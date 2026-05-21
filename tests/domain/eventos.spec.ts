import { describe, expect, it, vi } from 'vitest';
import { registrarEvento } from '../../src/domain/eventos.js';
import type { AppSupabaseClient } from '../../src/clients/supabase.js';

function makeSupabase(overrides?: { insertError?: string; throws?: boolean }) {
	const insert = overrides?.throws
		? vi.fn().mockRejectedValue(new Error('network error'))
		: vi.fn().mockResolvedValue({
				data: null,
				error: overrides?.insertError ? { message: overrides.insertError } : null,
			});
	return {
		raw: {
			from: vi.fn().mockReturnValue({ insert }),
		},
		_insert: insert,
	} as unknown as AppSupabaseClient & { _insert: ReturnType<typeof vi.fn> };
}

describe('registrarEvento', () => {
	it('inserts with correct defaults (sucesso=true, detalhes={})', async () => {
		const sb = makeSupabase();
		await registrarEvento(sb, { tipo: 'mensagem_recebida' });
		expect(sb._insert).toHaveBeenCalledWith(
			expect.objectContaining({ tipo: 'mensagem_recebida', sucesso: true, detalhes: {} }),
		);
	});

	it('inserts all fields when provided', async () => {
		const sb = makeSupabase();
		await registrarEvento(sb, {
			telefone: '5571999999999',
			tipo: 'agendamento_criado',
			detalhes: { tool: 'criar_agendamento' },
			sucesso: true,
			cliente_nome: 'Maria',
			valor: 150,
		});
		expect(sb._insert).toHaveBeenCalledWith({
			telefone: '5571999999999',
			tipo: 'agendamento_criado',
			detalhes: { tool: 'criar_agendamento' },
			sucesso: true,
			cliente_nome: 'Maria',
			valor: 150,
		});
	});

	it('does not throw when Supabase returns an error', async () => {
		const sb = makeSupabase({ insertError: 'relation does not exist' });
		await expect(registrarEvento(sb, { tipo: 'erro_tool' })).resolves.toBeUndefined();
	});

	it('does not throw when Supabase throws a network error', async () => {
		const sb = makeSupabase({ throws: true });
		await expect(registrarEvento(sb, { tipo: 'pix_enviado' })).resolves.toBeUndefined();
	});

	it('maps null telefone when not provided', async () => {
		const sb = makeSupabase();
		await registrarEvento(sb, { tipo: 'mensagem_recebida' });
		expect(sb._insert).toHaveBeenCalledWith(expect.objectContaining({ telefone: null }));
	});
});
