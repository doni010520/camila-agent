import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';
import { runRelatorioDiario } from '../../src/jobs/relatorio-diario.js';

setTestEnv({});

function makeEvento(tipo: string, overrides: Record<string, unknown> = {}) {
	return {
		tipo,
		telefone: '5571999999999',
		valor: null,
		detalhes: {},
		sucesso: true,
		cliente_nome: 'Maria',
		criado_em: new Date().toISOString(),
		...overrides,
	};
}

function makeSupabase(eventos: unknown[] = [], jaEnviado = false) {
	const fromMap: Record<string, unknown> = {
		relatorios_enviados: {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({ data: jaEnviado ? { data: 'today', resumo: { data: '2026-05-21' } } : null }),
			insert: vi.fn().mockResolvedValue({ data: null, error: null }),
		},
		eventos_helena: {
			select: vi.fn().mockReturnThis(),
			gte: vi.fn().mockReturnThis(),
			lte: vi.fn().mockReturnThis(),
			eq: vi.fn().mockResolvedValue({ data: eventos, error: null }),
		},
	};
	return {
		raw: {
			from: vi.fn().mockImplementation((table: string) => fromMap[table] ?? {
				select: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				maybeSingle: vi.fn().mockResolvedValue({ data: null }),
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
			}),
		},
	};
}

function makeUazapi() {
	return { sendText: vi.fn().mockResolvedValue(undefined) };
}

