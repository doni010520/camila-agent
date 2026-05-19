import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { healthRouter } from '../../src/routes/health.js';

describe('GET /health', () => {
	const app = new Hono();
	app.route('/', healthRouter);

	it('returns 200 with status ok', async () => {
		const res = await app.request('/health');
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(body.service).toBe('camila-agent');
		expect(body.timestamp).toBeDefined();
		expect(typeof body.uptime).toBe('number');
	});
});
