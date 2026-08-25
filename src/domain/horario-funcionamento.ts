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
		// Sem filtro de almoço hardcoded: a fonte da verdade é o horariosVagos
		// da Trinks (já desconta bloqueios reais, incl. "Lanche"). Remover
		// 12:00-13:30 fixo escondia horários que a Camila tinha livres e quebrava
		// a continuidade pra serviços de 2h → Helena dizia "sem vaga" tendo vaga.
		return horarios;
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

/**
 * Verifica se um horário de início + duração cabe inteiramente nos horariosVagos
 * da profissional (vindos do Trinks /v1/agendamentos/profissionais/{data}).
 *
 * horariosVagos são slots de 30min em HH:MM (ex: ["09:00","09:30",...]) que JÁ
 * descontam agendamentos de clientes E bloqueios manuais (ex: "Lanche", almoço).
 * É a fonte de verdade da disponibilidade — a mesma que o painel usa.
 *
 * Ex: início 09:00, duração 120min → precisa de 09:00, 09:30, 10:00, 10:30 vagos.
 *
 * @param horaInicio "HH:MM"
 * @param duracaoMin duração em minutos
 * @param horariosVagos array de slots livres "HH:MM"
 */
export function horarioCabeNosVagos(
	horaInicio: string,
	duracaoMin: number,
	horariosVagos: string[],
): boolean {
	const m = horaInicio.match(/^(\d{2}):(\d{2})/);
	if (!m) return false;
	const set = new Set(horariosVagos);
	const slotsNeeded = Math.max(1, Math.ceil(duracaoMin / 30));
	let h = Number(m[1]);
	let min = Number(m[2]);
	for (let i = 0; i < slotsNeeded; i++) {
		const slot = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
		if (!set.has(slot)) return false;
		min += 30;
		if (min >= 60) {
			h += 1;
			min -= 60;
		}
	}
	return true;
}

/** Format schedule for the system prompt */
export function formatScheduleForPrompt(): string {
	return [
		'## Horário de funcionamento (IMPORTANTE)',
		'',
		'A agenda da Camila **muda de dia pra dia** — ela define os horários que abre em cada data.',
		'Por isso, **NUNCA afirme um horário fixo de abertura/fechamento pra cliente** (ex: não diga',
		'"abrimos às 8h" ou "atendemos até 18h"). Em geral ela começa por volta das 9h e atende até a noite,',
		'mas isso varia.',
		'',
		'Regra de ouro: quando a cliente perguntar horário ou quiser marcar, **sempre chame',
		'`consultar_disponibilidade`** e ofereça SOMENTE os horários que a tool retornar. Esses horários',
		'já refletem a agenda real (folgas, bloqueios, almoço e horários ocupados já vêm descontados).',
		'- Domingo: fechado.',
		'- Se a tool não retornar nenhum horário num dia, é porque a Camila não atende nesse dia ou está lotada — ofereça outro dia.',
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
