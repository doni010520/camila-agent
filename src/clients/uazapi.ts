import { z } from 'zod';
import { getEnv } from '../infra/env.js';
import { UazapiError } from '../infra/errors.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';
import { isRetryableStatus, withRetry } from '../infra/retry.js';

// ═══════════════════════════════════════════════════════════════
// Schemas — from REFERENCE-PAYLOADS.md real production webhooks
// ═══════════════════════════════════════════════════════════════

// messageType vem em CamelCase ou camelCase dependendo da versão UAZAPI.
// Lista NÃO é exaustiva — aceita string livre, mas categoriza pelas conhecidas.
export const uazapiMessageTypeSchema = z.string();

export const uazapiMessageContentSchema = z
	.object({
		URL: z.string().optional(),
		mediaKey: z.string().optional(),
		degreesLatitude: z.number().nullable().optional(),
		degreesLongitude: z.number().nullable().optional(),
	})
	.passthrough();

// Real field is `chatid`, NOT `sender_pn`
// Schema permissivo: UAZAPI manda dezenas de campos extras que ignoramos.
export const uazapiMessageSchema = z
	.object({
		chatid: z.string(),
		messageid: z.string().optional().default(''),
		text: z.string().optional().default(''),
		messageType: uazapiMessageTypeSchema,
		wasSentByApi: z.boolean().optional().default(false),
		fromMe: z.boolean().optional().default(false),
		content: z.unknown().optional(),
		buttonOrListid: z.string().optional().default(''),
	})
	.passthrough();

// Full webhook: chat info + message + token
// chat tem 50+ campos com tipos variados (wa_label = array, lead_tags = array, etc.)
// só nos importamos com wa_name pra extrair nome do contato.
export const uazapiWebhookSchema = z.object({
	body: z.object({
		chat: z.unknown().optional(),
		message: uazapiMessageSchema,
		token: z.string().optional(),
		created_at: z.string().optional(),
	}),
});

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/** Extract phone digits from chatid: "5571999999999@s.whatsapp.net" → "5571999999999" */
export function chatidToTelefone(chatid: string): string {
	return chatid.split('@')[0] ?? '';
}

/** Check if a webhook message is a button click (buttonOrListid populated) */
export function isButtonClick(msg: z.infer<typeof uazapiMessageSchema>): boolean {
	return msg.buttonOrListid !== undefined && msg.buttonOrListid !== '';
}

/**
 * Parse button click convention from production:
 * "Id_sim495316019"      → { action: 'confirmar',        agendamentoId: '495316019' } (lembrete véspera)
 * "Id_nao495316019"      → { action: 'recusar',          agendamentoId: '495316019' }
 * "id_sim495316019"      → { action: 'enquete_sim',      agendamentoId: '495316019' } (legacy enquete pra cliente)
 * "id_nao"               → { action: 'enquete_nao',      agendamentoId: '' }
 * "Fin_sim495316019"     → { action: 'finalizar_sim',    agendamentoId: '495316019' } (Camila no grupo)
 * "Fin_nao495316019"     → { action: 'finalizar_nao',    agendamentoId: '495316019' }
 * "Manut_sim495316019"   → { action: 'manutencao_sim',   agendamentoId: '495316019' } (cliente confirma manutenção)
 * "Manut_nao495316019"   → { action: 'manutencao_nao',   agendamentoId: '495316019' }
 * "Fb_bom495316019"      → { action: 'feedback_bom',     agendamentoId: '495316019' } (feedback 3 dias depois)
 * "Fb_ruim495316019"     → { action: 'feedback_ruim',    agendamentoId: '495316019' }
 */
export function parseButtonId(buttonOrListid: string): { action: string; agendamentoId: string } {
	const idStr = buttonOrListid.replace(/[^a-zA-Z_]/g, '');
	const numStr = buttonOrListid.replace(/\D/g, '');

	if (idStr === 'Id_sim') return { action: 'confirmar', agendamentoId: numStr };
	if (idStr === 'Id_nao') return { action: 'recusar', agendamentoId: numStr };
	if (idStr === 'id_sim') return { action: 'enquete_sim', agendamentoId: numStr };
	if (idStr === 'id_nao') return { action: 'enquete_nao', agendamentoId: numStr };
	if (idStr === 'Fin_sim') return { action: 'finalizar_sim', agendamentoId: numStr };
	if (idStr === 'Fin_nao') return { action: 'finalizar_nao', agendamentoId: numStr };
	if (idStr === 'Manut_sim') return { action: 'manutencao_sim', agendamentoId: numStr };
	if (idStr === 'Manut_nao') return { action: 'manutencao_nao', agendamentoId: numStr };
	if (idStr === 'Fb_bom') return { action: 'feedback_bom', agendamentoId: numStr };
	if (idStr === 'Fb_ruim') return { action: 'feedback_ruim', agendamentoId: numStr };
	return { action: 'unknown', agendamentoId: numStr };
}

