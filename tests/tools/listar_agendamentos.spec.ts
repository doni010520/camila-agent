import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/agent/tools/_registry.js';
import { createListarAgendamentos } from '../../src/agent/tools/listar_agendamentos.js';

const ctx: ToolContext = {
	telefone: '5571999999999',
	lead: { nome: 'Maria', etiquetas: [], sinal_pago: false },
};

const REAL_AGENDAMENTO = {
	id: 494524448,
	status: { id: 4, nome: 'Confirmado' },
	cliente: { id: 79761206, nome: 'Thaise Rosa' },
	servico: { id: 13981392, nome: 'PE E MAO' },
	profissional: { id: 170223, nome: 'Camila Rosario' },
	dataHoraInicio: '2026-05-15T17:40:00',
	duracaoEmMinutos: 90,
	observacoesDoEstabelecimento: '',
	observacoesDoCliente: null,
	valor: 45,
};

function makeTool(agendamentos = [REAL_AGENDAMENTO], clienteFound = true) {
	const trinks = {
		listClientes: vi.fn().mockResolvedValue({
			data: clienteFound
				? [
						{
							id: 79761206,
							nome: 'Thaise Rosa',
							telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }],
						},
					]
				: [],
		}),
		listAgendamentos: vi.fn().mockResolvedValue({ data: agendamentos }),
	};

	const postgres = { findClienteByPhone: vi.fn().mockResolvedValue(null) };
	const tool = createListarAgendamentos({ trinks: trinks as never, postgres: postgres as never });
	return { tool, trinks };
}

describe('listar_agendamentos', () => {
	it('returns active agendamentos formatted', async () => {
		const { tool } = makeTool();
		const result = await tool.handler({ telefone: '5571999999999', apenas_ativos: true }, ctx);
		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			expect(result.total).toBe(1);
			const ag = (result.agendamentos as Array<Record<string, unknown>>)[0];
			expect(ag?.servico).toBe('PE E MAO');
			expect(ag?.profissional).toBe('Camila Rosario');
			expect(ag?.status).toBe('Confirmado');
			expect(ag?.id).toBe(494524448);
		}
	});

	it('filters out cancelled/finalized when apenas_ativos=true', async () => {
		const cancelled = { ...REAL_AGENDAMENTO, id: 2, status: { id: 7, nome: 'Cancelado' } };
		const { tool } = makeTool([REAL_AGENDAMENTO, cancelled]);
		const result = await tool.handler({ telefone: '5571999999999', apenas_ativos: true }, ctx);
		if (result.status === 'ok') {
			expect(result.total).toBe(1);
		}
	});

	it('returns all when apenas_ativos=false', async () => {
		const cancelled = { ...REAL_AGENDAMENTO, id: 2, status: { id: 7, nome: 'Cancelado' } };
		const { tool } = makeTool([REAL_AGENDAMENTO, cancelled]);
		const result = await tool.handler({ telefone: '5571999999999', apenas_ativos: false }, ctx);
		if (result.status === 'ok') {
			expect(result.total).toBe(2);
		}
	});

	it('returns ok with total=0 when no agendamentos', async () => {
		const { tool } = makeTool([]);
		const result = await tool.handler({ telefone: '5571999999999' }, ctx);
		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			expect(result.total).toBe(0);
		}
	});

	it('returns erro when cliente not found', async () => {
		const { tool } = makeTool([], false);
		const result = await tool.handler({ telefone: '5571999999999' }, ctx);
		expect(result.status).toBe('erro');
	});

	it('returns erro for invalid telefone', async () => {
		const { tool } = makeTool([], false);
		const result = await tool.handler({ telefone: '123' }, ctx);
		expect(result.status).toBe('erro');
	});
});
