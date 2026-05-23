import { Hono } from 'hono';
import { rootLogger } from '../infra/logger.js';
import { runAgent } from '../agent/helena.js';
import type { ToolRegistry } from '../agent/tools/_registry.js';
import type { AppOpenAIClient } from '../clients/openai.js';
import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import { isButtonClick, uazapiWebhookSchema } from '../clients/uazapi.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { MessageDebouncer } from '../domain/debounce.js';
import { registrarEvento } from '../domain/eventos.js';
import { LeadManager } from '../domain/lead.js';
import { MediaRouter } from '../domain/media-router.js';
import { ChatMemory } from '../domain/memory.js';
import { chatidToE164 } from '../domain/telefone.js';
import { createRequestLogger } from '../infra/logger.js';
import { handleButton } from './webhook-button.js';

export interface WebhookDeps {
	openai: AppOpenAIClient;
	uazapi: UazapiClient;
	supabase: AppSupabaseClient;
	postgres: PostgresClient;
	toolRegistry: ToolRegistry;
	trinks: TrinksClient;
}

const TEXT_TYPES = new Set(['conversation', 'extendedTextMessage', 'ephemeralMessage']);
const MEDIA_TYPES = new Set(['audioMessage', 'imageMessage', 'documentMessage']);

/**
 * Extrai URL da mídia do content do UAZAPI.
 * UAZAPI manda URL em posições diferentes conforme a versão:
 *   - content.URL  (uppercase — formato antigo, documentado)
 *   - content.url  (lowercase — observado em produção)
 *   - content.<messageType>.url  (nested dentro do tipo — ex: content.imageMessage.url)
 *   - content (string) — já normalizado antes, mas se escapar chega aqui
 */
function extractMediaUrl(content: unknown, messageType: string): string | undefined {
	if (!content || typeof content !== 'object') return undefined;
	const c = content as Record<string, unknown>;

	// 1. Campo direto: URL ou url
	if (typeof c.URL === 'string' && c.URL) return c.URL;
	if (typeof c.url === 'string' && c.url) return c.url;

	// 2. Nested dentro do messageType (ex: content.imageMessage.url)
	const nested = c[messageType];
	if (nested && typeof nested === 'object') {
		const n = nested as Record<string, unknown>;
		if (typeof n.URL === 'string' && n.URL) return n.URL;
		if (typeof n.url === 'string' && n.url) return n.url;
	}

	return undefined;
}

