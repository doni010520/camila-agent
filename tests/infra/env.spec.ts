import { describe, expect, it } from 'vitest';
import { setTestEnv } from '../../src/infra/env.js';

describe('env boolean parsing', () => {
	it('TRINKS_DRY_RUN="false" parses as false (not true)', () => {
		const env = setTestEnv({ TRINKS_DRY_RUN: 'false' } as never);
		expect(env.TRINKS_DRY_RUN).toBe(false);
	});

	it('TRINKS_DRY_RUN="true" parses as true', () => {
		const env = setTestEnv({ TRINKS_DRY_RUN: 'true' } as never);
		expect(env.TRINKS_DRY_RUN).toBe(true);
	});

	it('TRINKS_DRY_RUN="0" parses as false', () => {
		const env = setTestEnv({ TRINKS_DRY_RUN: '0' } as never);
		expect(env.TRINKS_DRY_RUN).toBe(false);
	});

	it('TRINKS_DRY_RUN="1" parses as true', () => {
		const env = setTestEnv({ TRINKS_DRY_RUN: '1' } as never);
		expect(env.TRINKS_DRY_RUN).toBe(true);
	});

	it('UAZAPI_DRY_RUN="false" parses as false', () => {
		const env = setTestEnv({ UAZAPI_DRY_RUN: 'false' } as never);
		expect(env.UAZAPI_DRY_RUN).toBe(false);
	});

	it('UAZAPI_DRY_RUN="true" parses as true', () => {
		const env = setTestEnv({ UAZAPI_DRY_RUN: 'true' } as never);
		expect(env.UAZAPI_DRY_RUN).toBe(true);
	});

	it('defaults to false when not set', () => {
		const env = setTestEnv({});
		expect(env.TRINKS_DRY_RUN).toBe(false);
		expect(env.UAZAPI_DRY_RUN).toBe(false);
	});
});
