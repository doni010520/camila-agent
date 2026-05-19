import type { ChatCompletionTool } from 'openai/resources/chat/completions.js';
import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════
// Tool result convention (SPEC §9)
// ═══════════════════════════════════════════════════════════════

export type ToolResult =
	| { status: 'ok'; [k: string]: unknown }
	| { status: 'erro'; razao: string; detalhes?: unknown }
	| { status: 'aguardando_escolha'; [k: string]: unknown };

// ═══════════════════════════════════════════════════════════════
// Tool context (passed to every handler)
// ═══════════════════════════════════════════════════════════════

export interface ToolContext {
	telefone: string;
	lead: { nome?: string | null; etiquetas: string[]; sinal_pago: boolean };
}

// ═══════════════════════════════════════════════════════════════
// Tool definition
// ═══════════════════════════════════════════════════════════════

export interface ToolDefinition<TInput = unknown> {
	name: string;
	description: string;
	inputSchema: z.ZodTypeAny;
	handler: (input: TInput, ctx: ToolContext) => Promise<ToolResult>;
}

// ═══════════════════════════════════════════════════════════════
// Registry
// ═══════════════════════════════════════════════════════════════

export class ToolRegistry {
	// biome-ignore lint/suspicious/noExplicitAny: stores heterogeneous tools
	private readonly tools = new Map<string, ToolDefinition<any>>();

	// biome-ignore lint/suspicious/noExplicitAny: registry stores heterogeneous tools
	register(tool: ToolDefinition<any>): void {
		this.tools.set(tool.name, tool);
	}

	get(name: string): ToolDefinition | undefined {
		return this.tools.get(name);
	}

	/** Convert all tools to OpenAI function calling format */
	openAiSchemas(): ChatCompletionTool[] {
		return [...this.tools.values()].map((t) => ({
			type: 'function' as const,
			function: {
				name: t.name,
				description: t.description,
				parameters: zodToJsonSchema(t.inputSchema),
			},
		}));
	}

	get names(): string[] {
		return [...this.tools.keys()];
	}

	get size(): number {
		return this.tools.size;
	}
}

/**
 * Minimal Zod-to-JSON-Schema converter for OpenAI function calling.
 * Handles the subset we use: objects with string/number/boolean/enum/optional fields.
 */
function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
	if (schema instanceof z.ZodObject) {
		const shape = schema.shape as Record<string, z.ZodType>;
		const properties: Record<string, unknown> = {};
		const required: string[] = [];

		for (const [key, fieldSchema] of Object.entries(shape)) {
			const { schema: innerSchema, isOptional } = unwrapOptional(fieldSchema);
			properties[key] = zodFieldToJson(innerSchema);
			if (!isOptional) required.push(key);
		}

		return { type: 'object', properties, required };
	}
	return { type: 'object', properties: {} };
}

function unwrapOptional(schema: z.ZodType): { schema: z.ZodType; isOptional: boolean } {
	if (schema instanceof z.ZodOptional) return { schema: schema.unwrap(), isOptional: true };
	if (schema instanceof z.ZodDefault) return { schema: schema.removeDefault(), isOptional: true };
	return { schema, isOptional: false };
}

function zodFieldToJson(schema: z.ZodType): Record<string, unknown> {
	if (schema instanceof z.ZodString) return { type: 'string' };
	if (schema instanceof z.ZodNumber) return { type: 'number' };
	if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
	if (schema instanceof z.ZodEnum) return { type: 'string', enum: schema.options };
	if (schema instanceof z.ZodOptional) return zodFieldToJson(schema.unwrap());
	if (schema instanceof z.ZodDefault) return zodFieldToJson(schema.removeDefault());
	if (schema instanceof z.ZodArray) return { type: 'array', items: zodFieldToJson(schema.element) };
	return { type: 'string' };
}
