import { Hono } from 'hono';

export const healthRouter = new Hono();

healthRouter.get('/health', (c) => {
	return c.json({
		status: 'ok',
		service: 'camila-agent',
		timestamp: new Date().toISOString(),
		uptime: process.uptime(),
	});
});