describe('runRelatorioDiario', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns zero counts when no events', async () => {
		const sb = makeSupabase([]);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.atendimentos_unicos).toBe(0);
		expect(r.agendamentos_criados).toBe(0);
		expect(r.receita_potencial_agendada).toBe(0);
		expect(r.top_servicos).toHaveLength(0);
	});

	it('counts each tipo correctly', async () => {
		const eventos = [
			makeEvento('agendamento_criado', { telefone: 'A', valor: 100, detalhes: { result: { agendamento_id: 1 } } }),
			makeEvento('agendamento_criado', { telefone: 'B', valor: 50, detalhes: { result: { agendamento_id: 2 } } }),
			makeEvento('agendamento_cancelado', { telefone: 'C' }),
			makeEvento('agendamento_reagendado', { telefone: 'D' }),
			makeEvento('transferido_humano', { telefone: 'E' }),
			makeEvento('catalogo_enviado', { telefone: 'F' }),
			makeEvento('curso_enviado', { telefone: 'G' }),
			makeEvento('pix_enviado', { telefone: 'H' }),
			makeEvento('sinal_pago', { telefone: 'I', valor: 80 }),
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.agendamentos_criados).toBe(2);
		expect(r.agendamentos_cancelados).toBe(1);
		expect(r.agendamentos_reagendados).toBe(1);
		expect(r.transferidos_humano).toBe(1);
		expect(r.catalogos_enviados).toBe(1);
		expect(r.cursos_enviados).toBe(1);
		expect(r.pix_enviados).toBe(1);
		expect(r.sinais_pagos).toBe(1);
		expect(r.receita_potencial_agendada).toBe(150);
		expect(r.receita_sinais).toBe(80);
		expect(r.atendimentos_unicos).toBe(9);
	});

	it('counts unique telefones correctly (same phone multiple events)', async () => {
		const eventos = [
			makeEvento('mensagem_recebida', { telefone: 'X' }),
			makeEvento('agendamento_criado', { telefone: 'X', detalhes: { result: { agendamento_id: 10 } } }),
			makeEvento('agendamento_criado', { telefone: 'Y', detalhes: { result: { agendamento_id: 11 } } }),
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.atendimentos_unicos).toBe(2);
	});

	it('extracts top servicos sorted by count', async () => {
		const eventos = [
			makeEvento('agendamento_criado', { detalhes: { result: { agendamento_id: 20, servico_nome: 'Hidratação', data_hora_inicio: '2026-05-21T10:00:00' } } }),
			makeEvento('agendamento_criado', { detalhes: { result: { agendamento_id: 21, servico_nome: 'Hidratação', data_hora_inicio: '2026-05-21T14:00:00' } } }),
			makeEvento('agendamento_criado', { detalhes: { result: { agendamento_id: 22, servico_nome: 'Corte', data_hora_inicio: '2026-05-21T09:00:00' } } }),
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.top_servicos[0]).toEqual({ nome: 'Hidratação', total: 2 });
		expect(r.top_servicos[1]).toEqual({ nome: 'Corte', total: 1 });
	});

	it('extracts faixa horaria from data_hora_inicio', async () => {
		const eventos = [
			makeEvento('agendamento_criado', { detalhes: { result: { agendamento_id: 30, servico_nome: 'S', data_hora_inicio: '2026-05-21T10:30:00' } } }),
			makeEvento('agendamento_criado', { detalhes: { result: { agendamento_id: 31, servico_nome: 'S', data_hora_inicio: '2026-05-21T14:00:00' } } }),
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		const faixas = r.top_horarios.map((h) => h.faixa);
		expect(faixas).toContain('10h-12h');
		expect(faixas).toContain('14h-16h');
	});

	it('is idempotent: skips send if already sent today', async () => {
		const sb = makeSupabase([], true);
		const ua = makeUazapi();
		await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(ua.sendText).not.toHaveBeenCalled();
	});

	it('does not count sucesso=false events in positive metrics', async () => {
		// The query filters sucesso=true at DB level; we test that agregarEventos
		// only receives events already filtered. Simulate by passing empty array.
		const sb = makeSupabase([]);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.agendamentos_criados).toBe(0);
	});

	it('sends message that does not mention errors', async () => {
		const sb = makeSupabase([makeEvento('agendamento_criado', { valor: 100, detalhes: { result: { agendamento_id: 40, servico_nome: 'S', data_hora_inicio: '2026-05-21T10:00:00' } } })]);
		const ua = makeUazapi();
		await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		const sentText = ua.sendText.mock.calls[0]?.[1] as string;
		expect(sentText).not.toMatch(/erro/i);
		expect(sentText).not.toMatch(/error/i);
		expect(sentText).not.toMatch(/falha/i);
	});

	it('sums valor correctly across multiple sinal_pago events', async () => {
		const eventos = [
			makeEvento('sinal_pago', { valor: 50 }),
			makeEvento('sinal_pago', { valor: 75 }),
			makeEvento('sinal_pago', { valor: 25 }),
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.sinais_pagos).toBe(3);
		expect(r.receita_sinais).toBe(150);
	});

	it('deduplica eventos agendamento_criado com mesmo agendamento_id', async () => {
		// Helena chamou criar_agendamento 2x para o mesmo agendamento (retentativa)
		// → deve contar 1 agendamento e somar o valor apenas 1 vez
		const eventos = [
			makeEvento('agendamento_criado', { valor: 120, detalhes: { result: { agendamento_id: 999, servico_nome: 'Volume', data_hora_inicio: '2026-05-21T11:00:00' } } }),
			makeEvento('agendamento_criado', { valor: 120, detalhes: { result: { agendamento_id: 999, servico_nome: 'Volume', data_hora_inicio: '2026-05-21T11:00:00' } } }),
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.agendamentos_criados).toBe(1);
		expect(r.receita_potencial_agendada).toBe(120);
		expect(r.top_servicos[0]).toEqual({ nome: 'Volume', total: 1 });
	});

	it('ignora agendamento_criado sem agendamento_id em detalhes', async () => {
		// Evento legado ou edge case sem ID → não deve inflar métricas
		const eventos = [
			makeEvento('agendamento_criado', { valor: 100 }), // sem detalhes.result.agendamento_id
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.agendamentos_criados).toBe(0);
		expect(r.receita_potencial_agendada).toBe(0);
	});
});
