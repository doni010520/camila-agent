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
	 * @param mediaUrl - content.URL from webhook
	 * @returns text to inject into debounce buffer
	 */
	async process(messageType: string, mediaUrl: string): Promise<string> {
		switch (messageType) {
			case 'audioMessage':
				return this.handleAudio(mediaUrl);
			case 'imageMessage':
				return this.handleImage(mediaUrl);
			case 'documentMessage':
				return this.handleDocument(mediaUrl);
			default:
				this.log.warn({ messageType }, 'Unsupported media type');
				return `[Mídia do tipo ${messageType} recebida — não processada]`;
		}
	}

	private async handleAudio(mediaUrl: string): Promise<string> {
		this.log.debug({ mediaUrl: mediaUrl.slice(0, 50) }, 'Processing audio');
		const buffer = await this.uazapi.fetchMedia(mediaUrl);
		const result = await this.openai.transcribe(buffer, 'audio/ogg');
		this.log.info({ textLength: result.text.length }, 'Audio transcribed');
		return `[Áudio transcrito]: ${result.text}`;
	}

	private async handleImage(mediaUrl: string): Promise<string> {
		this.log.debug({ mediaUrl: mediaUrl.slice(0, 50) }, 'Processing image');
		const buffer = await this.uazapi.fetchMedia(mediaUrl);
		const base64 = Buffer.from(buffer).toString('base64');
		const result = await this.openai.analyzeImage(
			base64,
			'Descreva brevemente esta imagem em português. Se for um comprovante PIX, extraia: valor, destinatário, chave, status.',
		);
		this.log.info({ textLength: result.text.length }, 'Image described');
		return `[Imagem recebida]: ${result.text}`;
	}

	private async handleDocument(mediaUrl: string): Promise<string> {
		this.log.debug({ mediaUrl: mediaUrl.slice(0, 50) }, 'Processing document');
		try {
			const buffer = await this.uazapi.fetchMedia(mediaUrl);
			// Dynamic import to avoid bundling pdf-parse when not needed
			const pdfParse = (await import('pdf-parse')).default;
			const parsed = await pdfParse(Buffer.from(buffer));
			const text = parsed.text.slice(0, MAX_PDF_CHARS);
			this.log.info(
				{ textLength: text.length, truncated: parsed.text.length > MAX_PDF_CHARS },
				'PDF extracted',
			);
			return `[PDF recebido]: ${text}`;
		} catch (err) {
			this.log.error({ err }, 'Failed to parse PDF');
			return '[PDF recebido mas não foi possível extrair o texto]';
		}
	}
}
