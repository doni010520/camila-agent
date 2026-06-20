import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { AppOpenAIClient } from '../clients/openai.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { LeadCamilaRow } from '../clients/supabase.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { nowBRT } from '../domain/data-brt.js';
import { type EventoTipo, registrarEvento } from '../domain/eventos.js';
import { formatScheduleForPrompt } from '../domain/horario-funcionamento.js';
import { recessoInfoParaPrompt } from '../domain/recesso.js';
import { ChatMemory } from '../domain/memory.js';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { createRequestLogger } from '../infra/logger.js';
import { recordToolError } from '../infra/tool-error-tracker.js';
import type { ToolRegistry } from './tools/_registry.js';

// Load prompt template once at module init
const PROMPT_TEMPLATE = readFileSync(resolve(import.meta.dirname, 'prompt.md'), 'utf-8');

export interface AgentContext {
	telefone: string;
	mensagem: string;
	lead: LeadCamilaRow;
}

export interface AgentDeps {
	openai: AppOpenAIClient;
	uazapi: UazapiClient;
	supabase: AppSupabaseClient;
	memory: ChatMemory;
	toolRegistry: ToolRegistry;
	logger?: Logger;
}

/** Tabela de preços real (cache sincronizado da Trinks). A Helena deve usar
 *  ESTES valores — nunca inventar. Filtra serviços sem preço real. */
function formatCatalogoPrecos(servicos: Array<{ nome: string; preco?: number | null }>): string {
	const validos = servicos
		.filter((s) => (s.preco ?? 0) > 1)
		.sort((a, b) => a.nome.localeCompare(b.nome));
	if (validos.length === 0) return '';
	const linhas = validos.map((s) => `- ${s.nome}: R$${s.preco}`);
	return ['## Tabela de preços (fonte: Trinks — use SEMPRE estes valores, NUNCA invente)', '', ...linhas].join('\n');
}

function buildSystemPrompt(lead: LeadCamilaRow, catalogoPrecos: string): string {
	// Historical agendamentos (from lead metadata or empty)
	const historico = lead.ultimo_servico
		? `Último serviço: ${lead.ultimo_servico}${lead.ultimo_agendamento_em ? ` em ${lead.ultimo_agendamento_em}` : ''}`
		: 'Sem histórico de agendamentos.';

	// Hours since last catálogo send
	let pdfH = 'nunca';
	if (lead.pdf_catalogo_enviado_em) {
		const hours =
			(Date.now() - new Date(lead.pdf_catalogo_enviado_em).getTime()) / (1000 * 60 * 60);
		pdfH = String(Math.round(hours));
	}

	return PROMPT_TEMPLATE.replace('{{data_atual}}', nowBRT())
		.replace('{{cliente_nome}}', lead.nome ?? 'amiga')
		.replace('{{lead_etiquetas}}', lead.etiquetas.join(', ') || 'nenhuma')
		.replace('{{sinal_pago}}', lead.sinal_pago ? 'sim' : 'não')
		.replace('{{pdf_catalogo_enviado_h}}', pdfH)
		.replace('{{horario_expediente}}', formatScheduleForPrompt())
		.replace('{{recesso_info}}', recessoInfoParaPrompt())
		.replace('{{catalogo_precos}}', catalogoPrecos)
		.replace('{{historico_cliente}}', historico);
}

