import type { ChatMemoryRow, PostgresClient } from '../clients/postgres.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

/** Max messages to load as context for the agent.
 *  Reduzido de 30 → 20 pra encurtar requests à OpenAI: clientes recorrentes
 *  com 30 turnos de histórico viravam ~2-3k tokens de prompt, e geração lenta
 *  do gpt-4.1-mini com tools deixava janela pra "Premature close" da OpenAI
 *  cortar a resposta. 20 mensagens (~10 trocas) é contexto suficiente. */
const MAX_MESSAGES = 20;

export class ChatMemory {
	private readonly pg: PostgresClient;
	private readonly log: Logger;

	constructor(pg: PostgresClient, logger?: Logger) {
		this.pg = pg;
		this.log = logger ?? rootLogger.child({ module: 'memory' });
	}

	async loadRecent(sessionId: string): Promise<ChatMemoryRow[]> {
		const raw = await this.pg.loadRecentMessages(sessionId, MAX_MESSAGES);
		// Filter out role 'tool' messages — they are intermediate context that
		// only makes sense paired with the originating `assistant.tool_calls`.
		// Persisting them in the langchain-format table loses the linkage,
		// so loading them back into OpenAI as orphan `tool` messages breaks
		// the API contract. We keep only user + assistant exchanges.
		const messages = raw.filter((m) => m.role === 'user' || m.role === 'assistant');
		this.log.debug(
			{ sessionId: sessionId.slice(-8), raw: raw.length, kept: messages.length },
			'Loaded chat memory (filtered)',
		);
		return messages;
	}

	async clear(sessionId: string): Promise<number> {
		const deleted = await this.pg.clearChatMemory(sessionId);
		this.log.info({ sessionId: sessionId.slice(-8), deleted }, 'Chat memory cleared');
		return deleted;
	}

	async save(
		sessionId: string,
		role: string,
		content: string,
		metadata?: Record<string, unknown>,
	): Promise<void> {
		await this.pg.saveChatMessage(sessionId, role, content, metadata);
	}

	/** Convert memory rows to OpenAI message format */
	static toOpenAIMessages(rows: ChatMemoryRow[]): Array<{ role: string; content: string }> {
		return rows.map((r) => ({ role: r.role, content: r.content }));
	}
}
