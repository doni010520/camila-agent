import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';

// Mock the job runners
const mockLembrete = vi
	.fn()
	.mockResolvedValue({ date: '2026-05-22', total: 2, enviados: 1, jaEnviados: 1, erros: 0 });
const mockEnquete = vi.fn().mockResolvedValue({ total: 1, enviados: 1, jaEnviados: 0, erros: 0 });
const mockRelatorioDiario = vi.fn().mockResolvedValue({ data: '2026-05-21', agendamentos_criados: 3 });
const mockRelatorioErros = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/jobs/lembrete-amanha.js', () => ({
	runLembreteAmanha: (...args: unknown[]) => mockLembrete(...args),
}));

vi.mock('../../src/jobs/enquete-finalizacao.js', () => ({
	runEnqueteFinalizacao: (...args: unknown[]) => mockEnquete(...args),
}));

vi.mock('../../src/jobs/relatorio-diario.js', () => ({
	runRelatorioDiario: (...args: unknown[]) => mockRelatorioDiario(...args),
}));

vi.mock('../../src/jobs/relatorio-erros.js', () => ({
	runRelatorioErros: (...args: unknown[]) => mockRelatorioErros(...args),
}));

import { createCronRouter } from '../../src/routes/cron.js';

function makeApp(secret?: string) {
	setTestEnv(secret ? ({ WEBHOOK_SHARED_SECRET: secret } as never) : {});
	const deps = { trinks: {}, supabase: {}, uazapi: {} };
	const router = createCronRouter(deps as never);
	const app = new Hono();
	app.route('/', router);
	return app;
}

async function postCron(app: Hono, path: string, authHeader?: string) {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' };
	if (authHeader) headers.Authorization = authHeader;
	return app.request(path, { method: 'POST', headers });
}

describe('POST /cron/lembrete', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 200 with result when no auth required', async () => {
		const app = makeApp();
		const res = await postCron(app, '/cron/lembrete');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(body.enviados).toBe(1);
	});

	it('returns 401 when secret set but no Bearer', async () => {
		const app = makeApp('mysecret');
		const res = await postCron(app, '/cron/lembrete');
		expect(res.status).toBe(401);
	});

	it('returns 401 when Bearer wrong', async () => {
		const app = makeApp('mysecret');
		const res = await postCron(app, '/cron/lembrete', 'Bearer wrongsecret');
		expect(res.status).toBe(401);
	});

	it('returns 200 when Bearer correct', async () => {
		const app = makeApp('mysecret');
		const res = await postCron(app, '/cron/lembrete', 'Bearer mysecret');
		expect(res.status).toBe(200);
	});

	it('returns 500 on internal error', async () => {
		mockLembrete.mockRejectedValueOnce(new Error('db down'));
		const app = makeApp();
		const res = await postCron(app, '/cron/lembrete');
		expect(res.status).toBe(500);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('erro');
	});
});

describe('POST /cron/enquete', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 200 with result', async () => {
		const app = makeApp();
		const res = await postCron(app, '/cron/enquete');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(body.enviados).toBe(1);
	});

	it('returns 401 when secret set but missing', async () => {
		const app = makeApp('mysecret');
		const res = await postCron(app, '/cron/enquete');
		expect(res.status).toBe(401);
	});

	it('returns 500 on internal error', async () => {
		mockEnquete.mockRejectedValueOnce(new Error('timeout'));
		const app = makeApp();
		const res = await postCron(app, '/cron/enquete');
		expect(res.status).toBe(500);
	});
});

describe('POST /cron/relatorio-diario', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 200 with resumo on success', async () => {
		const app = makeApp();
		const res = await postCron(app, '/cron/relatorio-diario');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(body.data).toBe('2026-05-21');
	});

	it('returns 401 when secret set but missing', async () => {
		const app = makeApp('mysecret');
		const res = await postCron(app, '/cron/relatorio-diario');
		expect(res.status).toBe(401);
	});

	it('returns 401 with wrong Bearer', async () => {
		const app = makeApp('mysecret');
		const res = await postCron(app, '/cron/relatorio-diario', 'Bearer wrong');
		expect(res.status).toBe(401);
	});

	it('returns 200 with correct Bearer', async () => {
		const app = makeApp('mysecret');
		const res = await postCron(app, '/cron/relatorio-diario', 'Bearer mysecret');
		expect(res.status).toBe(200);
	});

	it('returns 500 on job failure', async () => {
		mockRelatorioDiario.mockRejectedValueOnce(new Error('db down'));
		const app = makeApp();
		const res = await postCron(app, '/cron/relatorio-diario');
		expect(res.status).toBe(500);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('erro');
	});
});

describe('POST /cron/relatorio-erros', () => {
	beforeEach(() => vi.clearAllMocks());

	it('returns 200 on success', async () => {
		const app = makeApp();
		const res = await postCron(app, '/cron/relatorio-erros');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
	});

	it('returns 401 when secret set but missing', async () => {
		const app = makeApp('mysecret');
		const res = await postCron(app, '/cron/relatorio-erros');
		expect(res.status).toBe(401);
	});

	it('returns 500 on job failure', async () => {
		mockRelatorioErros.mockRejectedValueOnce(new Error('timeout'));
		const app = makeApp();
		const res = await postCron(app, '/cron/relatorio-erros');
		expect(res.status).toBe(500);
	});
});