/**
 * Normalize number for UAZAPI outbound:
 * Groups (ending in @g.us) are preserved as-is.
 * Person numbers strip @s.whatsapp.net.
 */
export function normalizeNumber(input: string): string {
	if (input.endsWith('@g.us')) return input;
	return input.split('@')[0] ?? input;
}

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type UazapiMessage = z.infer<typeof uazapiMessageSchema>;
export type UazapiWebhookPayload = z.infer<typeof uazapiWebhookSchema>;

// ═══════════════════════════════════════════════════════════════
// Client
// ═══════════════════════════════════════════════════════════════

export interface UazapiClientConfig {
	baseUrl?: string;
	token?: string;
	dryRun?: boolean;
	logger?: Logger;
}

export class UazapiClient {
	private readonly baseUrl: string;
	private readonly token: string;
	private readonly dryRun: boolean;
	private readonly log: Logger;

	constructor(config?: UazapiClientConfig) {
		const env = getEnv();
		this.baseUrl = (config?.baseUrl ?? env.UAZAPI_BASE_URL).replace(/\/$/, '');
		this.token = config?.token ?? env.UAZAPI_TOKEN;
		this.dryRun = config?.dryRun ?? env.UAZAPI_DRY_RUN;
		this.log = config?.logger ?? rootLogger.child({ client: 'uazapi' });
	}

