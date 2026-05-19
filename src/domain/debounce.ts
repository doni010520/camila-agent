import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

export interface DebouncedMessage {
	text: string;
	timestamp: number;
}

interface DebounceEntry {
	messages: DebouncedMessage[];
	timer: ReturnType<typeof setTimeout>;
	processing: boolean;
}

export type DebounceCallback = (telefone: string, combinedText: string) => Promise<void>;

export class MessageDebouncer {
	private readonly buffers = new Map<string, DebounceEntry>();
	private readonly windowMs: number;
	private readonly log: Logger;
	private callback: DebounceCallback | null = null;

	constructor(windowMs?: number, logger?: Logger) {
		this.windowMs = windowMs ?? getEnv().DEBOUNCE_MS;
		this.log = logger ?? rootLogger.child({ module: 'debounce' });
	}

	setCallback(cb: DebounceCallback): void {
		this.callback = cb;
	}

	push(telefone: string, text: string): void {
		const existing = this.buffers.get(telefone);

		if (existing?.processing) {
			// Agent is still processing previous batch — queue for next window
			this.log.debug({ telefone: telefone.slice(-8) }, 'Agent busy, queuing for next window');
			const nextEntry = this.buffers.get(`__next__${telefone}`);
			if (nextEntry) {
				clearTimeout(nextEntry.timer);
				nextEntry.messages.push({ text, timestamp: Date.now() });
				nextEntry.timer = setTimeout(() => this.flush(`__next__${telefone}`), this.windowMs);
			} else {
				const timer = setTimeout(() => this.flush(`__next__${telefone}`), this.windowMs);
				this.buffers.set(`__next__${telefone}`, {
					messages: [{ text, timestamp: Date.now() }],
					timer,
					processing: false,
				});
			}
			return;
		}

		if (existing) {
			clearTimeout(existing.timer);
			existing.messages.push({ text, timestamp: Date.now() });
			existing.timer = setTimeout(() => this.flush(telefone), this.windowMs);
		} else {
			const timer = setTimeout(() => this.flush(telefone), this.windowMs);
			this.buffers.set(telefone, {
				messages: [{ text, timestamp: Date.now() }],
				timer,
				processing: false,
			});
		}
	}

	private async flush(key: string): Promise<void> {
		const entry = this.buffers.get(key);
		if (!entry || entry.messages.length === 0) return;

		// Determine real telefone (strip __next__ prefix if present)
		const isNext = key.startsWith('__next__');
		const telefone = isNext ? key.slice(8) : key;

		const combined = entry.messages.map((m) => m.text).join('\n\n');
		entry.processing = true;
		this.log.info(
			{ telefone: telefone.slice(-8), messageCount: entry.messages.length },
			'Debounce flush',
		);

		try {
			if (this.callback) {
				await this.callback(telefone, combined);
			}
		} catch (err) {
			this.log.error({ err, telefone: telefone.slice(-8) }, 'Debounce callback error');
		} finally {
			this.buffers.delete(key);

			// If there's a next buffer queued, move it to primary
			if (!isNext) {
				const nextKey = `__next__${telefone}`;
				const nextEntry = this.buffers.get(nextKey);
				if (nextEntry) {
					this.buffers.delete(nextKey);
					this.buffers.set(telefone, { ...nextEntry, processing: false });
					// Re-arm timer
					clearTimeout(nextEntry.timer);
					nextEntry.timer = setTimeout(() => this.flush(telefone), this.windowMs);
				}
			}
		}
	}

	/** For tests: get pending count */
	get pendingCount(): number {
		return this.buffers.size;
	}

	/** For tests: force flush all */
	async flushAll(): Promise<void> {
		const keys = [...this.buffers.keys()];
		for (const key of keys) {
			const entry = this.buffers.get(key);
			if (entry) clearTimeout(entry.timer);
			await this.flush(key);
		}
	}

	/** Cleanup all timers */
	destroy(): void {
		for (const entry of this.buffers.values()) {
			clearTimeout(entry.timer);
		}
		this.buffers.clear();
	}
}
