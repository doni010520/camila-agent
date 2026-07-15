import { z } from 'zod';
import type { UazapiClient } from '../../clients/uazapi.js';
import { nomeParecePessoa } from '../../domain/nome-cliente.js';
import { getEnv } from '../../infra/env.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	motivo: z.string().describe('Motivo da notificação'),
	contexto: z.string().describe('Contexto da conversa (resumo preparado pela Helena)'),
	urgencia: z.enum(['baixa', 'normal', 'alta']).optional().default('normal'),
});

type Input = z.infer<typeof inputSchema>;

export function createNotificarTime(deps: { uazapi: UazapiClient }): ToolDefinition<Input> {
	const { uazapi } = deps;

	return {
		name: 'notificar_time',
		description: 'Envia notificação para o grupo do time da Camila no WhatsApp. Sem LLM no meio.',
		inputSchema,
		handler: async (input: Input, ctx: ToolContext): Promise<ToolResult> => {
			const env = getEnv();
			const urgenciaEmoji =
				input.urgencia === 'alta' ? '🔴' : input.urgencia === 'normal' ? '🟡' : '🟢';
			// Não mostra nome de perfil que não é de pessoa (ex: "manicure").
			const nomeCliente = nomeParecePessoa(ctx.lead.nome) ? ctx.lead.nome : 'Cliente';
			const text = [
				`${urgenciaEmoji} *Notificação Helena*`,
				'',
				`*Motivo:* ${input.motivo}`,
				`*Cliente:* ${nomeCliente} (${ctx.telefone.slice(-8)})`,
				'',
				'*Contexto:*',
				input.contexto,
			].join('\n');

			try {
				await uazapi.sendText(env.UAZAPI_GRUPO_TIME, text);
				return { status: 'ok', mensagem: 'Time notificado.' };
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao notificar time: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}
		},
	};
}
