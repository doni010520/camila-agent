import type { PostgresClient } from '../clients/postgres.js';
import type { TrinksClient, TrinksCliente } from '../clients/trinks.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';
import { parsePhone } from './telefone.js';

/**
 * Finds a Trinks cliente by phone using a 3-strategy cascade.
 * This prevents the silent miss that caused the original Iracema ghost bug.
 *
 * Strategy:
 * 1. Search by full E.164 (e.g. "5571999999999")
 * 2. Search by DDD+numero (e.g. "71999999999")
 * 3. Fallback: Postgres lookup by last 8 digits → then Trinks by clienteId
 */
export interface ClienteLookupResult {
	cliente: TrinksCliente;
	strategy: 'e164' | 'ddd_numero' | 'postgres_fallback';
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
		log.debug({ strategy: 'ddd_numero', clienteId: byNumero.data[0].id }, 'Found by numero only');
		return { cliente: byNumero.data[0], strategy: 'ddd_numero' };
	}

	// Strategy 4: Postgres fallback by last 8 digits
	const pgResult = await deps.postgres.findClienteByPhone(parts.last8);
	if (pgResult) {
		// We found it in our local DB — now try Trinks by ID
		try {
			const trinksCliente = await deps.trinks.getCliente(pgResult.id);
			log.info(
				{ strategy: 'postgres_fallback', clienteId: pgResult.id },
				'Found via Postgres fallback',
			);
			return { cliente: trinksCliente, strategy: 'postgres_fallback' };
		} catch {
			log.warn(
				{ pgClienteId: pgResult.id },
				'Postgres fallback found ID but Trinks getCliente failed',
			);
		}
	}

	log.info({ telefone: telefone.slice(-8) }, 'Cliente not found in any strategy');
	return null;
}
