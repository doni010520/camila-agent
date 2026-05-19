import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runAgent } from '../../src/agent/helena.js';
import { ToolRegistry } from '../../src/agent/tools/_registry.js';
import type { LeadCamilaRow } from '../../src/clients/supabase.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({ AGENT_MAX_TURNS: '3' } as never);

// ── Helpers ──

function makeLead(overrides?: Partial<LeadCamilaRow>): LeadCamilaRow {
	return {
		id: 'test-uuid',
		telefone: '5571999999999',
		nome: overrides?.nome ?? 'Maria',
		primeira_interacao: new Date().toISOString(),
		ultimo_contato: new Date().toISOString(),
		pdf_catalogo_enviado_em: overrides?.pdf_catalogo_enviado_em ?? null,
		pdf_curso_enviado_em: null,
		sinal_pago: false,
		agendamento_pendente_id: null,
		ia_ativa: true,
		etiquetas: [],
		ultimo_servico: overrides?.ultimo_servico ?? null,
		ultimo_agendamento_em: null,
		metadata: {},
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

function makeDeps(overrides?: {
	chatResponse?: unknown;
	chatResponses?: unknown[];
	toolHandler?: ReturnType<typeof vi.fn>;
	toolName?: string;
}) {
	const sentTexts: string[] = [];
	const savedMessages: Array<{ session: string; role: string; content: string }> = [];

	const openai = {
		chat: overrides?.chatResponses
			? vi
					.fn()
					.mockResolvedValueOnce(overrides.chatResponses[0])
					.mockResolvedValueOnce(overrides.chatResponses[1])
					.mockResolvedValueOnce(overrides.chatResponses[2])
			: vi.fn().mockResolvedValue(
					overrides?.chatResponse ?? {
						message: { content: 'Olá! Como posso te ajudar?', tool_calls: null },
						finishReason: 'stop',
					},
				),
	};

	const uazapi = {
		sendText: vi.fn().mockImplementation(async (_n: string, text: string) => {
			sentTexts.push(text);
		}),
	};

	const supabase = {};

	const memory = {
		loadRecent: vi.fn().mockResolvedValue([]),
		save: vi.fn().mockImplementation(async (session: string, role: string, content: string) => {
			savedMessages.push({ session, role, content });
		}),
	};

	const registry = new ToolRegistry();
	if (overrides?.toolHandler) {
		registry.register({
			name: overrides.toolName ?? 'test_tool',
			description: 'Test tool',
			inputSchema: z.object({ param: z.string() }),
			handler: overrides.toolHandler,
		});
	}

	return {
		openai: openai as never,
		uazapi: uazapi as never,
		supabase: supabase as never,
		memory: memory as never,
		toolRegistry: registry,
		sentTexts,
		savedMessages,
		mockOpenai: openai,
		mockMemory: memory,
	};
}

// ── Tests ──

describe('runAgent (helena.ts)', () => {
	it('sends text via UAZAPI + saves memory (user + assistant) when no tool calls', async () => {
		const deps = makeDeps();
		await runAgent({ telefone: '5571999', mensagem: 'Oi', lead: makeLead() }, deps);

		expect(deps.sentTexts).toEqual(['Olá! Como posso te ajudar?']);
		expect(deps.savedMessages).toEqual([
			{ session: '5571999', role: 'user', content: 'Oi' },
			{ session: '5571999', role: 'assistant', content: 'Olá! Como posso te ajudar?' },
		]);
	});

	it('executes tool call → result becomes role:tool → next iteration gets final text', async () => {
		const toolHandler = vi.fn().mockResolvedValue({ status: 'ok', data: 'test' });
		const deps = makeDeps({
			chatResponses: [
				// Turn 1: model wants to call a tool
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc1',
								type: 'function',
								function: { name: 'test_tool', arguments: '{"param":"hello"}' },
							},
						],
					},
					finishReason: 'tool_calls',
				},
				// Turn 2: model produces final text after seeing tool result
				{
					message: { content: 'Resultado: test', tool_calls: null },
					finishReason: 'stop',
				},
			],
			toolHandler,
			toolName: 'test_tool',
		});

		await runAgent({ telefone: '5571999', mensagem: 'Faz algo', lead: makeLead() }, deps);

		expect(toolHandler).toHaveBeenCalledWith(
			{ param: 'hello' },
			expect.objectContaining({ telefone: '5571999' }),
		);
		expect(deps.sentTexts).toEqual(['Resultado: test']);
		// Memory should include tool result
		const toolSaves = deps.savedMessages.filter((m) => m.role === 'tool');
		expect(toolSaves).toHaveLength(1);
		expect(toolSaves[0]?.content).toContain('test_tool');
	});

	it('handles unknown tool name → error message in history', async () => {
		const deps = makeDeps({
			chatResponses: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc1',
								type: 'function',
								function: { name: 'nonexistent_tool', arguments: '{}' },
							},
						],
					},
					finishReason: 'tool_calls',
				},
				{ message: { content: 'Desculpa, erro.', tool_calls: null }, finishReason: 'stop' },
			],
		});

		await runAgent({ telefone: '5571999', mensagem: 'Faz algo', lead: makeLead() }, deps);

		// Check that openai.chat was called with tool error in messages
		const secondCall = deps.mockOpenai.chat.mock.calls[1];
		const messages = secondCall?.[0]?.messages as Array<{ role: string; content: string }>;
		const toolMsg = messages?.find((m) => m.role === 'tool');
		expect(toolMsg?.content).toContain('não existe');
	});

	it('handles invalid JSON in tool arguments → structured error', async () => {
		const deps = makeDeps({
			chatResponses: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc1',
								type: 'function',
								function: { name: 'test_tool', arguments: '{broken json' },
							},
						],
					},
					finishReason: 'tool_calls',
				},
				{ message: { content: 'Desculpa.', tool_calls: null }, finishReason: 'stop' },
			],
			toolHandler: vi.fn(),
			toolName: 'test_tool',
		});

		await runAgent({ telefone: '5571999', mensagem: 'Faz', lead: makeLead() }, deps);

		const secondCall = deps.mockOpenai.chat.mock.calls[1];
		const messages = secondCall?.[0]?.messages as Array<{ role: string; content: string }>;
		const toolMsg = messages?.find((m) => m.role === 'tool');
		expect(toolMsg?.content).toContain('JSON inválido');
	});

	it('handles args that fail Zod validation → error with flatten', async () => {
		const deps = makeDeps({
			chatResponses: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc1',
								type: 'function',
								function: { name: 'test_tool', arguments: '{"wrong_field": 123}' },
							},
						],
					},
					finishReason: 'tool_calls',
				},
				{ message: { content: 'Erro.', tool_calls: null }, finishReason: 'stop' },
			],
			toolHandler: vi.fn(),
			toolName: 'test_tool',
		});

		await runAgent({ telefone: '5571999', mensagem: 'Faz', lead: makeLead() }, deps);

		const secondCall = deps.mockOpenai.chat.mock.calls[1];
		const messages = secondCall?.[0]?.messages as Array<{ role: string; content: string }>;
		const toolMsg = messages?.find((m) => m.role === 'tool');
		expect(toolMsg?.content).toContain('inválidos');
	});

	it('sends fallback message + notifies team when max turns reached', async () => {
		// All 3 turns return tool calls → never gets final text
		const notifyHandler = vi.fn().mockResolvedValue({ status: 'ok' });
		const deps = makeDeps({
			chatResponses: [
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc1',
								type: 'function',
								function: {
									name: 'notificar_time',
									arguments: '{"motivo":"loop","contexto":"test","urgencia":"alta"}',
								},
							},
						],
					},
					finishReason: 'tool_calls',
				},
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc2',
								type: 'function',
								function: {
									name: 'notificar_time',
									arguments: '{"motivo":"loop","contexto":"test","urgencia":"alta"}',
								},
							},
						],
					},
					finishReason: 'tool_calls',
				},
				{
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc3',
								type: 'function',
								function: {
									name: 'notificar_time',
									arguments: '{"motivo":"loop","contexto":"test","urgencia":"alta"}',
								},
							},
						],
					},
					finishReason: 'tool_calls',
				},
			],
			toolHandler: notifyHandler,
			toolName: 'notificar_time',
		});

		// Also register notificar_time for the emergency call
		await runAgent({ telefone: '5571999', mensagem: 'Loop', lead: makeLead() }, deps);

		// Should have sent fallback message
		expect(deps.sentTexts.some((t) => t.includes('probleminha'))).toBe(true);
	});

	it('uses "amiga" in prompt when lead.nome is null', async () => {
		const deps = makeDeps();
		await runAgent({ telefone: '5571999', mensagem: 'Oi', lead: makeLead({ nome: null }) }, deps);

		// Check the system prompt passed to openai.chat
		const firstCall = deps.mockOpenai.chat.mock.calls[0];
		const messages = firstCall?.[0]?.messages as Array<{ role: string; content: string }>;
		const system = messages?.find((m) => m.role === 'system');
		expect(system?.content).toContain('amiga');
	});

	it('uses "nunca" for pdf_catalogo_enviado_h when null', async () => {
		const deps = makeDeps();
		await runAgent(
			{ telefone: '5571999', mensagem: 'Oi', lead: makeLead({ pdf_catalogo_enviado_em: null }) },
			deps,
		);

		const firstCall = deps.mockOpenai.chat.mock.calls[0];
		const messages = firstCall?.[0]?.messages as Array<{ role: string; content: string }>;
		const system = messages?.find((m) => m.role === 'system');
		expect(system?.content).toContain('nunca');
	});
});
