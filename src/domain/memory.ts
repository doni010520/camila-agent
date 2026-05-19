import type { ChatMemoryRow, PostgresClient } from '../clients/postgres.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

/** Max messages to load as context for the agent */
const MAX_MESSAGES = 30;

export class ChatMemory {
	private readonly pg: PostgresClient;
	private readonly log: Logger;

	constructor(pg: PostgresClient, logger?: Logger) {
		this.pg = pg;
		this.log = logger ?? rootLogger.child({ module: 'memory' });
	}

	async loadRecent(sessionId: string): Promise<ChatMemoryRow[]> {
		const messages = await this.pg.loadRecentMessages(sessionId, MAX_MESSAGES);
		this.log.debug(
			{ sessionId: sessionId.slice(-8), count: messages.length },
			'Loaded chat memory',
		);
		return messages;
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
