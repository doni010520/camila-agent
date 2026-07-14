import { afterEach, describe, expect, it } from 'vitest';
import { servicoIndisponivel } from '../../src/domain/servico-indisponivel.js';
import { setTestEnv } from '../../src/infra/env.js';

afterEach(() => setTestEnv({}));

// Allowlist default (serviços de cílios da Camila)
const ALLOW = 'volume,cilio,lash,efeito,fox,hidragloss,hibrido,remocao,reposicao';

// Serviços reais da Trinks — cílios (da Camila) devem ser PERMITIDOS
const CILIOS = [
	'Cílios marrons',
	'Volume Russo',
	'Volume Brasileiro',
	'Volume light',
	'Volume híbrido',
	'Mega volume',
	'Volume 30+',
	'Volume express',
	'Manutenção volume Russo 15 dias',
	'Manutenção volume brasileiro 15 dias',
	'Manutenção volume light 15 dias',
	'Manutenção 25 dias híbrido',
	'Manutenção Mega Volume 15 dias',
	'efeito flecha',
	'Efeito Fox',
	'Manutenção fox 15 dias',
	'Manutenção efeito flecha 15 dias',
	'Manutenção Efeito molhado',
	'Manutenção 25 dias efeito molhado',
	'Lash lifting',
	'Hidragloss',
	'Manutenção 15 dias cílios marrons',
	'Mantenção cílios marrons 25 dias',
	'Remoção',
	'Reposição',
];

// Serviços de OUTROS profissionais — NÃO devem ser oferecidos
const OUTROS = [
	'Design de sobrancelhas com coloração',
	'Design de sobrancelhas com henna',
	'Designer de sobrancelhas sem henna',
	'Harmonização  de Micro',
	'Micropigmentação',
	'Pure Browns',
	'Retoque de micro',
	'Depilação',
	'MASSAGEM',
	'LIMPEZA DE PELE PROFUNDA',
	'PE E MAO',
	'UNHAS MAO',
	'Unhas PE',
];

describe('servicoIndisponivel (allowlist serviços da Camila)', () => {
	it('✅ TODOS os serviços de cílios da Camila são permitidos', () => {
		setTestEnv({ HELENA_SERVICOS_PERMITIDOS: ALLOW });
		for (const s of CILIOS) {
			expect(servicoIndisponivel(s), `${s} deveria ser permitido`).toBe(false);
		}
	});

	it('🚫 TODOS os serviços de outros profissionais são bloqueados', () => {
		setTestEnv({ HELENA_SERVICOS_PERMITIDOS: ALLOW });
		for (const s of OUTROS) {
			expect(servicoIndisponivel(s), `${s} deveria ser bloqueado`).toBe(true);
		}
	});

	it('case e acento insensível', () => {
		setTestEnv({ HELENA_SERVICOS_PERMITIDOS: ALLOW });
		expect(servicoIndisponivel('VOLUME RUSSO')).toBe(false);
		expect(servicoIndisponivel('sobrançelha com henna')).toBe(true);
	});

	it('allowlist vazia → tudo liberado', () => {
		setTestEnv({ HELENA_SERVICOS_PERMITIDOS: '' });
		expect(servicoIndisponivel('Design de sobrancelhas com henna')).toBe(false);
		expect(servicoIndisponivel('Volume Russo')).toBe(false);
	});
});
