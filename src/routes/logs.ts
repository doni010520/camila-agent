import { Hono } from 'hono';
import { getEnv } from '../infra/env.js';
import { getLogLines } from '../infra/log-buffer.js';

export const logsRouter = new Hono();

logsRouter.get('/logs', (c) => {
	const env = getEnv();
	if (env.WEBHOOK_SHARED_SECRET) {
		const auth = c.req.header('Authorization');
		if (auth !== `Bearer ${env.WEBHOOK_SHARED_SECRET}`) {
			return c.json({ status: 'erro', razao: 'Unauthorized' }, 401);
		}
	}

	const nParam = c.req.query('n');
	const n = nParam ? Number.parseInt(nParam, 10) : 200;
	const lines = getLogLines(Number.isFinite(n) && n > 0 ? n : 200);

	// Plain text (one JSON-log line per line) is easiest to grep/scroll.
	const format = c.req.query('format');
	if (format === 'json') {
		return c.json({ count: lines.length, lines });
	}
	return c.text(lines.join('\n'));
});
