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
	private readonly apiKey: string;
	private readonly model: string;
	private readonly modelVision: string;
	private readonly modelWhisper: string;
	private readonly log: Logger;

	constructor(config?: OpenAIClientConfig) {
		const env = getEnv();
		this.apiKey = config?.apiKey ?? env.OPENAI_API_KEY;
		// SDK mantido só pra Whisper/Vision. O chat() crítico usa fetch nativo
		// DIRETO (ver chat()) — testes provaram que toda falha de "Premature
		// close"/"invalid content-length" vinha do node-fetch interno do SDK,
		// enquanto o fetch nativo direto roda 100% limpo.
		this.client = new OpenAI({ apiKey: this.apiKey, maxRetries: 2, timeout: 60_000 });
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

		// FETCH NATIVO DIRETO (não o SDK). Diagnóstico extensivo provou que TODA
		// falha de "Premature close"/"invalid content-length"/"Connection error"
		// vinha do node-fetch interno do SDK 4.x. O fetch nativo do Node 22
		// (undici) chamando a API direto roda 100% limpo (0 falhas em dezenas de
		// testes), incluindo respostas lentas de 40s+. Mantemos o mesmo formato
		// de resposta pro resto do código.
		const body = {
			model,
			messages: opts.messages,
			tools: opts.tools?.length ? opts.tools : undefined,
			tool_choice: opts.tools?.length ? ('auto' as const) : undefined,
			temperature: opts.temperature ?? 0.3,
		};

		const json = await withRetry(
			async () => {
				const res = await fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${this.apiKey}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(body),
				});
				if (!res.ok) {
					const txt = await res.text().catch(() => '');
					// 429/5xx → retryável (isTransientConnError não pega status, então
					// sinalizamos via mensagem). 4xx de input → não retenta.
					const retryable = res.status === 429 || res.status >= 500;
					throw new Error(
						`OpenAI ${res.status}${retryable ? ' (transient)' : ''}: ${txt.slice(0, 200)}`,
					);
				}
				return (await res.json()) as OpenAI.Chat.Completions.ChatCompletion;
			},
			{
				maxRetries: 5,
				baseDelayMs: 1500,
				maxDelayMs: 16_000,
				shouldRetry: (err) =>
					isTransientConnError(err) ||
					(err instanceof Error && err.message.includes('(transient)')),
				logger: this.log,
				label: 'openai:chat',
			},
		);

		const choice = json.choices?.[0];
		if (!choice) throw new Error('OpenAI returned no choices');

		this.log.info(
			{
				model,
				finishReason: choice.finish_reason,
				promptTokens: json.usage?.prompt_tokens,
				completionTokens: json.usage?.completion_tokens,
			},
			'OpenAI chat response',
		);

		return {
			message: choice.message,
			finishReason: choice.finish_reason,
			usage: json.usage ?? undefined,
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
