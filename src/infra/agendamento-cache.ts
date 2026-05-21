/**
 * Cache in-process de agendamentos recém-criados.
 *
 * Por quê: a Trinks GET após POST tem eventual consistency — um agendamento
 * criado às 10:11 pode não aparecer em listAgendamentos às 10:16. Isso causa
 * idempotency failure (criar_agendamento cria duplicata).
 *
 * Esse cache resolve dentro do mesmo processo (Easypanel é single-instance).
 * Em deploy/restart o cache zera, mas a janela de risco real é só 1-15 min
 * após uma criação — improvável coincidir com restart.
 */

const TTL_MS = 15 * 60 * 1000; // 15 min
const MAX_ENTRIES = 1000;

interface Entry {
	id: number;
	expiresAt: number;
}

const cache = new Map<string, Entry>();

function chave(telefone: string, dataHora: string): string {
	// substring(0,16) = "YYYY-MM-DDTHH:MM" — ignora segundos e timezone suffix
	return `${telefone}:${dataHora.slice(0, 16)}`;
}

export function getCachedAgendamento(telefone: string, dataHora: string): number | null {
	const e = cache.get(chave(telefone, dataHora));
	if (!e) return null;
	if (Date.now() > e.expiresAt) {
		cache.delete(chave(telefone, dataHora));
		return null;
	}
	return e.id;
}

export function rememberAgendamento(telefone: string, dataHora: string, id: number): void {
	cache.set(chave(telefone, dataHora), { id, expiresAt: Date.now() + TTL_MS });

	// housekeeping: se passou de MAX_ENTRIES, purga expirados
	if (cache.size > MAX_ENTRIES) {
		const now = Date.now();
		for (const [k, v] of cache.entries()) {
			if (now > v.expiresAt) cache.delete(k);
		}
	}
}

/** Para tests. */
export function _resetAgendamentoCache(): void {
	cache.clear();
}
