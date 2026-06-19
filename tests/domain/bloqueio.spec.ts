import { describe, expect, it } from 'vitest';
import { isNumeroBloqueado } from '../../src/domain/bloqueio.js';
import { setTestEnv } from '../../src/infra/env.js';

describe('isNumeroBloqueado', () => {
	it('retorna false quando a lista está vazia', () => {
		setTestEnv({});
		expect(isNumeroBloqueado('5571999998888')).toBe(false);
	});

	it('detecta número bloqueado (match exato)', () => {
		setTestEnv({ HELENA_NUMEROS_BLOQUEADOS: '5571999998888' });
		expect(isNumeroBloqueado('5571999998888')).toBe(true);
	});

	it('compara pelos últimos 8 dígitos (robusto a DDI/DDD/9º dígito)', () => {
		setTestEnv({ HELENA_NUMEROS_BLOQUEADOS: '5571999998888' });
		// mesmo número, formatos diferentes
		expect(isNumeroBloqueado('99998888')).toBe(true);
		expect(isNumeroBloqueado('71999998888')).toBe(true);
		expect(isNumeroBloqueado('+55 71 99999-8888')).toBe(true);
	});

	it('aceita lista com vários números (CSV, ; ou espaço)', () => {
		setTestEnv({ HELENA_NUMEROS_BLOQUEADOS: '5571999998888, 5571977776666;5571955554444' });
		expect(isNumeroBloqueado('5571977776666')).toBe(true);
		expect(isNumeroBloqueado('5571955554444')).toBe(true);
	});

	it('não bloqueia número fora da lista', () => {
		setTestEnv({ HELENA_NUMEROS_BLOQUEADOS: '5571999998888' });
		expect(isNumeroBloqueado('5571912345678')).toBe(false);
	});

	it('lida com telefone undefined/curto', () => {
		setTestEnv({ HELENA_NUMEROS_BLOQUEADOS: '5571999998888' });
		expect(isNumeroBloqueado(undefined)).toBe(false);
		expect(isNumeroBloqueado('123')).toBe(false);
	});
});
