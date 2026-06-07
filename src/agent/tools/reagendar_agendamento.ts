import { z } from 'zod';
import type { PostgresClient } from '../../clients/postgres.js';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { findClienteByTelefone } from '../../domain/cliente-lookup.js';
import { trinksWallClockToEpochMin } from '../../domain/data-brt.js';
import { horarioCabeNosVagos } from '../../domain/horario-funcionamento.js';
import { ACTIVE_STATUSES, TRINKS_STATUS } from '../../domain/trinks-status.js';
import { rememberAgendamento } from '../../infra/agendamento-cache.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	telefone: z.string().describe('Telefone da cliente'),
	agendamento_id: z
		.number()
		.optional()
		.describe('ID do agendamento. Se omitido e houver apenas 1 ativo, usa esse.'),
	nova_data_hora: z.string().describe("Nova data/hora ISO: '2026-05-30T14:00:00'"),
});

type Input = z.infer<typeof inputSchema>;

/**
 * Reagendar = CANCELAR antigo + CRIAR novo.
 *
 * Decisão de produto: queremos histórico explícito (agendamento antigo fica como
 * `Cancelado` na Trinks, novo entra como `Aguardando confirmação`). Permite rastrear
 * "movimento" via logs_agendamentos.
 *
 * NÃO usamos PUT /v1/agendamentos (update in-place) porque isso perde o histórico
 * do horário anterior.
 */
