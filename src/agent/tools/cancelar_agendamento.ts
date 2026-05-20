import { z } from 'zod';
import type { PostgresClient } from '../../clients/postgres.js';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { findClienteByTelefone } from '../../domain/cliente-lookup.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

import { ACTIVE_STATUSES, TRINKS_STATUS } from '../../domain/trinks-status.js';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
	agendamento_id: z
		.number()
		.optional()
		.describe('ID do agendamento. Se omitido, lista todos ativos.'),
	motivo: z.string().optional().default('Cancelado a pedido do cliente'),
});

type Input = z.infer<typeof inputSchema>;

export function createCancelarAgendamento(deps: {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	postgres: PostgresClient;
}): ToolDefinition<Input> {
	const { trinks, supabase, postgres } = deps;

	return {
		name: 'cancelar_agendamento',
		description:
			'Cancela um agendamento. Se agendamento_id não informado, lista os ativos para a cliente escolher.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// 1. Find cliente
			const lookup = await findClienteByTelefone(input.telefone, { trinks, postgres });
			if (!lookup) return { status: 'erro', razao: 'Cliente não encontrado' };
			const clienteId = lookup.cliente.id;

			// 2. Sempre lista ativos primeiro (futuros — evita lixo histórico).
			//    Se agendamento_id veio do LLM, validamos que existe na lista —
			//    se não existir, o LLM alucinou; devolvemos `aguardando_escolha`
			//    em vez de tentar PATCH com ID inválido (e estourar 400/404).
			const hoje = new Date().toISOString().split('T')[0];
			const result = await trinks.listAgendamentos({
				clienteId: lookup.cliente.id,
				dataInicio: `${hoje}T00:00:00`,
				dataFim: '2027-12-31T23:59:59',
			});
			const ativos = result.data.filter((a) => ACTIVE_STATUSES.has(a.status.id));

			if (ativos.length === 0) {
				return { status: 'ok', total: 0, mensagem: 'Nenhum agendamento ativo encontrado.' };
			}

			if (input.agendamento_id !== undefined) {
				// IDs Trinks são grandes (>=1000). Se o LLM passar 1..N (índice 1-based)
				// resolvemos pra ID real da lista. Mitiga alucinação onde Helena envia
				// o número da posição em vez do ID real.
				let alvoId: number | undefined;
				if (input.agendamento_id >= 1 && input.agendamento_id <= ativos.length) {
					alvoId = ativos[input.agendamento_id - 1]?.id;
				} else if (ativos.some((a) => a.id === input.agendamento_id)) {
					alvoId = input.agendamento_id;
				}
				if (alvoId !== undefined) return await cancelAndVerify(alvoId, input.motivo);
				// ID inválido/alucinado: re-lista pra Helena escolher de novo
			}

			if (ativos.length === 1 && ativos[0]) {
				return await cancelAndVerify(ativos[0].id, input.motivo);
			}

			return {
				status: 'aguardando_escolha',
				total: ativos.length,
				agendamentos: ativos.map((a) => ({
					id: a.id,
					servico: a.servico.nome,
					data_hora: a.dataHoraInicio,
					profissional: a.profissional.nome,
					status: a.status.nome,
				})),
			};

			async function cancelAndVerify(agId: number, motivo: string): Promise<ToolResult> {
				// PATCH cancel
				try {
					await trinks.cancelarAgendamento(agId, { motivo });
				} catch (err) {
					return {
						status: 'erro',
						razao: `Falha ao cancelar: ${err instanceof Error ? err.message : 'unknown'}`,
					};
				}

				// VERIFY: GET and check status === 7 (Cancelado)
				try {
					const readBack = await trinks.getAgendamento(agId);
					if (readBack.status.id !== TRINKS_STATUS.CANCELADO) {
						return {
							status: 'erro',
							razao: `Cancelamento não confirmado. Status atual: ${readBack.status.nome} (${readBack.status.id})`,
						};
					}

					// Mirror to Supabase (best-effort)
					try {
						await supabase.upsertAgendamento({ id: agId, status_id: TRINKS_STATUS.CANCELADO });
					} catch {
						/* best-effort */
					}

					// Log (best-effort) — real columns: evento, detalhes, criado_em
					try {
						await supabase.raw.from('logs_agendamentos').insert({
							evento: 'cancelamento_agendamento',
							agendamento_id: String(agId),
							cliente_id: clienteId,
							detalhes: { motivo, cancelado_em: new Date().toISOString() },
							criado_em: new Date().toISOString(),
						});
					} catch {
						/* best-effort */
					}

					return {
						status: 'ok',
						agendamento_id: agId,
						servico: readBack.servico.nome,
						data_hora: readBack.dataHoraInicio,
						mensagem: `Agendamento de ${readBack.servico.nome} cancelado com sucesso.`,
					};
				} catch (err) {
					return {
						status: 'erro',
						razao: 'Cancelamento não confirmado por leitura subsequente',
						detalhes: {
							agendamentoId: agId,
							error: err instanceof Error ? err.message : 'unknown',
						},
					};
				}
			}
		},
	};
}
