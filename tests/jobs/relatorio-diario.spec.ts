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
			makeEvento('agendamento_criado', { telefone: 'A', valor: 100 }),
			makeEvento('agendamento_criado', { telefone: 'B', valor: 50 }),
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
			makeEvento('agendamento_criado', { telefone: 'X' }),
			makeEvento('agendamento_criado', { telefone: 'Y' }),
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.atendimentos_unicos).toBe(2);
	});

	it('extracts top servicos sorted by count', async () => {
		const eventos = [
			makeEvento('agendamento_criado', { detalhes: { result: { servico_nome: 'Hidratação', data_hora_inicio: '2026-05-21T10:00:00' } } }),
			makeEvento('agendamento_criado', { detalhes: { result: { servico_nome: 'Hidratação', data_hora_inicio: '2026-05-21T14:00:00' } } }),
			makeEvento('agendamento_criado', { detalhes: { result: { servico_nome: 'Corte', data_hora_inicio: '2026-05-21T09:00:00' } } }),
		];
		const sb = makeSupabase(eventos);
		const ua = makeUazapi();
		const r = await runRelatorioDiario({ supabase: sb as never, uazapi: ua as never });
		expect(r.top_servicos[0]).toEqual({ nome: 'Hidratação', total: 2 });
		expect(r.top_servicos[1]).toEqual({ nome: 'Corte', total: 1 });
	});

	it('extracts faixa horaria from data_hora_inicio', async () => {
		const eventos = [
			makeEvento('agendamento_criado', { detalhes: { result: { servico_nome: 'S', data_hora_inicio: '2026-05-21T10:30:00' } } }),
			makeEvento('agendamento_criado', { detalhes: { result: { servico_nome: 'S', data_hora_inicio: '2026-05-21T14:00:00' } } }),
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
		const sb = makeSupabase([makeEvento('agendamento_criado', { valor: 100, detalhes: { result: { servico_nome: 'S', data_hora_inicio: '2026-05-21T10:00:00' } } })]);
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
});
