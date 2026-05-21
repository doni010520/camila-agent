import { z } from 'zod';
import type { PostgresClient } from '../../clients/postgres.js';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { findClienteByTelefone } from '../../domain/cliente-lookup.js';
import { parsePhone } from '../../domain/telefone.js';
import { ACTIVE_STATUSES } from '../../domain/trinks-status.js';
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

			// 3a. IDEMPOTENCY: check if cliente already has an active agendamento at this time
			// Prevents duplicate creation when agent retries (e.g. after timezone mismatch in verify).
			const dataDia = input.data_e_hora.substring(0, 10); // 'YYYY-MM-DD'
			try {
				const existing = await trinks.listAgendamentos({
					clienteId,
					dataInicio: `${dataDia}T00:00:00`,
					dataFim: `${dataDia}T23:59:59`,
				});
				const dup = existing.data?.find((a) => {
					const sameHour = a.dataHoraInicio.substring(0, 16) === input.data_e_hora.substring(0, 16);
					return sameHour && ACTIVE_STATUSES.has(a.status.id);
				});
				if (dup) {
					return {
						status: 'ok',
						agendamento_id: dup.id,
						cliente_id: dup.cliente.id,
						cliente_nome: dup.cliente.nome,
						servico_nome: dup.servico.nome,
						data_hora_inicio: dup.dataHoraInicio,
						duracao_em_minutos: dup.duracaoEmMinutos,
						valor: dup.valor ?? 0,
						cliente_novo: false,
						ja_existia: true,
					};
				}
			} catch {
				/* idempotency check is best-effort; fall through to create */
			}

			// 3aa. CHECK CONFLITO: profissional já tem agendamento ativo sobrepondo o horário?
			// Trinks NÃO bloqueia overlap — temos que validar nós mesmos antes de POST.
			try {
				const dataDiaConflito = input.data_e_hora.substring(0, 10);
				const ocupacao = await trinks.listAgendamentos({
					profissionalId,
					dataInicio: `${dataDiaConflito}T00:00:00`,
					dataFim: `${dataDiaConflito}T23:59:59`,
				});
				const propostoInicio = new Date(`${input.data_e_hora}${input.data_e_hora.includes('-03') || input.data_e_hora.endsWith('Z') ? '' : '-03:00'}`).getTime();
				const propostoFim = propostoInicio + servico.duracao_minutos * 60_000;
				const conflito = (ocupacao.data ?? []).find((a) => {
					if (!ACTIVE_STATUSES.has(a.status.id)) return false;
					const ini = new Date(`${a.dataHoraInicio}${a.dataHoraInicio.includes('-03') || a.dataHoraInicio.endsWith('Z') ? '' : '-03:00'}`).getTime();
					const fim = ini + (a.duracaoEmMinutos ?? 60) * 60_000;
					return propostoInicio < fim && propostoFim > ini;
				});
				if (conflito) {
					return {
						status: 'erro',
						razao: 'Horário indisponível: a profissional já tem outro atendimento nesse intervalo. Ofereça outro horário.',
						detalhes: {
							conflitoComServico: conflito.servico.nome,
							conflitoDataHora: conflito.dataHoraInicio,
							conflitoDuracao: conflito.duracaoEmMinutos,
						},
					};
				}
			} catch (err) {
				// Falha na consulta? Loga e segue — preferimos não bloquear cliente por bug na verificação,
				// mas se Trinks rejeitar o POST por overlap nativo (caso ative), volta erro normal.
				// eslint-disable-next-line no-console
				console.warn('Conflict check failed, prosseguindo:', err);
			}

			// 3b. POST create agendamento
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

				// Verify key fields match. Compare only YYYY-MM-DDTHH:MM (ignore seconds, timezone, fractional ms)
				// because Helena may pass "2026-05-22T17:30:00-03:00" or with .000Z while Trinks
				// returns "2026-05-22T17:30:00" naked. Same moment, different string.
				const normDH = (s: string) => {
					const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
					return m ? `${m[1]}T${m[2]}` : s;
				};
				if (normDH(readBack.dataHoraInicio) !== normDH(input.data_e_hora)) {
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
