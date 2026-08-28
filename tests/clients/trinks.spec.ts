import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
	TrinksClient,
	trinksAgendamentoSchema,
	trinksCreateClienteInputSchema,
} from '../../src/clients/trinks.js';
import { setTestEnv } from '../../src/infra/env.js';

const BASE = 'https://api.trinks.test';

// ── Real production payloads (from REFERENCE-PAYLOADS.md) ──

const REAL_CLIENTE = {
	id: 74248732,
	dataCadastro: '2025-07-12T12:57:43',
	email: null,
	nome: 'Ana Beatriz Barbosa Oliveira da Silva ',
	telefones: [{ ddi: '55', ddd: '71', telefone: '981311391' }],
	clienteDetalhes: null,
};

const REAL_AGENDAMENTO = {
	id: 494524448,
	status: { id: 4, nome: 'Confirmado' },
	cliente: { id: 79761206, nome: 'Thaise Rosa' },
	servico: { id: 13981392, nome: 'PE E MAO' },
	profissional: { id: 806842, nome: 'Juliana dos Santos Sena' },
	dataHoraInicio: '2026-05-15T17:40:00',
	duracaoEmMinutos: 90,
	observacoesDoEstabelecimento: '',
	observacoesDoCliente: null,
	valor: 45,
};

const REAL_DISPONIBILIDADE = [
	{ id: 171151, nome: 'Agenda Camacari', horariosVagos: [], intervalosVagos: [] },
	{
		id: 170223,
		nome: 'Camila Rosario',
		horariosVagos: [
			'10:30',
			'11:00',
			'11:30',
			'14:00',
			'14:30',
			'15:00',
			'15:30',
			'16:00',
			'16:30',
			'17:00',
			'17:30',
			'18:00',
			'18:30',
			'19:00',
			'19:30',
		],
		intervalosVagos: [{ inicio: '10:30', fim: '20:00' }],
	},
];

let ultimoPostCliente: Record<string, unknown> | null = null;

const handlers = [
	http.get(`${BASE}/v1/clientes`, ({ request }) => {
		const url = new URL(request.url);
		const telefone = url.searchParams.get('telefone');
		if (telefone === '00000000000')
			return HttpResponse.json({ data: [], page: 1, pageSize: 50, totalPages: 0, totalRecords: 0 });
		return HttpResponse.json({
			data: [REAL_CLIENTE],
			page: 1,
			pageSize: 50,
			totalPages: 1,
			totalRecords: 1,
		});
	}),
	http.get(`${BASE}/v1/clientes/74248732`, () => HttpResponse.json(REAL_CLIENTE)),
	http.get(`${BASE}/v1/clientes/999`, () => new HttpResponse(null, { status: 404 })),
	http.post(`${BASE}/v1/clientes`, async ({ request }) => {
		// A Trinks devolve SOMENTE { id } (verificado em produção 27/08/2026).
		ultimoPostCliente = (await request.json()) as Record<string, unknown>;
		return HttpResponse.json({ id: 80000001 }, { status: 201 });
	}),

	http.get(`${BASE}/v1/agendamentos`, () =>
		HttpResponse.json({
			data: [REAL_AGENDAMENTO],
			page: 1,
			pageSize: 50,
			totalPages: 1,
			totalRecords: 1,
		}),
	),
	http.get(`${BASE}/v1/agendamentos/494524448`, () => HttpResponse.json(REAL_AGENDAMENTO)),
	http.get(`${BASE}/v1/agendamentos/404`, () => new HttpResponse(null, { status: 404 })),
	http.post(`${BASE}/v1/agendamentos`, async () => {
		// Trinks really returns ONLY { id } on POST
		return HttpResponse.json({ id: 500000001 }, { status: 201 });
	}),
	http.put(`${BASE}/v1/agendamentos/494524448`, async ({ request }) => {
		const body = (await request.json()) as Record<string, unknown>;
		return HttpResponse.json({ ...REAL_AGENDAMENTO, dataHoraInicio: body.dataHoraInicio });
	}),

	http.patch(
		`${BASE}/v1/agendamentos/494524448/status/confirmado`,
		() => new HttpResponse(null, { status: 204 }),
	),
	http.patch(`${BASE}/v1/agendamentos/494524448/status/cancelado`, async ({ request }) => {
		const body = (await request.json()) as Record<string, unknown>;
		// Validate QuemCancelou capital Q
		if (body.QuemCancelou === undefined)
			return new HttpResponse('Missing QuemCancelou', { status: 400 });
		return new HttpResponse(null, { status: 204 });
	}),
	http.patch(
		`${BASE}/v1/agendamentos/494524448/status/finalizado`,
		() => new HttpResponse(null, { status: 204 }),
	),
	http.patch(
		`${BASE}/v1/agendamentos/494524448/status/clientefaltou`,
		() => new HttpResponse(null, { status: 204 }),
	),

	http.get(`${BASE}/v1/agendamentos/profissionais/2026-05-29`, () =>
		HttpResponse.json({ data: REAL_DISPONIBILIDADE }),
	),
	http.get(`${BASE}/v1/servicos`, () =>
		HttpResponse.json({
			data: [
				{ id: 7331915, nome: 'Volume Brasileiro', duracaoEmMinutos: 120, preco: 160, ativo: true },
			],
			page: 1,
			pageSize: 50,
			totalPages: 1,
			totalRecords: 1,
		}),
	),
	http.get(`${BASE}/v1/profissionais`, () =>
		HttpResponse.json({
			data: [{ id: 170223, nome: 'Camila Rosario', ativo: true }],
			page: 1,
			pageSize: 50,
			totalPages: 1,
			totalRecords: 1,
		}),
	),
];

