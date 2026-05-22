import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';
import { createAdminRouter } from '../../src/routes/admin.js';

// Mock relatorio-diario to avoid real DB calls in admin/relatorio tests
const mockAgregarEventos = vi.fn().mockResolvedValue({
	atendimentos_unicos: 3,
	agendamentos_criados: 1,
	agendamentos_cancelados: 0,
	agendamentos_reagendados: 0,
	transferidos_humano: 0,
	catalogos_enviados: 1,
	cursos_enviados: 0,
	pix_enviados: 0,
	sinais_pagos: 0,
	receita_sinais: 0,
	receita_potencial_agendada: 100,
	top_servicos: [],
	top_horarios: [],
});

vi.mock('../../src/jobs/relatorio-diario.js', () => ({
	agregarEventos: (...args: unknown[]) => mockAgregarEventos(...args),
}));

const CRON_MOCK = [
	{
		job_name: 'lembrete',
		enabled: true,
		cron_expressions: ['0 9 * * *', '0 13 * * *', '0 18 * * *'],
		descricao: 'Lembrete pra confirmar agendamento de amanhã',
		ultima_execucao_em: null,
		ultima_execucao_resultado: null,
		atualizado_em: '2026-05-22T00:00:00Z',
	},
	{
		job_name: 'enquete',
		enabled: true,
		cron_expressions: ['0 20 * * *'],
		descricao: 'Enquete pós-atendimento',
		ultima_execucao_em: null,
		ultima_execucao_resultado: null,
		atualizado_em: '2026-05-22T00:00:00Z',
	},
];

const ERROS_MOCK = [
	{
		criado_em: '2026-05-21T14:00:00Z',
		telefone: '5571999993061',
		tipo: 'erro_tool',
		detalhes: { tool: 'criar_agendamento', result: { razao: 'Horário indisponível' } },
		cliente_nome: 'Maria',
		sucesso: false,
	},
];

function makePostgres() {
	return {
		listChatSessions: vi.fn().mockResolvedValue([]),
		listWebhookInbound: vi.fn().mockResolvedValue([]),
		listSessionsSemResposta: vi.fn().mockResolvedValue([]),
		loadRecentMessages: vi.fn().mockResolvedValue([]),
		listCronJobs: vi.fn().mockResolvedValue(CRON_MOCK),
		updateCronJob: vi.fn().mockResolvedValue(undefined),
	};
}

function makeSupabase(erros = ERROS_MOCK) {
	const queryBuilder = {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		limit: vi.fn().mockResolvedValue({ data: erros, error: null }),
	};
	return {
		raw: {
			from: vi.fn().mockReturnValue(queryBuilder),
		},
		_queryBuilder: queryBuilder,
	};
}

function makeApp(secret?: string) {
	setTestEnv(secret ? ({ WEBHOOK_SHARED_SECRET: secret } as never) : {});
	const deps = { postgres: makePostgres(), supabase: makeSupabase() };
	const router = createAdminRouter(deps as never);
	const app = new Hono();
	app.route('/', router);
	return { app, deps };
}

async function getAdmin(app: Hono, path: string, authHeader?: string) {
	const headers: Record<string, string> = {};
	if (authHeader) headers.Authorization = authHeader;
	return app.request(path, { method: 'GET', headers });
}

async function patchAdmin(app: Hono, path: string, body: unknown) {
	return app.request(path, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('GET /admin/erros — auth', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 200 without auth (auth removed)', async () => {
		const { app } = makeApp('mysecret');
		const res = await getAdmin(app, '/admin/erros');
		expect(res.status).toBe(200);
	});

	it('returns 200 with no secret set', async () => {
		const { app } = makeApp();
		const res = await getAdmin(app, '/admin/erros');
		expect(res.status).toBe(200);
	});
});

