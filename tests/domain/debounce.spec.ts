import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageDebouncer } from '../../src/domain/debounce.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({ DEBOUNCE_MS: '100' } as never);

describe('MessageDebouncer', () => {
	let debouncer: MessageDebouncer;
	const results: Array<{ telefone: string; text: string }> = [];

	beforeEach(() => {
		vi.useFakeTimers();
		results.length = 0;
		debouncer = new MessageDebouncer(100);
		debouncer.setCallback(async (tel, text) => {
			results.push({ telefone: tel, text });
		});
	});

	afterEach(() => {
		debouncer.destroy();
		vi.useRealTimers();
	});

	it('groups messages within window into single callback', async () => {
		debouncer.push('5571999', 'oi');
		debouncer.push('5571999', 'quero agendar');
		debouncer.push('5571999', 'volume russo');

		await vi.advanceTimersByTimeAsync(200);

		expect(results).toHaveLength(1);
		expect(results[0]?.text).toBe('oi\n\nquero agendar\n\nvolume russo');
	});

	it('isolates different phone numbers', async () => {
		debouncer.push('5571111', 'msg A');
		debouncer.push('5571222', 'msg B');

		await vi.advanceTimersByTimeAsync(200);

		expect(results).toHaveLength(2);
		const phones = results.map((r) => r.telefone).sort();
		expect(phones).toEqual(['5571111', '5571222']);
	});

	it('resets timer on new message within window', async () => {
		debouncer.push('5571999', 'first');
		await vi.advanceTimersByTimeAsync(50);
		debouncer.push('5571999', 'second');

		// At 100ms total, shouldn't have fired (timer was reset at 50ms)
		await vi.advanceTimersByTimeAsync(60);
		expect(results).toHaveLength(0);

		// At 200ms, should have fired
		await vi.advanceTimersByTimeAsync(100);
		expect(results).toHaveLength(1);
		expect(results[0]?.text).toBe('first\n\nsecond');
	});

	it('flushAll forces all pending', async () => {
		debouncer.push('5571999', 'test');
		expect(debouncer.pendingCount).toBe(1);
		await debouncer.flushAll();
		expect(results).toHaveLength(1);
		expect(debouncer.pendingCount).toBe(0);
	});
});
