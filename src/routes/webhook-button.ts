import type { ToolRegistry } from '../agent/tools/_registry.js';
import type { AppOpenAIClient } from '../clients/openai.js';
import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { parseButtonId } from '../clients/uazapi.js';
import type { LeadManager } from '../domain/lead.js';
import {
	escolherHorarioManutencao,
	formatarDataManutencao,
	getManutencaoServiceName,
	intervaloManutencaoDias,
} from '../domain/manutencao.js';
import { TRINKS_STATUS } from '../domain/trinks-status.js';

import { getEnv } from '../infra/env.js';
import { createRequestLogger } from '../infra/logger.js';

export interface ButtonHandlerParams {
	telefone: string;
	buttonOrListid: string;
	deps: {
		openai: AppOpenAIClient;
		uazapi: UazapiClient;
		supabase: AppSupabaseClient;
		postgres: PostgresClient;
		toolRegistry: ToolRegistry;
		trinks: TrinksClient;
	};
	leadManager: LeadManager;
}

export async function handleButton(params: ButtonHandlerParams): Promise<void> {
	const { telefone, buttonOrListid, deps } = params;
	const log = createRequestLogger(telefone);
	const { action, agendamentoId } = parseButtonId(buttonOrListid);

	log.info({ action, agendamentoId, buttonOrListid }, 'Processing button click');

	switch (action) {
		case 'confirmar': {
			if (!agendamentoId) {
				log.warn('confirmar button without agendamento ID');
				return;
			}
			const agId = Number(agendamentoId);

			// PATCH confirm
			try {
				await deps.trinks.confirmarAgendamento(agId);
			} catch (err) {
				log.error({ err, agId }, 'Failed to confirm via button');
				await deps.uazapi
					.sendText(telefone, 'Tive um probleminha ao confirmar. Já chamei a Camila 💖')
					.catch(() => {});
				return;
			}

			// VERIFY: status deve virar CONFIRMADO (4) — anti-fantasma IB1
			try {
				const readBack = await deps.trinks.getAgendamento(agId);
				if (readBack.status.id !== TRINKS_STATUS.CONFIRMADO) {
					log.error(
						{ agId, status: readBack.status },
						'Confirm verify failed: status != CONFIRMADO',
					);
					await deps.uazapi
						.sendText(telefone, 'Tive um probleminha ao confirmar. Já chamei a Camila 💖')
						.catch(() => {});
					return;
				}
				try {
					await deps.supabase.upsertAgendamento({
						id: agId,
						status_id: TRINKS_STATUS.CONFIRMADO,
					});
				} catch {
					/* best-effort */
				}
				await deps.uazapi.sendText(telefone, 'Perfeito! Te aguardo 💖');
			} catch (err) {
				log.error({ err, agId }, 'Confirm verify read-back failed');
				await deps.uazapi
					.sendText(telefone, 'Tive um probleminha ao confirmar. Já chamei a Camila 💖')
					.catch(() => {});
			}
			break;
		}

		case 'recusar': {
			await deps.uazapi.sendText(
				telefone,
				'Entendi! Quer reagendar pra outro dia? Me conta quando fica melhor pra você 💖',
			);
			break;
		}

		case 'enquete_sim': {
			if (!agendamentoId) return;
			const agId = Number(agendamentoId);

			// PATCH finalize
			try {
				await deps.trinks.finalizarAgendamento(agId);
			} catch (err) {
				log.error({ err, agId }, 'Failed to finalize via enquete');
				return;
			}

			// VERIFY: status deve virar FINALIZADO (8, medido na API) — anti-fantasma IB1
			try {
				const readBack = await deps.trinks.getAgendamento(agId);
				if (readBack.status.id !== TRINKS_STATUS.FINALIZADO) {
					log.error(
						{ agId, status: readBack.status },
						'Finalize verify failed: status != FINALIZADO',
					);
					return;
				}
				try {
					await deps.supabase.upsertAgendamento({
						id: agId,
						status_id: TRINKS_STATUS.FINALIZADO,
					});
				} catch {
					/* best-effort */
				}
				await deps.uazapi.sendText(
					telefone,
					'Que bom! Espero que tenha amado o resultado 💖 Já te aviso quando for hora da manutenção!',
				);
			} catch (err) {
				log.error({ err, agId }, 'Finalize verify read-back failed');
			}
			break;
		}

		case 'enquete_nao': {
			await deps.uazapi.sendText(telefone, 'Tudo bem! Quando finalizar, me avisa por aqui 😊');
			break;
		}

		// ── NOVO FLUXO: Camila confirma finalização pelo grupo, Helena oferta manutenção ──

		case 'finalizar_sim': {
			// Camila (no grupo) confirmou que atendeu Fulana. Helena:
			// 1. Finaliza no Trinks
			// 2. Calcula próxima manutenção (+15d mesmo horário)
			// 3. Pergunta pra cliente se confirma
			if (!agendamentoId) {
				log.warn('finalizar_sim sem agendamento ID');
				return;
			}
			const agId = Number(agendamentoId);

			let ag: Awaited<ReturnType<typeof deps.trinks.getAgendamento>>;
			try {
				ag = await deps.trinks.getAgendamento(agId);
			} catch (err) {
				log.error({ err, agId }, 'Failed to get ag for finalizar_sim');
				await deps.uazapi
					.sendText(telefone, `❌ Não consegui ler o agendamento ${agId} pra finalizar.`)
					.catch(() => {});
				return;
			}

			// 1. PATCH finalizar
			try {
				await deps.trinks.finalizarAgendamento(agId);
			} catch (err) {
				log.error({ err, agId }, 'Failed to finalize via grupo button');
				await deps.uazapi
					.sendText(telefone, `❌ Erro ao finalizar ${ag.cliente.nome} no sistema.`)
					.catch(() => {});
				return;
			}

			try {
				const readBack = await deps.trinks.getAgendamento(agId);
				if (readBack.status.id !== TRINKS_STATUS.FINALIZADO) {
					log.error({ agId, status: readBack.status }, 'Finalize verify failed');
					await deps.uazapi
						.sendText(telefone, `⚠️ Finalização de ${ag.cliente.nome} não confirmou no Trinks.`)
						.catch(() => {});
					return;
				}
				try {
					await deps.supabase.upsertAgendamento({ id: agId, status_id: TRINKS_STATUS.FINALIZADO });
				} catch {
					/* */
				}
			} catch (err) {
				log.error({ err, agId }, 'Finalize verify read-back failed');
				return;
			}

			// 2. Buscar telefone real do cliente
			let cliente: Awaited<ReturnType<typeof deps.trinks.getCliente>>;
			try {
				cliente = await deps.trinks.getCliente(ag.cliente.id);
			} catch {
				log.warn({ clienteId: ag.cliente.id }, 'Sem cliente — manutenção não oferecida');
				await deps.uazapi
					.sendText(
						telefone,
						`✅ ${ag.cliente.nome} finalizada. Não consegui mandar manutenção (sem telefone).`,
					)
					.catch(() => {});
				return;
			}
			let numeroCliente: string | null = null;
			const tel = cliente.telefones?.[0];
			if (tel) {
				numeroCliente = `${tel.ddi ?? '55'}${tel.ddd ?? ''}${tel.telefone}`;
			} else {
				numeroCliente = await deps.postgres.findPhoneByTrinksId(ag.cliente.id).catch(() => null);
			}
			if (!numeroCliente) {
				log.warn({ clienteId: ag.cliente.id }, 'Sem telefone — manutenção não oferecida');
				await deps.uazapi
					.sendText(
						telefone,
						`✅ ${ag.cliente.nome} finalizada. Não consegui mandar manutenção (sem telefone no cadastro).`,
					)
					.catch(() => {});
				return;
			}

			// 3. Calcula manutenção
			const servicoManutencao = getManutencaoServiceName(ag.servico.nome);
			if (!servicoManutencao) {
				log.warn({ servico: ag.servico.nome }, 'Serviço sem mapeamento de manutenção');
				await deps.uazapi
					.sendText(
						telefone,
						`✅ ${ag.cliente.nome} finalizada. Serviço "${ag.servico.nome}" não tem manutenção mapeada — falar com cliente manualmente.`,
					)
					.catch(() => {});
				return;
			}
			// Procura um horário que EXISTE antes de propor. Antes a proposta saía
			// às cegas (+15d, mesmo horário) e a cliente só descobria que estava
			// ocupado depois de clicar "confirmo" — o atrito que a Camila pediu pra tirar.
			const intervalo = intervaloManutencaoDias(servicoManutencao);
			const escolha = await escolherHorarioManutencao({
				dataHoraOriginal: ag.dataHoraInicio,
				duracaoMin: ag.duracaoEmMinutos ?? 60,
				intervaloDias: intervalo,
				vagosDoDia: async (data) => {
					const agenda = await deps.trinks.listProfissionaisComAgenda(data);
					return agenda.data.find((p) => p.id === ag.profissional.id)?.horariosVagos ?? [];
				},
			});

			if (!escolha) {
				log.warn({ agId, servicoManutencao, intervalo }, 'Sem horário livre pra manutenção');
				await deps.uazapi
					.sendText(
						telefone,
						`✅ ${ag.cliente.nome} finalizada. Não achei horário livre pra manutenção dela nos próximos dias — melhor você falar com ela.`,
					)
					.catch(() => {});
				return;
			}

			const novaDataHora = escolha.dataHora;
			const novaDataLegivel = formatarDataManutencao(novaDataHora);

			// 4. Manda menu pra cliente
			try {
				await deps.uazapi.sendMenu({
					number: numeroCliente,
					text: `${ag.cliente.nome.trim().split(/\s+/)[0]}, sua manutenção ficou para *${novaDataLegivel}*. Confirma? 💖`,
					choices: [
						{ label: 'Sim, confirmo ✅', id: `Manut_sim${agId}` },
						{ label: 'Quero outra data', id: `Manut_nao${agId}` },
					],
				});
				// Guarda em metadata pra o manutencao_sim usar quando ela clicar.
				// NÃO é best-effort: sem isso o botao "Sim, confirmo" da cliente
				// responde "tive um probleminha". mergeMetadata casa o número da
				// Trinks (com 9º dígito) com o do WhatsApp (sem) e preserva o
				// metadata existente — um update cru não fazia nenhum dos dois.
				let guardou = false;
				try {
					guardou = await params.leadManager.mergeMetadata(numeroCliente, {
						proxima_manutencao_servico: servicoManutencao,
						proxima_manutencao_data: novaDataHora,
						proxima_manutencao_agendamento_origem: agId,
					});
				} catch (err) {
					log.error({ err, cliente: numeroCliente.slice(-8) }, 'mergeMetadata falhou');
				}

				if (!guardou) {
					// A cliente recebeu a oferta, mas o clique dela não vai funcionar.
					// Melhor a Camila saber agora do que a cliente descobrir sozinha.
					log.error(
						{ agId, cliente: numeroCliente.slice(-8) },
						'Oferta de manutenção enviada sem lead correspondente',
					);
					await deps.uazapi
						.sendText(
							telefone,
							`✅ ${ag.cliente.nome} finalizada. Mandei a oferta de manutenção pra ${novaDataLegivel}, mas não achei o cadastro dela aqui — se ela confirmar, marca manualmente.`,
						)
						.catch(() => {});
					return;
				}

				await deps.uazapi
					.sendText(
						telefone,
						`✅ ${ag.cliente.nome} finalizada. Mandei oferta de manutenção pra ${novaDataLegivel}.`,
					)
					.catch(() => {});
			} catch (err) {
				log.error({ err, agId }, 'Failed to send manutencao menu');
				await deps.uazapi
					.sendText(
						telefone,
						`✅ ${ag.cliente.nome} finalizada. ⚠️ Falha ao enviar manutenção: ${err instanceof Error ? err.message : 'unknown'}`,
					)
					.catch(() => {});
			}
			break;
		}

		case 'finalizar_nao': {
			// Camila marcou que cliente não compareceu (no grupo)
			if (!agendamentoId) return;
			const agId = Number(agendamentoId);

			let ag: Awaited<ReturnType<typeof deps.trinks.getAgendamento>>;
			try {
				ag = await deps.trinks.getAgendamento(agId);
			} catch (err) {
				log.error({ err, agId }, 'finalizar_nao: get failed');
				return;
			}
			try {
				await deps.trinks.marcarClienteFaltou(agId);
				await deps.supabase
					.upsertAgendamento({ id: agId, status_id: TRINKS_STATUS.CLIENTE_FALTOU })
					.catch(() => undefined);
				await deps.uazapi
					.sendText(telefone, `📝 ${ag.cliente.nome} marcada como não compareceu.`)
					.catch(() => {});
			} catch (err) {
				log.error({ err, agId }, 'finalizar_nao: marcar falta failed');
				await deps.uazapi
					.sendText(
						telefone,
						`❌ Erro ao marcar falta da ${ag.cliente.nome}: ${err instanceof Error ? err.message : 'unknown'}`,
					)
					.catch(() => {});
			}
			break;
		}

		case 'manutencao_sim': {
			// Cliente confirmou a manutenção sugerida — cria agendamento direto
			if (!agendamentoId) return;
			const origemId = Number(agendamentoId);

			// Pega os dados pré-calculados do lead.metadata
			const lead = await deps.supabase.raw
				.from('leads_energia_solar')
				.select('metadata')
				.eq('telefone', telefone)
				.maybeSingle();
			const meta = (lead.data?.metadata ?? {}) as Record<string, unknown>;
			const servicoNome =
				typeof meta.proxima_manutencao_servico === 'string'
					? meta.proxima_manutencao_servico
					: null;
			const dataHora =
				typeof meta.proxima_manutencao_data === 'string' ? meta.proxima_manutencao_data : null;
			if (!servicoNome || !dataHora) {
				await deps.uazapi
					.sendText(
						telefone,
						'Tive um probleminha ao confirmar sua manutenção. Já avisei a Camila 💖',
					)
					.catch(() => {});
				log.error({ telefone, meta }, 'manutencao_sim sem dados em metadata');
				return;
			}

			const criarTool = deps.toolRegistry.get('criar_agendamento');
			if (!criarTool) {
				log.error('criar_agendamento tool não encontrada');
				return;
			}

			// Obter ag origem pra ter nome do cliente
			let ag: Awaited<ReturnType<typeof deps.trinks.getAgendamento>>;
			try {
				ag = await deps.trinks.getAgendamento(origemId);
			} catch {
				await deps.uazapi
					.sendText(telefone, 'Tive um probleminha. Já chamei a Camila 💖')
					.catch(() => {});
				return;
			}

			const result = await criarTool.handler(
				{
					telefone,
					nome: ag.cliente.nome,
					servico: servicoNome,
					data_e_hora: dataHora,
				},
				{ telefone, lead: { nome: ag.cliente.nome, etiquetas: [], sinal_pago: false } },
			);

			if (result.status === 'ok') {
				await deps.uazapi
					.sendText(
						telefone,
						`Prontinho! 💖 Sua manutenção tá confirmada pra ${formatarDataManutencao(dataHora)}. Te aguardo!`,
					)
					.catch(() => {});
			} else {
				// Horário +15d ocupado: em vez de só pedir, OFERECE horários próximos.
				let ofereceu = false;
				const consultarTool = deps.toolRegistry.get('consultar_disponibilidade');
				if (consultarTool) {
					try {
						const disp = await consultarTool.handler(
							{ servico: servicoNome, data: dataHora.slice(0, 10), hora_e_turno: 'qualquer' },
							{ telefone, lead: { nome: ag.cliente.nome, etiquetas: [], sinal_pago: false } },
						);
						const opcoes = disp as {
							status: string;
							opcoes?: Array<{ data: string; dia_semana: string; horarios: string[] }>;
						};
						if (opcoes.status === 'ok' && opcoes.opcoes?.length) {
							const linhas = opcoes.opcoes.slice(0, 3).map((o) => {
								const [, mes, dia] = o.data.split('-');
								return `📅 ${o.dia_semana}, ${dia}/${mes}: ${o.horarios.slice(0, 4).join(', ')}`;
							});
							await deps.uazapi
								.sendText(
									telefone,
									`Esse horário acabou de ficar ocupado 😅 Mas tenho essas opções pra sua manutenção:\n\n${linhas.join('\n')}\n\nQual você prefere? 💖`,
								)
								.catch(() => {});
							ofereceu = true;
						}
					} catch (err) {
						log.warn({ err }, 'manutencao_sim: falha ao oferecer horários próximos');
					}
				}
				if (!ofereceu) {
					await deps.uazapi
						.sendText(
							telefone,
							'Esse horário ficou ocupado 😅 Me fala um dia/horário que prefere pra sua manutenção que eu vejo as opções 💖',
						)
						.catch(() => {});
				}
			}
			break;
		}

		case 'manutencao_nao': {
			// Cliente pediu pra escolher outra data — deixa Helena conversar normal
			await deps.uazapi.sendText(
				telefone,
				'Tudo bem! 💖 Me conta qual dia e horário fica melhor pra sua manutenção que eu vou ver as opções.',
			);
			break;
		}

		// ── Feedback 3 dias depois do atendimento (pedido da Camila, 01/09/2026) ──

		case 'feedback_bom':
		case 'feedback_ruim': {
			if (!agendamentoId) return;
			const agId = Number(agendamentoId);
			const gostou = action === 'feedback_bom';
			const env = getEnv();
			const paraCamila = env.UAZAPI_CAMILA_PHONE ?? env.UAZAPI_GRUPO_TIME;

			// Contexto pro aviso da Camila. Se não der pra ler, seguimos mesmo
			// assim: a resposta da cliente é mais importante que o detalhe.
			let quem = 'A cliente';
			let servico = '';
			let quando = '';
			try {
				const ag = await deps.trinks.getAgendamento(agId);
				quem = ag.cliente.nome.trim();
				servico = ag.servico.nome;
				quando = `${ag.dataHoraInicio.slice(8, 10)}/${ag.dataHoraInicio.slice(5, 7)}`;
			} catch (err) {
				log.warn({ err, agId }, 'feedback: não consegui ler o agendamento');
			}

			if (gostou) {
				const link = env.CAMILA_LINK_AVALIACAO;
				await deps.uazapi
					.sendText(
						telefone,
						link
							? `Que alegria ler isso! 💖 Se puder deixar sua avaliação aqui, ajuda demais a gente: ${link}`
							: 'Que alegria ler isso! 💖 Se puder deixar uma avaliação nossa, ajuda demais 🥰',
					)
					.catch(() => {});
				await deps.uazapi
					.sendText(
						paraCamila,
						`⭐ *${quem}* amou o resultado${servico ? ` (${servico}${quando ? `, ${quando}` : ''})` : ''}. Boa hora pra pedir foto ou depoimento.`,
					)
					.catch(() => {});
			} else {
				// Reclamação de resultado é conversa de dona. A Helena acolhe e sai
				// da frente — não tenta contornar, não oferece desconto, não agenda.
				await deps.uazapi
					.sendText(
						telefone,
						'Poxa, sinto muito que não tenha ficado como você esperava 💔 Já avisei a Camila e ela vai te chamar pra entender direitinho.',
					)
					.catch(() => {});
				await deps.uazapi
					.sendText(
						paraCamila,
						`⚠️ *${quem}* disse que o resultado podia estar melhor${servico ? ` (${servico}${quando ? `, ${quando}` : ''})` : ''}.\n\nEla está esperando seu contato.`,
					)
					.catch(() => {});
			}
			break;
		}

		default: {
			log.warn({ action, buttonOrListid }, 'Unknown button action');
		}
	}
}
