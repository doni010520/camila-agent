import { z } from 'zod';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
	agendamento_id: z.number().describe('ID do agendamento que o sinal confirma'),
});

type Input = z.infer<typeof inputSchema>;

export function createAtualizarSinal(deps: {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
}): ToolDefinition<Input> {
	const { trinks, supabase } = deps;

	return {
		name: 'atualizar_sinal',
		description: 'Marca sinal como pago e confirma o agendamento no Trinks.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// 1. Confirm agendamento in Trinks FIRST (before touching lead)
			try {
				await trinks.confirmarAgendamento(input.agendamento_id);
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao confirmar agendamento: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// 2. VERIFY: check status changed to 4 (Confirmado)
			try {
				const readBack = await trinks.getAgendamento(input.agendamento_id);
				if (readBack.status.id !== 4) {
					return {
						status: 'erro',
						razao: `Confirmação não verificada. Status atual: ${readBack.status.nome} (${readBack.status.id})`,
					};
				}

				// 3. Only NOW update lead (Trinks confirmed successfully)
				try {
					await supabase.raw
						.from('leads_energia_solar')
						.update({ sinal_pago: true, agendamento_pendente_id: null })
						.eq('telefone', input.telefone);
				} catch {
					/* best-effort: Trinks is source of truth */
				}

				// Mirror confirmation to Supabase (best-effort)
				try {
					await supabase.upsertAgendamento({ id: input.agendamento_id, status_id: 4 });
				} catch {
					/* best-effort */
				}

				return {
					status: 'ok',
					agendamento_id: input.agendamento_id,
					sinal_pago: true,
					agendamento_confirmado: true,
					mensagem: 'Sinal registrado e agendamento confirmado.',
				};
			} catch (err) {
				return {
					status: 'erro',
					razao: 'Confirmação não verificada por leitura subsequente',
					detalhes: { agendamentoId: input.agendamento_id },
				};
			}
		},
	};
}