describe('GET /admin/erros — content', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns only sucesso=false events (query filters at DB level)', async () => {
		const { app, deps } = makeApp();
		const res = await getAdmin(app, '/admin/erros');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { erros: unknown[]; total: number };
		expect(body.total).toBe(1);
		expect(body.erros).toHaveLength(1);
		// Verify the .eq('sucesso', false) was called
		expect(deps.supabase._queryBuilder.eq).toHaveBeenCalledWith('sucesso', false);
	});

	it('never calls uazapi.sendText — errors never go to the public group', async () => {
		setTestEnv({});
		const postgres = makePostgres();
		const supabase = makeSupabase();
		const uazapi = { sendText: vi.fn() };
		const router = createAdminRouter({ postgres, supabase } as never);
		const app = new Hono();
		app.route('/', router);
		await getAdmin(app, '/admin/erros');
		expect(uazapi.sendText).not.toHaveBeenCalled();
	});

	it('respects n query param', async () => {
		const { app, deps } = makeApp();
		await getAdmin(app, '/admin/erros?n=10');
		expect(deps.supabase._queryBuilder.limit).toHaveBeenCalledWith(10);
	});
});

describe('GET /admin/relatorio — auth', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 200 without auth (auth removed)', async () => {
		const { app } = makeApp('mysecret');
		const res = await getAdmin(app, '/admin/relatorio');
		expect(res.status).toBe(200);
	});
});

describe('GET /admin/relatorio — content', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns periodo and resumo in response', async () => {
		const { app } = makeApp();
		const res = await getAdmin(app, '/admin/relatorio?periodo=dia');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.periodo).toBe('dia');
		expect(body.resumo).toBeDefined();
	});

	it('accepts periodo=semana', async () => {
		const { app } = makeApp();
		const res = await getAdmin(app, '/admin/relatorio?periodo=semana');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.periodo).toBe('semana');
	});

	it('accepts periodo=mes', async () => {
		const { app } = makeApp();
		const res = await getAdmin(app, '/admin/relatorio?periodo=mes');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.periodo).toBe('mes');
	});
});

describe('GET /admin/cron', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 200 with jobs list', async () => {
		const { app } = makeApp();
		const res = await getAdmin(app, '/admin/cron');
		expect(res.status).toBe(200);
		const body = (await res.json()) as { total: number; jobs: unknown[] };
		expect(body.total).toBe(2);
		expect(body.jobs).toHaveLength(2);
	});

	it('job entries have expected fields', async () => {
		const { app } = makeApp();
		const res = await getAdmin(app, '/admin/cron');
		const body = (await res.json()) as { jobs: Array<Record<string, unknown>> };
		const lembrete = body.jobs.find((j) => j.job_name === 'lembrete');
		expect(lembrete).toBeDefined();
		expect(lembrete?.enabled).toBe(true);
		expect(Array.isArray(lembrete?.cron_expressions)).toBe(true);
	});
});

describe('PATCH /admin/cron/:job_name', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 200 and calls updateCronJob when disabling', async () => {
		const { app, deps } = makeApp();
		const res = await patchAdmin(app, '/admin/cron/lembrete', { enabled: false });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe('ok');
		expect(deps.postgres.updateCronJob).toHaveBeenCalledWith('lembrete', { enabled: false });
	});

	it('returns 200 and calls updateCronJob when updating expressions', async () => {
		const { app, deps } = makeApp();
		const res = await patchAdmin(app, '/admin/cron/lembrete', { cron_expressions: ['0 10 * * *'] });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe('ok');
		expect(deps.postgres.updateCronJob).toHaveBeenCalledWith('lembrete', {
			cron_expressions: ['0 10 * * *'],
		});
	});

	it('returns 404 for unknown job', async () => {
		const { app } = makeApp();
		const res = await patchAdmin(app, '/admin/cron/jobinexistente', { enabled: false });
		expect(res.status).toBe(404);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe('erro');
	});

	it('returns 400 for invalid cron expression', async () => {
		const { app } = makeApp();
		const res = await patchAdmin(app, '/admin/cron/lembrete', { cron_expressions: ['not-a-cron'] });
		expect(res.status).toBe(400);
		const body = (await res.json()) as { status: string };
		expect(body.status).toBe('erro');
	});
});
