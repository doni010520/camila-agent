import { z } from 'zod';
import type { UazapiClient } from '../../clients/uazapi.js';
import type { LeadManager } from '../../domain/lead.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';
import { createNotificarTime } from './notificar_time.js';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
	motivo: z.string().describe('Motivo da transferência'),
});

type Input = z.infer<typeof inputSchema>;

export function createTransferirHumano(deps: {
	uazapi: UazapiClient;
	leadManager: LeadManager;
}): ToolDefinition<Input> {
	const { uazapi, leadManager } = deps;
	const notificarTime = createNotificarTime({ uazapi });

	return {
		name: 'transferir_humano',
		description: 'Desativa a IA para este cliente e notifica a Camila para atendimento humano.',
		inputSchema,
		handler: async (input: Input, ctx: ToolContext): Promise<ToolResult> => {
			// 1. Disable IA for this lead
			try {
				await leadManager.setIaAtiva(input.telefone, false);
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao desativar IA: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// 2. Notify team
			try {
				await notificarTime.handler(
					{
						motivo: `Transferência: ${input.motivo}`,
						contexto: `Cliente ${ctx.lead.nome ?? 'não identificada'} solicitou atendimento humano.`,
						urgencia: 'normal',
					},
					ctx,
				);
			} catch {
				/* best-effort: IA already disabled, that's what matters */
			}

			// 3. Send message to client
			try {
				await uazapi.sendText(
					input.telefone,
					'Já chamei a Camila pra te responder. Em breve ela te chama por aqui 💖',
				);
			} catch {
				/* best-effort */
			}

			return { status: 'ok', ia_ativa: false, mensagem: 'Transferência realizada.' };
		},
	};
}