export async function runAgent(ctx: AgentContext, deps: AgentDeps): Promise<void> {
	const env = getEnv();
	const log = deps.logger ?? createRequestLogger(ctx.telefone);
	const maxTurns = env.AGENT_MAX_TURNS;

	// 1. Load memory
	const history = await deps.memory.loadRecent(ctx.telefone);
	const historyMessages = ChatMemory.toOpenAIMessages(history);

	// 2. Build system prompt (com tabela de preços real da Trinks)
	const servicos = await deps.supabase.listServicos().catch(() => []);
	const systemPrompt = buildSystemPrompt(ctx.lead, formatCatalogoPrecos(servicos));

	// 3. Build messages array
	const messages: ChatCompletionMessageParam[] = [
		{ role: 'system', content: systemPrompt },
		...(historyMessages as ChatCompletionMessageParam[]),
		{ role: 'user', content: ctx.mensagem },
	];

	// 4. Tool calling loop
	for (let turn = 0; turn < maxTurns; turn++) {
		const result = await deps.openai.chat({
			messages,
			tools: deps.toolRegistry.openAiSchemas(),
			temperature: 0.3,
		});

		const msg = result.message;
		messages.push(msg);

		// No tool calls → final text response
		if (!msg.tool_calls || msg.tool_calls.length === 0) {
			const text = msg.content ?? '';
			if (text) {
				await deps.uazapi.sendText(ctx.telefone, text);
			}

			// Save to memory
			await deps.memory.save(ctx.telefone, 'user', ctx.mensagem);
			if (text) await deps.memory.save(ctx.telefone, 'assistant', text);
			return;
		}

		// Process tool calls
		for (const tc of msg.tool_calls) {
			const tool = deps.toolRegistry.get(tc.function.name);
			if (!tool) {
				messages.push({
					role: 'tool',
					tool_call_id: tc.id,
					content: JSON.stringify({
						status: 'erro',
						razao: `Tool "${tc.function.name}" não existe`,
					}),
				});
				continue;
			}

			let args: Record<string, unknown>;
			try {
				args = JSON.parse(tc.function.arguments);
			} catch {
				messages.push({
					role: 'tool',
					tool_call_id: tc.id,
					content: JSON.stringify({ status: 'erro', razao: 'JSON inválido nos argumentos' }),
				});
				continue;
			}

			// Inject contextual fields automatically so the model never has to ask the client
			// for what we already have (telefone from chatid, nome from lead).
			args.telefone = ctx.telefone;
			if (ctx.lead.nome && !args.nome) {
				args.nome = ctx.lead.nome;
			}

			const parsed = tool.inputSchema.safeParse(args);
			if (!parsed.success) {
				messages.push({
					role: 'tool',
					tool_call_id: tc.id,
					content: JSON.stringify({
						status: 'erro',
						razao: 'Argumentos inválidos',
						detalhes: parsed.error.flatten(),
					}),
				});
				continue;
			}

			const toolCtx = {
				telefone: ctx.telefone,
				lead: {
					nome: ctx.lead.nome,
					etiquetas: ctx.lead.etiquetas,
					sinal_pago: ctx.lead.sinal_pago,
				},
			};

			const toolResult = await tool.handler(parsed.data, toolCtx);
			const resultStr = JSON.stringify(toolResult);
			log.info(
				{
					tool: tc.function.name,
					status: toolResult.status,
					args: JSON.stringify(parsed.data).slice(0, 300),
					result: resultStr.slice(0, 600),
				},
				'Tool executed',
			);
			if (toolResult.status === 'erro') {
				const razao = typeof toolResult.razao === 'string' ? toolResult.razao : 'erro sem razão';
				recordToolError(tc.function.name, razao, {
					sendAlert: async (text) => {
						// Alertas técnicos vão pro privado do dev, não pro grupo.
						const destino = env.UAZAPI_DEV_PHONE ?? env.UAZAPI_GRUPO_TIME;
						await deps.uazapi.sendText(destino, text);
					},
				});
			}

			// Instrumentação de eventos — best-effort, nunca bloqueia o fluxo
			{
				const toolToEvento: Partial<Record<string, EventoTipo>> = {
					criar_agendamento: 'agendamento_criado',
					cancelar_agendamento: 'agendamento_cancelado',
					reagendar_agendamento: 'agendamento_reagendado',
					envio_pix: 'pix_enviado',
					atualizar_sinal: 'sinal_pago',
					enviar_catalogo: 'catalogo_enviado',
					enviar_pdf_curso: 'curso_enviado',
					transferir_humano: 'transferido_humano',
				};
				const tipoEvento = toolToEvento[tc.function.name];
				if (tipoEvento) {
					const result = toolResult as Record<string, unknown>;
					const v = result.valor ?? result.valor_sinal;
					const valor = typeof v === 'number' ? v : typeof v === 'string' && !Number.isNaN(Number(v)) ? Number(v) : undefined;
					registrarEvento(deps.supabase, {
						telefone: ctx.telefone,
						cliente_nome: ctx.lead.nome ?? undefined,
						tipo: toolResult.status === 'erro' ? 'erro_tool' : tipoEvento,
						sucesso: toolResult.status !== 'erro',
						detalhes: {
							tool: tc.function.name,
							args: parsed.data as Record<string, unknown>,
							result,
						},
						valor,
					}).catch(() => undefined);
				}
			}

			messages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr });

			// NOTE: tool messages are NOT saved to long-term memory.
			// They are intermediate context for the agent loop only.
			// Saving them would corrupt the history (OpenAI requires `tool` to follow
			// an `assistant` with `tool_calls`, which we can't reconstruct from langchain format).
			// Only user input + final assistant response are persisted (see block above).
		}
	}

	// Max turns reached — emergency fallback
	log.error({ telefone: ctx.telefone.slice(-8), turns: maxTurns }, 'Agent stuck in loop');
	await deps.uazapi.sendText(
		ctx.telefone,
		'Desculpa, deu um probleminha aqui. Já chamei a Camila pra te responder 💖',
	);

	// Notify team about loop
	const notifyTool = deps.toolRegistry.get('notificar_time');
	if (notifyTool) {
		await notifyTool.handler(
			{
				motivo: 'Agente em loop',
				contexto: `Máximo de ${maxTurns} turnos atingido`,
				urgencia: 'alta',
			},
			{
				telefone: ctx.telefone,
				lead: {
					nome: ctx.lead.nome,
					etiquetas: ctx.lead.etiquetas,
					sinal_pago: ctx.lead.sinal_pago,
				},
			},
		);
	}
}