export function createReagendarAgendamento(deps: {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	postgres: PostgresClient;
}): ToolDefinition<Input> {
	const { trinks, supabase, postgres } = deps;

	return {
		name: 'reagendar_agendamento',
		description:
			'Reagenda um agendamento. Cancela o antigo e cria um novo na nova data/hora — mantém histórico.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			const lookup = await findClienteByTelefone(input.telefone, { trinks, postgres });
			if (!lookup) return { status: 'erro', razao: 'Cliente não encontrado' };
			const clienteId = lookup.cliente.id;

			// 1. Sempre lista ativos primeiro. Se agendamento_id veio mas não existe
			//    na lista, é alucinação do LLM → devolve aguardando_escolha.
			const hoje = new Date().toISOString().split('T')[0];
			const listResult = await trinks.listAgendamentos({
				clienteId,
				dataInicio: `${hoje}T00:00:00`,
				dataFim: '2027-12-31T23:59:59',
			});
			const ativos = listResult.data
				.filter((a) => ACTIVE_STATUSES.has(a.status.id))
				.sort((a, b) => a.dataHoraInicio.localeCompare(b.dataHoraInicio));

			if (ativos.length === 0) {
				return { status: 'erro', razao: 'Nenhum agendamento ativo encontrado para reagendar' };
			}

			let agIdAntigo: number | undefined;
			if (input.agendamento_id !== undefined) {
				// IDs Trinks são grandes (>=1000). Se o LLM passar 1..N (índice 1-based),
				// resolvemos pra ID real da lista. Mitiga alucinação.
				if (input.agendamento_id >= 1 && input.agendamento_id <= ativos.length) {
					agIdAntigo = ativos[input.agendamento_id - 1]?.id;
				} else if (ativos.some((a) => a.id === input.agendamento_id)) {
					agIdAntigo = input.agendamento_id;
				}
				// senão: cai pro fluxo de escolha abaixo
			}

			if (agIdAntigo === undefined) {
				if (ativos.length === 1 && ativos[0]) {
					agIdAntigo = ativos[0].id;
				} else {
					return {
						status: 'aguardando_escolha',
						total: ativos.length,
						mensagem: 'Qual agendamento você quer reagendar?',
						agendamentos: ativos.map((a) => ({
							id: a.id,
							servico: a.servico.nome,
							data_hora: a.dataHoraInicio,
						})),
					};
				}
			}

			// 2. Lê o agendamento antigo (precisa dos campos pra recriar)
			let antigo: Awaited<ReturnType<typeof trinks.getAgendamento>>;
			try {
				antigo = await trinks.getAgendamento(agIdAntigo);
			} catch (err) {
				return {
					status: 'erro',
					razao: `Não foi possível ler o agendamento antigo: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			const dataAnterior = antigo.dataHoraInicio;

			// 2.4 DISPONIBILIDADE: novo horário precisa estar nos horariosVagos do Trinks
			// (fonte de verdade — desconta agendamentos + bloqueios + expediente).
			try {
				const dataDiaDisp = input.nova_data_hora.substring(0, 10);
				const horaInicio = input.nova_data_hora.substring(11, 16);
				const agenda = await trinks.listProfissionaisComAgenda(dataDiaDisp);
				const prof = agenda.data.find((p) => p.id === antigo.profissional.id);
				if (prof) {
					// soma o slot do próprio antigo como "vago" se for no mesmo dia
					// (ele será cancelado), pra permitir reagendar dentro da própria janela
					const vagos = new Set(prof.horariosVagos);
					if (antigo.dataHoraInicio.substring(0, 10) === dataDiaDisp) {
						const hIni = antigo.dataHoraInicio.substring(11, 16);
						const slots = Math.max(1, Math.ceil((antigo.duracaoEmMinutos ?? 60) / 30));
						const partes = hIni.split(':');
						let hh = Number(partes[0] ?? 0);
						let mm = Number(partes[1] ?? 0);
						for (let i = 0; i < slots; i++) {
							vagos.add(`${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`);
							mm += 30; if (mm >= 60) { hh += 1; mm -= 60; }
						}
					}
					if (!horarioCabeNosVagos(horaInicio, antigo.duracaoEmMinutos ?? 60, Array.from(vagos))) {
						return {
							status: 'erro',
							razao:
								'Novo horário indisponível na agenda (ocupado, bloqueado ou fora do expediente). Mantenha o antigo e use consultar_disponibilidade pra oferecer horários livres.',
							detalhes: { horario_pedido: horaInicio, agendamentoAntigoIntacto: agIdAntigo, horarios_vagos: prof.horariosVagos },
						};
					}
				}
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn('Reagendar disponibilidade check failed:', err);
			}

			// 2.5 CHECK CONFLITO no novo horário ANTES de cancelar o antigo.
			// Trinks não bloqueia overlap — validamos aqui pra não criar dupla agenda.
			try {
				const dataDia = input.nova_data_hora.substring(0, 10);
				const ocupacao = await trinks.listAgendamentos({
					profissionalId: antigo.profissional.id,
					dataInicio: `${dataDia}T00:00:00`,
					dataFim: `${dataDia}T23:59:59`,
				});
				// Horário de parede BRT (imune a Z/offset inconsistente do Trinks)
				const propostoInicio = trinksWallClockToEpochMin(input.nova_data_hora);
				const propostoFim = propostoInicio + (antigo.duracaoEmMinutos ?? 60);
				const conflito = (ocupacao.data ?? []).find((a) => {
					if (a.id === agIdAntigo) return false; // o antigo vai ser cancelado
					if (!ACTIVE_STATUSES.has(a.status.id)) return false;
					const ini = trinksWallClockToEpochMin(a.dataHoraInicio);
					const fim = ini + (a.duracaoEmMinutos ?? 60);
					return propostoInicio < fim && propostoFim > ini;
				});
				if (conflito) {
					return {
						status: 'erro',
						razao: 'Novo horário indisponível: a profissional já tem outro atendimento nesse intervalo. Mantenha o antigo e ofereça outro horário pra cliente.',
						detalhes: {
							conflitoComServico: conflito.servico.nome,
							conflitoDataHora: conflito.dataHoraInicio,
							agendamentoAntigoIntacto: agIdAntigo,
						},
					};
				}
			} catch (err) {
				// eslint-disable-next-line no-console
				console.warn('Reagendar conflict check failed, prosseguindo:', err);
			}

			// 3. CANCELA o antigo (PATCH /status/cancelado)
			try {
				await trinks.cancelarAgendamento(agIdAntigo, { motivo: 'Reagendamento' });
			} catch (err) {
				return {
					status: 'erro',
					razao: `Falha ao cancelar o agendamento antigo: ${err instanceof Error ? err.message : 'unknown'}`,
				};
			}

			// 4. Verify cancelamento (status do antigo deve ser Cancelado)
			try {
				const readOld = await trinks.getAgendamento(agIdAntigo);
				if (readOld.status.id !== TRINKS_STATUS.CANCELADO) {
					return {
						status: 'erro',
						razao: `Cancelamento do antigo não confirmado. Status atual: ${readOld.status.nome}`,
					};
				}
			} catch (err) {
				return {
					status: 'erro',
					razao: 'Não foi possível verificar cancelamento do antigo',
					detalhes: { agIdAntigo, error: err instanceof Error ? err.message : 'unknown' },
				};
			}

			// 5. CRIA o novo agendamento na nova data
			let agIdNovo: number;
			try {
				const created = await trinks.createAgendamento({
					clienteId: antigo.cliente.id,
					servicoId: antigo.servico.id,
					profissionalId: antigo.profissional.id,
					dataHoraInicio: input.nova_data_hora,
					duracaoEmMinutos: antigo.duracaoEmMinutos,
					valor: antigo.valor ?? undefined,
					observacoes: '🤖 Reagendado pela Helena (assistente virtual)',
					confirmado: false,
				});
				agIdNovo = created.id;
				rememberAgendamento(input.telefone, input.nova_data_hora, agIdNovo);
			} catch (err) {
				return {
					status: 'erro',
					razao:
						'⚠️ Antigo já foi CANCELADO mas não consegui criar o novo. Cliente precisa de intervenção da Camila.',
					detalhes: {
						agIdAntigo,
						erro: err instanceof Error ? err.message : 'unknown',
					},
				};
			}

			// 6. Verify criação (compara dataHoraInicio normalizado)
			try {
				const readNew = await trinks.getAgendamento(agIdNovo);
				const normDH = (s: string) => {
					const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
					return m ? `${m[1]}T${m[2]}` : s;
				};
				if (normDH(readNew.dataHoraInicio) !== normDH(input.nova_data_hora)) {
					return {
						status: 'erro',
						razao:
							'⚠️ Novo criado mas dataHoraInicio diverge. Cliente precisa de intervenção da Camila.',
						detalhes: {
							agIdAntigo,
							agIdNovo,
							esperado: input.nova_data_hora,
							recebido: readNew.dataHoraInicio,
						},
					};
				}

				// 7. Mirror em Supabase (best-effort): novo entra, antigo é atualizado
				try {
					await supabase.upsertAgendamento({ id: agIdAntigo, status_id: TRINKS_STATUS.CANCELADO });
				} catch {
					/* best-effort */
				}
				try {
					await supabase.upsertAgendamento({
						id: agIdNovo,
						status_id: readNew.status.id,
						cliente_id: readNew.cliente.id,
						cliente_nome: readNew.cliente.nome,
						servico_id: readNew.servico.id,
						servico_nome: readNew.servico.nome,
						profissional_id: readNew.profissional.id,
						profissional_nome: readNew.profissional.nome,
						data_hora_inicio: readNew.dataHoraInicio,
						duracao_em_minutos: readNew.duracaoEmMinutos,
						valor: readNew.valor ?? undefined,
						numero: input.telefone,
					});
				} catch {
					/* best-effort */
				}

				// 8. Log estruturado
				try {
					await supabase.raw.from('logs_agendamentos').insert({
						evento: 'reagendamento_agendamento',
						agendamento_id: String(agIdAntigo),
						cliente_id: clienteId,
						detalhes: {
							agendamento_id_antigo: agIdAntigo,
							agendamento_id_novo: agIdNovo,
							data_anterior: dataAnterior,
							data_nova: readNew.dataHoraInicio,
							reagendado_em: new Date().toISOString(),
						},
						criado_em: new Date().toISOString(),
					});
				} catch {
					/* best-effort */
				}

				return {
					status: 'ok',
					agendamento_id_antigo: agIdAntigo,
					agendamento_id_novo: agIdNovo,
					servico: readNew.servico.nome,
					data_hora_anterior: dataAnterior,
					data_hora_nova: readNew.dataHoraInicio,
					mensagem: `Reagendamento concluído. Antigo (${dataAnterior}) cancelado, novo (${readNew.dataHoraInicio}) criado.`,
				};
			} catch (err) {
				return {
					status: 'erro',
					razao: 'Novo agendamento criado mas verificação subsequente falhou',
					detalhes: { agIdAntigo, agIdNovo, error: err instanceof Error ? err.message : 'unknown' },
				};
			}
		},
	};
}
