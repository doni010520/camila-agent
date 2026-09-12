import { describe, expect, it, vi } from 'vitest';
import { LeadManager } from '../../src/domain/lead.js';

/** Supabase falso: guarda a linha do lead e registra o que foi gravado. */
function makeSupabase(leadInicial: Record<string, unknown>) {
	const gravado: Record<string, unknown>[] = [];
	const raw = {
		from: () => ({
			select: () => ({
				eq: () => ({ maybeSingle: async () => ({ data: leadInicial, error: null }) }),
			}),
			update: (u: Record<string, unknown>) => {
				gravado.push(u);
				return { eq: async () => ({ error: null }) };
			},
		}),
	};
	return { supabase: { raw } as never, gravado };
}

const LEAD_BASE = {
	id: '11111111-1111-1111-1111-111111111111',
	telefone: '5571988887777',
	nome: 'Ana Beatriz',
	created_at: '2026-01-01T00:00:00Z',
	etiquetas: [],
	sinal_pago: false,
	metadata: {},
};

describe('LeadManager.registrarCompromisso', () => {
	it('remarcação de cliente nova → contador 1, sem apagar o resto do metadata', async () => {
		const { supabase, gravado } = makeSupabase({
			...LEAD_BASE,
			metadata: { intervencao_humana_em: '2026-09-01T10:00:00Z' },
		});
		await new LeadManager(supabase).registrarCompromisso('5571988887777', 'remarcacao');

		expect(gravado).toHaveLength(1);
		expect(gravado[0]?.metadata).toEqual({
			intervencao_humana_em: '2026-09-01T10:00:00Z',
			compromisso: { remarcacoes: 1, faltas: 0, atendimentos_limpos: 0 },
		});
	});

	it('🎯 3ª remarcação soma em cima do histórico existente', async () => {
		const { supabase, gravado } = makeSupabase({
			...LEAD_BASE,
			metadata: { compromisso: { remarcacoes: 2, faltas: 0, atendimentos_limpos: 0 } },
		});
		await new LeadManager(supabase).registrarCompromisso('5571988887777', 'remarcacao');

		expect(gravado[0]?.metadata).toMatchObject({
			compromisso: { remarcacoes: 3, faltas: 0, atendimentos_limpos: 0 },
		});
	});

	it('falta soma no mesmo balde das remarcações', async () => {
		const { supabase, gravado } = makeSupabase({
			...LEAD_BASE,
			metadata: { compromisso: { remarcacoes: 2, faltas: 0, atendimentos_limpos: 0 } },
		});
		await new LeadManager(supabase).registrarCompromisso('5571988887777', 'falta');

		expect(gravado[0]?.metadata).toMatchObject({
			compromisso: { remarcacoes: 2, faltas: 1, atendimentos_limpos: 0 },
		});
	});

	it('2º atendimento concluído zera o histórico e libera a cliente', async () => {
		const { supabase, gravado } = makeSupabase({
			...LEAD_BASE,
			metadata: { compromisso: { remarcacoes: 3, faltas: 1, atendimentos_limpos: 1 } },
		});
		await new LeadManager(supabase).registrarCompromisso('5571988887777', 'atendimento_concluido');

		expect(gravado[0]?.metadata).toMatchObject({
			compromisso: { remarcacoes: 0, faltas: 0, atendimentos_limpos: 0 },
		});
	});

	it('lead desconhecido não explode nem grava nada', async () => {
		const raw = {
			from: () => ({
				select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
				update: vi.fn(),
			}),
		};
		await expect(
			new LeadManager({ raw } as never).registrarCompromisso('5571900000000', 'falta'),
		).resolves.toBeUndefined();
	});
});

describe('LeadManager.setSinalSempre', () => {
	it('🎯 #sinal-on marca a cliente sem mexer nas outras etiquetas', async () => {
		const { supabase, gravado } = makeSupabase({ ...LEAD_BASE, etiquetas: ['vip'] });
		const tags = await new LeadManager(supabase).setSinalSempre('5571988887777', true);

		expect(tags).toEqual(['vip', 'sinal-sempre']);
		expect(gravado[0]?.etiquetas).toEqual(['vip', 'sinal-sempre']);
	});

	it('#sinal-off tira a etiqueta e zera o histórico (perdão da Camila)', async () => {
		const { supabase, gravado } = makeSupabase({
			...LEAD_BASE,
			etiquetas: ['sinal-sempre'],
			metadata: { compromisso: { remarcacoes: 4, faltas: 2, atendimentos_limpos: 0 } },
		});
		const tags = await new LeadManager(supabase).setSinalSempre('5571988887777', false);

		expect(tags).toEqual([]);
		expect(gravado[0]?.metadata).toMatchObject({
			compromisso: { remarcacoes: 0, faltas: 0, atendimentos_limpos: 0 },
		});
	});

	it('ligar duas vezes não duplica a etiqueta', async () => {
		const { supabase } = makeSupabase({ ...LEAD_BASE, etiquetas: ['sinal-sempre'] });
		expect(await new LeadManager(supabase).setSinalSempre('5571988887777', true)).toEqual([
			'sinal-sempre',
		]);
	});
});
