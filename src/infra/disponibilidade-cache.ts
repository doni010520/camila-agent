/**
 * Cache in-process curto pra disponibilidade da agenda (listProfissionaisComAgenda).
 *
 * Motivo: a busca de disponibilidade varre vários dias (14) fazendo um GET por
 * dia em /agendamentos/profissionais/{data}. Sem cache, várias clientes
 * consultando ao mesmo tempo (ou a mesma cliente reconsultando) multiplicam as
 * chamadas e estouram o rate limit da Trinks (HTTP 429).
 *
 * TTL curto (45s) é seguro pra OFERTA de horários — se um slot ofertado já foi
 * ocupado no intervalo, o criar_agendamento (que NÃO usa cache, valida fresh +
 * lock + verify-after-write) recusa na hora. O cache nunca é usado no caminho
 * de criação, só na consulta/oferta.
 */
import type { TrinksClient, TrinksProfissionalAgenda } from '../clients/trinks.js';

const TTL_MS = 45_000;
const cache = new Map<string, { at: number; data: TrinksProfissionalAgenda[] }>();

/** Busca a agenda do dia, servindo do cache se ainda fresco. NUNCA usar no
 *  caminho de criação de agendamento — só pra consulta/oferta. */
export async function getAgendaDoDiaCached(
	trinks: TrinksClient,
	data: string,
	nowMs: number = Date.now(),
): Promise<TrinksProfissionalAgenda[]> {
	const hit = cache.get(data);
	if (hit && nowMs - hit.at < TTL_MS) return hit.data;
	const resp = await trinks.listProfissionaisComAgenda(data);
	cache.set(data, { at: nowMs, data: resp.data });
	return resp.data;
}

/** Para tests. */
export function _resetDisponibilidadeCache(): void {
	cache.clear();
}
