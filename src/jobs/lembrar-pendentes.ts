/**
 * Cutuca os botões de "finalizou o atendimento?" que a Camila não respondeu.
 *
 * ── Por que isso existe ──
 * Só ela sabe se o atendimento aconteceu. Não há lançamento financeiro na Trinks
 * (0 registros em agosto/2026) nem qualquer outro sinal — deduzir seria propor
 * manutenção pra quem não compareceu, o que é pior que não propor.
 *
 * Mas o job da enquete pergunta UMA vez, no instante em que o atendimento acaba,
 * e nunca mais volta naquele agendamento. A Camila está de pinça na mão nesse
 * momento. Resultado medido em 01/09/2026: dos 85 atendimentos realizados nos
 * últimos 45 dias, 51 ficaram parados em "Confirmado" — ela nunca respondeu, e
 * ninguém perguntou de novo. Cada um desses é uma manutenção que não foi
 * proposta.
 *
 * Aqui a gente insiste, com limite: mesmo botão, mesmo handler, até 3 vezes,
 * respeitando um intervalo, e no máximo alguns por vez pra não virar spam.
 */
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { addDaysBRT, todayBRT, trinksWallClockToEpochMin } from '../domain/data-brt.js';
import { ACTIVE_STATUSES } from '../domain/trinks-status.js';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

/** Quantos dias pra trás procurar pendência. Curto de propósito: cutucar um
 *  atendimento de 3 semanas atrás não ajuda ninguém a lembrar. */
const DIAS_PARA_TRAS = 5;
/** Teto de insistência por atendimento. Depois disso, desiste em silêncio. */
const MAX_LEMBRETES = 3;
/** Intervalo mínimo entre dois lembretes do MESMO atendimento. */
const HORAS_ENTRE_LEMBRETES = 20;
/** Teto por execução — ela recebe no máximo isso de uma vez. */
const MAX_POR_EXECUCAO = 3;

export interface LembrarPendentesDeps {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	uazapi: UazapiClient;
	profissionalId: number;
	logger?: Logger;
	/** Relógio injetável (deixa o comportamento testável sem esperar o tempo passar). */
	agora?: Date;
}

export interface LembrarPendentesResult {
	candidatos: number;
	lembrados: number;
	erros: number;
}

export async function runLembrarPendentes(
	deps: LembrarPendentesDeps,
): Promise<LembrarPendentesResult> {
	const log = deps.logger ?? rootLogger.child({ job: 'lembrar-pendentes' });
	const agora = deps.agora ?? new Date();
	const agoraMin = trinksWallClockToEpochMin(
		agora.toLocaleString('sv-SE', { timeZone: 'America/Bahia' }).replace(' ', 'T'),
	);

	const hoje = todayBRT(agora);
	const desde = addDaysBRT(hoje, -DIAS_PARA_TRAS);

	const lista = await deps.trinks.listAgendamentos({
		dataInicio: `${desde}T00:00:00`,
		dataFim: `${hoje}T23:59:59`,
	});

	// Candidato = da Camila, já terminou, e continua num status ATIVO — ou seja,
	// ela não disse nem que finalizou nem que a cliente faltou.
	const candidatos = (lista.data ?? []).filter((a) => {
		if (a.profissional.id !== deps.profissionalId) return false;
		if (!ACTIVE_STATUSES.has(a.status.id)) return false;
		const fim = trinksWallClockToEpochMin(a.dataHoraInicio) + (a.duracaoEmMinutos ?? 60);
		return fim <= agoraMin;
	});

	let lembrados = 0;
	let erros = 0;
	const env = getEnv();
	const destino = env.UAZAPI_CAMILA_PHONE ?? env.UAZAPI_GRUPO_TIME;

	for (const ag of candidatos) {
		if (lembrados >= MAX_POR_EXECUCAO) break;

		let espelho: Awaited<ReturnType<typeof deps.supabase.getAgendamento>>;
		try {
			espelho = await deps.supabase.getAgendamento(ag.id);
		} catch (err) {
			log.warn({ err, agId: ag.id }, 'Falha ao ler espelho');
			erros++;
			continue;
		}

		// Nunca recebeu o botão: quem manda o primeiro é o job da enquete, não este.
		if (!espelho?.enquete_finalizacao_enviada_em) continue;

		const jaLembrado = espelho.enquete_lembretes ?? 0;
		if (jaLembrado >= MAX_LEMBRETES) continue;

		if (espelho.enquete_lembrado_em) {
			const horas = (agora.getTime() - new Date(espelho.enquete_lembrado_em).getTime()) / 3_600_000;
			if (horas < HORAS_ENTRE_LEMBRETES) continue;
		}

		const quando = `${ag.dataHoraInicio.slice(8, 10)}/${ag.dataHoraInicio.slice(5, 7)} às ${ag.dataHoraInicio.slice(11, 16)}`;
		try {
			await deps.uazapi.sendMenu({
				number: destino,
				// Mesmos IDs de botão do fluxo normal: cai no mesmo handler, sem
				// caminho paralelo pra manter em pé.
				text: `⏰ Ficou pendente: *${ag.cliente.nome}* (${ag.servico.nome}, ${quando}). Você finalizou?`,
				choices: [
					{ label: 'Sim, finalizei ✅', id: `Fin_sim${ag.id}` },
					{ label: 'Não compareceu ❌', id: `Fin_nao${ag.id}` },
				],
			});
			await deps.supabase.markEnqueteLembrada(ag.id, jaLembrado + 1);
			lembrados++;
		} catch (err) {
			log.error({ err, agId: ag.id }, 'Falha ao enviar lembrete de pendência');
			erros++;
		}
	}

	log.info({ candidatos: candidatos.length, lembrados, erros }, 'Lembrar pendentes concluído');
	return { candidatos: candidatos.length, lembrados, erros };
}
