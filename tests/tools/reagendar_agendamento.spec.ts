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
const AG_CANCELLED = { ...AG, status: { id: 9, nome: 'Cancelado' } };
const AG_NEW = {
	...AG,
	id: 600,
	status: { id: 3, nome: 'Aguardando Confirmação do Estabelecimento' },
	dataHoraInicio: '2026-05-25T10:00:00',
};

interface Overrides {
	getOldAfterCancel?: ReturnType<typeof vi.fn>;
	getNewAfterCreate?: ReturnType<typeof vi.fn>;
	cancelFn?: ReturnType<typeof vi.fn>;
	createFn?: ReturnType<typeof vi.fn>;
}

function makeDeps(o?: Overrides) {
	// Sequence of getAgendamento calls:
	// 1st: read antigo (returns AG ativo)
	// 2nd: verify cancelamento (returns AG_CANCELLED)
	// 3rd: verify novo (returns AG_NEW)
	const getMock = vi
		.fn()
		.mockResolvedValueOnce(AG)
		.mockImplementationOnce(o?.getOldAfterCancel ?? (() => Promise.resolve(AG_CANCELLED)))
		.mockImplementationOnce(o?.getNewAfterCreate ?? (() => Promise.resolve(AG_NEW)));

	const trinks = {
		listClientes: vi.fn().mockResolvedValue({ data: [{ id: 100, nome: 'Maria', telefones: [] }] }),
		listAgendamentos: vi.fn().mockResolvedValue({ data: [AG] }),
		getAgendamento: getMock,
		cancelarAgendamento: o?.cancelFn ?? vi.fn().mockResolvedValue({ ok: true, status: 204, body: '' }),
		createAgendamento: o?.createFn ?? vi.fn().mockResolvedValue({ id: 600 }),
		getCliente: vi.fn().mockResolvedValue({ id: 100, nome: 'Maria' }),
	};
	const supabase = {
		upsertAgendamento: vi.fn(),
		raw: {
			from: vi.fn().mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: null }) }),
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

describe('reagendar_agendamento (cancel + create strategy)', () => {
	it('✅ cancels antigo + creates novo + returns both IDs', async () => {
		const { tool, trinks } = makeDeps();
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') {
			expect(r.agendamento_id_antigo).toBe(500);
			expect(r.agendamento_id_novo).toBe(600);
			expect(r.data_hora_anterior).toBe('2026-05-20T14:00:00');
			expect(r.data_hora_nova).toBe('2026-05-25T10:00:00');
		}
		expect(trinks.cancelarAgendamento).toHaveBeenCalledWith(500, { motivo: 'Reagendamento' });
		expect(trinks.createAgendamento).toHaveBeenCalled();
	});

	it('🔴 GHOST: cancel did not actually cancel (verify shows status active) → erro', async () => {
		const { tool, trinks } = makeDeps({
			getOldAfterCancel: vi.fn().mockResolvedValue(AG), // ainda ativo
		});
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('erro');
		expect(trinks.createAgendamento).not.toHaveBeenCalled(); // não cria novo se antigo falhou
	});

	it('🔴 cancel falhou (PATCH erro) → erro', async () => {
		const { tool, trinks } = makeDeps({
			cancelFn: vi.fn().mockRejectedValue(new Error('Trinks 500')),
		});
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('erro');
		expect(trinks.createAgendamento).not.toHaveBeenCalled();
	});

	it('🔴 CRITICAL: cancel ok + create falhou → erro com aviso de intervenção', async () => {
		const { tool } = makeDeps({
			createFn: vi.fn().mockRejectedValue(new Error('Trinks 409')),
		});
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('erro');
		if (r.status === 'erro') {
			expect(r.razao).toContain('CANCELADO');
			expect(r.razao).toContain('Camila');
		}
	});

	it('returns aguardando_escolha for multiple actives', async () => {
		const { tool, trinks } = makeDeps();
		trinks.listAgendamentos.mockResolvedValue({ data: [AG, { ...AG, id: 501 }] });
		const r = await tool.handler(
			{ telefone: '5571999999999', nova_data_hora: '2026-05-25T10:00:00' },
			ctx,
		);
		expect(r.status).toBe('aguardando_escolha');
	});
});
