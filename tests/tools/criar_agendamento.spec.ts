import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolContext } from '../../src/agent/tools/_registry.js';
import { createCriarAgendamento } from '../../src/agent/tools/criar_agendamento.js';
import { _resetAgendamentoCache } from '../../src/infra/agendamento-cache.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});

const ctx: ToolContext = {
	telefone: '5571999999999',
	lead: { nome: 'Maria', etiquetas: [], sinal_pago: false },
};

const SERVICO = { id: 7331915, nome: 'Volume Brasileiro', duracao_minutos: 120, preco: 160 };

function makeDeps(overrides?: {
	getAgendamentoFn?: ReturnType<typeof vi.fn>;
	createAgendamentoFn?: ReturnType<typeof vi.fn>;
	listClientesFn?: ReturnType<typeof vi.fn>;
}) {
	const trinks = {
		listClientes:
			overrides?.listClientesFn ??
			vi.fn().mockResolvedValue({
				data: [
					{
						id: 79761206,
						nome: 'Maria',
						telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }],
					},
				],
			}),
		createCliente: vi.fn().mockResolvedValue({ id: 80000001, nome: 'Maria Nova', telefones: [] }),
		createAgendamento:
			overrides?.createAgendamentoFn ??
			vi.fn().mockResolvedValue({
				id: 500000001,
				status: { id: 1, nome: 'Agendado' },
				cliente: { id: 79761206, nome: 'Maria' },
				servico: { id: 7331915, nome: 'Volume Brasileiro' },
				profissional: { id: 170223, nome: 'Camila Rosario' },
				dataHoraInicio: '2026-05-20T14:00:00',
				duracaoEmMinutos: 120,
				valor: 160,
			}),
		getAgendamento:
			overrides?.getAgendamentoFn ??
			vi.fn().mockResolvedValue({
				id: 500000001,
				status: { id: 1, nome: 'Agendado' },
				cliente: { id: 79761206, nome: 'Maria' },
				servico: { id: 7331915, nome: 'Volume Brasileiro' },
				profissional: { id: 170223, nome: 'Camila Rosario' },
				dataHoraInicio: '2026-05-20T14:00:00',
				duracaoEmMinutos: 120,
				valor: 160,
			}),
		getCliente: vi.fn().mockResolvedValue({ id: 79761206, nome: 'Maria' }),
		// idempotência/conflito: sem agendamentos por padrão
		listAgendamentos: vi.fn().mockResolvedValue({ data: [] }),
		// disponibilidade (fail-closed): Camila com slots livres cobrindo 14:00–16:00
		listProfissionaisComAgenda: vi.fn().mockResolvedValue({
			data: [
				{
					id: 170223,
					nome: 'Camila Rosario',
					horariosVagos: ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30'],
					intervalosVagos: [],
				},
			],
		}),
	};

	const supabase = {
		findServicoByName: vi.fn().mockResolvedValue(SERVICO),
		upsertAgendamento: vi.fn().mockResolvedValue(undefined),
		raw: {
			from: vi.fn().mockReturnValue({
				update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
			}),
		},
	};

	const postgres = {
		findClienteByPhone: vi.fn().mockResolvedValue(null),
	};

	const tool = createCriarAgendamento({
		trinks: trinks as never,
		supabase: supabase as never,
		postgres: postgres as never,
		profissionalId: 170223,
	});

	return { tool, trinks, supabase, postgres };
}

