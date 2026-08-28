import { beforeEach, describe, expect, it } from 'vitest';
import type { LeadCamilaRow } from '../../src/clients/supabase.js';
import { LeadManager } from '../../src/domain/lead.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({});

/**
 * Regressão de produção (28/08/2026).
 *
 * O WhatsApp entrega o número SEM o 9º dígito e a Trinks guarda COM:
 *   lead (chatid)  557192083199
 *   Trinks         5571992083199
 *
 * Medido no banco: casando exato, 6 de 216 leads batem (2,8%). Casando pelos
 * últimos 8 dígitos, 128 de 237. Como o `finalizar_sim` gravava o metadata da
 * manutenção com `.eq('telefone', <número da Trinks>)`, o UPDATE não achava
 * linha nenhuma — e o `manutencao_sim`, que lê pelo número do WhatsApp,
 * encontrava metadata vazio e respondia "Tive um probleminha ao confirmar".
 */

/** Fake mínimo do PostgREST: só o que o LeadManager usa. Guarda as linhas de
 *  verdade pra o teste medir comportamento, não chamada de mock. */
function fakeSupabase(rows: LeadCamilaRow[]) {
	const campo = (r: LeadCamilaRow, col: string) =>
		String((r as unknown as Record<string, unknown>)[col] ?? '');

	const consulta = (filtro: (r: LeadCamilaRow) => boolean) => ({
		eq: (col: string, val: unknown) => consulta((r) => filtro(r) && campo(r, col) === String(val)),
		like: (col: string, val: string) => {
			const sufixo = val.replace(/^%/, '');
			return consulta((r) => filtro(r) && campo(r, col).endsWith(sufixo));
		},
		maybeSingle: async () => ({ data: rows.find(filtro) ?? null, error: null }),
		limit: async () => ({ data: rows.filter(filtro), error: null }),
	});

	return {
		raw: {
			from: () => ({
				select: () => consulta(() => true),
				update: (patch: Record<string, unknown>) => ({
					eq: async (col: string, val: unknown) => {
						for (const r of rows) if (campo(r, col) === String(val)) Object.assign(r, patch);
						return { error: null };
					},
				}),
			}),
		},
	};
}

function makeLead(telefone: string, metadata: Record<string, unknown> = {}): LeadCamilaRow {
	return {
		id: 'uuid-1',
		telefone,
		nome: 'Stefani',
		created_at: new Date().toISOString(),
		etiquetas: [],
		sinal_pago: false,
		metadata,
	} as LeadCamilaRow;
}

describe('LeadManager: casamento de telefone entre WhatsApp e Trinks', () => {
	let rows: LeadCamilaRow[];
	let manager: LeadManager;

	beforeEach(() => {
		rows = [makeLead('557192083199', { ia_off_since: '2026-08-01T10:00:00Z' })];
		manager = new LeadManager(fakeSupabase(rows) as never);
	});

	it('acha o lead do WhatsApp usando o número da Trinks (com 9º dígito)', async () => {
		const lead = await manager.findByTelefoneFlex('5571992083199');

		expect(lead?.telefone).toBe('557192083199');
	});

	it('grava a manutenção no lead certo mesmo vindo no formato da Trinks', async () => {
		const ok = await manager.mergeMetadata('5571992083199', {
			proxima_manutencao_servico: 'Manutenção volume light 15 dias',
		});

		expect(ok).toBe(true);
		expect(rows[0]?.metadata.proxima_manutencao_servico).toBe('Manutenção volume light 15 dias');
	});

	it('não apaga o metadata que já existia ao gravar a manutenção', async () => {
		await manager.mergeMetadata('5571992083199', { proxima_manutencao_data: '2026-09-11T14:00' });

		// ia_off_since controla o TTL de reativação da IA — perder isso deixa a
		// cliente com a Helena desligada pra sempre.
		expect(rows[0]?.metadata.ia_off_since).toBe('2026-08-01T10:00:00Z');
	});
});
