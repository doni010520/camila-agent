import OpenAI from 'openai';
import type {
	ChatCompletionMessageParam,
	ChatCompletionTool,
} from 'openai/resources/chat/completions.js';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';
import { withRetry } from '../infra/retry.js';

/**
 * Detecta erro transitório de conexão com a OpenAI. O caso recorrente é
 * "Invalid response body ... Premature close" — a conexão (keep-alive) é
 * fechada no meio da leitura do corpo. O retry interno do SDK nem sempre
 * cobre isso (acontece no parsing do body), então retentamos por fora, o
 * que força uma request nova (conexão fresca).
 */
function isTransientConnError(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
	return (
		msg.includes('premature close') ||
		msg.includes('terminated') ||
		msg.includes('econnreset') ||
		msg.includes('socket hang up') ||
		msg.includes('other side closed') ||
		msg.includes('fetch failed') ||
		msg.includes('connection error') ||
		msg.includes('network') ||
		msg.includes('timeout') ||
		msg.includes('etimedout')
	);
}

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface ChatOptions {
	messages: ChatCompletionMessageParam[];
	tools?: ChatCompletionTool[];
	temperature?: number;
	model?: string;
}

export interface ChatResult {
	message: OpenAI.Chat.Completions.ChatCompletionMessage;
	finishReason: string | null;
	usage?: OpenAI.CompletionUsage;
}

export interface WhisperResult {
	text: string;
}

export interface VisionResult {
	text: string;
}

// ═══════════════════════════════════════════════════════════════
// Client
// ═══════════════════════════════════════════════════════════════

export interface OpenAIClientConfig {
	apiKey?: string;
	model?: string;
	modelVision?: string;
	modelWhisper?: string;
	logger?: Logger;
}

export class AppOpenAIClient {
	private readonly client: OpenAI;
	private readonly model: string;
	private readonly modelVision: string;
	private readonly modelWhisper: string;
	private readonly log: Logger;

	constructor(config?: OpenAIClientConfig) {
		const env = getEnv();
		this.client = new OpenAI({
			apiKey: config?.apiKey ?? env.OPENAI_API_KEY,
			// CRÍTICO: força o SDK a usar o fetch nativo do Node 22 (undici), em
			// vez do node-fetch@2.x que vem como polyfill padrão. O node-fetch 2.x
			// tem bug conhecido com streams gzip em keep-alive: "Premature close"
			// no Gunzip. Causa raiz do erro recorrente — sem isso, toda a
			// configuração de pool/retry era inútil porque nem chegava no undici.
			// biome-ignore lint/suspicious/noExplicitAny: tipos do node-fetch (SDK 4.x)
			// e do fetch nativo do Node 22 não casam perfeitamente, mas runtime é
			// 100% compatível. Pular checagem de tipo aqui é intencional.
			fetch: globalThis.fetch as any,
			maxRetries: 2,
			timeout: 60_000,
		});
		this.model = config?.model ?? env.OPENAI_MODEL;
		this.modelVision = config?.modelVision ?? env.OPENAI_MODEL_VISION;
		this.modelWhisper = config?.modelWhisper ?? env.OPENAI_MODEL_WHISPER;
		this.log = config?.logger ?? rootLogger.child({ client: 'openai' });
	}

	// ── Chat completions (with tool calling) ──

	async chat(opts: ChatOptions): Promise<ChatResult> {
		const model = opts.model ?? this.model;
		this.log.debug(
			{ model, messageCount: opts.messages.length, hasTools: !!opts.tools },
			'OpenAI chat request',
		);

		const response = await withRetry(
			() =>
				this.client.chat.completions.create({
					model,
					messages: opts.messages,
					tools: opts.tools?.length ? opts.tools : undefined,
					tool_choice: opts.tools?.length ? 'auto' : undefined,
					temperature: opts.temperature ?? 0.3,
				}),
			{
				// 5 retries × baseDelay 1500 com cap 16s cobre rajadas longas de
				// Premature close (já vimos sequência de ~10 falhas seguidas).
				maxRetries: 5,
				baseDelayMs: 1500,
				maxDelayMs: 16_000,
				shouldRetry: isTransientConnError,
				logger: this.log,
				label: 'openai:chat',
			},
		);

		const choice = response.choices[0];
		if (!choice) throw new Error('OpenAI returned no choices');

		this.log.info(
			{
				model,
				finishReason: choice.finish_reason,
				promptTokens: response.usage?.prompt_tokens,
				completionTokens: response.usage?.completion_tokens,
			},
			'OpenAI chat response',
		);

		return {
			message: choice.message,
			finishReason: choice.finish_reason,
			usage: response.usage ?? undefined,
		};
	}

	// ── Whisper (audio → text) ──

	async transcribe(audioBuffer: Uint8Array, mimeType = 'audio/ogg'): Promise<WhisperResult> {
		const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm';
		const file = new File([audioBuffer], `audio.${ext}`, { type: mimeType });

		this.log.debug({ model: this.modelWhisper, size: audioBuffer.length }, 'Whisper transcribe');

		const response = await this.client.audio.transcriptions.create({
			model: this.modelWhisper,
			file,
			language: 'pt',
		});

		this.log.info({ textLength: response.text.length }, 'Whisper result');
		return { text: response.text };
	}

	// ── Vision (image → structured text, used for PIX receipt OCR) ──

	/**
	 * Analisa imagem via OpenAI Vision.
	 * @param imageSource - base64 da imagem OU URL direta (quando mimeType='url')
	 * @param prompt - instrução pra o modelo
	 * @param mimeType - 'image/jpeg', 'image/png', etc. ou 'url' para URL direta
	 */
	async analyzeImage(
		imageSource: string,
		prompt: string,
		mimeType = 'image/jpeg',
	): Promise<VisionResult> {
		this.log.debug({ model: this.modelVision, promptLength: prompt.length, mode: mimeType === 'url' ? 'url' : 'base64' }, 'Vision request');

		const imageUrl = mimeType === 'url'
			? imageSource
			: `data:${mimeType};base64,${imageSource}`;

		const response = await this.client.chat.completions.create({
			model: this.modelVision,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'image_url', image_url: { url: imageUrl, detail: 'high' as const } },
						{ type: 'text', text: prompt },
					],
				},
			],
			temperature: 0.1,
			max_tokens: 500,
		});

		const text = response.choices[0]?.message?.content ?? '';
		this.log.info({ textLength: text.length }, 'Vision result');
		return { text };
	}
}
