import { describe, expect, it } from 'vitest';
import { isLeadVip } from '../../src/domain/lead.js';

describe('isLeadVip', () => {
	it('🎯 caso Lalesca: etiqueta com o ID VIP de produção → VIP', () => {
		// Bug real: Lalesca tinha ['557196416018:9'] e foi cobrada sinal porque
		// a decisão dependia do LLM interpretar o ID cru. Agora é no código.
		expect(isLeadVip({ etiquetas: ['557196416018:9'] })).toBe(true);
	});

	it('etiqueta contendo "vip" (qualquer caixa) → VIP', () => {
		expect(isLeadVip({ etiquetas: ['vip'] })).toBe(true);
		expect(isLeadVip({ etiquetas: ['VIP'] })).toBe(true);
		expect(isLeadVip({ etiquetas: ['Cliente VIP'] })).toBe(true);
	});

	it('ID VIP no meio de outras etiquetas → VIP', () => {
		expect(isLeadVip({ etiquetas: ['fidelidade', '557196416018:9', 'azul'] })).toBe(true);
	});

	it('sem etiqueta VIP → não VIP', () => {
		expect(isLeadVip({ etiquetas: ['fidelidade'] })).toBe(false);
		expect(isLeadVip({ etiquetas: [] })).toBe(false);
		expect(isLeadVip({ etiquetas: null })).toBe(false);
		expect(isLeadVip({})).toBe(false);
	});
});
