import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/agent/tools/_registry.js';
import { createCancelarAgendamento } from '../../src/agent/tools/cancelar_agendamento.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});
const ctx: ToolContext = {
	telefone: '5571999999999',
	lead: { nome: 'Maria', etiquetas: [], sinal_pago: false },
};

const AG = {
	id: 500,
	status: { id: 4, nome: 'Confirmado' },
	cliente: { id: 100, nome: 'Maria' },
	servico: { id: 10, nome: 'Volume Brasileiro' },
	profissional: { id: 170223, nome: 'Camila' },
	dataHoraInicio: '2026-05-20T14:00:00',
	duracaoEmMinutos: 120,
	valor: 160,
};

function makeDeps(overrides?: { getAfterCancel?: ReturnType<typeof vi.fn> }) {
	const trinks = {
		listClientes: vi.fn().mockResolvedValue({ data: [{ id: 100, nome: 'Maria', telefones: [] }] }),
		listAgendamentos: vi.fn().mockResolvedValue({ data: [AG] }),
		cancelarAgendamento: vi.fn().mockResolvedValue({ ok: true, status: 204, body: '' }),
		getAgendamento:
			overrides?.getAfterCancel ??
			vi.fn().mockResolvedValue({ ...AG, status: { id: 7, nome: 'Cancelado' } }),
		getCliente: vi.fn().mockResolvedValue({ id: 100, nome: 'Maria' }),
	};
	const supabase = {
		upsertAgendamento: vi.fn(),
		raw: {
			from: vi.fn().mockReturnValue({
				insert: vi.fn().mockResolvedValue({ error: null }),
			}),
		},
	};
	const postgres = { findClienteByPhone: vi.fn().mockResolvedValue(null) };

	return {
		tool: createCancelarAgendamento({
			trinks: trinks as never,
			supabase: supabase as never,
			postgres: postgres as never,
		}),
		trinks,
		supabase,
	};
}

describe('cancelar_agendamento', () => {
	it('✅ cancels single active and verifies status=7', async () => {
		const { tool } = makeDeps();
		const r = await tool.handler({ telefone: '5571999999999' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') expect(r.agendamento_id).toBe(500);
	});

	it('🔴 GHOST: PATCH ok + GET shows status≠7 → erro', async () => {
		const { tool } = makeDeps({
			getAfterCancel: vi.fn().mockResolvedValue({ ...AG, status: { id: 4, nome: 'Confirmado' } }),
		});
		const r = await tool.handler({ telefone: '5571999999999', agendamento_id: 500 }, ctx);
		expect(r.status).toBe('erro');
		if (r.status === 'erro') expect(r.razao).toContain('não confirmado');
	});

	it('🔴 GHOST: PATCH ok + GET 404 → erro', async () => {
		const { tool } = makeDeps({
			getAfterCancel: vi.fn().mockRejectedValue(new Error('404')),
		});
		const r = await tool.handler({ telefone: '5571999999999', agendamento_id: 500 }, ctx);
		expect(r.status).toBe('erro');
	});

	it('returns aguardando_escolha for multiple active', async () => {
		const { tool, trinks } = makeDeps();
		const ag2 = { ...AG, id: 501, servico: { id: 11, nome: 'Manutenção' } };
		trinks.listAgendamentos.mockResolvedValue({ data: [AG, ag2] });
		const r = await tool.handler({ telefone: '5571999999999' }, ctx);
		expect(r.status).toBe('aguardando_escolha');
	});

	it('returns ok total=0 when no active agendamentos', async () => {
		const { tool, trinks } = makeDeps();
		trinks.listAgendamentos.mockResolvedValue({ data: [] });
		const r = await tool.handler({ telefone: '5571999999999' }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') expect(r.total).toBe(0);
	});
});
