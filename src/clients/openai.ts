import OpenAI from 'openai';
import type {
	ChatCompletionMessageParam,
	ChatCompletionTool,
} from 'openai/resources/chat/completions.js';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

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
		this.client = new OpenAI({ apiKey: config?.apiKey ?? env.OPENAI_API_KEY });
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

		const response = await this.client.chat.completions.create({
			model,
			messages: opts.messages,
			tools: opts.tools?.length ? opts.tools : undefined,
			tool_choice: opts.tools?.length ? 'auto' : undefined,
			temperature: opts.temperature ?? 0.3,
		});

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

	async analyzeImage(
		imageBase64: string,
		prompt: string,
		mimeType = 'image/jpeg',
	): Promise<VisionResult> {
		this.log.debug({ model: this.modelVision, promptLength: prompt.length }, 'Vision request');

		const response = await this.client.chat.completions.create({
			model: this.modelVision,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
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