	private async post(path: string, body: unknown): Promise<unknown> {
		if (this.dryRun) {
			this.log.info({ path, dry_run: true }, 'UAZAPI dry-run: skipping send');
			return { ok: true, dry_run: true };
		}

		const url = `${this.baseUrl}${path}`;
		const doRequest = async () => {
			this.log.debug({ path }, 'UAZAPI request');
			const res = await fetch(url, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json',
					token: this.token,
				},
				body: JSON.stringify(body),
			});
			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new UazapiError(
					`POST ${path} returned ${res.status}`,
					res.status >= 500 ? 502 : res.status,
					{ status: res.status, body: text },
				);
			}
			return await res.json().catch(() => ({}));
		};

		return withRetry(doRequest, {
			maxRetries: 2,
			baseDelayMs: 300,
			shouldRetry: (err) => err instanceof UazapiError && isRetryableStatus(err.statusCode),
			logger: this.log,
			label: `uazapi:POST ${path}`,
		});
	}

	// ── Send text: fields `number`, `text`, `delay` (ms) ──
	async sendText(number: string, text: string, delayMs = 3000): Promise<void> {
		await this.post('/send/text', {
			number: normalizeNumber(number),
			text,
			delay: delayMs,
		});
		this.log.info(
			{ number: number.slice(-8), text: text.length > 300 ? `${text.slice(0, 300)}…` : text },
			'Text sent',
		);
	}

	// ── Send media: `file` is BASE64, not URL ──
	async sendMedia(opts: {
		number: string;
		type: 'document' | 'image' | 'audio' | 'sticker' | 'video';
		fileBase64: string;
		docName?: string;
	}): Promise<void> {
		await this.post('/send/media', {
			number: normalizeNumber(opts.number),
			type: opts.type,
			file: opts.fileBase64,
			...(opts.docName ? { docName: opts.docName } : {}),
		});
		this.log.info({ number: opts.number.slice(-8), type: opts.type }, 'Media sent');
	}

	// ── Send menu: `choices` is ["Label|id"] strings, not objects ──
	async sendMenu(opts: {
		number: string;
		text: string;
		choices: Array<{ label: string; id: string }>;
	}): Promise<void> {
		if (opts.choices.length > 3) throw new UazapiError('Máx 3 botões', 400);
		await this.post('/send/menu', {
			number: normalizeNumber(opts.number),
			type: 'button',
			text: opts.text,
			choices: opts.choices.map((c) => `${c.label}|${c.id}`),
			selectableCount: 1, // 1 clique só por menu
			readchat: true,
		});
		this.log.info({ number: opts.number.slice(-8), choiceCount: opts.choices.length }, 'Menu sent');
	}

	// ── Send PIX button: only pixType, pixKey, pixName (no valor/banco/titular) ──
	async sendPixButton(opts: {
		number: string;
		pixType?: 'EVP' | 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE';
		pixKey: string;
		pixName: string;
	}): Promise<void> {
		await this.post('/send/pix-button', {
			number: normalizeNumber(opts.number),
			pixType: opts.pixType ?? 'EVP',
			pixKey: opts.pixKey,
			pixName: opts.pixName,
		});
		this.log.info({ number: opts.number.slice(-8) }, 'PIX button sent');
	}

	// ═══════════════════════════════════════════════════════════════
	// Media download via UAZAPI API (descriptografa automaticamente)
	// Endpoint: POST /message/download  — baseado no fp-solar-agent
	// ═══════════════════════════════════════════════════════════════

	/**
	 * Baixa mídia via UAZAPI API (descriptografa automaticamente).
	 * Retorna { fileURL, mimetype, base64Data } dependendo dos flags.
	 */
	async downloadMedia(opts: {
		messageId: string;
		returnLink?: boolean;
		returnBase64?: boolean;
		transcribe?: boolean;
		generateMp3?: boolean;
	}): Promise<Record<string, unknown> | null> {
		const payload: Record<string, unknown> = {
			id: opts.messageId,
			return_link: opts.returnLink ?? true,
			return_base64: opts.returnBase64 ?? false,
			transcribe: opts.transcribe ?? false,
			generate_mp3: opts.generateMp3 ?? false,
		};

		const url = `${this.baseUrl}/message/download`;
		const res = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
				token: this.token,
			},
			body: JSON.stringify(payload),
		});

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			this.log.error(
				{ path: '/message/download', status: res.status, body: text.slice(0, 200) },
				'UAZAPI download failed',
			);
			return null;
		}

		return (await res.json().catch(() => null)) as Record<string, unknown> | null;
	}

	/**
	 * Retorna URL descriptografada da mídia (servida pelo UAZAPI).
	 * Essa URL é pública e pode ser passada diretamente pro OpenAI Vision.
	 */
	async getMediaUrl(messageId: string): Promise<string | null> {
		const result = await this.downloadMedia({ messageId, returnLink: true, returnBase64: false });
		if (result?.fileURL && typeof result.fileURL === 'string') return result.fileURL;
		this.log.warn(
			{ messageId, resultKeys: result ? Object.keys(result) : [] },
			'getMediaUrl: no fileURL in response',
		);
		return null;
	}

	/**
	 * Baixa bytes da mídia descriptografada. Usa getMediaUrl internamente.
	 * Fallback: tenta base64 direto do UAZAPI.
	 */
	async fetchMediaByMessageId(messageId: string): Promise<{ bytes: Uint8Array; mimetype: string }> {
		// 1. Tenta via URL (mais eficiente)
		const result = await this.downloadMedia({ messageId, returnLink: true, returnBase64: false });
		const fileURL = typeof result?.fileURL === 'string' ? result.fileURL : null;
		const mimetype =
			typeof result?.mimetype === 'string' ? result.mimetype : 'application/octet-stream';

		if (fileURL) {
			const res = await fetch(fileURL);
			if (res.ok) {
				this.log.debug(
					{ messageId, mimetype, size: 'streaming' },
					'Media fetched via UAZAPI fileURL',
				);
				return { bytes: new Uint8Array(await res.arrayBuffer()), mimetype };
			}
			this.log.warn({ messageId, status: res.status }, 'fileURL fetch failed, trying base64');
		}

		// 2. Fallback: base64 direto
		const b64result = await this.downloadMedia({
			messageId,
			returnBase64: true,
			returnLink: false,
		});
		const base64Data = typeof b64result?.base64Data === 'string' ? b64result.base64Data : null;
		const mime2 = typeof b64result?.mimetype === 'string' ? b64result.mimetype : mimetype;

		if (base64Data) {
			this.log.debug({ messageId, mimetype: mime2 }, 'Media fetched via UAZAPI base64');
			return { bytes: Uint8Array.from(Buffer.from(base64Data, 'base64')), mimetype: mime2 };
		}

		throw new UazapiError(`Could not download media for messageId=${messageId}`, 502);
	}

	/**
	 * Fetch media por URL direta (legado — usado por validar_comprovante com URLs já descriptografadas).
	 */
	async fetchMedia(mediaUrl: string): Promise<Uint8Array> {
		const res = await fetch(mediaUrl);
		if (!res.ok) throw new UazapiError(`Failed to download media: ${res.status}`, 502);
		return new Uint8Array(await res.arrayBuffer());
	}
}
