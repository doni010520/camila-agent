import { describe, expect, it } from 'vitest';
import {
	escolherHorarioManutencao,
	inicioBuscaAlternativas,
	getManutencaoServiceName,
	intervaloManutencaoDias,
} from '../../src/domain/manutencao.js';

/**
 * Regra dada pela Camila em 01/09/2026:
 *
 *  "quem for aplicação deixa sempre 15 dias (caso a cliente não queira ela altera).
 *   As que são fixas já está como manutenção então ela só vai repetir (caso seja
 *   15 dias ou 25 dias)"
 *
 *  "A mensagem para ela vai para ela agendar uma manutenção de 15 dias, repetindo
 *   horário de hoje (caso não tenha ela busca o mais próximo automaticamente)
 *   tanto data quanto horário"
 *
 * O ponto do "busca o mais próximo" é que a proposta precisa sair JÁ com um
 * horário que existe. Antes, o sistema propunha +15d no mesmo horário sem olhar
 * a agenda — a cliente clicava "confirmo" e levava "esse horário ficou ocupado".
 */

describe('intervaloManutencaoDias', () => {
	it('aplicação vira manutenção de 15 dias', () => {
		expect(intervaloManutencaoDias('Manutenção volume light 15 dias')).toBe(15);
	});

	it('manutenção de 25 dias repete em 25, não em 15', () => {
		expect(intervaloManutencaoDias('Manutenção volume light 25 dias')).toBe(25);
	});

	it('reconhece 25 dias com a ordem das palavras invertida', () => {
		expect(intervaloManutencaoDias('Manutenção 25 dias volume Brasileiro')).toBe(25);
	});

	it('sem número no nome, assume 15', () => {
		expect(intervaloManutencaoDias('Manutenção Efeito molhado')).toBe(15);
	});
});

describe('escolherHorarioManutencao', () => {
	const base = {
		dataHoraOriginal: '2026-08-28T16:00:00',
		duracaoMin: 60,
		intervaloDias: 15,
	};
	// 28/08 + 15 dias = 12/09

	it('usa o mesmo horário quando ele está livre no dia alvo', async () => {
		const r = await escolherHorarioManutencao({
			...base,
			vagosDoDia: async (d) => (d === '2026-09-12' ? ['15:00', '16:00', '16:30', '17:00'] : []),
		});

		expect(r).toEqual({ dataHora: '2026-09-12T16:00:00', exato: true });
	});

	it('cai pro horário mais próximo no mesmo dia quando o exato está ocupado', async () => {
		const r = await escolherHorarioManutencao({
			...base,
			vagosDoDia: async (d) => (d === '2026-09-12' ? ['09:00', '09:30', '17:00', '17:30'] : []),
		});

		expect(r).toEqual({ dataHora: '2026-09-12T17:00:00', exato: false });
	});

	it('só vai pro dia seguinte quando o dia alvo não tem nada', async () => {
		const r = await escolherHorarioManutencao({
			...base,
			vagosDoDia: async (d) => (d === '2026-09-13' ? ['16:00', '16:30'] : []),
		});

		expect(r).toEqual({ dataHora: '2026-09-13T16:00:00', exato: true });
	});

	it('respeita a duração: 2h precisa de 4 blocos seguidos', async () => {
		const r = await escolherHorarioManutencao({
			...base,
			duracaoMin: 120,
			// 16:00 tem só 2 blocos seguidos; 09:00 tem 4
			vagosDoDia: async (d) =>
				d === '2026-09-12' ? ['09:00', '09:30', '10:00', '10:30', '16:00', '16:30'] : [],
		});

		expect(r).toEqual({ dataHora: '2026-09-12T09:00:00', exato: false });
	});

	it('manutenção de 25 dias cai 25 dias depois', async () => {
		const r = await escolherHorarioManutencao({
			...base,
			intervaloDias: 25, // 28/08 + 25 = 22/09
			vagosDoDia: async (d) => (d === '2026-09-22' ? ['16:00', '16:30'] : []),
		});

		expect(r?.dataHora).toBe('2026-09-22T16:00:00');
	});

	it('devolve null quando não acha nada na janela de busca', async () => {
		const r = await escolherHorarioManutencao({ ...base, vagosDoDia: async () => [] });

		expect(r).toBeNull();
	});

	it('não deixa um dia com erro de consulta parecer dia sem vaga', async () => {
		const r = await escolherHorarioManutencao({
			...base,
			vagosDoDia: async (d) => {
				if (d === '2026-09-12') throw new Error('429');
				if (d === '2026-09-13') return ['16:00', '16:30'];
				return [];
			},
		});

		// pula o dia que falhou em vez de derrubar tudo
		expect(r).toEqual({ dataHora: '2026-09-13T16:00:00', exato: true });
	});
});

