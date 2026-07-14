import { z } from 'zod';
import type { PostgresClient } from '../../clients/postgres.js';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { isNumeroBloqueado } from '../../domain/bloqueio.js';
import { findClienteByTelefone } from '../../domain/cliente-lookup.js';
import { dataEstaNoRecesso, dataRetornoRecesso } from '../../domain/recesso.js';
import { servicoIndisponivel } from '../../domain/servico-indisponivel.js';
import { todayBRT, trinksWallClockToEpochMin } from '../../domain/data-brt.js';
import { horarioCabeNosVagos } from '../../domain/horario-funcionamento.js';
import { parsePhone } from '../../domain/telefone.js';
import { ACTIVE_STATUSES } from '../../domain/trinks-status.js';
import {
	getCachedAgendamento,
	rememberAgendamento,
} from '../../infra/agendamento-cache.js';
import { lockKey, withAgendamentoLock } from '../../infra/agendamento-lock.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente (E.164)'),
	nome: z.string().describe('Nome da cliente'),
	servico: z.string().describe('Nome do serviço'),
	data_e_hora: z.string().describe("Data e hora ISO: '2026-05-29T17:00:00'"),
	agendamento_adicional: z
		.boolean()
		.optional()
		.describe(
			'Só passe true se a cliente confirmou EXPLICITAMENTE que quer um agendamento ADICIONAL, mantendo o(s) que já tem. Para remarcar/mudar data use reagendar_agendamento, NÃO isto.',
		),
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
			// Número bloqueado: nunca cria agendamento. Defesa em profundidade — se
			// a cliente der data/hora direto (pulando consultar_disponibilidade),
			// ainda assim recusamos. Sem encaixe, sem avisar a Camila.
			if (isNumeroBloqueado(_ctx.telefone) || isNumeroBloqueado(input.telefone)) {
				return {
					status: 'erro',
					razao:
						'Responda com carinho e gentileza que, no momento, não temos horários disponíveis na agenda. Seja acolhedora. NUNCA diga, insinue ou deixe transparecer que a cliente está bloqueada, impedida ou em qualquer lista — isso é interno e jamais pode ser revelado. Não ofereça encaixe, não cite lista de espera e não acione a Camila.',
				};
			}

			// Serviço indisponível (sem profissional): não agenda.
			if (servicoIndisponivel(input.servico)) {
				return {
					status: 'erro',
					razao:
						'Esse serviço está indisponível no momento (sem profissional). Informe a cliente com carinho que não estamos oferecendo esse serviço agora. NÃO agende.',
				};
			}

			// RECESSO: não agenda para datas dentro do recesso da Camila.
			if (dataEstaNoRecesso(input.data_e_hora)) {
				const retorno = dataRetornoRecesso();
				return {
					status: 'erro',
					razao: `A Camila estará de recesso nessa data, sem atendimento. Explique com carinho que nesse período ela está de recesso e ofereça agendar a partir de ${retorno}. NÃO ofereça encaixe nem diga que vai chamar a Camila.`,
				};
			}

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

			// 3a-PRE. Cache local in-process — mais rápido e imune a eventual consistency
			// do Trinks. Cobre o caso real: Helena criou agendamento, cliente respondeu
			// algo ambíguo 5min depois, Helena re-chamou criar_agendamento e o Trinks
			// ainda não tinha indexado o primeiro POST -> duplicata.
			const cachedId = getCachedAgendamento(input.telefone, input.data_e_hora);
			if (cachedId !== null) {
				try {
					const ag = await trinks.getAgendamento(cachedId);
					if (ACTIVE_STATUSES.has(ag.status.id)) {
						return {
							status: 'ok',
							agendamento_id: ag.id,
							cliente_id: ag.cliente.id,
							cliente_nome: ag.cliente.nome,
							servico_nome: ag.servico.nome,
							data_hora_inicio: ag.dataHoraInicio,
							duracao_em_minutos: ag.duracaoEmMinutos ?? 0,
							valor: ag.valor ?? 0,
							cliente_novo: false,
							ja_existia: true,
						};
					}
				} catch {
					/* cache stale (foi cancelado, etc.) — segue pro fluxo normal */
				}
			}

			// LOCK por profissional+dia: serializa criações concorrentes pra eliminar
			// race na verificação de disponibilidade (eventual consistency do Trinks).
			// Duas clientes pedindo o mesmo horário ao mesmo tempo agora rodam em série —
			// a segunda só valida DEPOIS da primeira ter criado, então enxerga o ocupado.
			return await withAgendamentoLock(lockKey(profissionalId, input.data_e_hora), async () => {
			// 3a. IDEMPOTENCY + ANTI-DUPLICAÇÃO (QUALQUER DIA FUTURO)
			// (a) Mesmo horário e mesmo cliente -> retorna existente (idempotency)
			// (b) Já tem agendamento ativo em QUALQUER data futura -> recusa e força
			//     reagendar. Antes só olhava o MESMO DIA, então remarcar pra outro
			//     dia via criar_agendamento gerava DOIS ativos (bug relatado: "ela
			//     remarca mas não tira o anterior"). Exceção: agendamento_adicional
			//     = true (cliente confirmou explicitamente que quer um a mais).
			try {
				const hojeStr = todayBRT();
				const existing = await trinks.listAgendamentos({
					clienteId,
					dataInicio: `${hojeStr}T00:00:00`,
					dataFim: '2027-12-31T23:59:59',
				});
				const ativos = (existing.data ?? []).filter((a) => ACTIVE_STATUSES.has(a.status.id));
				const dup = ativos.find(
					(a) => a.dataHoraInicio.substring(0, 16) === input.data_e_hora.substring(0, 16),
				);
				if (dup) {
					// (a) idempotency — mesmo horário, retorna o existente
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
				if (ativos.length > 0 && !input.agendamento_adicional) {
					// (b) Já existe ativo futuro. Quase sempre a cliente quer MUDAR a
					//     data (remarcar), não criar um segundo. Bloqueia e orienta.
					return {
						status: 'erro',
						razao:
							'A cliente JÁ TEM agendamento(s) ativo(s) (veja abaixo). Se ela quer MUDAR a data/horário, chame reagendar_agendamento com o agendamento_id existente + nova_data_hora — NÃO crie outro. Só crie um novo (agendamento_adicional=true) se a cliente confirmou EXPLICITAMENTE que quer um agendamento a mais, mantendo o que já tem.',
						detalhes: {
							existentes: ativos.map((a) => ({
								id: a.id,
								servico: a.servico.nome,
								data_hora: a.dataHoraInicio,
							})),
						},
					};
				}
			} catch {
				/* idempotency check is best-effort; fall through to create */
			}

			// 3a-DISPONIBILIDADE (FAIL-CLOSED): valida o horário contra horariosVagos
			// do Trinks — a FONTE DE VERDADE que o painel usa. Desconta agendamentos
			// de cliente E bloqueios manuais (ex: "Lanche", almoço, dia fechado).
			//
			// CRÍTICO: se NÃO conseguirmos validar (erro de API, profissional ausente),
			// NÃO criamos às cegas — recusamos. Conflitar horário é pior que pedir
			// pra cliente tentar de novo. "Nunca conflitar" é regra de ouro.
			try {
				const dataDiaDisp = input.data_e_hora.substring(0, 10);
				const horaInicio = input.data_e_hora.substring(11, 16); // "HH:MM"
				const agenda = await trinks.listProfissionaisComAgenda(dataDiaDisp);
				const prof = agenda.data.find((p) => p.id === profissionalId);
				if (!prof) {
					return {
						status: 'erro',
						razao:
							'Não consegui confirmar a disponibilidade da agenda nesse dia. Chame consultar_disponibilidade pra ver os horários livres antes de marcar.',
						detalhes: { dia: dataDiaDisp, motivo: 'profissional_sem_agenda' },
					};
				}
				if (!horarioCabeNosVagos(horaInicio, servico.duracao_minutos, prof.horariosVagos)) {
					return {
						status: 'erro',
						razao:
							'Horário indisponível na agenda da profissional (ocupado, bloqueado ou fora do expediente). NÃO insista nesse horário. Chame consultar_disponibilidade pra ver os horários realmente livres e ofereça à cliente.',
						detalhes: {
							horario_pedido: horaInicio,
							duracao_min: servico.duracao_minutos,
							horarios_vagos: prof.horariosVagos,
						},
					};
				}
			} catch (err) {
				// FAIL-CLOSED: não conseguimos verificar → não arriscamos conflito.
				return {
					status: 'erro',
					razao:
						'Tive um probleminha técnico pra confirmar a agenda agora. Diga à cliente que vai verificar e tentar em instantes (NÃO confirme o horário ainda).',
					detalhes: { erro: err instanceof Error ? err.message : 'unknown' },
				};
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
				// Horário de parede BRT (imune a Z/offset inconsistente do Trinks)
				const propostoInicio = trinksWallClockToEpochMin(input.data_e_hora);
				const propostoFim = propostoInicio + servico.duracao_minutos;
				const conflito = (ocupacao.data ?? []).find((a) => {
					if (!ACTIVE_STATUSES.has(a.status.id)) return false;
					const ini = trinksWallClockToEpochMin(a.dataHoraInicio);
					const fim = ini + (a.duracaoEmMinutos ?? 60);
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
					// Carimbo de rastreabilidade: aparece no painel do Trinks e permite
					// distinguir agendamentos da Helena dos feitos manualmente pela Camila.
					observacoes: '🤖 Agendado pela Helena (assistente virtual)',
					confirmado: false,
				});
				agendamentoId = created.id;
				// Memoriza imediatamente — mesmo antes de verify — pra não duplicar se
				// o agent re-chamar entre POST e GET verify.
				rememberAgendamento(input.telefone, input.data_e_hora, agendamentoId);
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
			}); // fim withAgendamentoLock
		},
	};
}
