import { Hono } from 'hono';
import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { getEnv } from '../infra/env.js';
import { rootLogger } from '../infra/logger.js';
import { runDetectarConflitos } from '../jobs/detectar-conflitos.js';
import { runEnqueteFinalizacao } from '../jobs/enquete-finalizacao.js';
import { runLembrarPendentes } from '../jobs/lembrar-pendentes.js';
import { runLembreteAmanha } from '../jobs/lembrete-amanha.js';
import { runRelatorioDiario } from '../jobs/relatorio-diario.js';
import { runRelatorioErros } from '../jobs/relatorio-erros.js';
import { runSyncClientes } from '../jobs/sync-clientes.js';

export interface CronDeps {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	uazapi: UazapiClient;
	postgres: PostgresClient;
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
				postgres: deps.postgres,
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

	router.post('/cron/lembrar-pendentes', async (c) => {
		const log = rootLogger.child({ job: 'cron-lembrar-pendentes' });
		try {
			const result = await runLembrarPendentes({
				trinks: deps.trinks,
				supabase: deps.supabase,
				uazapi: deps.uazapi,
				profissionalId: env.TRINKS_PROFISSIONAL_ID_CAMILA,
				logger: log,
			});
			return c.json({ status: 'ok', ...result });
		} catch (err) {
			log.error({ err }, 'Cron lembrar-pendentes failed');
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	router.post('/cron/sync-clientes', async (c) => {
		const log = rootLogger.child({ job: 'cron-sync-clientes' });
		try {
			const result = await runSyncClientes({
				trinks: deps.trinks,
				postgres: deps.postgres,
				logger: log,
			});
			return c.json({ status: 'ok', ...result });
		} catch (err) {
			log.error({ err }, 'Cron sync-clientes failed');
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	router.post('/cron/detectar-conflitos', async (c) => {
		const log = rootLogger.child({ job: 'cron-detectar-conflitos' });
		try {
			const result = await runDetectarConflitos({
				trinks: deps.trinks,
				uazapi: deps.uazapi,
				postgres: deps.postgres,
				profissionalId: getEnv().TRINKS_PROFISSIONAL_ID_CAMILA,
				logger: log,
			});
			return c.json({ status: 'ok', ...result });
		} catch (err) {
			log.error({ err }, 'Cron detectar-conflitos failed');
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	router.post('/cron/relatorio-diario', async (c) => {
		const log = rootLogger.child({ job: 'cron-relatorio-diario' });
		try {
			const resumo = await runRelatorioDiario({
				supabase: deps.supabase,
				uazapi: deps.uazapi,
			});
			return c.json({ status: 'ok', ...resumo });
		} catch (err) {
			log.error({ err }, 'Cron relatorio-diario failed');
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	router.post('/cron/relatorio-erros', async (c) => {
		const log = rootLogger.child({ job: 'cron-relatorio-erros' });
		try {
			await runRelatorioErros({
				supabase: deps.supabase,
				uazapi: deps.uazapi,
			});
			return c.json({ status: 'ok' });
		} catch (err) {
			log.error({ err }, 'Cron relatorio-erros failed');
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	return router;
}
