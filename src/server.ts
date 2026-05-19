import { serve } from '@hono/node-server';
import { bootApp } from './composition-root.js';
import { loadEnv } from './infra/env.js';
import { rootLogger } from './infra/logger.js';

const env = loadEnv();

const { app, registry, shutdown } = await bootApp();

rootLogger.info({ port: env.PORT, tools: registry.names }, 'Starting camila-agent');

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
	rootLogger.info({ port: info.port }, 'camila-agent listening');
});

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, async () => {
		rootLogger.info({ signal }, 'Received shutdown signal');
		server.close();
		await shutdown();
		process.exit(0);
	});
}

export { app };
