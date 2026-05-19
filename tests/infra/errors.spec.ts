import { describe, expect, it } from 'vitest';
import {
	AppError,
	TrinksError,
	UazapiError,
	ValidationError,
	VerifyAfterWriteError,
} from '../../src/infra/errors.js';

describe('AppError', () => {
	it('has statusCode and details', () => {
		const err = new AppError('test', 400, { foo: 'bar' });
		expect(err.statusCode).toBe(400);
		expect(err.details).toEqual({ foo: 'bar' });
		expect(err.isOperational).toBe(true);
	});
});

describe('TrinksError', () => {
	it('prefixes message with Trinks', () => {
		const err = new TrinksError('not found', 404);
		expect(err.message).toContain('Trinks');
		expect(err.statusCode).toBe(404);
	});
});

describe('UazapiError', () => {
	it('prefixes message with UAZAPI', () => {
		const err = new UazapiError('timeout');
		expect(err.message).toContain('UAZAPI');
	});
});

describe('ValidationError', () => {
	it('is status 400', () => {
		const err = new ValidationError('bad input');
		expect(err.statusCode).toBe(400);
	});
});

describe('VerifyAfterWriteError', () => {
	it('includes resource and id in message', () => {
		const err = new VerifyAfterWriteError('agendamento', 123);
		expect(err.message).toContain('agendamento');
		expect(err.message).toContain('123');
		expect(err.statusCode).toBe(502);
	});
});
