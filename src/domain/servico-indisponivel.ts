/**
 * Allowlist de serviços que a Helena pode oferecer/agendar.
 *
 * O estabelecimento da Camila tem, na Trinks, serviços de OUTROS profissionais
 * (sobrancelha, micropigmentação, unhas, massagem, depilação, limpeza de pele)
 * que a Helena NÃO deve oferecer — a Camila é lash designer, só faz cílios.
 *
 * Configurado por HELENA_SERVICOS_PERMITIDOS (CSV de palavras-chave). Um serviço
 * é "indisponível" (não oferecido/agendado) se NÃO casa nenhuma palavra da
 * allowlist. Casa por substring, sem acento/caixa. Allowlist vazia = tudo
 * liberado (comportamento antigo). Pra reativar um serviço, adicione uma
 * palavra que case o nome dele.
 */
import { getEnv } from '../infra/env.js';

function norm(s: string): string {
	return (s ?? '')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim();
}

/** Palavras-chave normalizadas dos serviços permitidos (do env). */
function permitidos(): string[] {
	const raw = getEnv().HELENA_SERVICOS_PERMITIDOS ?? '';
	return raw
		.split(',')
		.map((k) => norm(k))
		.filter((k) => k.length > 0);
}

/** True se o serviço NÃO é oferecido pela Helena (não é da Camila). Quando a
 *  allowlist está vazia, nada é indisponível. */
export function servicoIndisponivel(nomeServico: string): boolean {
	const perms = permitidos();
	if (perms.length === 0) return false; // sem allowlist → tudo liberado
	const n = norm(nomeServico);
	if (!n) return false;
	return !perms.some((k) => n.includes(k)); // indisponível se não casa nenhuma
}
