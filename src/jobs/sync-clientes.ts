/**
 * Sync Trinks `clientes` → local Postgres `clientes` cache.
 *
 * Why: cliente-lookup.ts e o job de lembrete dependem desse cache pra resolver
 * telefone quando Trinks GET /v1/clientes/{id} retorna `telefones: []` (caso
 * comum em clientes importados via painel sem cadastro de telefone).
 *
 * Estratégia: pagina todo o /v1/clientes (pageSize=200), faz UPSERT em massa
 * por id. Idempotente — pode rodar quantas vezes quiser.
 */
import type { PostgresClient } from '../clients/postgres.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

export interface SyncClientesDeps {
	trinks: TrinksClient;
	postgres: PostgresClient;
	logger?: Logger;
}

export interface SyncClientesResult {
	total: number;
	inseridos: number;
	atualizados: number;
	semTelefone: number;
	erros: number;
}

const PAGE_SIZE = 200;
const MAX_PAGES = 50; // safety cap (10k clientes)

export async function runSyncClientes(deps: SyncClientesDeps): Promise<SyncClientesResult> {
	const log = deps.logger ?? rootLogger.child({ job: 'sync-clientes' });
	log.info('Running sync-clientes');

	let total = 0;
	let inseridos = 0;
	let atualizados = 0;
	let semTelefone = 0;
	let erros = 0;

	for (let page = 1; page <= MAX_PAGES; page++) {
		const result = await deps.trinks.listClientes({ page, pageSize: PAGE_SIZE });
		if (result.data.length === 0) break;

		for (const c of result.data) {
			total++;
			const phone = c.telefones?.[0];
			const telefone = phone
				? `${phone.ddi ?? '55'}${phone.ddd ?? ''}${phone.telefone}`
				: null;
			if (!telefone) semTelefone++;

			try {
				const r = await deps.postgres.upsertCliente({
					id: c.id,
					nome: c.nome,
					email: c.email ?? null,
					telefone,
				});
				if (r === 'inserted') inseridos++;
				else atualizados++;
			} catch (err) {
				erros++;
				log.warn({ id: c.id, err: err instanceof Error ? err.message : 'unknown' }, 'Upsert failed');
			}
		}

		// Se a página veio com menos que PAGE_SIZE, é a última
		if (result.data.length < PAGE_SIZE) break;
	}

	log.info({ total, inseridos, atualizados, semTelefone, erros }, 'Sync-clientes complete');
	return { total, inseridos, atualizados, semTelefone, erros };
}