export function createWebhookMessageRouter(deps: WebhookDeps): Hono {
	const router = new Hono();
	const memory = new ChatMemory(deps.postgres);
	const leadManager = new LeadManager(deps.supabase);
	const mediaRouter = new MediaRouter({ openai: deps.openai, uazapi: deps.uazapi });

	// Set up debouncer
	const debouncer = new MessageDebouncer();
	debouncer.setCallback(async (telefone, combinedText) => {
		const log = createRequestLogger(telefone);
		let nomeCliente: string | undefined;
		try {
			const lead = await leadManager.getOrCreate({ telefone, wa_label: undefined });
			nomeCliente = lead.nome ?? undefined;

			await runAgent(
				{ telefone, mensagem: combinedText, lead },
				{
					openai: deps.openai,
					uazapi: deps.uazapi,
					supabase: deps.supabase,
					memory,
					toolRegistry: deps.toolRegistry,
					logger: log,
				},
			);
		} catch (err) {
			log.error({ err }, 'Agent execution failed');
			// Notifica time DE VERDADE antes de prometer pra cliente. Senão
			// vira anti-fantasma negativo (Helena diz 'chamei a Camila' sem chamar).
			const env = (await import('../infra/env.js')).getEnv();
			const errMsg = err instanceof Error ? err.message : 'unknown';
			try {
				await deps.uazapi.sendText(
					env.UAZAPI_GRUPO_TIME,
					`🚨 *Helena travou*\n\nCliente: ${nomeCliente ?? telefone.slice(-4)}\nErro: ${errMsg.slice(0, 200)}\n\nA cliente recebeu fallback "tive um probleminha". Verificar se precisa intervir.`,
				);
			} catch {
				/* notificação não pode bloquear o fallback pra cliente */
			}
			try {
				await deps.uazapi.sendText(
					telefone,
					'Desculpa, tive um probleminha. Já chamei a Camila 💖',
				);
			} catch {
				/* last resort */
			}
		}
	});

	router.post('/webhook/uazapi/message', async (c) => {
		const rawBody: unknown = await c.req.json();

		// UAZAPI manda payload SEM o wrapper `body:` no formato real.
		// Formato real: {BaseUrl, EventType, chat, message, owner, token}
		// Formato esperado pelo schema antigo (compat): {body: {chat, message}}
		// Normalizamos ambos pra um shape único antes de validar.
		const rawObj = (rawBody && typeof rawBody === 'object' ? (rawBody as Record<string, unknown>) : {});
		const innerBody = (rawObj.body && typeof rawObj.body === 'object' ? rawObj.body : rawObj) as Record<
			string,
			unknown
		>;
		// messageType vem `"Conversation"` em vez de `"conversation"` — minuscula 1ª letra
		const msgObj = (innerBody.message && typeof innerBody.message === 'object'
			? (innerBody.message as Record<string, unknown>)
			: {}) as Record<string, unknown>;
		if (typeof msgObj.messageType === 'string' && msgObj.messageType.length > 0) {
			msgObj.messageType = msgObj.messageType.charAt(0).toLowerCase() + msgObj.messageType.slice(1);
		}
		// UAZAPI manda `content` como string OU objeto. Schema atual aceita só objeto.
		// Para mídia, a string pode ser a própria URL → preserva como {URL: valor}.
		// Para texto puro, descarta pra não quebrar o schema.
		if (typeof msgObj.content === 'string') {
			const mt = typeof msgObj.messageType === 'string' ? msgObj.messageType.toLowerCase() : '';
			if (msgObj.content && (mt.includes('image') || mt.includes('audio') || mt.includes('document'))) {
				msgObj.content = { URL: msgObj.content };
			} else {
				delete msgObj.content;
			}
		}
		const normalized = { body: { chat: innerBody.chat, message: msgObj, token: innerBody.token } };

		const parsed = uazapiWebhookSchema.safeParse(normalized);

		// Log persistente de TODA inbound — antes de validar/filtrar/ignorar.
		// Permite responder "será que a mensagem chegou?" mesmo após restart.
		// Best-effort: nunca quebra o fluxo.
		try {
			const chatid = typeof msgObj.chatid === 'string' ? (msgObj.chatid as string) : null;
			deps.postgres.logWebhookInbound({
				chatid,
				telefone: chatid ? chatid.split('@')[0] ?? null : null,
				message_type: typeof msgObj.messageType === 'string' ? (msgObj.messageType as string) : null,
				text: typeof msgObj.text === 'string' ? (msgObj.text as string) : null,
				from_me: msgObj.fromMe === true,
				was_sent_by_api: msgObj.wasSentByApi === true,
				button_id:
					typeof msgObj.buttonOrListid === 'string' && msgObj.buttonOrListid !== ''
						? (msgObj.buttonOrListid as string)
						: null,
				payload: rawBody,
			}).catch(() => undefined);
		} catch {
			/* never blocks */
		}

		if (!parsed.success) {
			rootLogger.warn(
				{ issues: parsed.error.flatten() },
				'Webhook payload rejected by schema',
			);
			return c.json({ status: 'erro', razao: 'Payload inválido' }, 400);
		}

		const { message } = parsed.data.body;
		const rawChat = parsed.data.body.chat;
		const chat = (rawChat && typeof rawChat === 'object'
			? (rawChat as { wa_name?: unknown; wa_label?: unknown })
			: undefined);
		const waName = typeof chat?.wa_name === 'string' ? chat.wa_name : undefined;
		const waLabel = typeof chat?.wa_label === 'string'
			? chat.wa_label
			: Array.isArray(chat?.wa_label) && typeof chat.wa_label[0] === 'string'
				? (chat.wa_label[0] as string)
				: undefined;

		// ── Mensagens enviadas pela própria API (loop da Helena) → ignora cedo, sem DB ──
		if (message.wasSentByApi) {
			return c.json({ status: 'ok', ignored: 'fromMe' });
		}

		const telefone = chatidToE164(message.chatid);
		if (!telefone || telefone.length < 8) {
			return c.json({ status: 'ok', ignored: 'invalid_phone' });
		}

		const log = createRequestLogger(telefone);

		// ── Humano digitando pela conta business (fromMe=true, wasSentByApi=false) ──
		// Registra intervenção humana → Helena fica calada por 30 min.
		if (message.fromMe) {
			await leadManager.setIntervencaoHumana(telefone).catch((err) =>
				log.warn({ err }, 'setIntervencaoHumana failed — non-blocking'),
			);
			return c.json({ status: 'ok', ignored: 'intervencao_humana' });
		}

		// Check if this is a button click (same endpoint, routed by buttonOrListid)
		if (isButtonClick(message)) {
			log.info({ buttonId: message.buttonOrListid }, 'Button click received');
			// Handle button in background, respond 200 immediately
			handleButton({
				telefone,
				buttonOrListid: message.buttonOrListid,
				deps,
				leadManager,
			}).catch((err) => log.error({ err }, 'Button handler error'));
			return c.json({ status: 'ok', type: 'button' });
		}

		// Get or create lead
		const lead = await leadManager.getOrCreate({
			telefone,
			nome: waName,
			wa_label: waLabel,
		});

		// Extract text early so magic commands can run even with IA desativada.
		const earlyText = (message.text ?? '').trim().toLowerCase();
		const isCommand = earlyText.startsWith('#');

		// Tenta reativar IA automaticamente se passou >24h desde transferir_humano
		if (lead.ia_on_off === 'off' && !isCommand) {
			const reactivated = await leadManager.maybeAutoReactivate(lead, 24);
			if (reactivated) {
				lead.ia_on_off = 'on';
				log.info('IA auto-reativada (TTL 24h)');
			} else {
				log.info('IA disabled for this lead, ignoring');
				return c.json({ status: 'ok', ignored: 'ia_desativada' });
			}
		}

		// ── Intervenção humana recente → Helena fica calada por 30 min ──
		// Comandos #reset/#ia-on continuam funcionando como escape hatch de debug.
		const INTERVENCAO_TTL_MIN = 30;
		const minutosIntervencao = leadManager.minutosDesdeIntervencao(lead);
		if (!isCommand && minutosIntervencao !== null && minutosIntervencao < INTERVENCAO_TTL_MIN) {
			const restante = Math.ceil(INTERVENCAO_TTL_MIN - minutosIntervencao);
			log.info(
				{ minutosDesdeIntervencao: Math.round(minutosIntervencao), restante },
				'Helena pausada por intervenção humana recente',
			);
			return c.json({
				status: 'ok',
				ignored: 'intervencao_humana_recente',
				minutos_restantes: restante,
			});
		}

		// Route by message type
		let text = message.text ?? '';

		if (MEDIA_TYPES.has(message.messageType)) {
			const mediaUrl = extractMediaUrl(message.content, message.messageType);
			if (mediaUrl) {
				try {
					text = await mediaRouter.process(message.messageType, mediaUrl);
				} catch (err) {
					log.error({ err, messageType: message.messageType, mediaUrl: mediaUrl.slice(0, 80) }, 'Media processing failed');
					text = `[Mídia recebida: ${message.messageType}]`;
				}
			} else {
				// Log content keys pra diagnóstico — sem logar valores (pode ter base64)
				const contentKeys = message.content && typeof message.content === 'object'
					? Object.keys(message.content as Record<string, unknown>)
					: ['(empty)'];
				log.warn(
					{ messageType: message.messageType, contentKeys },
					'Media message sem URL no content — verificar formato UAZAPI',
				);
				text = `[Mídia recebida sem URL: ${message.messageType}]`;
			}
		} else if (!TEXT_TYPES.has(message.messageType)) {
			text = `[Mensagem do tipo ${message.messageType} recebida]`;
		}

		if (!text) {
			return c.json({ status: 'ok', ignored: 'empty_text' });
		}

		// Magic commands (não documentados pro público — uso interno de debug)
		const cmd = text.trim().toLowerCase();
		if (cmd === '#reset') {
			try {
				const deleted = await memory.clear(telefone);
				await deps.uazapi.sendText(telefone, `🧹 Memória limpa (${deleted} mensagens).`);
				log.info({ deleted }, 'Memory reset via #reset command');
			} catch (err) {
				log.error({ err }, '#reset failed');
				await deps.uazapi
					.sendText(telefone, '❌ Falha ao limpar memória.')
					.catch(() => undefined);
			}
			return c.json({ status: 'ok', command: 'reset' });
		}
		if (cmd === '#vip-on' || cmd === '#vip-off') {
			const isVip = cmd === '#vip-on';
			try {
				const tags = await leadManager.setVip(telefone, isVip);
				await deps.uazapi.sendText(
					telefone,
					isVip ? `⭐ VIP ativado. Etiquetas: ${tags.join(', ')}` : `🔓 VIP removido. Etiquetas: ${tags.join(', ') || '(vazio)'}`,
				);
				log.info({ isVip, tags }, 'VIP toggled via command');
			} catch (err) {
				log.error({ err }, 'VIP toggle failed');
				await deps.uazapi
					.sendText(telefone, '❌ Falha ao alternar VIP.')
					.catch(() => undefined);
			}
			return c.json({ status: 'ok', command: cmd });
		}
		if (cmd === '#ia-on' || cmd === '#ia-off') {
			const active = cmd === '#ia-on';
			try {
				await leadManager.setIaAtiva(telefone, active);
				await deps.uazapi.sendText(
					telefone,
					active ? '🤖 IA reativada.' : '🔇 IA desativada.',
				);
				log.info({ active }, 'IA toggled via command');
			} catch (err) {
				log.error({ err }, 'IA toggle failed');
			}
			return c.json({ status: 'ok', command: cmd });
		}

		// Push to debouncer (responds 200 immediately, agent runs after debounce window)
		debouncer.push(telefone, text);

		// Registra evento de mensagem recebida — best-effort, não persiste o texto (LGPD)
		registrarEvento(deps.supabase, {
			telefone,
			tipo: 'mensagem_recebida',
			cliente_nome: waName,
			detalhes: { message_type: message.messageType, len: text.length },
		}).catch(() => undefined);

		return c.json({ status: 'ok', debounced: true });
	});

	return router;
}