const server = setupServer(...handlers);

describe('TrinksClient', () => {
	let client: TrinksClient;

	beforeAll(() => {
		setTestEnv({ TRINKS_API_KEY: 'test-key' });
		server.listen({ onUnhandledRequest: 'error' });
	});
	afterEach(() => server.resetHandlers());
	afterAll(() => server.close());
	beforeEach(() => {
		client = new TrinksClient({
			baseUrl: BASE,
			apiKey: 'test-key',
			estabelecimentoId: 44992,
			dryRun: false,
		});
	});

	describe('clientes', () => {
		it('lists clientes with real shape (telefones.telefone, not numero)', async () => {
			const r = await client.listClientes({ telefone: '71981311391' });
			expect(r.data[0]?.telefones?.[0]?.telefone).toBe('981311391');
		});

		it('returns empty list', async () => {
			expect((await client.listClientes({ telefone: '00000000000' })).data).toHaveLength(0);
		});

		it('getCliente includes dataCadastro', async () => {
			const c = await client.getCliente(74248732);
			expect(c.dataCadastro).toBe('2025-07-12T12:57:43');
		});

		it('throws on 404', async () => {
			await expect(client.getCliente(999)).rejects.toThrow('Trinks');
		});

		it('createCliente envia telefones com `numero` no corpo (assimetria do POST)', async () => {
			const input = {
				nome: 'Nova',
				telefones: [{ ddi: '55', ddd: '71', numero: '988888888', tipoId: 1 }],
			};
			trinksCreateClienteInputSchema.parse(input); // validates
			ultimoPostCliente = null;

			const c = await client.createCliente(input);

			expect(c.id).toBe(80000001);
			const enviados = ultimoPostCliente?.telefones as Array<Record<string, unknown>>;
			expect(enviados?.[0]?.numero).toBe('988888888'); // POST usa `numero`, não `telefone`
		});
	});

	describe('agendamentos (nested objects)', () => {
		it('lists with nested status/cliente/servico/profissional', async () => {
			const r = await client.listAgendamentos();
			const ag = r.data[0];
			expect(ag?.status.nome).toBe('Confirmado');
			expect(ag?.cliente.nome).toBe('Thaise Rosa');
			expect(ag?.profissional.nome).toBe('Juliana dos Santos Sena');
		});

		it('getAgendamento returns real shape', async () => {
			const ag = await client.getAgendamento(494524448);
			expect(ag.servico.id).toBe(13981392);
			expect(ag.valor).toBe(45);
		});

		it('rejects old flat shape', () => {
			expect(trinksAgendamentoSchema.safeParse({ id: 1, statusId: 4, clienteId: 1 }).success).toBe(
				false,
			);
		});

		it('createAgendamento returns only { id } (Trinks POST returns minimal)', async () => {
			const ag = await client.createAgendamento({
				servicoId: 7331915,
				clienteId: 74248732,
				profissionalId: 170223,
				dataHoraInicio: '2026-05-20T14:00:00',
				duracaoEmMinutos: 120,
				valor: 160,
			});
			expect(typeof ag.id).toBe('number');
			expect(ag.id).toBeGreaterThan(0);
		});

		it('verify-after-write: getAgendamento 404 throws', async () => {
			await expect(client.getAgendamento(404)).rejects.toThrow('Trinks');
		});
	});

	describe('status patches', () => {
		it('cancels with QuemCancelou capital Q', async () => {
			const r = await client.cancelarAgendamento(494524448, { motivo: 'teste' });
			expect(r.ok).toBe(true);
		});
		it('confirms', async () => {
			expect((await client.confirmarAgendamento(494524448)).ok).toBe(true);
		});
		it('finalizes', async () => {
			expect((await client.finalizarAgendamento(494524448)).ok).toBe(true);
		});
		it('marks falta', async () => {
			expect((await client.marcarClienteFaltou(494524448)).ok).toBe(true);
		});
	});

	describe('disponibilidade (horariosVagos = string[])', () => {
		it('returns string array for horariosVagos', async () => {
			const r = await client.listProfissionaisComAgenda('2026-05-29');
			const camila = r.data.find((p) => p.id === 170223);
			expect(camila?.horariosVagos).toContain('10:30');
			expect(camila?.intervalosVagos[0]?.inicio).toBe('10:30');
		});

		it('returns empty arrays for agenda without slots', async () => {
			const r = await client.listProfissionaisComAgenda('2026-05-29');
			const camacari = r.data.find((p) => p.id === 171151);
			expect(camacari?.horariosVagos).toEqual([]);
		});
	});

	describe('auth header', () => {
		it('sends X-Api-Key (not Authorization: Bearer)', async () => {
			let headers: Record<string, string> = {};
			server.use(
				http.get(`${BASE}/v1/profissionais`, ({ request }) => {
					headers = Object.fromEntries(request.headers.entries());
					return HttpResponse.json({
						data: [{ id: 170223, nome: 'Camila Rosario', ativo: true }],
						page: 1,
						pageSize: 50,
						totalPages: 1,
						totalRecords: 1,
					});
				}),
			);
			await client.listProfissionais();
			expect(headers['x-api-key']).toBe('test-key');
			expect(headers.authorization).toBeUndefined();
		});
	});

	describe('dry-run', () => {
		it('POST returns synthetic, GET goes through', async () => {
			const dry = new TrinksClient({
				baseUrl: BASE,
				apiKey: 'test-key',
				estabelecimentoId: 44992,
				dryRun: true,
			});
			const ag = await dry.createAgendamento({
				servicoId: 1,
				clienteId: 1,
				profissionalId: 170223,
				dataHoraInicio: '2026-05-20T14:00:00',
				duracaoEmMinutos: 60,
			});
			expect(ag.id).toBeLessThan(0);
			const real = await dry.listServicos();
			expect(real.data.length).toBeGreaterThan(0);
		});
	});

	describe('schema validation', () => {
		it('rejects broken response', async () => {
			server.use(
				http.get(`${BASE}/v1/servicos`, () => HttpResponse.json({ data: [{ broken: true }] })),
			);
			await expect(client.listServicos()).rejects.toThrow('schema validation');
		});
	});
});

