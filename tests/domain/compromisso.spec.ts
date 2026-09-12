import { describe, expect, it } from 'vitest';
import {
	ATENDIMENTOS_PARA_LIMPAR,
	LIMITE_STRIKES,
	eventoCompromissoDaTool,
	exigeSinalSempre,
	lerHistorico,
	registrarAtendimentoConcluido,
	registrarFalta,
	registrarRemarcacao,
} from '../../src/domain/compromisso.js';

describe('lerHistorico', () => {
	it('lead sem metadata → histórico zerado', () => {
		expect(lerHistorico({})).toEqual({ remarcacoes: 0, faltas: 0, atendimentos_limpos: 0 });
	});

	it('lê os contadores de metadata.compromisso', () => {
		expect(
			lerHistorico({
				metadata: { compromisso: { remarcacoes: 2, faltas: 1, atendimentos_limpos: 0 } },
			}),
		).toEqual({ remarcacoes: 2, faltas: 1, atendimentos_limpos: 0 });
	});

	it('ignora lixo em metadata (valores não numéricos viram 0)', () => {
		expect(lerHistorico({ metadata: { compromisso: { remarcacoes: 'três' } } })).toEqual({
			remarcacoes: 0,
			faltas: 0,
			atendimentos_limpos: 0,
		});
	});
});

describe('exigeSinalSempre', () => {
	it('🎯 caso Ana Beatriz: 3 remarcações → exige sinal', () => {
		// Ela remarcou 3x e na última faltou em cima da hora, ocupando o horário.
		expect(exigeSinalSempre({ metadata: { compromisso: { remarcacoes: 3 } } })).toBe(true);
	});

	it('remarcações e faltas SOMAM (2 remarcações + 1 falta = 3)', () => {
		expect(exigeSinalSempre({ metadata: { compromisso: { remarcacoes: 2, faltas: 1 } } })).toBe(
			true,
		);
	});

	it('abaixo do limite → não exige', () => {
		expect(exigeSinalSempre({ metadata: { compromisso: { remarcacoes: 1, faltas: 1 } } })).toBe(
			false,
		);
		expect(exigeSinalSempre({})).toBe(false);
	});

	it('etiqueta manual da Camila liga a regra independente do contador', () => {
		expect(exigeSinalSempre({ etiquetas: ['sinal-sempre'] })).toBe(true);
	});

	it('VIP não escapa da regra se bateu o limite', () => {
		// VIP isenta de sinal no fluxo normal; quem já furou 3x não é mais isenta.
		expect(exigeSinalSempre({ etiquetas: ['vip'], metadata: { compromisso: { faltas: 3 } } })).toBe(
			true,
		);
	});
});

describe('registrar eventos', () => {
	it('remarcação incrementa e zera a sequência limpa', () => {
		expect(registrarRemarcacao({ remarcacoes: 1, faltas: 0, atendimentos_limpos: 1 })).toEqual({
			remarcacoes: 2,
			faltas: 0,
			atendimentos_limpos: 0,
		});
	});

	it('falta incrementa e zera a sequência limpa', () => {
		expect(registrarFalta({ remarcacoes: 0, faltas: 1, atendimentos_limpos: 1 })).toEqual({
			remarcacoes: 0,
			faltas: 2,
			atendimentos_limpos: 0,
		});
	});

	it('atendimento concluído soma na sequência limpa', () => {
		expect(
			registrarAtendimentoConcluido({ remarcacoes: 3, faltas: 0, atendimentos_limpos: 0 }),
		).toEqual({ remarcacoes: 3, faltas: 0, atendimentos_limpos: 1 });
	});

	it(`🎯 ${ATENDIMENTOS_PARA_LIMPAR} atendimentos limpos zeram o histórico (cliente se redime)`, () => {
		const apos1 = registrarAtendimentoConcluido({
			remarcacoes: 3,
			faltas: 1,
			atendimentos_limpos: 0,
		});
		expect(exigeSinalSempre({ metadata: { compromisso: apos1 } })).toBe(true);

		const apos2 = registrarAtendimentoConcluido(apos1);
		expect(apos2).toEqual({ remarcacoes: 0, faltas: 0, atendimentos_limpos: 0 });
		expect(exigeSinalSempre({ metadata: { compromisso: apos2 } })).toBe(false);
	});

	it('limite é 3 strikes', () => {
		expect(LIMITE_STRIKES).toBe(3);
	});
});

describe('eventoCompromissoDaTool', () => {
	it('remarcação bem-sucedida conta como furo', () => {
		expect(eventoCompromissoDaTool('reagendar_agendamento', 'ok')).toBe('remarcacao');
	});

	it('falta registrada conta como furo', () => {
		expect(eventoCompromissoDaTool('marcar_falta', 'ok')).toBe('falta');
	});

	it('🎯 tool que falhou NÃO conta furo (a cliente não remarcou nada)', () => {
		expect(eventoCompromissoDaTool('reagendar_agendamento', 'erro')).toBeNull();
		expect(eventoCompromissoDaTool('reagendar_agendamento', 'aguardando_escolha')).toBeNull();
	});

	it('cancelar não é remarcar — não conta furo', () => {
		expect(eventoCompromissoDaTool('cancelar_agendamento', 'ok')).toBeNull();
	});
});
