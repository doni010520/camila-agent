import { z } from 'zod';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { TRINKS_STATUS } from '../../domain/trinks-status.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	agendamento_id: z.number().describe('ID do agendamento'),
});

type Input = z.infer<typeof inputSchema>;

export function createMarcarFalta(deps: {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
}): ToolDefinition<Input> {
	const { trinks, supabase } = deps;

	return {
		name: 'marcar_falta',
		description: 'Marca que a cliente não compareceu ao agendamento.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// PATCH
			try {
				await trinks.marcarClienteFaltou(input.agendamento_id);
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao marcar falta: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// VERIFY: status deve virar CLIENTE_FALTOU (6, medido na API)
			try {
				const readBack = await trinks.getAgendamento(input.agendamento_id);
				if (readBack.status.id !== TRINKS_STATUS.CLIENTE_FALTOU) {
					return {
						status: 'erro',
						razao: `Falta não confirmada. Status atual: ${readBack.status.nome} (${readBack.status.id})`,
					};
				}

				try {
					await supabase.upsertAgendamento({
						id: input.agendamento_id,
						status_id: TRINKS_STATUS.CLIENTE_FALTOU,
					});
				} catch {
					/* best-effort */
				}

				return {
					status: 'ok',
					agendamento_id: input.agendamento_id,
					mensagem: 'Falta registrada com sucesso.',
				};
			} catch (err) {
				return {
					status: 'erro',
					razao: 'Falta não confirmada por leitura subsequente',
					detalhes: { agendamentoId: input.agendamento_id },
				};
			}
		},
	};
}
