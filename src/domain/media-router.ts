/**
 * Converte mídia recebida no WhatsApp em texto para o LLM.
 *
 * Usa POST /message/download do UAZAPI para descriptografar a mídia
 * (CDN do WhatsApp retorna blobs criptografados que OpenAI rejeita).
 *
 * Baseado no fp-solar-agent (doni010520/fp-solar-agent).
 */

import type { AppOpenAIClient } from '../clients/openai.js';
import type { UazapiClient } from '../clients/uazapi.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

const MAX_PDF_CHARS = 4000;

export interface MediaRouterDeps {
	openai: AppOpenAIClient;
	uazapi: UazapiClient;
	logger?: Logger;
}

export interface MediaResult {
	/** Texto para injetar no debounce buffer / prompt do agente */
	text: string;
	/** URL descriptografada da mídia (usável por tools como validar_comprovante) */
	mediaUrl?: string;
}

/**
 * Converts non-text media into text for the debounce buffer.
 * Source: SPEC §7.2.
 */
export class MediaRouter {
	private readonly openai: AppOpenAIClient;
	private readonly uazapi: UazapiClient;
	private readonly log: Logger;

	constructor(deps: MediaRouterDeps) {
		this.openai = deps.openai;
		this.uazapi = deps.uazapi;
		this.log = deps.logger ?? rootLogger.child({ module: 'media-router' });
	}

	/**
	 * Route media to appropriate handler and return text representation.
	 * @param messageType - UAZAPI messageType (audioMessage, imageMessage, documentMessage)
	 * @param messageId - messageid do webhook UAZAPI (usado pra baixar via /message/download)
	 * @returns MediaResult com texto e URL descriptografada (quando disponível)
	 */
	async process(messageType: string, messageId: string): Promise<MediaResult> {
		switch (messageType) {
			case 'audioMessage':
				return this.handleAudio(messageId);
			case 'imageMessage':
				return this.handleImage(messageId);
			case 'documentMessage':
				return this.handleDocument(messageId);
			default:
				this.log.warn({ messageType }, 'Unsupported media type');
				return { text: `[Mídia do tipo ${messageType} recebida — não processada]` };
		}
	}

	private async handleAudio(messageId: string): Promise<MediaResult> {
		this.log.debug({ messageId }, 'Processing audio');

		let audioBytes: Uint8Array | null = null;
		let mimetype = 'audio/ogg';

		// 1. Tenta via UAZAPI download API (descriptografa automaticamente)
		try {
			const result = await this.uazapi.downloadMedia({
				messageId,
				returnLink: true,
				returnBase64: false,
				generateMp3: false, // OGG é o formato nativo do WhatsApp
			});
			if (result) {
				const fileURL = typeof result.fileURL === 'string' ? result.fileURL : null;
				mimetype = typeof result.mimetype === 'string' ? result.mimetype : mimetype;

				if (fileURL) {
					const res = await fetch(fileURL);
					if (res.ok) {
						audioBytes = new Uint8Array(await res.arrayBuffer());
						this.log.debug({ size: audioBytes.length, mimetype }, 'Audio downloaded via fileURL');
					}
				}
			}
		} catch (err) {
			this.log.error({ err: err instanceof Error ? err.message : err }, 'download_media raised');
		}

		// 2. Fallback: base64 direto
		if (!audioBytes) {
			try {
				const result = await this.uazapi.downloadMedia({
					messageId,
					returnBase64: true,
					returnLink: false,
				});
				const b64 = typeof result?.base64Data === 'string' ? result.base64Data : null;
				if (b64) {
					audioBytes = Uint8Array.from(Buffer.from(b64, 'base64'));
					mimetype = typeof result?.mimetype === 'string' ? result.mimetype : mimetype;
					this.log.debug({ size: audioBytes.length }, 'Audio obtained via base64 fallback');
				}
			} catch (err) {
				this.log.error({ err: err instanceof Error ? err.message : err }, 'base64 fallback raised');
			}
		}

		if (!audioBytes) {
			return { text: '[áudio recebido, mas não foi possível baixar]' };
		}

		// Extensão coerente com mimetype pro Whisper aceitar
		let ext = 'ogg';
		if (mimetype.includes('mp3') || mimetype.includes('mpeg')) ext = 'mp3';
		else if (mimetype.includes('wav')) ext = 'wav';
		else if (mimetype.includes('m4a') || mimetype.includes('mp4')) ext = 'm4a';
		else if (mimetype.includes('webm')) ext = 'webm';

		try {
			const mimeForWhisper = `audio/${ext === 'm4a' ? 'mp4' : ext}`;
			const result = await this.openai.transcribe(audioBytes, mimeForWhisper);
			this.log.info({ textLength: result.text.length }, 'Audio transcribed');
			if (!result.text.trim()) return { text: '[áudio recebido, mas a transcrição veio vazia]' };
			return { text: `[Áudio transcrito]: ${result.text}` };
		} catch (err) {
			this.log.error({ err: err instanceof Error ? err.message : err, mimetype, ext }, 'Whisper failed');
			return { text: '[áudio recebido, mas não foi possível transcrever]' };
		}
	}

	private async handleImage(messageId: string): Promise<MediaResult> {
		this.log.debug({ messageId }, 'Processing image');

		// Pega URL descriptografada do UAZAPI (igual ao fp-solar-agent)
		const mediaUrl = await this.uazapi.getMediaUrl(messageId);
		if (!mediaUrl) {
			return { text: '[imagem recebida, mas não foi possível acessar]' };
		}

		try {
			// Passa URL direta pro OpenAI Vision (não precisa base64)
			const result = await this.openai.analyzeImage(
				mediaUrl,
				'Descreva brevemente esta imagem em português. Se for um comprovante PIX, extraia: valor, destinatário, chave, status.',
				'url', // flag pra usar URL direta
			);
			this.log.info({ textLength: result.text.length }, 'Image described');
			return {
				text: `[Imagem recebida | media_url=${mediaUrl}]: ${result.text}`,
				mediaUrl,
			};
		} catch (err) {
			this.log.error({ err: err instanceof Error ? err.message : err, mediaUrl: mediaUrl.slice(0, 80) }, 'Vision failed');
			return {
				text: '[imagem recebida, mas não foi possível analisar]',
				mediaUrl,
			};
		}
	}

	private async handleDocument(messageId: string): Promise<MediaResult> {
		this.log.debug({ messageId }, 'Processing document');
		try {
			const { bytes } = await this.uazapi.fetchMediaByMessageId(messageId);
			// Dynamic import to avoid bundling pdf-parse when not needed
			const pdfParse = (await import('pdf-parse')).default;
			const parsed = await pdfParse(Buffer.from(bytes));
			const text = parsed.text.slice(0, MAX_PDF_CHARS);
			this.log.info(
				{ textLength: text.length, truncated: parsed.text.length > MAX_PDF_CHARS },
				'PDF extracted',
			);
			return { text: `[PDF recebido]: ${text}` };
		} catch (err) {
			this.log.error({ err: err instanceof Error ? err.message : err }, 'Failed to parse PDF');
			return { text: '[PDF recebido mas não foi possível extrair o texto]' };
		}
	}
}
