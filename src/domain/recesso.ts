/**
 * Modo recesso da Camila.
 *
 * Durante o período configurado (HELENA_RECESSO_INICIO/FIM), a Helena CONTINUA
 * ATENDENDO normalmente (conversa, dúvidas, catálogo, preços). O que ela NÃO
 * pode é:
 *  - agendar para datas DENTRO do recesso (a Camila não atende esses dias);
 *  - oferecer encaixe / chamar a Camila para essas datas.
 *
 * O bloqueio é pela DATA DO AGENDAMENTO (dataEstaNoRecesso), não pela data da
 * conversa. Separadamente, se a cliente quiser falar com a Camila DURANTE o
 * recesso, a Helena informa o recesso (estaEmRecesso(hoje)).
 */
import { getEnv } from '../infra/env.js';
import { addDaysBRT, todayBRT } from './data-brt.js';

export function getRecesso(): { inicio: string; fim: string } | null {
	const env = getEnv();
	if (!env.HELENA_RECESSO_INICIO || !env.HELENA_RECESSO_FIM) return null;
	return { inicio: env.HELENA_RECESSO_INICIO, fim: env.HELENA_RECESSO_FIM };
}

/** True se a data (YYYY-MM-DD ou ISO) cai DENTRO do recesso — usado pra
 *  bloquear agendamentos/encaixes nesses dias. */
export function dataEstaNoRecesso(dataISO: string): boolean {
	const r = getRecesso();
	if (!r) return false;
	const dia = (dataISO ?? '').slice(0, 10); // YYYY-MM-DD
	if (dia.length !== 10) return false;
	return dia >= r.inicio && dia <= r.fim;
}

/** True se HOJE (BRT) está dentro do recesso — usado pra mensagem ao pedir
 *  falar com a Camila durante o período. */
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
 * quando ele já passou. A Helena atende normal — só não agenda nas datas do
 * recesso.
 */
export function recessoInfoParaPrompt(hoje: string = todayBRT()): string {
	const r = getRecesso();
	if (!r) return '';
	if (hoje > r.fim) return ''; // recesso já passou
	const retorno = dataRetornoRecesso();
	return [
		`## ⚠️ Recesso da Camila (${ddmm(r.inicio)} a ${ddmm(r.fim)})`,
		'',
		`A Camila estará de recesso de ${ddmm(r.inicio)} a ${ddmm(r.fim)} e retorna no dia ${retorno}.`,
		'',
		'VOCÊ CONTINUA ATENDENDO NORMALMENTE nesse período — conversa, tira dúvidas,',
		'manda catálogo, informa preços e agenda para datas FORA do recesso.',
		'',
		'O que você NÃO pode:',
		`- **NÃO agende para nenhum dia entre ${ddmm(r.inicio)} e ${ddmm(r.fim)}.** A Camila não atende`,
		`  esses dias. Se a cliente pedir uma dessas datas, explique com carinho que a`,
		`  Camila estará de recesso e ofereça agendar a partir de ${retorno}.`,
		'- **NÃO ofereça encaixe nem diga que vai chamar a Camila** para essas datas.',
		`- Se a cliente quiser falar com a Camila pessoalmente, informe que ela está de`,
		`  recesso e retorna ${retorno}.`,
	].join('\n');
}
