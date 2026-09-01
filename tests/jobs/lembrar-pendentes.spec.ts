import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';
import { runLembrarPendentes } from '../../src/jobs/lembrar-pendentes.js';

setTestEnv({});

/**
 * A Camila é a única fonte de verdade sobre "o atendimento aconteceu?" — não há
 * lançamento financeiro na Trinks (0 registros em agosto) nem qualquer outro
 * sinal. Então o botão continua sendo dela.
 *
 * O problema medido: 51 dos 85 atendimentos realizados nos últimos 45 dias
 * ficaram em "Confirmado" — ela nunca respondeu. E o job da enquete pergunta
 * UMA vez e nunca mais volta naquele atendimento.
 *
 * Este job cutuca os botões que ficaram sem resposta.
 */

const CAMILA = 170223;
const AGORA = new Date('2026-09-01T20:00:00Z'); // 17:00 BRT

function makeAg(over: Partial<Record<string, unknown>> = {}) {
	return {
		id: 900,
		status: { id: 4, nome: 'Confirmado' },
		cliente: { id: 100, nome: 'Elisangela Pena' },
		servico: { id: 10, nome: 'efeito flecha' },
		profissional: { id: CAMILA, nome: 'Camila' },
		dataHoraInicio: '2026-08-31T14:00:00', // ontem, já terminou
		duracaoEmMinutos: 120,
		valor: 150,
		...over,
	};
}

function makeDeps(over?: {
	agendamentos?: ReturnType<typeof makeAg>[];
	espelho?: Record<number, Record<string, unknown> | null>;
}) {
	const menus: Array<{ number: string; text: string }> = [];
	const marcados: Array<{ id: number; lembretes: number }> = [];
	return {
		trinks: {
			listAgendamentos: vi.fn().mockResolvedValue({ data: over?.agendamentos ?? [makeAg()] }),
		},
		supabase: {
			getAgendamento: vi.fn().mockImplementation(async (id: number) => {
				if (over?.espelho && id in over.espelho) return over.espelho[id];
				return { id, enquete_finalizacao_enviada_em: '2026-08-31T19:00:00Z', enquete_lembretes: 0 };
			}),
			markEnqueteLembrada: vi.fn().mockImplementation(async (id: number, lembretes: number) => {
				marcados.push({ id, lembretes });
			}),
		},
		uazapi: {
			sendMenu: vi.fn().mockImplementation(async (o: { number: string; text: string }) => {
				menus.push(o);
			}),
		},
		profissionalId: CAMILA,
		agora: AGORA,
		menus,
		marcados,
	};
}

describe('runLembrarPendentes', () => {
	beforeEach(() => vi.clearAllMocks());

	it('cutuca o botão que a Camila não respondeu', async () => {
		const deps = makeDeps();

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(1);
		expect(deps.menus).toHaveLength(1);
		expect(deps.menus[0]?.text).toContain('Elisangela');
	});

	it('não cutuca o que ela já respondeu (finalizado)', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ status: { id: 8, nome: 'Finalizado' } })],
		});

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(0);
		expect(deps.menus).toHaveLength(0);
	});

	it('não cutuca o que ela marcou como falta', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ status: { id: 6, nome: 'Cliente não compareceu' } })],
		});

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(0);
	});

	it('não cutuca atendimento que nunca recebeu o botão', async () => {
		const deps = makeDeps({ espelho: { 900: { id: 900, enquete_finalizacao_enviada_em: null } } });

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(0);
	});

	it('não cutuca atendimento que ainda não terminou', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ dataHoraInicio: '2026-09-01T19:00:00' })], // termina 21h BRT
		});

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(0);
	});

	it('para de insistir depois de 3 lembretes', async () => {
		const deps = makeDeps({
			espelho: {
				900: {
					id: 900,
					enquete_finalizacao_enviada_em: '2026-08-31T19:00:00Z',
					enquete_lembretes: 3,
				},
			},
		});

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(0);
	});

	it('espera pelo menos 20h entre um lembrete e o próximo', async () => {
		const deps = makeDeps({
			espelho: {
				900: {
					id: 900,
					enquete_finalizacao_enviada_em: '2026-08-31T19:00:00Z',
					enquete_lembretes: 1,
					enquete_lembrado_em: '2026-09-01T16:00:00Z', // 4h atrás
				},
			},
		});

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(0);
	});

	it('registra o lembrete pra não repetir sem fim', async () => {
		const deps = makeDeps();

		await runLembrarPendentes(deps as never);

		expect(deps.marcados).toEqual([{ id: 900, lembretes: 1 }]);
	});

	it('manda no máximo 3 por execução pra não virar spam', async () => {
		const agendamentos = [1, 2, 3, 4, 5].map((i) =>
			makeAg({ id: 900 + i, cliente: { id: i, nome: `Cliente ${i}` } }),
		);
		const deps = makeDeps({ agendamentos });

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(3);
		expect(deps.menus).toHaveLength(3);
	});

	it('ignora agendamento de outra profissional', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ profissional: { id: 171151, nome: 'Agenda Camacari' } })],
		});

		const r = await runLembrarPendentes(deps as never);

		expect(r.lembrados).toBe(0);
	});

	it('usa os mesmos botões do fluxo normal, pra cair no mesmo handler', async () => {
		const deps = makeDeps();

		await runLembrarPendentes(deps as never);

		const choices = (deps.uazapi.sendMenu.mock.calls[0]?.[0] as { choices: Array<{ id: string }> })
			.choices;
		expect(choices.map((c) => c.id)).toEqual(['Fin_sim900', 'Fin_nao900']);
	});
});
