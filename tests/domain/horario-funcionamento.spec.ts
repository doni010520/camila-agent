import { describe, expect, it } from 'vitest';
import {
	filterByTurno,
	getScheduleForDay,
	horarioCabeNosVagos,
	isLunchBreak,
	isWithinBusinessHours,
} from '../../src/domain/horario-funcionamento.js';

describe('horarioCabeNosVagos', () => {
	const vagos = ['09:00', '09:30', '10:00', '10:30', '14:00', '14:30'];

	it('aceita quando todos os slots da duração estão vagos', () => {
		expect(horarioCabeNosVagos('09:00', 120, vagos)).toBe(true); // 09:00-11:00 → 09:00,09:30,10:00,10:30
	});
	it('recusa se um slot intermediário falta (bloqueio no meio)', () => {
		expect(horarioCabeNosVagos('10:00', 120, vagos)).toBe(false); // precisaria 11:00, 11:30 → faltam
	});
	it('recusa horário totalmente fora dos vagos (bloqueio "Lanche")', () => {
		expect(horarioCabeNosVagos('12:00', 60, vagos)).toBe(false);
	});
	it('recusa quando agenda vazia (dia fechado)', () => {
		expect(horarioCabeNosVagos('09:00', 60, [])).toBe(false);
	});
	it('aceita serviço curto de 1 slot', () => {
		expect(horarioCabeNosVagos('14:00', 30, vagos)).toBe(true);
	});
	it('aceita duração que cruza a hora cheia', () => {
		expect(horarioCabeNosVagos('09:30', 60, vagos)).toBe(true); // 09:30,10:00
	});
});

describe('getScheduleForDay', () => {
	it('weekday is open with 2 periods', () => {
		const s = getScheduleForDay(1); // Monday
		expect(s.open).toBe(true);
		expect(s.periods).toHaveLength(2);
	});

	it('saturday has 1 period', () => {
		const s = getScheduleForDay(6);
		expect(s.open).toBe(true);
		expect(s.periods).toHaveLength(1);
		expect(s.periods[0]?.start).toBe('09:00');
	});

	it('sunday is closed', () => {
		expect(getScheduleForDay(0).open).toBe(false);
	});
});

describe('isLunchBreak', () => {
	it('12:00 is lunch', () => expect(isLunchBreak('12:00')).toBe(true));
	it('12:30 is lunch', () => expect(isLunchBreak('12:30')).toBe(true));
	it('13:00 is lunch', () => expect(isLunchBreak('13:00')).toBe(true));
	it('13:30 is NOT lunch', () => expect(isLunchBreak('13:30')).toBe(false));
	it('11:30 is NOT lunch', () => expect(isLunchBreak('11:30')).toBe(false));
});

describe('isWithinBusinessHours', () => {
	it('10:00 on Monday is within hours', () => expect(isWithinBusinessHours(1, '10:00')).toBe(true));
	it('12:30 on Monday is NOT (lunch)', () => expect(isWithinBusinessHours(1, '12:30')).toBe(false));
	it('14:00 on Monday is within hours', () => expect(isWithinBusinessHours(1, '14:00')).toBe(true));
	it('10:00 on Sunday is NOT', () => expect(isWithinBusinessHours(0, '10:00')).toBe(false));
});

describe('filterByTurno', () => {
	const slots = [
		'08:00',
		'09:00',
		'10:00',
		'11:00',
		'12:00',
		'13:00',
		'13:30',
		'14:00',
		'15:00',
		'17:30',
		'18:00',
	];

	it('manha filters 08-12', () => {
		const r = filterByTurno(slots, 'manha');
		expect(r).toEqual(['08:00', '09:00', '10:00', '11:00']);
	});

	it('tarde filters 12:00-18:30 (do meio-dia às 18h)', () => {
		const r = filterByTurno(slots, 'tarde');
		expect(r).toEqual(['12:00', '13:00', '13:30', '14:00', '15:00', '17:30', '18:00']);
	});

	it('noite filters 18:00-20:00', () => {
		const r = filterByTurno(slots, 'noite');
		expect(r).toEqual(['18:00']);
	});

	it('qualquer retorna TODOS os slots (Trinks é a fonte da verdade, sem almoço hardcoded)', () => {
		const r = filterByTurno(slots, 'qualquer');
		// 12:00/13:00 agora são retornados se vierem vagos da Trinks
		expect(r).toContain('12:00');
		expect(r).toContain('13:00');
		expect(r).toContain('08:00');
		expect(r).toContain('14:00');
	});
});

// Regressão 28/08/2026: os turnos tinham um buraco entre 12:00 e 13:30 — resto
// de um "almoço" que já havia sido removido do resto do código. Efeito: quem
// pedia "de tarde" nunca recebia 13:00, o 2º horário mais cheio da Camila
// (15 atendimentos em jul+ago). 12:00/12:30/13:00 não pertenciam a turno nenhum.
//
// Disponibilidade real NÃO se decide aqui — quem decide é o horariosVagos da
// Trinks. Este mapa só traduz a palavra da cliente ("tarde") em faixa de hora,
// e por isso não pode deixar hora órfã.
describe('filterByTurno: cobertura sem buracos', () => {
	const doDia = (() => {
		const hs: string[] = [];
		for (let h = 8; h < 20; h++)
			for (const m of ['00', '30']) hs.push(`${String(h).padStart(2, '0')}:${m}`);
		return hs;
	})();

	it('todo horário do expediente cai em pelo menos um turno', () => {
		const cobertos = new Set([
			...filterByTurno(doDia, 'manha'),
			...filterByTurno(doDia, 'tarde'),
			...filterByTurno(doDia, 'noite'),
		]);
		const orfaos = doDia.filter((h) => !cobertos.has(h));
		expect(orfaos).toEqual([]);
	});

	it('"tarde" inclui 13:00 (2º horário mais cheio da Camila)', () => {
		expect(filterByTurno(['11:00', '12:00', '13:00', '15:00'], 'tarde')).toContain('13:00');
	});

	it('"tarde" inclui meio-dia', () => {
		expect(filterByTurno(['09:00', '12:00', '12:30'], 'tarde')).toEqual(['12:00', '12:30']);
	});
});
