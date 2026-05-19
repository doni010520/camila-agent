import { z } from 'zod';
import type { PostgresClient } from '../../clients/postgres.js';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { findClienteByTelefone } from '../../domain/cliente-lookup.js';
import { parsePhone } from '../../domain/telefone.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente (E.164)'),
	nome: z.string().describe('Nome da cliente'),
	servico: z.string().describe('Nome do serviço'),
	data_e_hora: z.string().describe("Data e hora ISO: '2026-05-29T17:00:00'"),
});

type Input = z.infer<typeof inputSchema>;

export function createCriarAgendamento(deps: {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	postgres: PostgresClient;
	profissionalId: number;
}): ToolDefinition<Input> {
	const { trinks, supabase, postgres, profissionalId } = deps;

	return {
		name: 'criar_agendamento',
		description:
			'Cria um novo agendamento no Trinks. Retorna status ok SOMENTE se a leitura de verificação confirmar a escrita.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// 1. Resolve serviço
			const servico = await supabase.findServicoByName(input.servico);
			if (!servico) {
				return { status: 'erro', razao: `Serviço "${input.servico}" não encontrado` };
			}

			// 2. Lookup or create cliente in Trinks
			const lookupResult = await findClienteByTelefone(input.telefone, { trinks, postgres });
			let clienteId: number;
			let clienteNovo = false;

			if (lookupResult) {
				clienteId = lookupResult.cliente.id;
			} else {
				// Create new cliente
				const parts = parsePhone(input.telefone);
				if (!parts) return { status: 'erro', razao: 'Telefone inválido para criar cliente' };

				const created = await trinks.createCliente({
					nome: input.nome,
					telefones: [{ ddi: parts.ddi, ddd: parts.ddd, numero: parts.numero, tipoId: 1 }],
				});
				clienteId = created.id;
				clienteNovo = true;
			}

			// 3. POST create agendamento
			let agendamentoId: number;
			try {
				const created = await trinks.createAgendamento({
					clienteId,
					servicoId: servico.id,
					profissionalId,
					dataHoraInicio: input.data_e_hora,
					duracaoEmMinutos: servico.duracao_minutos,
					valor: servico.preco ?? undefined,
					observacoes: '',
					confirmado: false,
				});
				agendamentoId = created.id;
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Erro desconhecido';
				return { status: 'erro', razao: `Falha ao criar agendamento: ${msg}` };
			}

			// 4. VERIFY: GET the agendamento back and check consistency
			try {
				const readBack = await trinks.getAgendamento(agendamentoId);

				// Verify key fields match
				if (readBack.dataHoraInicio !== input.data_e_hora) {
					return {
						status: 'erro',
						razao: 'Escrita não confirmada: dataHoraInicio diverge',
						detalhes: { esperado: input.data_e_hora, recebido: readBack.dataHoraInicio },
					};
				}

				if (readBack.servico.id !== servico.id) {
					return {
						status: 'erro',
						razao: 'Escrita não confirmada: serviço diverge',
						detalhes: { esperado: servico.id, recebido: readBack.servico.id },
					};
				}

				// 5. Mirror to Supabase (best-effort — Trinks is source of truth)
				try {
					await supabase.upsertAgendamento({
						id: agendamentoId,
						status_id: readBack.status.id,
						cliente_id: readBack.cliente.id,
						cliente_nome: readBack.cliente.nome,
						servico_id: readBack.servico.id,
						servico_nome: readBack.servico.nome,
						profissional_id: readBack.profissional.id,
						profissional_nome: readBack.profissional.nome,
						data_hora_inicio: readBack.dataHoraInicio,
						duracao_em_minutos: readBack.duracaoEmMinutos,
						valor: readBack.valor ?? undefined,
						numero: input.telefone,
					});
				} catch {
					/* best-effort */
				}

				// 6. Update lead (best-effort)
				try {
					await supabase.raw
						.from('leads_energia_solar')
						.update({
							ultimo_servico: readBack.servico.nome,
							ultimo_agendamento_em: new Date().toISOString(),
						})
						.eq('telefone', input.telefone);
				} catch {
					/* best-effort */
				}

				return {
					status: 'ok',
					agendamento_id: agendamentoId,
					cliente_id: clienteId,
					cliente_nome: readBack.cliente.nome,
					servico_nome: readBack.servico.nome,
					data_hora_inicio: readBack.dataHoraInicio,
					duracao_em_minutos: readBack.duracaoEmMinutos,
					valor: readBack.valor ?? 0,
					cliente_novo: clienteNovo,
				};
			} catch (err) {
				// GET failed — ghost scenario: POST said ok but we can't verify
				return {
					status: 'erro',
					razao: 'Escrita não confirmada por leitura subsequente',
					detalhes: { agendamentoId, error: err instanceof Error ? err.message : 'unknown' },
				};
			}
		},
	};
}
