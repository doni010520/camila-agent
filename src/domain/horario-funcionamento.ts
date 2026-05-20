/**
 * Business hours for Camila Rosario Academy.
 * Source: Helena v13 prompt §Horário de Funcionamento.
 *
 * Seg-Sex: 08:00–12:00 / 13:30–18:00
 * Sábado:  09:00–13:00
 * Domingo: Fechado
 * Almoço:  12:00–13:30 (bloqueio de slot)
 */

export interface DaySchedule {
	open: boolean;
	periods: Array<{ start: string; end: string }>;
}

const WEEKDAY: DaySchedule = {
	open: true,
	periods: [
		{ start: '08:00', end: '12:00' },
		{ start: '13:30', end: '18:00' },
	],
};

const SATURDAY: DaySchedule = {
	open: true,
	periods: [{ start: '09:00', end: '13:00' }],
};

const CLOSED: DaySchedule = { open: false, periods: [] };

/** 0=Sunday, 1=Monday, ..., 6=Saturday */
const SCHEDULE: Record<number, DaySchedule> = {
	0: CLOSED,
	1: WEEKDAY,
	2: WEEKDAY,
	3: WEEKDAY,
	4: WEEKDAY,
	5: WEEKDAY,
	6: SATURDAY,
};

export function getScheduleForDay(dayOfWeek: number): DaySchedule {
	return SCHEDULE[dayOfWeek] ?? CLOSED;
}

/** Check if a given time (HH:MM) falls in the lunch break 12:00–13:30 */
export function isLunchBreak(time: string): boolean {
	return time >= '12:00' && time < '13:30';
}

/** Check if time is within business hours for a given day */
export function isWithinBusinessHours(dayOfWeek: number, time: string): boolean {
	const schedule = getScheduleForDay(dayOfWeek);
	if (!schedule.open) return false;
	return schedule.periods.some((p) => time >= p.start && time < p.end);
}

/**
 * Filter turno: manhã 08:00–12:00, tarde 13:30–18:30, noite 18:00–19:30, qualquer = all.
 * Tarde e noite têm overlap intencional (17:30-18:30) — quando cliente diz "tarde"
 * e Camila só tem 17:30/18:00 vagos, queremos oferecer mesmo assim.
 */
export function filterByTurno(
	horarios: string[],
	turno: 'manha' | 'tarde' | 'noite' | 'qualquer',
): string[] {
	if (turno === 'qualquer') {
		return horarios.filter((h) => !isLunchBreak(h));
	}
	const ranges: Record<string, { start: string; end: string }> = {
		manha: { start: '08:00', end: '12:00' },
		tarde: { start: '13:30', end: '18:30' }, // inclui 17:30, 18:00
		noite: { start: '18:00', end: '20:00' }, // inclui 18:00, 18:30, 19:00, 19:30
	};
	const range = ranges[turno];
	if (!range) return horarios;
	return horarios.filter((h) => h >= range.start && h < range.end);
}

/** Format schedule for the system prompt */
export function formatScheduleForPrompt(): string {
	return [
		'Horário de funcionamento:',
		'- Seg a Sex: 08:00–12:00 e 13:30–18:00',
		'- Sábado: 09:00–13:00',
		'- Domingo: Fechado',
		'- Almoço: 12:00–13:30 (não agendar nesse intervalo)',
	].join('\n');
}

/**
 * Calculate next maintenance date.
 * From prompt v13: manutenção a cada 15 ou 25 dias.
 */
export function calcularProximaManutencao(
	ultimoAgendamentoDate: Date,
	diasIntervalo: 15 | 25 = 15,
): Date {
	const next = new Date(ultimoAgendamentoDate);
	next.setDate(next.getDate() + diasIntervalo);
	return next;
}
