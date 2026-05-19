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

/** Format a datetime string as human-readable in BRT.
 * Trinks returns naive datetimes (no timezone suffix) that represent BRT local time.
 * We append -03:00 if no timezone indicator is present. */
export function formatDateTimeBRT(isoString: string): string {
	// If no timezone info, treat as BRT (-03:00)
	const normalized =
		/[Z+]/.test(isoString) || isoString.includes('-03') ? isoString : `${isoString}-03:00`;
	const d = new Date(normalized);
	const DAYS = [
		'domingo',
		'segunda-feira',
		'terça-feira',
		'quarta-feira',
		'quinta-feira',
		'sexta-feira',
		'sábado',
	];
	const dayOfWeek = dayOfWeekBRT(d);
	const dateStr = d.toLocaleDateString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit' });
	const timeStr = d.toLocaleTimeString('pt-BR', {
		timeZone: TZ,
		hour: '2-digit',
		minute: '2-digit',
	});
	return `${DAYS[dayOfWeek]}, ${dateStr} às ${timeStr}`;
}
