import { afterEach, describe, expect, it } from 'vitest';
import { servicoIndisponivel } from '../../src/domain/servico-indisponivel.js';
import { setTestEnv } from '../../src/infra/env.js';

afterEach(() => setTestEnv({}));

describe('servicoIndisponivel', () => {
	it('default "sobrancelha" bloqueia os 3 designs de sobrancelha', () => {
		setTestEnv({ HELENA_SERVICOS_INDISPONIVEIS: 'sobrancelha' });
		expect(servicoIndisponivel('Design de sobrancelhas com coloração')).toBe(true);
		expect(servicoIndisponivel('Design de sobrancelhas com henna')).toBe(true);
		expect(servicoIndisponivel('Designer de sobrancelhas sem henna')).toBe(true);
	});

	it('não bloqueia serviços de cílios', () => {
		setTestEnv({ HELENA_SERVICOS_INDISPONIVEIS: 'sobrancelha' });
		expect(servicoIndisponivel('Volume Russo')).toBe(false);
		expect(servicoIndisponivel('Manutenção volume light 15 dias')).toBe(false);
	});

	it('case e acento insensível', () => {
		setTestEnv({ HELENA_SERVICOS_INDISPONIVEIS: 'sobrancelha' });
		expect(servicoIndisponivel('SOBRANCELHA')).toBe(true);
		expect(servicoIndisponivel('Sobrançelha')).toBe(true);
	});

	it('múltiplas palavras-chave (CSV)', () => {
		setTestEnv({ HELENA_SERVICOS_INDISPONIVEIS: 'sobrancelha,micropigment,pure browns' });
		expect(servicoIndisponivel('Micropigmentação')).toBe(true);
		expect(servicoIndisponivel('Pure Browns')).toBe(true);
		expect(servicoIndisponivel('Retoque de micro')).toBe(false); // não casa "micro" com "micropigment"
	});

	it('env vazia → nada bloqueado (reativado)', () => {
		setTestEnv({ HELENA_SERVICOS_INDISPONIVEIS: '' });
		expect(servicoIndisponivel('Design de sobrancelhas com henna')).toBe(false);
	});
});
