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
		it('✅ happy: finalizes + verifies status=8 + sends confirmation', async () => {
			const deps = makeDeps({
				getAfterPatch: vi.fn().mockResolvedValue({
					id: 500,
					status: { id: 8, nome: 'Finalizado' }, // status real medido na API
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
			expect(deps.supabase.upsertAgendamento).toHaveBeenCalledWith({ id: 500, status_id: 8 });
			expect(deps.sentTexts.some((t) => t.includes('amado o resultado'))).toBe(true);
		});

		it('🔴 GHOST: finalize ok + GET shows status≠8 → no confirmation sent', async () => {
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

// ── Regressão de produção (28/08/2026) ──
// A Camila clicou "Sim, finalizei ✅" 5 vezes e NENHUMA oferta de manutenção saiu.
// Causa: a Trinks grava status 8 ("Finalizado"), mas o código verificava contra 6.
// A verificação falhava sempre e o fluxo dava return antes de ofertar a manutenção.
describe('finalizar_sim (Fin_sim) — status real da Trinks é 8', () => {
	function makeFinalizarDeps(
		vagos: string[] = ['14:00', '14:30', '15:00', '15:30'],
		vagosEm?: string,
	) {
		const base = makeDeps();
		const agendamento = {
			id: 521608805,
			status: { id: 8, nome: 'Finalizado' }, // ← o que a Trinks devolve de verdade
			cliente: { id: 100, nome: 'Maria Silva' },
			servico: { id: 10, nome: 'Volume light' },
			profissional: { id: 170223, nome: 'Camila' },
			dataHoraInicio: '2026-08-27T14:00:00',
			duracaoEmMinutos: 120,
			valor: 145,
		};
		const sentMenus: Array<{ number: string; text: string }> = [];
		return {
			...base,
			trinks: {
				...base.trinks,
				getAgendamento: vi.fn().mockResolvedValue(agendamento),
				finalizarAgendamento: vi.fn().mockResolvedValue({ ok: true }),
				getCliente: vi.fn().mockResolvedValue({
					id: 100,
					nome: 'Maria Silva',
					telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }],
				}),
				// agenda de +15d: por padrao o mesmo horario (14:00) esta livre
				listProfissionaisComAgenda: vi.fn().mockImplementation(async (data: string) => ({
					data: [
						{
							id: 170223,
							nome: 'Camila',
							horariosVagos: data === (vagosEm ?? '2026-09-11') ? vagos : [],
							intervalosVagos: [],
						},
					],
				})),
			},
			uazapi: {
				...base.uazapi,
				sendMenu: vi.fn().mockImplementation(async (o: { number: string; text: string }) => {
					sentMenus.push(o);
				}),
			},
			supabase: {
				...base.supabase,
				raw: {
					from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }),
				},
			},
			postgres: { findPhoneByTrinksId: vi.fn().mockResolvedValue(null) },
			sentMenus,
		};
	}

	/** leadManager real o suficiente: guarda o que foi mesclado, pra o teste
	 *  medir o que ficou salvo em vez de medir chamada de mock. */
	function fakeLeadManager() {
		const salvo: Record<string, unknown> = {};
		return {
			manager: {
				mergeMetadata: async (_tel: string, patch: Record<string, unknown>) => {
					Object.assign(salvo, patch);
					return true;
				},
			},
			salvo,
		};
	}

	function paramsCom(deps: unknown, leadManager: unknown) {
		return {
			telefone: '5571999999999',
			buttonOrListid: 'Fin_sim521608805',
			deps: deps as never,
			leadManager: leadManager as never,
		};
	}

	it('oferece a manutenção à cliente quando a Trinks confirma status 8', async () => {
		const deps = makeFinalizarDeps();
		const lm = fakeLeadManager();
		await handleButton(paramsCom(deps, lm.manager));

		expect(deps.sentMenus).toHaveLength(1);
		expect(deps.sentMenus[0]?.text).toContain('manutenção');
	});

	it('guarda o serviço e a data da manutenção pro clique da cliente funcionar', async () => {
		const deps = makeFinalizarDeps();
		const lm = fakeLeadManager();
		await handleButton(paramsCom(deps, lm.manager));

		// Volume light (27/08 14:00) → manutenção 15 dias depois, mesmo horário
		expect(lm.salvo.proxima_manutencao_servico).toBe('Manutenção volume light 15 dias');
		expect(lm.salvo.proxima_manutencao_data).toBe('2026-09-11T14:00:00');
	});

	it('avisa a Camila quando o cadastro da cliente não foi encontrado', async () => {
		const deps = makeFinalizarDeps();
		const semLead = { mergeMetadata: async () => false };
		await handleButton(paramsCom(deps, semLead));

		expect(deps.sentTexts.join(' | ')).toContain('não achei o cadastro dela');
	});

	it('não acusa falha de finalização para a Camila quando deu certo', async () => {
		const deps = makeFinalizarDeps();
		await handleButton(makeParams('Fin_sim521608805', deps as never));

		const avisos = deps.sentTexts.join(' | ');
		expect(avisos).not.toContain('não confirmou no Trinks');
		expect(avisos).toContain('finalizada');
	});

	it('propõe o horário mais próximo quando o de sempre está ocupado', async () => {
		// 14:00 ocupado; sobra bloco de 2h a partir das 09:00
		const deps = makeFinalizarDeps(['09:00', '09:30', '10:00', '10:30']);
		const lm = fakeLeadManager();
		await handleButton(paramsCom(deps, lm.manager));

		expect(lm.salvo.proxima_manutencao_data).toBe('2026-09-11T09:00:00');
		expect(deps.sentMenus[0]?.text).toContain('11/09 às 9h');
	});

	it('avisa a Camila em vez de propor data inventada quando não há vaga', async () => {
		const deps = makeFinalizarDeps([]); // agenda cheia em toda a janela
		const lm = fakeLeadManager();
		await handleButton(paramsCom(deps, lm.manager));

		expect(deps.sentMenus).toHaveLength(0);
		expect(deps.sentTexts.join(' | ')).toContain('Não achei horário livre');
	});
});
