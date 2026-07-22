import { z } from 'zod';
import type { PostgresClient } from '../../clients/postgres.js';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { findClienteByTelefone } from '../../domain/cliente-lookup.js';
import { todayBRT } from '../../domain/data-brt.js';
import { ACTIVE_STATUSES } from '../../domain/trinks-status.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
	agendamento_id: z
		.number()
		.optional()
		.describe('ID do agendamento que o sinal confirma. Se omitido e houver 1 ativo, usa esse.'),
});

type Input = z.infer<typeof inputSchema>;

export function createAtualizarSinal(deps: {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	postgres: PostgresClient;
}): ToolDefinition<Input> {
	const { trinks, supabase, postgres } = deps;

	return {
		name: 'atualizar_sinal',
		description: 'Marca sinal como pago e confirma o agendamento no Trinks.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// 0. RESOLVE o agendamento real. O LLM às vezes passa índice (1) ou lixo
			//    (0), o que gerava PATCH /agendamentos/0 → 400 e o sinal não era
			//    registrado. Resolvemos contra a lista de ativos da cliente.
			let agendamentoId: number | undefined;
			try {
				const lookup = await findClienteByTelefone(input.telefone, { trinks, postgres });
				if (!lookup) return { status: 'erro', razao: 'Cliente não encontrado' };
				const lista = await trinks.listAgendamentos({
					clienteId: lookup.cliente.id,
					dataInicio: `${todayBRT()}T00:00:00`,
					dataFim: '2027-12-31T23:59:59',
				});
				const ativos = (lista.data ?? [])
					.filter((a) => ACTIVE_STATUSES.has(a.status.id))
					.sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio));

				if (ativos.length === 0) {
					return {
						status: 'erro',
						razao: 'Nenhum agendamento ativo encontrado pra confirmar o sinal.',
					};
				}

				const pedido = input.agendamento_id;
				if (pedido !== undefined && ativos.some((a) => a.id === pedido)) {
					agendamentoId = pedido; // ID real válido
				} else if (pedido !== undefined && pedido >= 1 && pedido <= ativos.length) {
					agendamentoId = ativos[pedido - 1]?.id; // era índice 1..N
				} else if (ativos.length === 1) {
					agendamentoId = ativos[0]?.id; // ID inválido/omitido, mas só há 1
				} else {
					return {
						status: 'aguardando_escolha',
						total: ativos.length,
						mensagem: 'Qual agendamento o sinal confirma?',
						agendamentos: ativos.map((a) => ({
							id: a.id,
							servico: a.servico.nome,
							data_hora: a.dataHoraInicio,
						})),
					};
				}
			} catch (err) {
				return {
					status: 'erro',
					razao: `Não consegui localizar o agendamento: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			if (!agendamentoId) {
				return { status: 'erro', razao: 'Não consegui identificar o agendamento do sinal.' };
			}

			// 1. Confirm agendamento in Trinks FIRST (before touching lead)
			try {
				await trinks.confirmarAgendamento(agendamentoId);
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao confirmar agendamento: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// 2. VERIFY: check status changed to 4 (Confirmado)
			try {
				const readBack = await trinks.getAgendamento(agendamentoId);
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
					await supabase.upsertAgendamento({ id: agendamentoId, status_id: 4 });
				} catch {
					/* best-effort */
				}

				return {
					status: 'ok',
					agendamento_id: agendamentoId,
					sinal_pago: true,
					agendamento_confirmado: true,
					mensagem: 'Sinal registrado e agendamento confirmado.',
				};
			} catch {
				return {
					status: 'erro',
					razao: 'Confirmação não verificada por leitura subsequente',
					detalhes: { agendamentoId },
				};
			}
		},
	};
}
