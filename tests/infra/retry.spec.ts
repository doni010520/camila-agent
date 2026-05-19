import { describe, expect, it, vi } from 'vitest';
import { withRetry } from '../../src/infra/retry.js';

describe('withRetry', () => {
	it('returns on first success', async () => {
		const fn = vi.fn().mockResolvedValue('ok');
		const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 });
		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on failure then succeeds', async () => {
		const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('ok');
		const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 50 });
		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('throws after maxRetries exhausted', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('always fails'));
		await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 50 })).rejects.toThrow(
			'always fails',
		);
		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	it('stops retrying when shouldRetry returns false', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('no retry'));
		await expect(
			withRetry(fn, { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 50, shouldRetry: () => false }),
		).rejects.toThrow('no retry');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('handles maxRetries=0 (one attempt only)', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('single'));
		await expect(withRetry(fn, { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 50 })).rejects.toThrow(
			'single',
		);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
