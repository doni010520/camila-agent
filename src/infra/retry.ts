import type { Logger } from './logger.js';

export interface RetryOptions {
	maxRetries: number;
	baseDelayMs: number;
	maxDelayMs: number;
	shouldRetry?: (error: unknown) => boolean;
	logger?: Logger;
	label?: string;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'logger' | 'label'>> = {
	maxRetries: 3,
	baseDelayMs: 500,
	maxDelayMs: 10000,
	shouldRetry: () => true,
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
	fn: () => Promise<T>,
	opts: Partial<RetryOptions> = {},
): Promise<T> {
	const options = { ...DEFAULT_OPTIONS, ...opts };
	let lastError: unknown;

	for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error: unknown) {
			lastError = error;

			if (attempt === options.maxRetries) break;

			const shouldRetry = options.shouldRetry?.(error) ?? true;
			if (!shouldRetry) break;

			const delay = Math.min(
				options.baseDelayMs * 2 ** attempt + Math.random() * 200,
				options.maxDelayMs,
			);

			opts.logger?.warn(
				{
					attempt: attempt + 1,
					maxRetries: options.maxRetries,
					delayMs: Math.round(delay),
					label: opts.label,
				},
				'Retrying after error',
			);

			await sleep(delay);
		}
	}

	throw lastError;
}

/** Returns true if the HTTP status code is retryable (5xx or 429) */
export function isRetryableStatus(status: number): boolean {
	return status >= 500 || status === 429;
}
