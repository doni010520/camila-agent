import { Hono } from 'hono';
import { runAgent } from '../agent/helena.js';
import type { ToolRegistry } from '../agent/tools/_registry.js';
import type { AppOpenAIClient } from '../clients/openai.js';
import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import { isButtonClick, uazapiWebhookSchema } from '../clients/uazapi.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { MessageDebouncer } from '../domain/debounce.js';
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

export function createWebhookMessageRouter(deps: WebhookDeps): Hono {
	const router = new Hono();
	const memory = new ChatMemory(deps.postgres);
	const leadManager = new LeadManager(deps.supabase);
	const mediaRouter = new MediaRouter({ openai: deps.openai, uazapi: deps.uazapi });

	// Set up debouncer
	const debouncer = new MessageDebouncer();
	debouncer.setCallback(async (telefone, combinedText) => {
		const log = createRequestLogger(telefone);
		try {
			const lead = await leadManager.getOrCreate({ telefone, wa_label: undefined });

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
		const parsed = uazapiWebhookSchema.safeParse(rawBody);

		if (!parsed.success) {
			return c.json({ status: 'erro', razao: 'Payload inválido' }, 400);
		}

		const { message } = parsed.data.body;
		const chat = parsed.data.body.chat;

		// Ignore messages sent by the API itself (avoid loops)
		if (message.fromMe || message.wasSentByApi) {
			return c.json({ status: 'ok', ignored: 'fromMe' });
		}

		const telefone = chatidToE164(message.chatid);
		if (!telefone || telefone.length < 8) {
			return c.json({ status: 'ok', ignored: 'invalid_phone' });
		}

		const log = createRequestLogger(telefone);

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
			nome: chat?.wa_name,
			wa_label: chat?.wa_label,
		});

		// Extract text early so magic commands can run even with IA desativada.
		const earlyText = (message.text ?? '').trim().toLowerCase();
		const isCommand = earlyText.startsWith('#');

		// If IA disabled, ignore — UNLESS the message is a magic command (#reset, #ia-on)
		if (lead.ia_on_off === 'off' && !isCommand) {
			log.info('IA disabled for this lead, ignoring');
			return c.json({ status: 'ok', ignored: 'ia_desativada' });
		}

		// Route by message type
		let text = message.text ?? '';

		if (MEDIA_TYPES.has(message.messageType)) {
			const mediaUrl = message.content?.URL;
			if (mediaUrl) {
				try {
					text = await mediaRouter.process(message.messageType, mediaUrl);
				} catch (err) {
					log.error({ err, messageType: message.messageType }, 'Media processing failed');
					text = `[Mídia recebida: ${message.messageType}]`;
				}
			} else {
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
		return c.json({ status: 'ok', debounced: true });
	});

	return router;
}
