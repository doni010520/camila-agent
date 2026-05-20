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
	// pg driver returns bigint as string by default; coerce to number
	id: z.coerce.number(),
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

	// ── Chat memory (reuses n8n_chat_histories, Langchain format) ──
	// Schema real (criado pelo n8n): id SERIAL, session_id VARCHAR, message JSONB
	// message format: { type: 'human'|'ai'|'tool'|'system', content: string, additional_kwargs, response_metadata }

	async ensureChatMemoryTable(): Promise<void> {
		// Cria com schema compatível com n8n (Langchain). IF NOT EXISTS = no-op se já existir.
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS n8n_chat_histories (
				id SERIAL PRIMARY KEY,
				session_id VARCHAR(255) NOT NULL,
				message JSONB NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_chat_histories_session
				ON n8n_chat_histories(session_id, id DESC);
		`);
	}

	private roleToLangchainType(role: string): string {
		switch (role) {
			case 'user': return 'human';
			case 'assistant': return 'ai';
			case 'tool': return 'tool';
			case 'system': return 'system';
			default: return role;
		}
	}

	private langchainTypeToRole(type: string): 'user' | 'assistant' | 'tool' | 'system' {
		switch (type) {
			case 'human': return 'user';
			case 'ai': return 'assistant';
			case 'tool': return 'tool';
			case 'system': return 'system';
			default: return 'user';
		}
	}

	async saveChatMessage(
		sessionId: string,
		role: string,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		const message = {
			type: this.roleToLangchainType(role),
			content,
			additional_kwargs: metadata ?? {},
			response_metadata: {},
		};
		await this.pool.query(
			'INSERT INTO n8n_chat_histories (session_id, message) VALUES ($1, $2)',
			[sessionId, JSON.stringify(message)],
		);
	}

	async loadRecentMessages(sessionId: string, limit = 30): Promise<ChatMemoryRow[]> {
		const rows = await this.query<{ id: number; session_id: string; message: Record<string, unknown> }>(
			`SELECT id, session_id, message
			 FROM n8n_chat_histories
			 WHERE session_id = $1
			 ORDER BY id DESC
			 LIMIT $2`,
			[sessionId, limit],
		);
		return rows.reverse().map((r) => ({
			id: r.id,
			session_id: r.session_id,
			role: this.langchainTypeToRole(String(r.message.type ?? 'human')),
			content: String(r.message.content ?? ''),
			metadata: (r.message.additional_kwargs as Record<string, unknown>) ?? null,
		}));
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
