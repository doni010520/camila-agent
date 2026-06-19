/**
 * Configuração global do pool HTTP (undici) — corrige a causa raiz do
 * "Invalid response body... Premature close" recorrente nas chamadas à
 * OpenAI.
 *
 * ── O problema ──
 * O fetch nativo do Node 22 usa undici e mantém um POOL de conexões TCP
 * keep-alive com cada host (api.openai.com etc) pra economizar handshake.
 * Quando a Helena fica algum tempo sem falar com a OpenAI, esses sockets
 * ficam ociosos. A OpenAI (e a Cloudflare na frente dela) FECHA conexões
 * ociosas depois de ~30-60s. O Node não percebe, e na próxima chamada
 * reusa um socket que o servidor já considera morto → a resposta chega
 * incompleta → "Premature close". O retry resolve "depois", mas a 1ª
 * cliente recebe o fallback.
 *
 * ── A correção ──
 * Encurtamos NÓS o tempo de vida dos sockets ociosos pra MENOS do que o
 * servidor remoto fecharia. Assim o socket é descartado pelo nosso lado
 * antes de virar zumbi. Em troca, fazemos handshake TCP/TLS um pouco
 * mais vezes (~ms de overhead) — pagamento barato pra eliminar o erro.
 *
 * Setting global → afeta TODO `fetch()` do app (OpenAI, Trinks, UAZAPI,
 * Supabase). Todos esses APIs ficam atrás de CDNs com comportamento
 * parecido, então beneficia todos.
 */
import { Agent, setGlobalDispatcher } from 'undici';
import { rootLogger } from './logger.js';

/** Tempo de vida MÁXIMO de um socket keep-alive ocioso (ms). Tem que ser
 *  bem menor que o que servidores remotos costumam usar (30-60s). */
const KEEP_ALIVE_TIMEOUT_MS = 10_000;

/** Tempo máximo absoluto de keep-alive (teto pra header Keep-Alive do
 *  servidor). Curto pra forçar reciclagem em conexões muito antigas. */
const KEEP_ALIVE_MAX_TIMEOUT_MS = 30_000;

/** Margem subtraída do timeout que o servidor anuncia (header Keep-Alive).
 *  Se servidor diz "60s", undici fecha em 60-5=55s. Defesa adicional. */
const KEEP_ALIVE_TIMEOUT_THRESHOLD_MS = 5_000;

/** Timeout pra estabelecer a conexão TCP/TLS (não a resposta). */
const CONNECT_TIMEOUT_MS = 15_000;

/** Timeout pra esperar a primeira resposta após enviar headers. */
const HEADERS_TIMEOUT_MS = 60_000;

/** Timeout pra ler o corpo da resposta. */
const BODY_TIMEOUT_MS = 60_000;

let configured = false;

/** Configura o dispatcher global do undici. Idempotente. */
export function configureHttpPool(): void {
	if (configured) return;
	configured = true;

	const agent = new Agent({
		keepAliveTimeout: KEEP_ALIVE_TIMEOUT_MS,
		keepAliveMaxTimeout: KEEP_ALIVE_MAX_TIMEOUT_MS,
		keepAliveTimeoutThreshold: KEEP_ALIVE_TIMEOUT_THRESHOLD_MS,
		connect: { timeout: CONNECT_TIMEOUT_MS },
		headersTimeout: HEADERS_TIMEOUT_MS,
		bodyTimeout: BODY_TIMEOUT_MS,
	});

	setGlobalDispatcher(agent);

	rootLogger.info(
		{
			keepAliveTimeoutMs: KEEP_ALIVE_TIMEOUT_MS,
			keepAliveMaxTimeoutMs: KEEP_ALIVE_MAX_TIMEOUT_MS,
			connectTimeoutMs: CONNECT_TIMEOUT_MS,
		},
		'HTTP pool configured (fix Premature close)',
	);
}
