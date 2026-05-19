import { describe, expect, it } from 'vitest';
import {
	addDaysBRT,
	dayOfWeekBRT,
	formatDateTimeBRT,
	nowBRT,
	todayBRT,
} from '../../src/domain/data-brt.js';

describe('todayBRT', () => {
	it('returns YYYY-MM-DD format', () => {
		const r = todayBRT(new Date('2026-05-20T15:00:00-03:00'));
		expect(r).toBe('2026-05-20');
	});

	it('🔴 CRITICAL: at 03:00 UTC (= 00:00 BRT) returns the correct BRT date, not next day', () => {
		// 2026-05-21 03:00 UTC = 2026-05-21 00:00 BRT
		const threeAmUtc = new Date('2026-05-21T03:00:00Z');
		const r = todayBRT(threeAmUtc);
		expect(r).toBe('2026-05-21'); // NOT 2026-05-22
	});

	it('🔴 CRITICAL: at 23:59 BRT returns same day (not next UTC day)', () => {
		// 2026-05-20 23:59 BRT = 2026-05-21 02:59 UTC
		const lateNightBrt = new Date('2026-05-21T02:59:00Z');
		const r = todayBRT(lateNightBrt);
		expect(r).toBe('2026-05-20'); // BRT is still May 20th
	});
});

describe('dayOfWeekBRT', () => {
	it('returns correct day for a known date', () => {
		// 2026-05-20 is a Wednesday
		const r = dayOfWeekBRT(new Date('2026-05-20T15:00:00-03:00'));
		expect(r).toBe(3); // Wednesday
	});
});

describe('addDaysBRT', () => {
	it('adds days correctly', () => {
		expect(addDaysBRT('2026-05-20', 3)).toBe('2026-05-23');
	});

	it('handles month boundary', () => {
		expect(addDaysBRT('2026-05-30', 3)).toBe('2026-06-02');
	});
});

describe('formatDateTimeBRT', () => {
	it('formats datetime in PT-BR with day of week', () => {
		const r = formatDateTimeBRT('2026-05-20T14:00:00');
		expect(r).toContain('20/05');
		expect(r).toContain('14:00');
	});
});

describe('nowBRT', () => {
	it('returns formatted string with weekday', () => {
		const r = nowBRT(new Date('2026-05-20T15:00:00-03:00'));
		expect(r).toContain('2026');
		expect(r).toContain('20');
	});
});