describe('getManutencaoServiceName (regra da Camila)', () => {
	it('aplicação mapeia pra manutenção correspondente', () => {
		expect(getManutencaoServiceName('Volume light')).toBe('Manutenção volume light 15 dias');
	});

	it('serviço que já é manutenção repete ele mesmo', () => {
		expect(getManutencaoServiceName('Manutenção volume light 25 dias')).toBe(
			'Manutenção volume light 25 dias',
		);
	});
});

/**
 * Caso real Iracema (11/09/2026) — a busca só andava PRA FRENTE.
 *
 * Atendimento 11/09 18:00, Manutenção volume Russo 15 dias, 90 min, com a
 * Camila Rosario. Alvo = 26/09, dia em que a agenda dela estava zerada; 27 e 28
 * também. A oferta saltou pra 29/09 (18 dias) enquanto o dia 25/09 — um dia
 * ANTES do alvo — tinha 15:00 a 17:30 livres.
 *
 * Pra manutenção de cílio atrasar é pior que adiantar (a cliente perde volume),
 * então a busca passa a olhar os dois lados: até 2 dias antes e 7 depois, sempre
 * do mais próximo do alvo pro mais distante, empate indo pro mais cedo.
 */
describe('escolherHorarioManutencao — janela nos dois sentidos', () => {
	const iracema = {
		dataHoraOriginal: '2026-09-11T18:00:00',
		duracaoMin: 90,
		intervaloDias: 15,
	};
	// agenda real medida em produção
	const AGENDA_REAL: Record<string, string[]> = {
		'2026-09-25': ['09:00', '09:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'],
		'2026-09-26': [],
		'2026-09-27': [],
		'2026-09-28': [],
		'2026-09-29': ['10:30', '11:00', '11:30', '12:00', '15:30', '17:30'],
	};

	it('🎯 caso Iracema: alvo lotado → recua pro dia 25 em vez de saltar pro 29', async () => {
		const r = await escolherHorarioManutencao({
			...iracema,
			vagosDoDia: async (d) => AGENDA_REAL[d] ?? [],
		});

		// 25/09 16:30 cabe 90 min (16:30, 17:00, 17:30) e é o mais perto das 18h.
		expect(r).toEqual({ dataHora: '2026-09-25T16:30:00', exato: false });
	});

	it('o dia alvo continua ganhando de qualquer vizinho', async () => {
		const r = await escolherHorarioManutencao({
			...iracema,
			vagosDoDia: async (d) =>
				d === '2026-09-26' ? ['10:00', '10:30', '11:00'] : (AGENDA_REAL[d] ?? []),
		});

		expect(r?.dataHora.startsWith('2026-09-26')).toBe(true);
	});

	it('empate entre véspera e dia seguinte fica com o mais cedo', async () => {
		const r = await escolherHorarioManutencao({
			...iracema,
			vagosDoDia: async (d) =>
				d === '2026-09-25' || d === '2026-09-27' ? ['17:00', '17:30', '18:00'] : [],
		});

		expect(r?.dataHora.startsWith('2026-09-25')).toBe(true);
	});

	it('não recua mais de 2 dias: 13 dias é o piso', async () => {
		const r = await escolherHorarioManutencao({
			...iracema,
			// só o dia 23 (12 dias) tem vaga — cedo demais, não serve
			vagosDoDia: async (d) => (d === '2026-09-23' ? ['17:00', '17:30', '18:00'] : []),
		});

		expect(r).toBeNull();
	});
});

describe('inicioBuscaAlternativas', () => {
	it('recua 2 dias da data ofertada (caso Iracema: 29 → 27)', () => {
		expect(inicioBuscaAlternativas('2026-09-29T12:30:00', '2026-09-12')).toBe('2026-09-27');
	});

	it('🎯 nunca recua pra antes de hoje', () => {
		expect(inicioBuscaAlternativas('2026-09-13T10:00:00', '2026-09-12')).toBe('2026-09-12');
	});

	it('quando a data ofertada é hoje, começa hoje', () => {
		expect(inicioBuscaAlternativas('2026-09-12T10:00:00', '2026-09-12')).toBe('2026-09-12');
	});
})
