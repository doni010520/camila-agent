/**
 * Detector de conflitos de agenda.
 *
 * Varre os próximos N dias e detecta agendamentos ATIVOS sobrepostos da mesma
 * profissional — não importa quem marcou (Helena OU manual no painel). Quando
 * acha, alerta a Camila no WhatsApp pra ela resolver antes da cliente reclamar.
 *
 * É a rede de segurança final: mesmo que algo escape (marcação manual em cima,
 * bug futuro), o conflito é pego no mesmo dia.
 */
import type { PostgresClient } from '../clients/postgres.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { addDaysBRT, todayBRT } from '../domain/data-brt.js';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

const ACTIVE_STATUSES = new Set([1, 3, 4, 5]); // Agendado, Aguardando, Confirmado, Em atendimento
const DIAS_VARRIDOS = 14;

export interface DetectarConflitosDeps {
	trinks: TrinksClient;
	uazapi: UazapiClient;
	postgres: PostgresClient;
	profissionalId: number;
	logger?: Logger;
}

export interface Conflito {
	data: string;
	a: { id: number; cliente: string; inicio: string; fim: string };
	b: { id: number; cliente: string; inicio: string; fim: string };
}

// Cache in-process pra não re-alertar o mesmo conflito toda execução.
const alertadosHoje = new Set<string>();
let diaDoCache = '';

function hhmm(min: number): string {
	const h = Math.floor(min / 60);
	const m = min % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Minutos desde 00:00 do dia, extraídos do wall-clock da string (imune a TZ). */
function minutosDoDia(dataHora: string): number {
	const m = dataHora.match(/[T ](\d{2}):(\d{2})/);
	if (!m) return 0;
	return Number(m[1]) * 60 + Number(m[2]);
}

export async function runDetectarConflitos(deps: DetectarConflitosDeps): Promise<{
	dias: number;
	conflitos: Conflito[];
	alertou: boolean;
}> {
	const log = deps.logger ?? rootLogger.child({ job: 'detectar-conflitos' });
	const hoje = todayBRT();

	// reseta cache de alertas a cada novo dia
	if (diaDoCache !== hoje) {
		alertadosHoje.clear();
		diaDoCache = hoje;
	}

	const conflitos: Conflito[] = [];

	for (let i = 0; i < DIAS_VARRIDOS; i++) {
		const dia = addDaysBRT(hoje, i);
		let ags: Awaited<ReturnType<typeof deps.trinks.listAgendamentos>>['data'];
		try {
			const r = await deps.trinks.listAgendamentos({
				dataInicio: `${dia}T00:00:00`,
				dataFim: `${dia}T23:59:59`,
			});
			ags = r.data ?? [];
		} catch (err) {
			log.warn({ dia, err: err instanceof Error ? err.message : 'unknown' }, 'Falha ao listar dia');
			continue;
		}

		const ativos = ags
			.filter((a) => a.profissional.id === deps.profissionalId)
			.filter((a) => ACTIVE_STATUSES.has(a.status.id))
			.map((a) => ({
				id: a.id,
				cliente: a.cliente.nome,
				ini: minutosDoDia(a.dataHoraInicio), // minuto-do-dia (loop é por dia)
				dur: a.duracaoEmMinutos ?? 60,
			}))
			.sort((x, y) => x.ini - y.ini);

		// detecta overlap entre pares
		for (let x = 0; x < ativos.length; x++) {
			for (let y = x + 1; y < ativos.length; y++) {
				const A = ativos[x];
				const B = ativos[y];
				if (!A || !B) continue;
				const aFim = A.ini + A.dur;
				const bFim = B.ini + B.dur;
				if (A.ini < bFim && aFim > B.ini) {
					conflitos.push({
						data: dia,
						a: { id: A.id, cliente: A.cliente, inicio: hhmm(A.ini), fim: hhmm(aFim) },
						b: { id: B.id, cliente: B.cliente, inicio: hhmm(B.ini), fim: hhmm(bFim) },
					});
				}
			}
		}
	}

	// filtra os que ainda não foram alertados hoje
	const novos = conflitos.filter((c) => {
		const chave = `${c.data}:${c.a.id}:${c.b.id}`;
		return !alertadosHoje.has(chave);
	});

	let alertou = false;
	if (novos.length > 0) {
		const env = getEnv();
		const destino = env.UAZAPI_CAMILA_PHONE ?? env.UAZAPI_GRUPO_TIME;
		const linhas = ['⚠️ *Conflito de agenda detectado*', ''];
		for (const c of novos) {
			const [, mes, d] = c.data.split('-');
			linhas.push(
				`📅 ${d}/${mes}: *${c.a.cliente}* (${c.a.inicio}-${c.a.fim}) × *${c.b.cliente}* (${c.b.inicio}-${c.b.fim})`,
			);
		}
		linhas.push('', 'Duas clientes no mesmo horário — confere no painel pra não dar choque 💖');
		try {
			await deps.uazapi.sendText(destino, linhas.join('\n'));
			for (const c of novos) alertadosHoje.add(`${c.data}:${c.a.id}:${c.b.id}`);
			alertou = true;
		} catch (err) {
			log.error({ err }, 'Falha ao enviar alerta de conflito');
		}
	}

	log.info({ dias: DIAS_VARRIDOS, conflitos: conflitos.length, novos: novos.length, alertou }, 'Detectar conflitos done');
	return { dias: DIAS_VARRIDOS, conflitos, alertou };
}

/** Para tests. */
export function _resetConflitoCache(): void {
	alertadosHoje.clear();
	diaDoCache = '';
}
