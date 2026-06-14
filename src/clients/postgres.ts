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

			CREATE TABLE IF NOT EXISTS webhook_inbound (
				id BIGSERIAL PRIMARY KEY,
				recebido_em TIMESTAMPTZ DEFAULT NOW(),
				chatid TEXT,
				telefone TEXT,
				message_type TEXT,
				text TEXT,
				from_me BOOLEAN,
				was_sent_by_api BOOLEAN,
				button_id TEXT,
				payload TEXT
			);
			CREATE INDEX IF NOT EXISTS idx_webhook_inbound_recebido_em
				ON webhook_inbound(recebido_em DESC);
			CREATE INDEX IF NOT EXISTS idx_webhook_inbound_telefone
				ON webhook_inbound(telefone, recebido_em DESC);

			CREATE TABLE IF NOT EXISTS cron_jobs (
				job_name TEXT PRIMARY KEY,
				enabled BOOLEAN NOT NULL DEFAULT true,
				cron_expressions TEXT[] NOT NULL DEFAULT '{}',
				descricao TEXT,
				ultima_execucao_em TIMESTAMPTZ,
				ultima_execucao_resultado JSONB,
				atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
			);
		`);

		// Seed dos jobs padrão (idempotente — só insere se não existir).
		await this.pool.query(`
			INSERT INTO cron_jobs (job_name, enabled, cron_expressions, descricao) VALUES
				('lembrete',       true, ARRAY['0 9 * * *','0 13 * * *','0 18 * * *'], 'Lembrete pra confirmar agendamento de amanhã (3x ao dia, igual n8n velho)'),
				('enquete',        true, ARRAY['0 20 * * *'],                          'Enquete pós-atendimento (final do dia)'),
				('sync_clientes',  true, ARRAY['0 4 * * 0'],                           'Sincroniza clientes da Trinks pro Postgres (domingo madrugada)'),
				('detectar_conflitos', true, ARRAY['0 8 * * *','0 12 * * *','0 19 * * *'], 'Detecta agendamentos sobrepostos (qualquer origem) e alerta a Camila')
			ON CONFLICT (job_name) DO NOTHING;
		`);
	}

	// ── Cron jobs config ──

	async listCronJobs(): Promise<Array<{
		job_name: string;
		enabled: boolean;
		cron_expressions: string[];
		descricao: string | null;
		ultima_execucao_em: string | null;
		ultima_execucao_resultado: unknown;
		atualizado_em: string;
	}>> {
		return this.query(
			`SELECT job_name, enabled, cron_expressions, descricao,
			        ultima_execucao_em::text AS ultima_execucao_em,
			        ultima_execucao_resultado,
			        atualizado_em::text AS atualizado_em
			 FROM cron_jobs ORDER BY job_name`,
		);
	}

	async updateCronJob(jobName: string, patch: { enabled?: boolean; cron_expressions?: string[]; descricao?: string }): Promise<void> {
		const sets: string[] = [];
		const params: unknown[] = [];
		let i = 1;
		if (patch.enabled !== undefined) { sets.push(`enabled = $${i++}`); params.push(patch.enabled); }
		if (patch.cron_expressions !== undefined) { sets.push(`cron_expressions = $${i++}`); params.push(patch.cron_expressions); }
		if (patch.descricao !== undefined) { sets.push(`descricao = $${i++}`); params.push(patch.descricao); }
		if (sets.length === 0) return;
		sets.push(`atualizado_em = NOW()`);
		params.push(jobName);
		await this.pool.query(
			`UPDATE cron_jobs SET ${sets.join(', ')} WHERE job_name = $${i}`,
			params,
		);
	}

	async marcarExecucaoCron(jobName: string, resultado: unknown): Promise<void> {
		await this.pool.query(
			`UPDATE cron_jobs SET ultima_execucao_em = NOW(), ultima_execucao_resultado = $1::jsonb WHERE job_name = $2`,
			[JSON.stringify(resultado), jobName],
		);
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

	/** Lista quantas mensagens cada sessão (telefone) já trocou com Helena.
	 *  Usado pra auditoria de quem está interagindo com o sistema. */
	async listChatSessions(): Promise<Array<{ session_id: string; total: number; ultima: string }>> {
		return this.query<{ session_id: string; total: number; ultima: string }>(
			`SELECT session_id,
			        COUNT(*)::int AS total,
			        MAX(id)::text AS ultima
			 FROM n8n_chat_histories
			 GROUP BY session_id
			 ORDER BY MAX(id) DESC
			 LIMIT 200`,
		);
	}

	/** Lista sessões onde a última mensagem é do usuário (sem resposta da Helena).
	 *  Útil pra investigar relatos do tipo "Helena não respondeu". */
	async listSessionsSemResposta(): Promise<Array<{ session_id: string; ultima_id: number; ultima_msg: string }>> {
		return this.query<{ session_id: string; ultima_id: number; ultima_msg: string }>(
			`WITH ult AS (
			   SELECT DISTINCT ON (session_id)
			     session_id, id AS ultima_id,
			     (message->>'type') AS tipo,
			     (message->>'content') AS ultima_msg
			   FROM n8n_chat_histories
			   ORDER BY session_id, id DESC
			 )
			 SELECT session_id, ultima_id, ultima_msg
			 FROM ult
			 WHERE tipo = 'human'
			 ORDER BY ultima_id DESC
			 LIMIT 50`,
		);
	}

	/** Best-effort: registra TODA mensagem inbound do webhook UAZAPI pra
	 *  auditoria. Não bloqueia o fluxo principal. */
	async logWebhookInbound(input: {
		chatid: string | null;
		telefone: string | null;
		message_type: string | null;
		text: string | null;
		from_me: boolean;
		was_sent_by_api: boolean;
		button_id: string | null;
		payload: unknown;
	}): Promise<void> {
		try {
			await this.pool.query(
				`INSERT INTO webhook_inbound
				   (chatid, telefone, message_type, text, from_me, was_sent_by_api, button_id, payload)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
				[
					input.chatid,
					input.telefone,
					input.message_type,
					input.text?.slice(0, 2000) ?? null,
					input.from_me,
					input.was_sent_by_api,
					input.button_id,
					JSON.stringify(input.payload).slice(0, 8000),
				],
			);
		} catch (err) {
			rootLogger.warn(
				{ err: err instanceof Error ? err.message : 'unknown' },
				'logWebhookInbound failed',
			);
		}
	}

	async listWebhookInbound(opts: { telefone?: string; limit?: number; includePayload?: boolean }): Promise<
		Array<{
			id: number;
			recebido_em: string;
			chatid: string | null;
			telefone: string | null;
			message_type: string | null;
			text: string | null;
			from_me: boolean;
			was_sent_by_api: boolean;
			button_id: string | null;
			payload?: string;
		}>
	> {
		const limit = opts.limit ?? 50;
		const cols = opts.includePayload
			? 'id, recebido_em, chatid, telefone, message_type, text, from_me, was_sent_by_api, button_id, payload'
			: 'id, recebido_em, chatid, telefone, message_type, text, from_me, was_sent_by_api, button_id';
		if (opts.telefone) {
			return this.query(
				`SELECT ${cols}
				 FROM webhook_inbound
				 WHERE telefone = $1 OR chatid LIKE $2
				 ORDER BY id DESC LIMIT $3`,
				[opts.telefone, `${opts.telefone}@%`, limit],
			);
		}
		return this.query(
			`SELECT ${cols}
			 FROM webhook_inbound
			 ORDER BY id DESC LIMIT $1`,
			[limit],
		);
	}

	async clearChatMemory(sessionId: string): Promise<number> {
		const result = await this.pool.query(
			'DELETE FROM n8n_chat_histories WHERE session_id = $1',
			[sessionId],
		);
		return result.rowCount ?? 0;
	}

	/** Busca textual no histórico de conversa (n8n_chat_histories). Retorna as
	 *  mensagens que contêm `termo` (case-insensitive), com o session_id pra
	 *  identificar a cliente. Usado pra auditoria — ex: achar todas as conversas
	 *  onde a Helena ofereceu/mencionou um serviço específico. */
	async searchChatMessages(
		termo: string,
		opts?: { role?: 'user' | 'assistant'; limit?: number },
	): Promise<Array<{ session_id: string; id: number; role: string; content: string }>> {
		const params: unknown[] = [`%${termo}%`];
		let roleFilter = '';
		if (opts?.role) {
			const lcType = this.roleToLangchainType(opts.role);
			params.push(lcType);
			roleFilter = `AND message->>'type' = $${params.length}`;
		}
		params.push(opts?.limit ?? 200);
		const rows = await this.query<{ session_id: string; id: number; type: string; content: string }>(
			`SELECT session_id, id,
			        message->>'type' AS type,
			        message->>'content' AS content
			 FROM n8n_chat_histories
			 WHERE message->>'content' ILIKE $1 ${roleFilter}
			 ORDER BY id DESC
			 LIMIT $${params.length}`,
			params,
		);
		return rows.map((r) => ({
			session_id: r.session_id,
			id: r.id,
			role: this.langchainTypeToRole(r.type ?? 'human'),
			content: r.content ?? '',
		}));
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

	/** Upsert a cliente record from Trinks sync. Returns whether the row was
	 *  newly inserted or updated. */
	async upsertCliente(input: {
		id: number;
		nome: string;
		email: string | null;
		telefone: string | null;
		dataCadastro: string | null;
	}): Promise<'inserted' | 'updated'> {
		const result = await this.pool.query<{ xmax: string }>(
			`INSERT INTO clientes (id, nome, email, telefone, data_cadastro)
			 VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()))
			 ON CONFLICT (id) DO UPDATE SET
			   nome = EXCLUDED.nome,
			   email = COALESCE(EXCLUDED.email, clientes.email),
			   telefone = COALESCE(EXCLUDED.telefone, clientes.telefone)
			 RETURNING xmax::text`,
			[input.id, input.nome, input.email, input.telefone, input.dataCadastro],
		);
		// xmax = '0' means INSERT; non-zero means UPDATE
		return result.rows[0]?.xmax === '0' ? 'inserted' : 'updated';
	}

	/** Look up phone by Trinks cliente id (used by lembrete job when Trinks GET
	 *  returns the cliente without telefones populated — common when the cliente
	 *  was imported pelo painel sem cadastro de telefone). */
	async findPhoneByTrinksId(id: number): Promise<string | null> {
		const rows = await this.query<{ telefone: string | null }>(
			`SELECT telefone FROM clientes WHERE id = $1 LIMIT 1`,
			[id],
		);
		const tel = rows[0]?.telefone;
		return tel && tel.length >= 10 ? tel : null;
	}
}