// ── Regressão de produção (27/08/2026 20:16) ──
// A Trinks devolve APENAS {"id": N} no POST /v1/clientes — não o cliente inteiro.
// O schema exigia `nome`, o Zod rejeitava, e o withRetry retentava um POST NÃO
// idempotente: 3 clientes criadas (91171794/95/96) e a Helena caiu com
// "Response schema validation failed for POST /v1/clientes".
describe('createCliente — resposta real da Trinks é só { id }', () => {
	const server2 = setupServer();
	beforeAll(() => {
		setTestEnv({});
		server2.listen({ onUnhandledRequest: 'error' });
	});
	afterEach(() => server2.resetHandlers());
	afterAll(() => server2.close());

	const input = {
		nome: 'Nova Cliente',
		telefones: [{ ddi: '55', ddd: '71', numero: '988888888', tipoId: 1 }],
	};

	it('aceita a resposta enxuta { id } sem erro de schema', async () => {
		server2.use(http.post(`${BASE}/v1/clientes`, () => HttpResponse.json({ id: 91171794 })));
		const client = new TrinksClient({ baseUrl: BASE, apiKey: 'k', estabelecimentoId: 44992 });

		const c = await client.createCliente(input);

		expect(c.id).toBe(91171794);
	});

	it('não retenta o POST quando a resposta não casa com o schema (evita cliente duplicada)', async () => {
		let posts = 0;
		server2.use(
			http.post(`${BASE}/v1/clientes`, () => {
				posts++;
				return HttpResponse.json({ resposta: 'formato inesperado' });
			}),
		);
		const client = new TrinksClient({ baseUrl: BASE, apiKey: 'k', estabelecimentoId: 44992 });

		await expect(client.createCliente(input)).rejects.toThrow();

		expect(posts).toBe(1);
	});
});
