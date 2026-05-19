import pg from 'pg';
import { z } from 'zod';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

// ═══════════════════════════════════════════════════════════════
// Schemas
// ═══════════════════════════════════════════════════════════════

export const chatMemoryRowSchema = z.object({
	id: z.number().optional(),
	session_id: z.string(),
	role: z.enum(['user', 'assistant', 'tool', 'system']),
	content: z.string(),
	metadata: z.record(z.unknown()).nullable().optional(),
	created_at: z.string().optional(),
});

export const clienteLookupSchema = z.object({
	id: z.number(),
	nome: z.string(),
	email: z.string().nullable().optional(),
	telefone: z.string(),
});

export type ChatMemoryRow = z.infer<typeof chatMemoryRowSchema>;
export type ClienteLookup = z.infer<typeof clienteLookupSchema>;

// ═══════════════════════════════════════════════════════════════
// Client
// ═══════════════════════════════════════════════════════════════

export interface PostgresClientConfig {
	connectionString?: string;
	logger?: Logger;
}

export class PostgresClient {
	private readonly pool: pg.Pool;
	private readonly log: Logger;

	constructor(config?: PostgresClientConfig) {
		const env = getEnv();
		this.pool = new pg.Pool({
			connectionString: config?.connectionString ?? env.POSTGRES_URL,
			max: 10,
			idleTimeoutMillis: 30000,
		});
		this.log = config?.logger ?? rootLogger.child({ client: 'postgres' });
	}

	async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
		this.log.debug({ sql: sql.slice(0, 80) }, 'Postgres query');
		const result = await this.pool.query(sql, params);
		return result.rows as T[];
	}

	async close(): Promise<void> {
		await this.pool.end();
	}

	// ── Chat memory (reusing n8n_chat_histories table) ──

	async ensureChatMemoryTable(): Promise<void> {
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS n8n_chat_histories (
				id SERIAL PRIMARY KEY,
				session_id TEXT NOT NULL,
				role TEXT NOT NULL,
				content TEXT NOT NULL,
				metadata JSONB,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			);
			CREATE INDEX IF NOT EXISTS idx_chat_histories_session
				ON n8n_chat_histories(session_id, created_at DESC);
		`);
	}

	async saveChatMessage(
		sessionId: string,
		role: string,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		await this.pool.query(
			'INSERT INTO n8n_chat_histories (session_id, role, content, metadata) VALUES ($1, $2, $3, $4)',
			[sessionId, role, content, metadata ? JSON.stringify(metadata) : null],
		);
	}

	async loadRecentMessages(sessionId: string, limit = 30): Promise<ChatMemoryRow[]> {
		const rows = await this.query<Record<string, unknown>>(
			`SELECT session_id, role, content, metadata, created_at
			 FROM n8n_chat_histories
			 WHERE session_id = $1
			 ORDER BY created_at DESC
			 LIMIT $2`,
			[sessionId, limit],
		);
		return rows.map((r) => chatMemoryRowSchema.parse(r)).reverse();
	}

	// ── Client lookup by last 8 digits ──

	async findClienteByPhone(last8: string): Promise<ClienteLookup | null> {
		const rows = await this.query<Record<string, unknown>>(
			`SELECT id, nome, email, telefone FROM clientes
			 WHERE RIGHT(telefone, 8) = $1
			 LIMIT 1`,
			[last8],
		);
		if (rows.length === 0) return null;
		return clienteLookupSchema.parse(rows[0]);
	}
}
