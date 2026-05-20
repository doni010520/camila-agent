import { z } from 'zod';
import type { PostgresClient } from '../../clients/postgres.js';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { findClienteByTelefone } from '../../domain/cliente-lookup.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

import { ACTIVE_STATUSES } from "../../domain/trinks-status.js";

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
	agendamento_id: z
		.number()
		.optional()
		.describe('ID do agendamento. Se omitido e houver apenas 1 ativo, usa esse.'),
	nova_data_hora: z.string().describe("Nova data/hora ISO: '2026-05-30T14:00:00'"),
});

type Input = z.infer<typeof inputSchema>;

export function createReagendarAgendamento(deps: {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	postgres: PostgresClient;
}): ToolDefinition<Input> {
	const { trinks, supabase, postgres } = deps;

	return {
		name: 'reagendar_agendamento',
		description: 'Reagenda um agendamento existente para nova data/hora.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			const lookup = await findClienteByTelefone(input.telefone, { trinks, postgres });
			if (!lookup) return { status: 'erro', razao: 'Cliente não encontrado' };

			// Resolve agendamento_id
			let agId = input.agendamento_id;

			if (agId === undefined) {
				const result = await trinks.listAgendamentos({ clienteId: lookup.cliente.id });
				const ativos = result.data.filter((a) => ACTIVE_STATUSES.has(a.status.id));

				if (ativos.length === 0)
					return { status: 'erro', razao: 'Nenhum agendamento ativo encontrado' };
				if (ativos.length === 1 && ativos[0]) {
					agId = ativos[0].id;
				} else {
					return {
						status: 'aguardando_escolha',
						total: ativos.length,
						agendamentos: ativos.map((a) => ({
							id: a.id,
							servico: a.servico.nome,
							data_hora: a.dataHoraInicio,
						})),
					};
				}
			}

			// Get current agendamento to preserve fields (N3: handle error)
			let current: Awaited<ReturnType<typeof trinks.getAgendamento>>;
			try {
				current = await trinks.getAgendamento(agId);
			} catch (err) {
				return {
					status: 'erro',
					razao: `Não foi possível ler o agendamento atual: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// PUT update
			try {
				await trinks.updateAgendamento(agId, {
					clienteId: current.cliente.id,
					servicoId: current.servico.id,
					profissionalId: current.profissional.id,
					dataHoraInicio: input.nova_data_hora,
					duracaoEmMinutos: current.duracaoEmMinutos,
					valor: current.valor ?? undefined,
				});
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao reagendar: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// VERIFY
			try {
				const readBack = await trinks.getAgendamento(agId);
				// Compare only YYYY-MM-DDTHH:MM (ignore seconds, timezone) — same fix as criar_agendamento
				const normDH = (s: string) => {
					const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
					return m ? `${m[1]}T${m[2]}` : s;
				};
				if (normDH(readBack.dataHoraInicio) !== normDH(input.nova_data_hora)) {
					return {
						status: 'erro',
						razao: 'Reagendamento não confirmado: dataHoraInicio diverge',
						detalhes: { esperado: input.nova_data_hora, recebido: readBack.dataHoraInicio },
					};
				}

				try {
					await supabase.upsertAgendamento({ id: agId, data_hora_inicio: readBack.dataHoraInicio });
				} catch {
					/* best-effort */
				}

				try {
					await supabase.raw.from('logs_agendamentos').insert({
						evento: 'reagendamento_agendamento',
						agendamento_id: String(agId),
						cliente_id: lookup.cliente.id,
						detalhes: {
							data_anterior: current.dataHoraInicio,
							data_nova: input.nova_data_hora,
							reagendado_em: new Date().toISOString(),
						},
						criado_em: new Date().toISOString(),
					});
				} catch {
					/* best-effort */
				}

				return {
					status: 'ok',
					agendamento_id: agId,
					servico: readBack.servico.nome,
					data_hora_anterior: current.dataHoraInicio,
					data_hora_nova: readBack.dataHoraInicio,
				};
			} catch (err) {
				return {
					status: 'erro',
					razao: 'Reagendamento não confirmado por leitura subsequente',
					detalhes: { agendamentoId: agId },
				};
			}
		},
	};
}
