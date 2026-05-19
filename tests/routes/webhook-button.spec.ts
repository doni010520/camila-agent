import { describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';
import { handleButton } from '../../src/routes/webhook-button.js';

setTestEnv({});

function makeDeps(overrides?: {
	getAfterPatch?: ReturnType<typeof vi.fn>;
	confirmFn?: ReturnType<typeof vi.fn>;
	finalizeFn?: ReturnType<typeof vi.fn>;
}) {
	const sentTexts: string[] = [];
	return {
		trinks: {
			confirmarAgendamento: overrides?.confirmFn ?? vi.fn().mockResolvedValue({ ok: true }),
			finalizarAgendamento: overrides?.finalizeFn ?? vi.fn().mockResolvedValue({ ok: true }),
			getAgendamento:
				overrides?.getAfterPatch ??
				vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 4, nome: 'Confirmado' },
					cliente: { id: 100, nome: 'Maria' },
					servico: { id: 10, nome: 'VB' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-05-20T14:00:00',
					duracaoEmMinutos: 120,
					valor: 160,
				}),
		},
		uazapi: {
			sendText: vi.fn().mockImplementation(async (_n: string, text: string) => {
				sentTexts.push(text);
			}),
		},
		supabase: { upsertAgendamento: vi.fn().mockResolvedValue(undefined) },
		openai: {},
		postgres: {},
		toolRegistry: {},
		sentTexts,
	};
}

function makeParams(buttonOrListid: string, deps: ReturnType<typeof makeDeps>) {
	return {
		telefone: '5571999999999',
		buttonOrListid,
		deps: deps as never,
		leadManager: {} as never,
	};
}

describe('handleButton', () => {
	// ── confirmar ──

	describe('confirmar (Id_sim)', () => {
		it('✅ happy: confirms + verifies status=4 + sends "Te aguardo"', async () => {
			const deps = makeDeps();
			await handleButton(makeParams('Id_sim500', deps));

			expect(deps.trinks.confirmarAgendamento).toHaveBeenCalledWith(500);
			expect(deps.trinks.getAgendamento).toHaveBeenCalledWith(500);
			expect(deps.supabase.upsertAgendamento).toHaveBeenCalledWith({ id: 500, status_id: 4 });
			expect(deps.sentTexts.some((t) => t.includes('Te aguardo'))).toBe(true);
		});

		it('🔴 GHOST: PATCH ok + GET shows status≠4 → error message sent', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 1, nome: 'Agendado' }, // NOT 4!
					cliente: { id: 100, nome: 'Maria' },
					servico: { id: 10, nome: 'VB' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-05-20T14:00:00',
					duracaoEmMinutos: 120,
					valor: 160,
				}),
			});
			await handleButton(makeParams('Id_sim500', deps));

			expect(deps.sentTexts.some((t) => t.includes('probleminha'))).toBe(true);
			expect(deps.sentTexts.every((t) => !t.includes('Te aguardo'))).toBe(true);
		});

		it('🔴 GHOST: PATCH ok + GET 404 → error message sent', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockRejectedValue(new Error('404')),
			});
			await handleButton(makeParams('Id_sim500', deps));

			expect(deps.sentTexts.some((t) => t.includes('probleminha'))).toBe(true);
		});
	});

	// ── recusar ──

	describe('recusar (Id_nao)', () => {
		it('sends reagendamento offer', async () => {
			const deps = makeDeps();
			await handleButton(makeParams('Id_nao500', deps));

			expect(deps.sentTexts.some((t) => t.includes('reagendar'))).toBe(true);
		});
	});

	// ── enquete_sim ──

	describe('enquete_sim (id_sim)', () => {
		it('✅ happy: finalizes + verifies status=6 + sends confirmation', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 6, nome: 'Finalizado' },
					cliente: { id: 100, nome: 'Maria' },
					servico: { id: 10, nome: 'VB' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-05-20T14:00:00',
					duracaoEmMinutos: 120,
					valor: 160,
				}),
			});
			await handleButton(makeParams('id_sim500', deps));

			expect(deps.trinks.finalizarAgendamento).toHaveBeenCalledWith(500);
			expect(deps.supabase.upsertAgendamento).toHaveBeenCalledWith({ id: 500, status_id: 6 });
			expect(deps.sentTexts.some((t) => t.includes('amado o resultado'))).toBe(true);
		});

		it('🔴 GHOST: finalize ok + GET shows status≠6 → no confirmation sent', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 4, nome: 'Confirmado' }, // NOT 6!
					cliente: { id: 100, nome: 'Maria' },
					servico: { id: 10, nome: 'VB' },
					profissional: { id: 170223, nome: 'Camila' },
					dataHoraInicio: '2026-05-20T14:00:00',
					duracaoEmMinutos: 120,
					valor: 160,
				}),
			});
			await handleButton(makeParams('id_sim500', deps));

			// Should NOT send "amado o resultado" — ghost detected
			expect(deps.sentTexts.every((t) => !t.includes('amado o resultado'))).toBe(true);
		});
	});

	// ── enquete_nao ──

	describe('enquete_nao (id_nao)', () => {
		it('sends acknowledgement', async () => {
			const deps = makeDeps();
			await handleButton(makeParams('id_nao', deps));

			expect(deps.sentTexts.some((t) => t.includes('Quando finalizar'))).toBe(true);
		});
	});
});
