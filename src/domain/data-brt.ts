/**
 * Date helpers in BRT (America/Bahia, UTC-3).
 * Prevents the bug where after 21h BRT (= 00:00 UTC next day),
 * the agent would consult the wrong date.
 */

const TZ = 'America/Bahia';

/** Get current date in BRT as YYYY-MM-DD */
export function todayBRT(now?: Date): string {
	const d = now ?? new Date();
	return d.toLocaleDateString('sv-SE', { timeZone: TZ });
	// sv-SE locale naturally outputs YYYY-MM-DD format
}

/** Get current datetime formatted for the prompt header */
export function nowBRT(now?: Date): string {
	const d = now ?? new Date();
	const formatter = new Intl.DateTimeFormat('pt-BR', {
		timeZone: TZ,
		weekday: 'long',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
	});
	return formatter.format(d);
}

/** Get day of week in BRT (0=Sunday, 6=Saturday) */
export function dayOfWeekBRT(now?: Date): number {
	const d = now ?? new Date();
	const parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).formatToParts(
		d,
	);
	const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
	const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	return map[weekday] ?? 0;
}

/** Add days to a date, respecting BRT */
export function addDaysBRT(dateStr: string, days: number): string {
	const d = new Date(`${dateStr}T12:00:00-03:00`);
	d.setDate(d.getDate() + days);
	return todayBRT(d);
}

const DAYS_PT = [
	'domingo',
	'segunda-feira',
	'terça-feira',
	'quarta-feira',
	'quinta-feira',
	'sexta-feira',
	'sábado',
];

/**
 * Extrai os componentes de parede (ano/mês/dia/hora/min) de um datetime do Trinks,
 * IGNORANDO qualquer indicador de fuso (Z, +00:00, -03:00).
 *
 * ⚠️ CRÍTICO: o Trinks representa SEMPRE horário local BRT, mas devolve formato
 * INCONSISTENTE — às vezes naive ("2026-06-03T10:00:00"), às vezes com Z
 * ("2026-06-03T10:00:00Z") significando o MESMO 10h local (não 10h UTC).
 * Se passássemos por `new Date()`, o Z faria converter 10h→07h (bug que mandou
 * lembrete errado pra cliente). Por isso extraímos os números direto da string.
 */
export function parseTrinksWallClock(
	isoString: string,
): { ano: number; mes: number; dia: number; hora: number; min: number } | null {
	const m = isoString.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
	if (!m) return null;
	return {
		ano: Number(m[1]),
		mes: Number(m[2]),
		dia: Number(m[3]),
		hora: Number(m[4]),
		min: Number(m[5]),
	};
}

/** Day of week (0=Sun..6=Sat) a partir de componentes de data, sem fuso. */
function dowFromParts(ano: number, mes: number, dia: number): number {
	return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay();
}

/**
 * Converte um datetime do Trinks pra um número de minutos absoluto (epoch-like),
 * tratando como horário de parede BRT (ignora Z/offset). Serve pra comparar
 * sobreposição de horários de forma consistente, sem bug de fuso.
 * Retorna NaN se não parseável.
 */
export function trinksWallClockToEpochMin(isoString: string): number {
	const p = parseTrinksWallClock(isoString);
	if (!p) return Number.NaN;
	// Date.UTC dá ms; tratamos todos os horários na mesma régua (UTC dos componentes).
	return Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min) / 60000;
}

/** Format a datetime string as human-readable in BRT.
 * Trinks devolve horário local BRT (com ou sem Z indevido) — sempre tratamos
 * como horário de parede, extraindo componentes da string. */
export function formatDateTimeBRT(isoString: string): string {
	const p = parseTrinksWallClock(isoString);
	if (!p) return isoString; // formato inesperado — devolve cru
	const dow = dowFromParts(p.ano, p.mes, p.dia);
	const dd = String(p.dia).padStart(2, '0');
	const mm = String(p.mes).padStart(2, '0');
	const hh = String(p.hora).padStart(2, '0');
	const min = String(p.min).padStart(2, '0');
	return `${DAYS_PT[dow]}, ${dd}/${mm} às ${hh}:${min}`;
}
