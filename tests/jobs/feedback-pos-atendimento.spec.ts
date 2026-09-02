import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';
import { runFeedbackPosAtendimento } from '../../src/jobs/feedback-pos-atendimento.js';

setTestEnv({});

/**
 * Pedido da Camila (01/09/2026):
 *   "Após 3 dias enviar mensagem para cliente para colher feedback positivo
 *    (prova social) se for negativo ela manda a msg eu entro em contato para
 *    entender a queixa"
 *
 * Restrição herdada do fluxo de manutenção: só perguntamos para atendimento que
 * a Camila CONFIRMOU que aconteceu (status Finalizado). Perguntar "como ficaram
 * seus cílios?" pra quem não compareceu é pior que não perguntar.
 */

const CAMILA = 170223;
const AGORA = new Date('2026-09-05T21:00:00Z'); // 18:00 BRT de sexta

function makeAg(over: Record<string, unknown> = {}) {
	return {
		id: 700,
		status: { id: 8, nome: 'Finalizado' },
		cliente: { id: 100, nome: 'Maria Silva' },
		servico: { id: 10, nome: 'Volume Russo' },
		profissional: { id: CAMILA, nome: 'Camila' },
		dataHoraInicio: '2026-09-02T14:00:00', // 3 dias atrás
		duracaoEmMinutos: 120,
		...over,
	};
}

function makeDeps(over?: {
	agendamentos?: ReturnType<typeof makeAg>[];
	espelho?: Record<number, Record<string, unknown> | null>;
	telefones?: Array<{ ddi: string; ddd: string; telefone: string }>;
}) {
	const menus: Array<{ number: string; text: string }> = [];
	const marcados: number[] = [];
	return {
		trinks: {
			listAgendamentos: vi.fn().mockResolvedValue({ data: over?.agendamentos ?? [makeAg()] }),
			getCliente: vi.fn().mockResolvedValue({
				id: 100,
				nome: 'Maria Silva',
				telefones: over?.telefones ?? [{ ddi: '55', ddd: '71', telefone: '999999999' }],
			}),
		},
		supabase: {
			getAgendamento: vi.fn().mockImplementation(async (id: number) => {
				if (over?.espelho && id in over.espelho) return over.espelho[id];
				return { id, feedback_enviado_em: null };
			}),
			markFeedbackEnviado: vi.fn().mockImplementation(async (id: number) => {
				marcados.push(id);
			}),
		},
		uazapi: {
			sendMenu: vi.fn().mockImplementation(async (o: { number: string; text: string }) => {
				menus.push(o);
			}),
		},
		postgres: { findPhoneByTrinksId: vi.fn().mockResolvedValue(null) },
		profissionalId: CAMILA,
		agora: AGORA,
		menus,
		marcados,
	};
}

describe('runFeedbackPosAtendimento', () => {
	beforeEach(() => vi.clearAllMocks());

	it('pergunta à cliente 3 dias depois do atendimento', async () => {
		const deps = makeDeps();

		const r = await runFeedbackPosAtendimento(deps as never);

		expect(r.enviados).toBe(1);
		expect(deps.menus[0]?.text).toContain('Maria');
	});

	it('manda pro telefone da cliente, não pro da Camila', async () => {
		const deps = makeDeps();

		await runFeedbackPosAtendimento(deps as never);

		expect(deps.menus[0]?.number).toBe('5571999999999');
	});

	it('não pergunta antes dos 3 dias', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ dataHoraInicio: '2026-09-04T14:00:00' })], // 1 dia atrás
		});

		const r = await runFeedbackPosAtendimento(deps as never);

		expect(r.enviados).toBe(0);
	});

	it('não pergunta de atendimento que a Camila não confirmou', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ status: { id: 4, nome: 'Confirmado' } })],
		});

		const r = await runFeedbackPosAtendimento(deps as never);

		expect(r.enviados).toBe(0);
	});

	it('não pergunta de quem não compareceu', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ status: { id: 6, nome: 'Cliente não compareceu' } })],
		});

		const r = await runFeedbackPosAtendimento(deps as never);

		expect(r.enviados).toBe(0);
	});

	it('não pergunta duas vezes para o mesmo atendimento', async () => {
		const deps = makeDeps({
			espelho: { 700: { id: 700, feedback_enviado_em: '2026-09-05T12:00:00Z' } },
		});

		const r = await runFeedbackPosAtendimento(deps as never);

		expect(r.enviados).toBe(0);
	});

	it('registra o envio pra não repetir', async () => {
		const deps = makeDeps();

		await runFeedbackPosAtendimento(deps as never);

		expect(deps.marcados).toEqual([700]);
	});

	it('usa o cache local quando a Trinks não tem telefone da cliente', async () => {
		const deps = makeDeps({ telefones: [] });
		deps.postgres.findPhoneByTrinksId = vi.fn().mockResolvedValue('5571988887777');

		await runFeedbackPosAtendimento(deps as never);

		expect(deps.menus[0]?.number).toBe('5571988887777');
	});

	it('pula a cliente sem telefone em vez de derrubar o job', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ id: 701 }), makeAg({ id: 702, cliente: { id: 2, nome: 'Ana' } })],
			telefones: [],
		});

		const r = await runFeedbackPosAtendimento(deps as never);

		expect(r.enviados).toBe(0);
		expect(r.semTelefone).toBe(2);
	});

	it('oferece dois caminhos: gostou e não gostou', async () => {
		const deps = makeDeps();

		await runFeedbackPosAtendimento(deps as never);

		const choices = (deps.uazapi.sendMenu.mock.calls[0]?.[0] as { choices: Array<{ id: string }> })
			.choices;
		expect(choices.map((c) => c.id)).toEqual(['Fb_bom700', 'Fb_ruim700']);
	});

	it('ignora agendamento de outra profissional', async () => {
		const deps = makeDeps({
			agendamentos: [makeAg({ profissional: { id: 171151, nome: 'Agenda Camacari' } })],
		});

		const r = await runFeedbackPosAtendimento(deps as never);

		expect(r.enviados).toBe(0);
	});
});
