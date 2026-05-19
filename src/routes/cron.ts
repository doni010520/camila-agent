import { Hono } from 'hono';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { getEnv } from '../infra/env.js';
import { rootLogger } from '../infra/logger.js';
import { runEnqueteFinalizacao } from '../jobs/enquete-finalizacao.js';
import { runLembreteAmanha } from '../jobs/lembrete-amanha.js';

export interface CronDeps {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	uazapi: UazapiClient;
}

export function createCronRouter(deps: CronDeps): Hono {
	const router = new Hono();
	const env = getEnv();

	// Optional: shared secret to protect cron endpoints
	router.use('/cron/*', async (c, next) => {
		if (env.WEBHOOK_SHARED_SECRET) {
			const auth = c.req.header('Authorization');
			if (auth !== `Bearer ${env.WEBHOOK_SHARED_SECRET}`) {
				return c.json({ status: 'erro', razao: 'Unauthorized' }, 401);
			}
		}
		return next();
	});

	router.post('/cron/lembrete', async (c) => {
		const log = rootLogger.child({ job: 'cron-lembrete' });
		try {
			const result = await runLembreteAmanha({
				trinks: deps.trinks,
				supabase: deps.supabase,
				uazapi: deps.uazapi,
				profissionalId: env.TRINKS_PROFISSIONAL_ID_CAMILA,
				logger: log,
			});
			return c.json({ status: 'ok', ...result });
		} catch (err) {
			log.error({ err }, 'Cron lembrete failed');
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	router.post('/cron/enquete', async (c) => {
		const log = rootLogger.child({ job: 'cron-enquete' });
		try {
			const result = await runEnqueteFinalizacao({
				trinks: deps.trinks,
				supabase: deps.supabase,
				uazapi: deps.uazapi,
				profissionalId: env.TRINKS_PROFISSIONAL_ID_CAMILA,
				logger: log,
			});
			return c.json({ status: 'ok', ...result });
		} catch (err) {
			log.error({ err }, 'Cron enquete failed');
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	return router;
}
