import { describe, expect, it } from 'vitest';
import { nomeParecePessoa, nomeUtilizavel } from '../../src/domain/nome-cliente.js';

describe('nomeParecePessoa', () => {
	it('✅ aceita nomes de pessoa normais', () => {
		for (const n of ['Maria', 'João', 'Ana Paula', 'Lalesca Paixão', 'maria clara']) {
			expect(nomeParecePessoa(n), n).toBe(true);
		}
	});

	it('🚫 rejeita profissões/genéricos (caso manicure)', () => {
		for (const n of ['manicure', 'Manicure', 'pedicure', 'cabeleireira', 'esteticista']) {
			expect(nomeParecePessoa(n), n).toBe(false);
		}
	});

	it('🚫 rejeita nomes de negócio/salão', () => {
		expect(nomeParecePessoa('Studio Camila')).toBe(false);
		expect(nomeParecePessoa('Salão da Ana')).toBe(false);
		expect(nomeParecePessoa('Nails Boutique')).toBe(false);
	});

	it('🚫 rejeita números, emojis-only e vazios', () => {
		expect(nomeParecePessoa('Loja 24h')).toBe(false);
		expect(nomeParecePessoa('71999998888')).toBe(false);
		expect(nomeParecePessoa('🥰💅')).toBe(false);
		expect(nomeParecePessoa('')).toBe(false);
		expect(nomeParecePessoa(undefined)).toBe(false);
		expect(nomeParecePessoa('A')).toBe(false);
	});

	it('aceita nome de pessoa mesmo com emoji junto', () => {
		expect(nomeParecePessoa('Maria 🥰')).toBe(true);
	});

	it('nomeUtilizavel retorna o nome ou undefined', () => {
		expect(nomeUtilizavel('Maria')).toBe('Maria');
		expect(nomeUtilizavel('manicure')).toBeUndefined();
		expect(nomeUtilizavel(undefined)).toBeUndefined();
	});
});
