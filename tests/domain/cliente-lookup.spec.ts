import { describe, expect, it, vi } from 'vitest';
import { findClienteByTelefone } from '../../src/domain/cliente-lookup.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});

const CLIENTE = {
	id: 79761206,
	nome: 'Maria',
	telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }],
};

function makeDeps(overrides?: {
	e164Result?: unknown[];
	dddNumResult?: unknown[];
	numeroResult?: unknown[];
	pgResult?: unknown;
}) {
	const trinks = {
		listClientes: vi.fn().mockImplementation(async (filters: { telefone: string }) => {
			if (filters.telefone === '5571999999999') return { data: overrides?.e164Result ?? [] };
			if (filters.telefone === '71999999999') return { data: overrides?.dddNumResult ?? [] };
			if (filters.telefone === '999999999') return { data: overrides?.numeroResult ?? [] };
			return { data: [] };
		}),
		getCliente: vi.fn().mockResolvedValue(CLIENTE),
	};
	const postgres = {
		findClienteByPhone: vi.fn().mockResolvedValue(overrides?.pgResult ?? null),
	};
	return { trinks: trinks as never, postgres: postgres as never, trinksRaw: trinks };
}

describe('findClienteByTelefone', () => {
	it('finds by E.164 (strategy 1)', async () => {
		const deps = makeDeps({ e164Result: [CLIENTE] });
		const r = await findClienteByTelefone('5571999999999', deps);
		expect(r?.strategy).toBe('e164');
		expect(r?.cliente.id).toBe(79761206);
	});

	it('falls back to DDD+numero (strategy 2) when E.164 fails', async () => {
		const deps = makeDeps({ dddNumResult: [CLIENTE] });
		const r = await findClienteByTelefone('5571999999999', deps);
		expect(['ddd_numero','numero_only']).toContain(r?.strategy);
	});

	it('falls back to numero only (strategy 3) when DDD+numero fails', async () => {
		const deps = makeDeps({ numeroResult: [CLIENTE] });
		const r = await findClienteByTelefone('5571999999999', deps);
		expect(['ddd_numero','numero_only']).toContain(r?.strategy);
	});

	it('falls back to Postgres last-8 → Trinks getCliente (strategy 4)', async () => {
		const deps = makeDeps({
			pgResult: { id: 79761206, nome: 'Maria', email: null, telefone: '71999999999' },
		});
		const r = await findClienteByTelefone('5571999999999', deps);
		expect(r?.strategy).toBe('postgres_cache');
		expect(r?.cliente.id).toBe(79761206);
	});

	it('returns null when all strategies fail', async () => {
		const deps = makeDeps();
		const r = await findClienteByTelefone('5571999999999', deps);
		expect(r).toBeNull();
	});

	it('returns null for invalid phone', async () => {
		const deps = makeDeps();
		const r = await findClienteByTelefone('123', deps);
		expect(r).toBeNull();
	});
});
