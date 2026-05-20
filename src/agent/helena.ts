import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import type { AppOpenAIClient } from '../clients/openai.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { LeadCamilaRow } from '../clients/supabase.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { nowBRT } from '../domain/data-brt.js';
import { formatScheduleForPrompt } from '../domain/horario-funcionamento.js';
import { ChatMemory } from '../domain/memory.js';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { createRequestLogger } from '../infra/logger.js';
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

function buildSystemPrompt(lead: LeadCamilaRow): string {
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
		.replace('{{historico_cliente}}', historico);
}

export async function runAgent(ctx: AgentContext, deps: AgentDeps): Promise<void> {
	const env = getEnv();
	const log = deps.logger ?? createRequestLogger(ctx.telefone);
	const maxTurns = env.AGENT_MAX_TURNS;

	// 1. Load memory
	const history = await deps.memory.loadRecent(ctx.telefone);
	const historyMessages = ChatMemory.toOpenAIMessages(history);

	// 2. Build system prompt
	const systemPrompt = buildSystemPrompt(ctx.lead);

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
