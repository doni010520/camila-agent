import { describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';
import { runEnqueteFinalizacao } from '../../src/jobs/enquete-finalizacao.js';
import { runLembreteAmanha } from '../../src/jobs/lembrete-amanha.js';

setTestEnv({});

const AG = {
	id: 500,
	status: { id: 4, nome: 'Confirmado' },
	cliente: { id: 100, nome: 'Maria Silva' },
	servico: { id: 10, nome: 'Volume Brasileiro' },
	profissional: { id: 170223, nome: 'Camila Rosario' },
	dataHoraInicio: '2026-05-21T14:00:00',
	duracaoEmMinutos: 120,
	valor: 160,
};

// ── lembrete-amanha ──

describe('runLembreteAmanha', () => {
	function makeDeps(overrides?: {
		agendamentos?: unknown[];
		lembreteEnviado?: boolean;
		noPhone?: boolean;
	}) {
		return {
			trinks: {
				listAgendamentos: vi.fn().mockResolvedValue({ data: overrides?.agendamentos ?? [AG] }),
				getCliente: overrides?.noPhone
					? vi.fn().mockResolvedValue({ id: 100, nome: 'Maria Silva', telefones: [] })
					: vi.fn().mockResolvedValue({
							id: 100,
							nome: 'Maria Silva',
							telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }],
						}),
			},
			supabase: {
				getAgendamento: vi
					.fn()
					.mockResolvedValue(
						overrides?.lembreteEnviado ? { lembrete_enviado_em: '2026-05-20T10:00:00' } : null,
					),
				upsertAgendamento: vi.fn().mockResolvedValue(undefined),
				markLembreteEnviado: vi.fn().mockResolvedValue(undefined),
			},
			uazapi: {
				sendText: vi.fn().mockResolvedValue(undefined),
				sendMenu: vi.fn().mockResolvedValue(undefined),
			},
			postgres: {
				findPhoneByTrinksId: vi.fn().mockResolvedValue(null),
			},
			profissionalId: 170223,
		};
	}

	it('sends lembrete for tomorrow agendamento', async () => {
		const deps = makeDeps();
		const r = await runLembreteAmanha(deps as never);
		expect(r.enviados).toBe(1);
		expect(deps.uazapi.sendText).toHaveBeenCalled();
		expect(deps.uazapi.sendMenu).toHaveBeenCalled();
		expect(deps.supabase.markLembreteEnviado).toHaveBeenCalledWith(500);
	});

	it('skips if lembrete already sent', async () => {
		const deps = makeDeps({ lembreteEnviado: true });
		const r = await runLembreteAmanha(deps as never);
		expect(r.jaEnviados).toBe(1);
		expect(r.enviados).toBe(0);
		expect(deps.uazapi.sendText).not.toHaveBeenCalled();
	});

	it('counts error when no phone found', async () => {
		const deps = makeDeps({ noPhone: true });
		const r = await runLembreteAmanha(deps as never);
		expect(r.erros).toBe(1);
		expect(r.enviados).toBe(0);
	});

	it('handles empty agendamentos', async () => {
		const deps = makeDeps({ agendamentos: [] });
		const r = await runLembreteAmanha(deps as never);
		expect(r.total).toBe(0);
	});

	it('filters out cancelled agendamentos (status 7)', async () => {
		const cancelled = { ...AG, status: { id: 7, nome: 'Cancelado' } };
		const deps = makeDeps({ agendamentos: [cancelled] });
		const r = await runLembreteAmanha(deps as never);
		expect(r.total).toBe(0);
	});

	it('filters out other profissional', async () => {
		const other = { ...AG, profissional: { id: 999, nome: 'Outro' } };
		const deps = makeDeps({ agendamentos: [other] });
		const r = await runLembreteAmanha(deps as never);
		expect(r.total).toBe(0);
	});

	it('sends menu with Id_sim/Id_nao button IDs', async () => {
		const deps = makeDeps();
		await runLembreteAmanha(deps as never);
		const menuCall = deps.uazapi.sendMenu.mock.calls[0]?.[0] as { choices: Array<{ id: string }> };
		expect(menuCall.choices[0]?.id).toBe('Id_sim500');
		expect(menuCall.choices[1]?.id).toBe('Id_nao500');
	});
});

// ── enquete-finalizacao ──

describe('runEnqueteFinalizacao', () => {
	function makeDeps(overrides?: { agendamentos?: unknown[]; enqueteEnviada?: boolean }) {
		// Job parses: new Date(`${dataHoraInicio}-03:00`) → adds +3h to get UTC
		// We need: end_utc = now - 4h, start_utc = now - 6h
		// So naive string must be: now_utc - 9h (because +3h gives now - 6h)
		const naiveStr = new Date(Date.now() - 9 * 60 * 60 * 1000)
			.toISOString()
			.replace('Z', '')
			.split('.')[0];
		const pastAg = { ...AG, dataHoraInicio: naiveStr };

		return {
			trinks: {
				listAgendamentos: vi.fn().mockResolvedValue({ data: overrides?.agendamentos ?? [pastAg] }),
				getCliente: vi.fn().mockResolvedValue({
					id: 100,
					nome: 'Maria Silva',
					telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }],
				}),
			},
			supabase: {
				getAgendamento: vi
					.fn()
					.mockResolvedValue(
						overrides?.enqueteEnviada ? { enquete_finalizacao_enviada_em: '2026-05-20' } : null,
					),
				upsertAgendamento: vi.fn().mockResolvedValue(undefined),
				markEnqueteEnviada: vi.fn().mockResolvedValue(undefined),
			},
			uazapi: {
				sendMenu: vi.fn().mockResolvedValue(undefined),
			},
			profissionalId: 170223,
		};
	}

	it('sends enquete for finished appointment', async () => {
		const deps = makeDeps();
		const r = await runEnqueteFinalizacao(deps as never);
		expect(r.enviados).toBe(1);
		expect(deps.uazapi.sendMenu).toHaveBeenCalled();
		expect(deps.supabase.markEnqueteEnviada).toHaveBeenCalled();
	});

	it('skips if enquete already sent', async () => {
		const deps = makeDeps({ enqueteEnviada: true });
		const r = await runEnqueteFinalizacao(deps as never);
		expect(r.jaEnviados).toBe(1);
		expect(r.enviados).toBe(0);
	});

	it('skips appointments still in progress', async () => {
		// Appointment starting now (not ended yet)
		const futureAg = { ...AG, dataHoraInicio: new Date().toISOString().split('.')[0] };
		const deps = makeDeps({ agendamentos: [futureAg] });
		const r = await runEnqueteFinalizacao(deps as never);
		expect(r.total).toBe(0);
	});

	it('sends menu pro grupo do time com Fin_sim/Fin_nao (fluxo novo)', async () => {
		const deps = makeDeps();
		await runEnqueteFinalizacao(deps as never);
		const menuCall = deps.uazapi.sendMenu.mock.calls[0]?.[0] as { choices: Array<{ id: string }>; number: string };
		expect(menuCall.choices[0]?.id).toContain('Fin_sim');
		expect(menuCall.choices[1]?.id).toContain('Fin_nao');
		// destinatário tem que ser o grupo, não o cliente
		expect(menuCall.number).toContain('@g.us');
	});
});
