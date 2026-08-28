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
	function makeFaltaDeps(statusAfter = 6) {
		const trinks = {
			marcarClienteFaltou: vi.fn().mockResolvedValue({ ok: true }),
			getAgendamento: vi.fn().mockResolvedValue({
				id: 500,
				status: {
					id: statusAfter,
					nome: statusAfter === 6 ? 'Cliente não compareceu' : 'Confirmado',
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

	it('✅ marks falta and verifies status=6 (CLIENTE_FALTOU real da API)', async () => {
		const { tool } = makeFaltaDeps(6);
		const r = await tool.handler({ agendamento_id: 500 }, ctx);
		expect(r.status).toBe('ok');
	});

	it('🔴 GHOST: PATCH ok + GET shows status≠6 → erro', async () => {
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
	// Agendamento ativo da cliente (usado pra resolver o agendamento_id).
	const ATIVO = {
		id: 500,
		status: { id: 1, nome: 'Agendado' },
		cliente: { id: 100, nome: 'Maria' },
		servico: { id: 10, nome: 'VB' },
		profissional: { id: 170223, nome: 'Camila' },
		dataHoraInicio: '2026-05-20T14:00:00',
		duracaoEmMinutos: 120,
		valor: 160,
	};

	function makeSinalDeps(statusAfter = 4) {
		const trinks = {
			listClientes: vi.fn().mockResolvedValue({
				data: [
					{ id: 100, nome: 'Maria', telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }] },
				],
			}),
			listAgendamentos: vi.fn().mockResolvedValue({ data: [ATIVO] }),
			confirmarAgendamento: vi.fn().mockResolvedValue({ ok: true }),
			getAgendamento: vi.fn().mockResolvedValue({
				...ATIVO,
				status: { id: statusAfter, nome: statusAfter === 4 ? 'Confirmado' : 'Agendado' },
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
		const postgres = { findClienteByPhone: vi.fn().mockResolvedValue(null) };
		return {
			tool: createAtualizarSinal({
				trinks: trinks as never,
				supabase: supabase as never,
				postgres: postgres as never,
			}),
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

	it('🛡️ ID inválido do LLM (0) → resolve pro agendamento ativo real (bug prod)', async () => {
		// Produção: LLM passava 0/1 → PATCH /agendamentos/0 → 400 → sinal perdido.
		const { tool, trinks } = makeSinalDeps(4);
		const r = await tool.handler({ telefone: '5571999999999', agendamento_id: 0 }, ctx);
		expect(r.status).toBe('ok');
		expect(trinks.confirmarAgendamento).toHaveBeenCalledWith(500); // ID real, não 0
	});

	it('🛡️ índice 1 do LLM → resolve pro 1º ativo', async () => {
		const { tool, trinks } = makeSinalDeps(4);
		const r = await tool.handler({ telefone: '5571999999999', agendamento_id: 1 }, ctx);
		expect(r.status).toBe('ok');
		expect(trinks.confirmarAgendamento).toHaveBeenCalledWith(500);
	});

	it('🛡️ sem agendamento_id → usa o único ativo', async () => {
		const { tool, trinks } = makeSinalDeps(4);
		const r = await tool.handler({ telefone: '5571999999999' }, ctx);
		expect(r.status).toBe('ok');
		expect(trinks.confirmarAgendamento).toHaveBeenCalledWith(500);
	});

	it('🔴 GHOST: confirm ok + GET 404 → erro', async () => {
		const trinks = {
			listClientes: vi.fn().mockResolvedValue({
				data: [
					{ id: 100, nome: 'Maria', telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }] },
				],
			}),
			listAgendamentos: vi.fn().mockResolvedValue({ data: [ATIVO] }),
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
		const postgres = { findClienteByPhone: vi.fn().mockResolvedValue(null) };
		const tool = createAtualizarSinal({
			trinks: trinks as never,
			supabase: supabase as never,
			postgres: postgres as never,
		});
		const r = await tool.handler({ telefone: '5571999999999', agendamento_id: 500 }, ctx);
		expect(r.status).toBe('erro');
	});
});
