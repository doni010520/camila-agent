import { describe, expect, it } from 'vitest';
import { chatidToE164, getLast8, parsePhone } from '../../src/domain/telefone.js';

describe('parsePhone', () => {
	it('parses full E.164: 5571999999999', () => {
		const r = parsePhone('5571999999999');
		expect(r).toEqual({
			e164: '5571999999999',
			ddi: '55',
			ddd: '71',
			numero: '999999999',
			last8: '99999999',
		});
	});

	it('parses with DDD only: 71999999999', () => {
		const r = parsePhone('71999999999');
		expect(r?.e164).toBe('5571999999999');
	});

	it('adds 9-digit prefix for 8-digit BA numbers', () => {
		const r = parsePhone('99999999');
		expect(r?.numero).toBe('999999999');
		expect(r?.ddd).toBe('71');
	});

	it('handles formatted: +55 (71) 99999-9999', () => {
		const r = parsePhone('+55 (71) 99999-9999');
		expect(r?.e164).toBe('5571999999999');
	});

	it('returns null for too short', () => {
		expect(parsePhone('1234')).toBeNull();
	});

	it('returns null for empty', () => {
		expect(parsePhone('')).toBeNull();
	});
});

describe('getLast8', () => {
	it('extracts last 8 digits', () => {
		expect(getLast8('5571999999999')).toBe('99999999');
	});

	it('handles formatted number', () => {
		expect(getLast8('+55 (71) 98131-1391')).toBe('81311391');
	});
});

describe('chatidToE164', () => {
	it('strips @s.whatsapp.net', () => {
		expect(chatidToE164('5571999999999@s.whatsapp.net')).toBe('5571999999999');
	});
});
