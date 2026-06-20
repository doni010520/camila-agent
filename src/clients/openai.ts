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
			// Usa o node-fetch padrão do SDK (NÃO o fetch nativo) — o streaming do
			// SDK foi desenhado pra ele e o custom fetch travava o stream (47s →
			// Connection error). O bug do gunzip do node-fetch só acontecia em
			// respostas GRANDES não-streaming; com streaming a resposta vem em
			// chunks pequenos e não aciona o bug.
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

		// STREAMING: causa raiz do "Premature close"/"invalid content-length" era
		// a OpenAI/Cloudflare cortar respostas grandes bufferizadas (chunked+br)
		// quando a geração demora (vimos chamadas de 40s+). Em streaming os tokens
		// chegam incrementalmente — a conexão fica ativa e não há corpo único
		// grande pra cortar. Remontamos o objeto completo (content + tool_calls)
		// no mesmo formato da resposta não-streaming.
		const assembled = await withRetry(
			() =>
				this.streamAndAssemble({
					model,
					messages: opts.messages,
					tools: opts.tools?.length ? opts.tools : undefined,
					tool_choice: opts.tools?.length ? 'auto' : undefined,
					temperature: opts.temperature ?? 0.3,
				}),
			{
				maxRetries: 5,
				baseDelayMs: 1500,
				maxDelayMs: 16_000,
				shouldRetry: isTransientConnError,
				logger: this.log,
				label: 'openai:chat',
			},
		);

		this.log.info(
			{
				model,
				finishReason: assembled.finishReason,
				promptTokens: assembled.usage?.prompt_tokens,
				completionTokens: assembled.usage?.completion_tokens,
			},
			'OpenAI chat response',
		);

		return assembled;
	}

	/** Faz a chamada em streaming e remonta o resultado final (content +
	 *  tool_calls fragmentados em deltas) no formato ChatResult. */
	private async streamAndAssemble(params: {
		model: string;
		messages: ChatCompletionMessageParam[];
		tools?: ChatCompletionTool[];
		tool_choice?: 'auto';
		temperature: number;
	}): Promise<ChatResult> {
		const stream = await this.client.chat.completions.create({
			...params,
			stream: true,
			stream_options: { include_usage: true },
		});

		let content = '';
		const toolCalls = new Map<
			number,
			{ id: string; type: 'function'; function: { name: string; arguments: string } }
		>();
		let finishReason: string | null = null;
		let usage: OpenAI.CompletionUsage | undefined;

		for await (const chunk of stream) {
			const choice = chunk.choices[0];
			if (choice) {
				if (choice.delta?.content) content += choice.delta.content;
				for (const tc of choice.delta?.tool_calls ?? []) {
					const idx = tc.index;
					let acc = toolCalls.get(idx);
					if (!acc) {
						acc = { id: '', type: 'function', function: { name: '', arguments: '' } };
						toolCalls.set(idx, acc);
					}
					if (tc.id) acc.id = tc.id;
					if (tc.function?.name) acc.function.name += tc.function.name;
					if (tc.function?.arguments) acc.function.arguments += tc.function.arguments;
				}
				if (choice.finish_reason) finishReason = choice.finish_reason;
			}
			if (chunk.usage) usage = chunk.usage;
		}

		const tcList = [...toolCalls.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
		const message = {
			role: 'assistant',
			content: content || null,
			...(tcList.length ? { tool_calls: tcList } : {}),
		} as OpenAI.Chat.Completions.ChatCompletionMessage;

		return { message, finishReason, usage };
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
