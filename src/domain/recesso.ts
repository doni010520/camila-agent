/**
 * Modo recesso da Camila.
 *
 * Durante o período configurado (HELENA_RECESSO_INICIO/FIM), quando a cliente
 * pede pra falar com a Camila, a Helena informa que ela está de recesso e que
 * retornará pra falar pessoalmente — em vez de transferir e desativar a IA.
 * O pedido ainda é registrado (notificar_time) pra Camila ter a lista de quem
 * a procurou e retornar quando voltar.
 */
import { getEnv } from '../infra/env.js';
import { addDaysBRT, todayBRT } from './data-brt.js';

export function getRecesso(): { inicio: string; fim: string } | null {
	const env = getEnv();
	if (!env.HELENA_RECESSO_INICIO || !env.HELENA_RECESSO_FIM) return null;
	return { inicio: env.HELENA_RECESSO_INICIO, fim: env.HELENA_RECESSO_FIM };
}

/** True se hoje (BRT) está dentro do período de recesso (inclusivo). */
export function estaEmRecesso(hoje: string = todayBRT()): boolean {
	const r = getRecesso();
	if (!r) return false;
	return hoje >= r.inicio && hoje <= r.fim;
}

/** DD/MM a partir de YYYY-MM-DD. */
function ddmm(iso: string): string {
	const [, m, d] = iso.split('-');
	return `${d}/${m}`;
}

/** Data de retorno (dia seguinte ao fim do recesso), formato DD/MM. */
export function dataRetornoRecesso(): string | null {
	const r = getRecesso();
	if (!r) return null;
	return ddmm(addDaysBRT(r.fim, 1));
}

/**
 * Bloco de instrução pro prompt. Vazio quando não há recesso configurado ou
 * quando ele já passou. Aparece quando estamos DENTRO do recesso (ou nos dias
 * próximos, pra avisar com antecedência).
 */
export function recessoInfoParaPrompt(hoje: string = todayBRT()): string {
	const r = getRecesso();
	if (!r) return '';
	if (hoje > r.fim) return ''; // recesso já passou
	const retorno = dataRetornoRecesso();
	const dentro = estaEmRecesso(hoje);
	const estado = dentro
		? `A Camila está DE RECESSO agora (de ${ddmm(r.inicio)} a ${ddmm(r.fim)}).`
		: `A Camila entrará de recesso de ${ddmm(r.inicio)} a ${ddmm(r.fim)}.`;
	return [
		'## ⚠️ Recesso da Camila',
		'',
		estado,
		`Ela retorna no dia ${retorno}.`,
		'',
		'Se a cliente pedir pra falar com a Camila, ou tiver um assunto que só ela',
		'resolve (reclamação, negociação de valor, dúvida pessoal), informe com',
		`carinho que a Camila está de recesso e que, assim que voltar (${retorno}),`,
		'ela mesma vai falar com a pessoa. Pode dizer algo como: "A Camila está de',
		`recesso até ${retorno} 💖 Assim que ela voltar, vai te responder pessoalmente!`,
		'Posso te ajudar em mais alguma coisa por aqui?"',
		'',
		'**NÃO use `transferir_humano` durante o recesso** (não desative a IA).',
		'Em vez disso, registre o pedido chamando `notificar_time` pra Camila ter a',
		'lista de quem a procurou. Continue ajudando normalmente com agendamentos e',
		'dúvidas que você resolve.',
	].join('\n');
}