describe('criar_agendamento', () => {
	beforeEach(() => _resetAgendamentoCache());

	it('✅ happy path: creates and verifies', async () => {
		const { tool } = makeDeps();
		const result = await tool.handler(
			{
				telefone: '5571999999999',
				nome: 'Maria',
				servico: 'Volume Brasileiro',
				data_e_hora: '2026-05-20T14:00:00',
			},
			ctx,
		);

		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			expect(result.agendamento_id).toBe(500000001);
			expect(result.data_hora_inicio).toBe('2026-05-20T14:00:00');
			expect(result.cliente_novo).toBe(false);
		}
	});

	it('🔴 GHOST: POST 201 + GET 404 → returns erro', async () => {
		const { tool } = makeDeps({
			getAgendamentoFn: vi
				.fn()
				.mockRejectedValue(new Error('Trinks: GET /v1/agendamentos/500000001 returned 404')),
		});

		const result = await tool.handler(
			{
				telefone: '5571999999999',
				nome: 'Maria',
				servico: 'Volume Brasileiro',
				data_e_hora: '2026-05-20T14:00:00',
			},
			ctx,
		);

		expect(result.status).toBe('erro');
		if (result.status === 'erro') {
			expect(result.razao).toContain('não confirmada');
		}
	});

	it('🔴 GHOST: POST 201 + GET returns different dataHoraInicio → returns erro', async () => {
		const { tool } = makeDeps({
			getAgendamentoFn: vi.fn().mockResolvedValue({
				id: 500000001,
				status: { id: 1, nome: 'Agendado' },
				cliente: { id: 79761206, nome: 'Maria' },
				servico: { id: 7331915, nome: 'Volume Brasileiro' },
				profissional: { id: 170223, nome: 'Camila Rosario' },
				dataHoraInicio: '2026-05-21T10:00:00', // DIFFERENT!
				duracaoEmMinutos: 120,
				valor: 160,
			}),
		});

		const result = await tool.handler(
			{
				telefone: '5571999999999',
				nome: 'Maria',
				servico: 'Volume Brasileiro',
				data_e_hora: '2026-05-20T14:00:00',
			},
			ctx,
		);

		expect(result.status).toBe('erro');
		if (result.status === 'erro') {
			expect(result.razao).toContain('dataHoraInicio diverge');
		}
	});

	it('creates new client when not found', async () => {
		const { tool, trinks } = makeDeps({
			listClientesFn: vi.fn().mockResolvedValue({ data: [] }),
		});

		const result = await tool.handler(
			{
				telefone: '5571999999999',
				nome: 'Maria Nova',
				servico: 'Volume Brasileiro',
				data_e_hora: '2026-05-20T14:00:00',
			},
			ctx,
		);

		expect(result.status).toBe('ok');
		if (result.status === 'ok') {
			expect(result.cliente_novo).toBe(true);
		}
		expect(trinks.createCliente).toHaveBeenCalled();
	});

	it('returns erro when POST fails (4xx)', async () => {
		const { tool } = makeDeps({
			createAgendamentoFn: vi.fn().mockRejectedValue(new Error('Trinks: POST returned 409')),
		});

		const result = await tool.handler(
			{
				telefone: '5571999999999',
				nome: 'Maria',
				servico: 'Volume Brasileiro',
				data_e_hora: '2026-05-20T14:00:00',
			},
			ctx,
		);

		expect(result.status).toBe('erro');
		if (result.status === 'erro') {
			expect(result.razao).toContain('Falha ao criar');
		}
	});

	it('returns erro when servico not found', async () => {
		const { tool, supabase } = makeDeps();
		supabase.findServicoByName.mockResolvedValue(null);

		const result = await tool.handler(
			{
				telefone: '5571999999999',
				nome: 'Maria',
				servico: 'Inexistente',
				data_e_hora: '2026-05-20T14:00:00',
			},
			ctx,
		);

		expect(result.status).toBe('erro');
	});

	// ── Blindagem anti-conflito (NUNCA marcar em horário indisponível) ──

	it('🛡️ recusa quando horário NÃO está nos horariosVagos (bloqueado/ocupado)', async () => {
		const { tool, trinks } = makeDeps();
		trinks.listProfissionaisComAgenda.mockResolvedValue({
			data: [{ id: 170223, nome: 'Camila', horariosVagos: ['16:00', '16:30'], intervalosVagos: [] }],
		});
		const result = await tool.handler(
			{ telefone: '5571999999999', nome: 'Maria', servico: 'Volume Brasileiro', data_e_hora: '2026-05-20T14:00:00' },
			ctx,
		);
		expect(result.status).toBe('erro');
		expect(trinks.createAgendamento).not.toHaveBeenCalled();
	});

	it('🛡️ recusa quando dia está fechado (horariosVagos vazio)', async () => {
		const { tool, trinks } = makeDeps();
		trinks.listProfissionaisComAgenda.mockResolvedValue({
			data: [{ id: 170223, nome: 'Camila', horariosVagos: [], intervalosVagos: [] }],
		});
		const result = await tool.handler(
			{ telefone: '5571999999999', nome: 'Maria', servico: 'Volume Brasileiro', data_e_hora: '2026-05-20T14:00:00' },
			ctx,
		);
		expect(result.status).toBe('erro');
		expect(trinks.createAgendamento).not.toHaveBeenCalled();
	});

	it('🛡️ FAIL-CLOSED: recusa quando consulta de disponibilidade falha (não cria às cegas)', async () => {
		const { tool, trinks } = makeDeps();
		trinks.listProfissionaisComAgenda.mockRejectedValue(new Error('Trinks timeout'));
		const result = await tool.handler(
			{ telefone: '5571999999999', nome: 'Maria', servico: 'Volume Brasileiro', data_e_hora: '2026-05-20T14:00:00' },
			ctx,
		);
		expect(result.status).toBe('erro');
		expect(trinks.createAgendamento).not.toHaveBeenCalled();
	});

	it('🛡️ FAIL-CLOSED: recusa quando profissional ausente na agenda do dia', async () => {
		const { tool, trinks } = makeDeps();
		trinks.listProfissionaisComAgenda.mockResolvedValue({ data: [] });
		const result = await tool.handler(
			{ telefone: '5571999999999', nome: 'Maria', servico: 'Volume Brasileiro', data_e_hora: '2026-05-20T14:00:00' },
			ctx,
		);
		expect(result.status).toBe('erro');
		expect(trinks.createAgendamento).not.toHaveBeenCalled();
	});
});
