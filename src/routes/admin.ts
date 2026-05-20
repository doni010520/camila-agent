/**
 * Endpoints de auditoria/admin. Protegidos por WEBHOOK_SHARED_SECRET.
 * Não exposto pro público.
 */
import { Hono } from 'hono';
import type { PostgresClient } from '../clients/postgres.js';
import { getEnv } from '../infra/env.js';

export interface AdminDeps {
	postgres: PostgresClient;
}

export function createAdminRouter(deps: AdminDeps): Hono {
	const router = new Hono();
	const env = getEnv();

	router.use('/admin/*', async (c, next) => {
		if (env.WEBHOOK_SHARED_SECRET) {
			const auth = c.req.header('Authorization');
			if (auth !== `Bearer ${env.WEBHOOK_SHARED_SECRET}`) {
				return c.json({ status: 'erro', razao: 'Unauthorized' }, 401);
			}
		}
		return next();
	});

	/** Quem está interagindo com Helena? Lista sessions ordenadas por última mensagem. */
	router.get('/admin/sessions', async (c) => {
		const sessions = await deps.postgres.listChatSessions();
		return c.json({ total_sessions: sessions.length, sessions });
	});

	/** Últimas N mensagens de uma sessão (telefone) pra inspecionar conteúdo. */
	router.get('/admin/session/:telefone', async (c) => {
		const telefone = c.req.param('telefone');
		const limit = Number(c.req.query('n') ?? 10);
		const rows = await deps.postgres.loadRecentMessages(telefone, Number.isFinite(limit) ? limit : 10);
		return c.json({ telefone, total: rows.length, mensagens: rows });
	});

	return router;
}
