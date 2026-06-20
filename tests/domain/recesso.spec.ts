import { afterEach, describe, expect, it } from 'vitest';
import {
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

	it('prompt mostra info durante o recesso e some depois', () => {
		setTestEnv({ HELENA_RECESSO_INICIO: '2026-06-27', HELENA_RECESSO_FIM: '2026-07-01' });
		const dentro = recessoInfoParaPrompt('2026-06-28');
		expect(dentro).toContain('DE RECESSO');
		expect(dentro).toContain('02/07');
		expect(dentro).toContain('transferir_humano');
		// depois do recesso → vazio
		expect(recessoInfoParaPrompt('2026-07-05')).toBe('');
	});

	it('prompt avisa com antecedência (antes do início)', () => {
		setTestEnv({ HELENA_RECESSO_INICIO: '2026-06-27', HELENA_RECESSO_FIM: '2026-07-01' });
		const antes = recessoInfoParaPrompt('2026-06-25');
		expect(antes).toContain('entrará de recesso');
	});
});
