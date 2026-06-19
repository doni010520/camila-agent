/**
 * Lista de números bloqueados pra agendamento.
 *
 * Pra esses telefones a Helena conversa normalmente (catálogo, preços), mas
 * SEMPRE diz que não há vagas e NUNCA oferece encaixe nem avisa a Camila.
 * Reproduz o filtro que existia no workflow antigo do n8n.
 *
 * Configurado via env HELENA_NUMEROS_BLOQUEADOS (CSV). Comparação pelos
 * últimos 8 dígitos — robusto a variações de DDI/DDD/9º dígito.
 */
import { getEnv } from '../infra/env.js';

/** Últimos 8 dígitos do telefone (só dígitos). '' se não der pra extrair. */
function ultimos8(telefone: string): string {
	const digits = (telefone ?? '').replace(/\D/g, '');
	return digits.length >= 8 ? digits.slice(-8) : '';
}

/** Conjunto (últimos 8 dígitos) dos números bloqueados, lido do env. */
function bloqueadosSet(): Set<string> {
	const raw = getEnv().HELENA_NUMEROS_BLOQUEADOS ?? '';
	const set = new Set<string>();
	for (const parte of raw.split(/[,;\s]+/)) {
		const k = ultimos8(parte);
		if (k) set.add(k);
	}
	return set;
}

/** True se o telefone está na lista de bloqueados (sempre "sem vagas"). */
export function isNumeroBloqueado(telefone: string | undefined): boolean {
	if (!telefone) return false;
	const k = ultimos8(telefone);
	if (!k) return false;
	return bloqueadosSet().has(k);
}
