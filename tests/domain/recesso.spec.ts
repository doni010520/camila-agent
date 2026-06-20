import { afterEach, describe, expect, it } from 'vitest';
import {
	dataEstaNoRecesso,
	dataRetornoRecesso,
	estaEmRecesso,
	recessoInfoParaPrompt,
} from '../../src/domain/recesso.js';
import { setTestEnv } from '../../src/infra/env.js';

afterEach(() => setTestEnv({}));

describe('recesso', () => {
	it('sem env configurada → nunca em recesso', () => {
		setTestEnv({});
		expect(estaEmRecesso('2026-06-28')).toBe(false);
		expect(recessoInfoParaPrompt('2026-06-28')).toBe('');
	});

	it('detecta dia DENTRO do recesso (inclusivo nas bordas)', () => {
		setTestEnv({ HELENA_RECESSO_INICIO: '2026-06-27', HELENA_RECESSO_FIM: '2026-07-01' });
		expect(estaEmRecesso('2026-06-27')).toBe(true); // primeiro dia
		expect(estaEmRecesso('2026-06-29')).toBe(true); // meio
		expect(estaEmRecesso('2026-07-01')).toBe(true); // último dia
	});

	it('dias fora do recesso', () => {
		setTestEnv({ HELENA_RECESSO_INICIO: '2026-06-27', HELENA_RECESSO_FIM: '2026-07-01' });
		expect(estaEmRecesso('2026-06-26')).toBe(false); // véspera
		expect(estaEmRecesso('2026-07-02')).toBe(false); // dia de retorno
	});

	it('data de retorno = dia seguinte ao fim', () => {
		setTestEnv({ HELENA_RECESSO_INICIO: '2026-06-27', HELENA_RECESSO_FIM: '2026-07-01' });
		expect(dataRetornoRecesso()).toBe('02/07');
	});

	it('dataEstaNoRecesso bloqueia agendamento PELA data do agendamento (não pela de hoje)', () => {
		setTestEnv({ HELENA_RECESSO_INICIO: '2026-06-27', HELENA_RECESSO_FIM: '2026-07-01' });
		// aceita YYYY-MM-DD e ISO completo
		expect(dataEstaNoRecesso('2026-06-28')).toBe(true);
		expect(dataEstaNoRecesso('2026-06-27T09:00:00')).toBe(true);
		expect(dataEstaNoRecesso('2026-07-01T17:30:00')).toBe(true);
		// fora do recesso
		expect(dataEstaNoRecesso('2026-06-26T09:00:00')).toBe(false);
		expect(dataEstaNoRecesso('2026-07-02T09:00:00')).toBe(false);
	});

	it('sem recesso configurado → nenhuma data bloqueada', () => {
		setTestEnv({});
		expect(dataEstaNoRecesso('2026-06-28')).toBe(false);
	});

	it('prompt: atende normal mas não agenda nas datas; some depois do recesso', () => {
		setTestEnv({ HELENA_RECESSO_INICIO: '2026-06-27', HELENA_RECESSO_FIM: '2026-07-01' });
		const info = recessoInfoParaPrompt('2026-06-20'); // antes do recesso, mas relevante
		expect(info).toContain('ATENDENDO NORMALMENTE');
		expect(info).toContain('NÃO agende');
		expect(info).toContain('02/07');
		// depois do recesso → vazio
		expect(recessoInfoParaPrompt('2026-07-05')).toBe('');
	});
});
