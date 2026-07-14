/**
 * Serviços temporariamente indisponíveis (ex: studio sem profissional).
 *
 * A Helena não oferece (some da tabela de preços do prompt) nem agenda esses
 * serviços. Configurado por HELENA_SERVICOS_INDISPONIVEIS (CSV de palavras-
 * chave). Casa por substring, sem acento/caixa. Pra reativar, setar a env
 * vazia no Easypanel.
 */
import { getEnv } from '../infra/env.js';

function norm(s: string): string {
	return (s ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim();
}

/** Palavras-chave normalizadas dos serviços indisponíveis (do env). */
function keywords(): string[] {
	const raw = getEnv().HELENA_SERVICOS_INDISPONIVEIS ?? '';
	return raw
		.split(',')
		.map((k) => norm(k))
		.filter((k) => k.length > 0);
}

/** True se o nome do serviço casa com alguma palavra-chave indisponível. */
export function servicoIndisponivel(nomeServico: string): boolean {
	const n = norm(nomeServico);
	if (!n) return false;
	return keywords().some((k) => n.includes(k));
}
