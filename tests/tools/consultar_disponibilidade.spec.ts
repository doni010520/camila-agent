import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/agent/tools/_registry.js';
import { createConsultarDisponibilidade } from '../../src/agent/tools/consultar_disponibilidade.js';
import { _resetDisponibilidadeCache } from '../../src/infra/disponibilidade-cache.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});

const ctx: ToolContext = {
	telefone: '5571999999999',
	lead: { nome: 'Maria', etiquetas: [], sinal_pago: false },
};

function makeTool(overrides?: {
	horariosVagos?: string[];
	intervalosVagos?: Array<{ inicio: string; fim: string }>;
}) {
	const trinks = {
		listProfissionaisComAgenda: vi.fn().mockResolvedValue({
			data: [
				{
					id: 170223,
					nome: 'Camila Rosario',
					horariosVagos: overrides?.horariosVagos ?? [
						'10:30',
						'11:00',
						'11:30',
						'14:00',
						'14:30',
						'15:00',
						'15:30',
						'16:00',
					],
					intervalosVagos: overrides?.intervalosVagos ?? [{ inicio: '10:30', fim: '18:00' }],
				},
			],
		}),
		listServicos: vi.fn().mockResolvedValue({
			data: [
				{
					id: 7331915,
					nome: 'Volume Brasileiro',
					duracaoEmMinutos: 120,
					preco: 160,
					ativo: true,
				},
			],
		}),
	};

	const supabase = {
		findServicoByName: vi.fn().mockResolvedValue({
			id: 7331915,
			nome: 'Volume Brasileiro',
			duracao_minutos: 120,
			preco: 160,
		}),
		upsertServico: vi.fn(),
	};

	const tool = createConsultarDisponibilidade({
		trinks: trinks as never,
		supabase: supabase as never,
		profissionalId: 170223,
	});

	return { tool, trinks, supabase };
}

describe('consultar_disponibilidade', () => {
	beforeEach(() => {
		_resetDisponibilidadeCache();
		setTestEnv({}); // env limpo (sem bloqueados) antes de cada teste
	});

	it('returns available slots filtered by turno tarde', async () => {
		const { tool } = makeTool();
		const result = await tool.handler({ servico: 'Volume Brasileiro', hora_e_turno: 'tarde' }, ctx);
		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			const opcoes = result.opcoes as Array<{ horarios: string[] }>;
			expect(opcoes.length).toBeGreaterThan(0);
			// Tarde = 13:30-17:30, so all horarios should be in that range
			for (const op of opcoes) {
				for (const h of op.horarios) {
					expect(h >= '13:30' && h < '17:30').toBe(true);
				}
			}
		}
	});

	it('filters consecutive slots for 120min service (needs 4 consecutive)', async () => {
		const { tool } = makeTool({
			horariosVagos: ['14:00', '14:30', '15:00', '15:30', '16:00', '17:00'],
		});
		const result = await tool.handler(
			{ servico: 'Volume Brasileiro', hora_e_turno: 'qualquer' },
			ctx,
		);
		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			const opcoes = result.opcoes as Array<{ horarios: string[] }>;
			// 14:00 is valid (14:00,14:30,15:00,15:30 all available)
			// 14:30 is valid (14:30,15:00,15:30,16:00 all available)
			// 15:00 is NOT valid (15:00,15:30,16:00,16:30 — 16:30 missing)
			// 17:00 is NOT valid (alone)
			const allHorarios = opcoes.flatMap((o) => o.horarios);
			expect(allHorarios).toContain('14:00');
			expect(allHorarios).toContain('14:30');
			expect(allHorarios).not.toContain('17:00');
		}
	});

	it('excludes lunch break slots', async () => {
		const { tool } = makeTool({
			horariosVagos: ['11:30', '12:00', '12:30', '13:00', '13:30', '14:00'],
		});
		const result = await tool.handler(
			{ servico: 'Volume Brasileiro', hora_e_turno: 'qualquer', duracao_minutos: 30 },
			ctx,
		);
		if (result.status === 'ok') {
			const allHorarios = (result.opcoes as Array<{ horarios: string[] }>).flatMap(
				(o) => o.horarios,
			);
			expect(allHorarios).not.toContain('12:00');
			expect(allHorarios).not.toContain('12:30');
			expect(allHorarios).not.toContain('13:00');
			expect(allHorarios).toContain('13:30');
		}
	});

	it('returns erro when servico not found', async () => {
		const { tool, supabase, trinks } = makeTool();
		supabase.findServicoByName.mockResolvedValue(null);
		trinks.listServicos.mockResolvedValue({ data: [] });
		const result = await tool.handler({ servico: 'Inexistente' }, ctx);
		expect(result.status).toBe('erro');
	});

	it('returns erro when no slots available', async () => {
		const { tool } = makeTool({ horariosVagos: [] });
		const result = await tool.handler({ servico: 'Volume Brasileiro' }, ctx);
		expect(result.status).toBe('erro');
		if (result.status === 'erro') {
			expect(result.razao).toContain('Sem horários');
		}
	});

	// ── Resiliência a rate limit (429) da Trinks ──

	it('🛡️ 429 em TODOS os dias → erro técnico (não diz "cheio")', async () => {
		const { tool, trinks } = makeTool();
		trinks.listProfissionaisComAgenda.mockRejectedValue(new Error('GET ... returned 429'));
		const result = await tool.handler({ servico: 'Volume Brasileiro' }, ctx);
		expect(result.status).toBe('erro');
		if (result.status === 'erro') {
			expect(result.razao).toContain('instabilidade');
			expect(result.razao).not.toContain('Sem horários');
		}
	});

	it('🛡️ 429 em alguns dias não derruba a consulta — retorna os dias que deram certo', async () => {
		const { tool, trinks } = makeTool();
		let call = 0;
		trinks.listProfissionaisComAgenda.mockImplementation(async () => {
			call++;
			// 1ª data falha (429), demais funcionam
			if (call === 1) throw new Error('GET ... returned 429');
			return {
				data: [
					{
						id: 170223,
						nome: 'Camila Rosario',
						horariosVagos: ['14:00', '14:30', '15:00', '15:30', '16:00'],
						intervalosVagos: [{ inicio: '14:00', fim: '18:00' }],
					},
				],
			};
		});
		const result = await tool.handler({ servico: 'Volume Brasileiro' }, ctx);
		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			expect((result.opcoes as unknown[]).length).toBeGreaterThan(0);
		}
	});

	it('⚡ early-exit: para de chamar a Trinks após juntar dias suficientes', async () => {
		const { tool, trinks } = makeTool();
		await tool.handler({ servico: 'Volume Brasileiro' }, ctx);
		// MAX_DIAS_OFERTA=4 → no máximo ~4 chamadas, nunca os 14 dias completos
		expect(trinks.listProfissionaisComAgenda.mock.calls.length).toBeLessThanOrEqual(5);
	});

	it('🚫 número bloqueado: sempre "sem vagas", sem tocar na Trinks nem oferecer encaixe', async () => {
		setTestEnv({ HELENA_NUMEROS_BLOQUEADOS: '5571999999999' });
		const { tool, trinks } = makeTool();
		const result = await tool.handler({ servico: 'Volume Brasileiro' }, ctx);
		expect(result.status).toBe('erro');
		if (result.status === 'erro') {
			expect(result.razao).toContain('NÃO ofereça encaixe');
		}
		expect(trinks.listProfissionaisComAgenda).not.toHaveBeenCalled();
		setTestEnv({}); // reset
	});
});
