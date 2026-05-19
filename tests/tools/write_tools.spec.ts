import { describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/agent/tools/_registry.js';
import { createAtualizarSinal } from '../../src/agent/tools/atualizar_sinal.js';
import { createMarcarFalta } from '../../src/agent/tools/marcar_falta.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});
const ctx: ToolContext = {
	telefone: '5571999999999',
	lead: { nome: 'Maria', etiquetas: [], sinal_pago: false },
};

// ── marcar_falta ──

describe('marcar_falta', () => {
	function makeFaltaDeps(statusAfter = 8) {
		const trinks = {
			marcarClienteFaltou: vi.fn().mockResolvedValue({ ok: true }),
			getAgendamento: vi.fn().mockResolvedValue({
				id: 500,
				status: {
					id: statusAfter,
					nome: statusAfter === 8 ? 'Cliente não compareceu' : 'Confirmado',
				},
				cliente: { id: 100, nome: 'Maria' },
				servico: { id: 10, nome: 'VB' },
				profissional: { id: 170223, nome: 'Camila' },
				dataHoraInicio: '2026-05-20T14:00:00',
				duracaoEmMinutos: 120,
				valor: 160,
			}),
		};
		const supabase = { upsertAgendamento: vi.fn() };
		return {
			tool: createMarcarFalta({ trinks: trinks as never, supabase: supabase as never }),
			trinks,
		};
	}

	it('✅ marks falta and verifies status=8', async () => {
		const { tool } = makeFaltaDeps(8);
		const r = await tool.handler({ agendamento_id: 500 }, ctx);
		expect(r.status).toBe('ok');
	});

	it('🔴 GHOST: PATCH ok + GET shows status≠8 → erro', async () => {
		const { tool } = makeFaltaDeps(4);
		const r = await tool.handler({ agendamento_id: 500 }, ctx);
		expect(r.status).toBe('erro');
		if (r.status === 'erro') expect(r.razao).toContain('não confirmada');
	});

	it('🔴 GHOST: PATCH ok + GET 404 → erro', async () => {
		const trinks = {
			marcarClienteFaltou: vi.fn().mockResolvedValue({ ok: true }),
			getAgendamento: vi.fn().mockRejectedValue(new Error('404')),
		};
		const tool = createMarcarFalta({
			trinks: trinks as never,
			supabase: { upsertAgendamento: vi.fn() } as never,
		});
		const r = await tool.handler({ agendamento_id: 500 }, ctx);
		expect(r.status).toBe('erro');
	});

	it('returns erro when PATCH itself fails', async () => {
		const trinks = {
			marcarClienteFaltou: vi.fn().mockRejectedValue(new Error('500')),
			getAgendamento: vi.fn(),
		};
		const tool = createMarcarFalta({
			trinks: trinks as never,
			supabase: { upsertAgendamento: vi.fn() } as never,
		});
		const r = await tool.handler({ agendamento_id: 500 }, ctx);
		expect(r.status).toBe('erro');
	});
});

// ── atualizar_sinal ──

describe('atualizar_sinal', () => {
	function makeSinalDeps(statusAfter = 4) {
		const trinks = {
			confirmarAgendamento: vi.fn().mockResolvedValue({ ok: true }),
			getAgendamento: vi.fn().mockResolvedValue({
				id: 500,
				status: { id: statusAfter, nome: statusAfter === 4 ? 'Confirmado' : 'Agendado' },
				cliente: { id: 100, nome: 'Maria' },
				servico: { id: 10, nome: 'VB' },
				profissional: { id: 170223, nome: 'Camila' },
				dataHoraInicio: '2026-05-20T14:00:00',
				duracaoEmMinutos: 120,
				valor: 160,
			}),
		};
		const supabase = {
			upsertAgendamento: vi.fn(),
			raw: {
				from: vi.fn().mockReturnValue({
					update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
				}),
			},
		};
		return {
			tool: createAtualizarSinal({ trinks: trinks as never, supabase: supabase as never }),
			trinks,
		};
	}

	it('✅ marks sinal paid and verifies confirmation status=4', async () => {
		const { tool } = makeSinalDeps(4);
		const r = await tool.handler({ telefone: '5571999999999', agendamento_id: 500 }, ctx);
		expect(r.status).toBe('ok');
		if (r.status === 'ok') {
			expect(r.sinal_pago).toBe(true);
			expect(r.agendamento_confirmado).toBe(true);
		}
	});

	it('🔴 GHOST: confirm ok + GET shows status≠4 → erro', async () => {
		const { tool } = makeSinalDeps(1);
		const r = await tool.handler({ telefone: '5571999999999', agendamento_id: 500 }, ctx);
		expect(r.status).toBe('erro');
		if (r.status === 'erro') expect(r.razao).toContain('não verificada');
	});

	it('🔴 GHOST: confirm ok + GET 404 → erro', async () => {
		const trinks = {
			confirmarAgendamento: vi.fn().mockResolvedValue({ ok: true }),
			getAgendamento: vi.fn().mockRejectedValue(new Error('404')),
		};
		const supabase = {
			upsertAgendamento: vi.fn(),
			raw: {
				from: vi.fn().mockReturnValue({
					update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
				}),
			},
		};
		const tool = createAtualizarSinal({ trinks: trinks as never, supabase: supabase as never });
		const r = await tool.handler({ telefone: '5571999999999', agendamento_id: 500 }, ctx);
		expect(r.status).toBe('erro');
	});
});
