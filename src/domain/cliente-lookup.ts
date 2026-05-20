import type { PostgresClient } from '../clients/postgres.js';
import type { TrinksClient, TrinksCliente } from '../clients/trinks.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';
import { parsePhone } from './telefone.js';

/**
 * Finds a Trinks cliente by phone using a fast-path cascade.
 *
 * Strategy (order matters — fastest first):
 * 0. Postgres `clientes` local cache by last 8 digits — fastest (~10ms)
 * 1. Trinks: full E.164 ("5571999999999")
 * 2. Trinks: DDD+numero ("71999999999")
 * 3. Trinks: numero only ("999999999")
 */
export interface ClienteLookupResult {
	cliente: TrinksCliente;
	strategy: 'postgres_cache' | 'e164' | 'ddd_numero' | 'numero_only';
}

export interface ClienteLookupDeps {
	trinks: TrinksClient;
	postgres: PostgresClient;
	logger?: Logger;
}

export async function findClienteByTelefone(
	telefone: string,
	deps: ClienteLookupDeps,
): Promise<ClienteLookupResult | null> {
	const log = deps.logger ?? rootLogger.child({ module: 'cliente-lookup' });
	const parts = parsePhone(telefone);
	if (!parts) {
		log.warn({ telefone: telefone.slice(-8) }, 'Invalid phone for lookup');
		return null;
	}

	// Strategy 0: local Postgres cache (table `clientes`, 379+ rows synced from Trinks)
	// This avoids 3 sequential Trinks API calls (each with retry) when cliente already
	// known locally. Falls through to Trinks only on cache miss.
	const pgResult = await deps.postgres.findClienteByPhone(parts.last8);
	if (pgResult) {
		try {
			const trinksCliente = await deps.trinks.getCliente(pgResult.id);
			log.debug({ strategy: 'postgres_cache', clienteId: pgResult.id }, 'Found via local cache');
			return { cliente: trinksCliente, strategy: 'postgres_cache' };
		} catch {
			// Local cache is stale — fall through to Trinks search
			log.warn({ pgClienteId: pgResult.id }, 'Local cache hit but Trinks getCliente failed');
		}
	}

	// Strategy 1: full E.164 ("5571999999999")
	const byE164 = await deps.trinks.listClientes({ telefone: parts.e164 });
	if (byE164.data.length > 0 && byE164.data[0]) {
		log.debug({ strategy: 'e164', clienteId: byE164.data[0].id }, 'Found by E.164');
		return { cliente: byE164.data[0], strategy: 'e164' };
	}

	// Strategy 2: DDD+numero ("71999999999")
	const dddNumero = `${parts.ddd}${parts.numero}`;
	const byDddNum = await deps.trinks.listClientes({ telefone: dddNumero });
	if (byDddNum.data.length > 0 && byDddNum.data[0]) {
		log.debug({ strategy: 'ddd_numero', clienteId: byDddNum.data[0].id }, 'Found by DDD+numero');
		return { cliente: byDddNum.data[0], strategy: 'ddd_numero' };
	}

	// Strategy 3: numero only ("999999999")
	const byNumero = await deps.trinks.listClientes({ telefone: parts.numero });
	if (byNumero.data.length > 0 && byNumero.data[0]) {
		log.debug({ strategy: 'numero_only', clienteId: byNumero.data[0].id }, 'Found by numero only');
		return { cliente: byNumero.data[0], strategy: 'numero_only' };
	}

	log.info({ telefone: telefone.slice(-8) }, 'Cliente not found in any strategy');
	return null;
}
