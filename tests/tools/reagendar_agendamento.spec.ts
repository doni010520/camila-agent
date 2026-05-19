import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/agent/tools/_registry.js';
import { createReagendarAgendamento } from '../../src/agent/tools/reagendar_agendamento.js';
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

function makeDeps(overrides?: { getAfterUpdate?: ReturnType<typeof vi.fn> }) {
	const trinks = {
		listClientes: vi.fn().mockResolvedValue({ data: [{ id: 100, nome: 'Maria', telefones: [] }] }),
		listAgendamentos: vi.fn().mockResolvedValue({ data: [AG] }),
		getAgendamento:
			overrides?.getAfterUpdate ??
			vi
				.fn()
				.mockResolvedValueOnce(AG) // first call: get current
				.mockResolvedValue({ ...AG, dataHoraInicio: '2026-05-25T10:00:00' }), // second: verify
		updateAgendamento: vi.fn().mockResolvedValue({ ...AG, dataHoraInicio: '2026-05-25T10:00:00' }),
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
		tool: createReagendarAgendamento({
			trinks: trinks as never,
			supabase: supabase as never,
			postgres: postgres as never,
		}),
		trinks,
	};
}

describe('reagendar_agendamento', () => {
	it('✅ reagenda single active and verifies', async () => {
		const { tool } = makeDeps();
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') {
			expect(r.data_hora_nova).toBe('2026-05-25T10:00:00');
			expect(r.data_hora_anterior).toBe('2026-05-20T14:00:00');
		}
	});

	it('🔴 GHOST: PUT ok + GET returns old date → erro', async () => {
		const { tool } = makeDeps({
			getAfterUpdate: vi
				.fn()
				.mockResolvedValueOnce(AG)
				.mockResolvedValue({ ...AG, dataHoraInicio: '2026-05-20T14:00:00' }), // unchanged!
		});
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('erro');
		if (r.status === 'erro') expect(r.razao).toContain('diverge');
	});

	it('🔴 GHOST: PUT ok + GET 404 → erro', async () => {
		const { tool } = makeDeps({
			getAfterUpdate: vi.fn().mockResolvedValueOnce(AG).mockRejectedValue(new Error('404')),
		});
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('erro');
	});

	it('returns aguardando_escolha for multiple', async () => {
		const { tool, trinks } = makeDeps();
		trinks.listAgendamentos.mockResolvedValue({ data: [AG, { ...AG, id: 501 }] });
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('aguardando_escolha');
	});
});
