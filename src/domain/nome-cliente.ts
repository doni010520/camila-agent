/**
 * Validação do nome vindo do perfil do WhatsApp (wa_name / pushName).
 *
 * O pushName é o que a PRÓPRIA pessoa configura no WhatsApp — muitas vezes NÃO
 * é um nome de pessoa: profissão ("manicure"), negócio ("Studio Camila"),
 * apelido, número ou emoji. Salvar isso como nome faz a Helena chamar a cliente
 * de "manicure". Esta função filtra o que claramente NÃO é um primeiro nome de
 * pessoa — nesses casos o nome fica vazio e a Helena pergunta o nome real.
 *
 * É conservadora: só rejeita o que é claramente não-nome. Casos ambíguos
 * passam e o LLM decide (o prompt instrui a perguntar quando não parece nome).
 */

/** Termos comuns que NÃO são nome de pessoa (contexto salão/serviços). */
const TERMOS_NAO_NOME = new Set([
	'manicure',
	'pedicure',
	'salao',
	'studio',
	'estudio',
	'atelie',
	'cliente',
	'atendimento',
	'contato',
	'sac',
	'loja',
	'boutique',
	'esteticista',
	'designer',
	'cabeleireira',
	'cabeleireiro',
	'depiladora',
	'lash',
	'nails',
	'nail',
	'beauty',
	'makeup',
	'maquiadora',
	'sobrancelha',
	'sobrancelhas',
]);

function norm(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.trim();
}

/**
 * True se o nome do perfil parece um nome de pessoa utilizável. False pra
 * profissões/negócios/números/emojis/genéricos — nesses casos não usamos.
 */
export function nomeParecePessoa(nome: string | undefined | null): boolean {
	if (!nome) return false;
	const raw = nome.trim();
	if (raw.length < 2) return false;
	if (raw.length > 40) return false; // nomes de negócio/frases

	// Remove emojis/símbolos pra ver o que sobra de texto real.
	const semEmoji = raw.replace(/[\p{Extended_Pictographic}‍️]/gu, '').trim();
	if (semEmoji.length < 2) return false; // era só emoji

	const n = norm(semEmoji);

	// Contém dígito → provavelmente não é nome ("Loja 2", "Cílios 24h").
	if (/\d/.test(n)) return false;

	// Alguma palavra é um termo claramente não-nome.
	const palavras = n.split(/\s+/).filter(Boolean);
	if (palavras.some((p) => TERMOS_NAO_NOME.has(p))) return false;

	// Precisa ter ao menos uma letra.
	if (!/[a-z]/.test(n)) return false;

	return true;
}

/** Retorna o nome se parecer de pessoa, senão undefined (Helena vai perguntar). */
export function nomeUtilizavel(nome: string | undefined | null): string | undefined {
	return nomeParecePessoa(nome) ? (nome ?? undefined)?.trim() : undefined;
}
