import { describe, expect, it } from 'vitest';
import { scoreServicoMatch } from '../../src/clients/supabase.js';

// Catálogo real (resumido) pra simular o ranking de findServicoByName.
const CATALOGO = [
	'Cílios marrons',
	'Manutenção 15 dias cílios marrons',
	'Volume Russo',
	'Volume Brasileiro',
	'Volume light',
	'Volume híbrido',
	'Mega volume',
	'Manutenção volume Russo 15 dias',
	'Manutenção volume brasileiro 15 dias',
	'Manutenção volume light 15 dias',
	'Lash lifting',
];

/** Simula findServicoByName: retorna o nome de maior score (ou null). */
function melhorMatch(input: string): string | null {
	const ranked = CATALOGO.map((nome) => ({ nome, score: scoreServicoMatch(input, nome) }))
		.filter((r) => r.score > 0)
		.sort((a, b) => b.score - a.score);
	return ranked[0]?.nome ?? null;
}

describe('scoreServicoMatch — termos genéricos', () => {
	it('🚨 "cílios" genérico NÃO casa com "Cílios marrons" (nem com nada)', () => {
		// Bug reportado: Helena marcava todos como "Cílios marrons" porque era
		// o único serviço com a palavra "cílios" no nome.
		expect(melhorMatch('cílios')).toBeNull();
		expect(melhorMatch('cilios')).toBeNull();
		expect(scoreServicoMatch('cílios', 'Cílios marrons')).toBe(0);
	});

	it('🚨 "quero botar cílios" / "aplicação de cílios" não casa com nada', () => {
		expect(melhorMatch('quero botar cílios')).toBeNull();
		expect(melhorMatch('aplicação de cílios')).toBeNull();
		expect(melhorMatch('extensão de cílios')).toBeNull();
	});

	it('✅ "cílios marrons" (técnica real) AINDA casa com Cílios marrons', () => {
		expect(melhorMatch('cílios marrons')).toBe('Cílios marrons');
	});

	it('✅ serviços específicos continuam casando', () => {
		expect(melhorMatch('Volume Russo')).toBe('Volume Russo');
		expect(melhorMatch('volume light')).toBe('Volume light');
		expect(melhorMatch('volume brasileiro')).toBe('Volume Brasileiro');
	});

	it('✅ manutenção continua priorizando o serviço de manutenção', () => {
		expect(melhorMatch('manutenção volume russo')).toBe('Manutenção volume Russo 15 dias');
		expect(melhorMatch('manutenção volume light')).toBe('Manutenção volume light 15 dias');
	});

	it('✅ "volume light" sem manutenção NÃO cai na manutenção', () => {
		expect(melhorMatch('volume light')).toBe('Volume light');
	});
});
