import { describe, expect, it, vi } from 'vitest';
import { runAgent } from '../../src/agent/helena.js';
import { ToolRegistry } from '../../src/agent/tools/_registry.js';
import { createCriarAgendamento } from '../../src/agent/tools/criar_agendamento.js';
import { createNotificarTime } from '../../src/agent/tools/notificar_time.js';
import type { LeadCamilaRow } from '../../src/clients/supabase.js';
import { setTestEnv } from '../../src/infra/env.js';

setTestEnv({ AGENT_MAX_TURNS: '4' } as never);

/**
 * SPEC §12: E2E obrigatório — fluxo fantasma rejeitado.
 *
 * Simulates:
 * 1. Model calls criar_agendamento
 * 2. Trinks POST returns 201 with id
 * 3. Trinks GET returns 404 (ghost! write not confirmed)
 * 4. Tool returns { status: 'erro', razao: 'Escrita não confirmada...' }
 * 5. Model sees erro → does NOT say "confirmado" → calls notificar_time
 */
describe('E2E: fluxo fantasma rejeitado', () => {
	it('ghost scenario: POST ok + GET 404 → agent calls notificar_time instead of confirming', async () => {
		const sentTexts: string[] = [];
		const notifyCalls: Array<Record<string, unknown>> = [];

		// Trinks mock: POST ok, GET 404 (ghost!)
		const trinks = {
			listClientes: vi.fn().mockResolvedValue({
				data: [
					{ id: 100, nome: 'Maria', telefones: [{ ddi: '55', ddd: '71', telefone: '999999999' }] },
				],
			}),
			createCliente: vi.fn(),
			createAgendamento: vi.fn().mockResolvedValue({
				id: 500000001,
				status: { id: 1, nome: 'Agendado' },
				cliente: { id: 100, nome: 'Maria' },
				servico: { id: 10, nome: 'Volume Brasileiro' },
				profissional: { id: 170223, nome: 'Camila' },
				dataHoraInicio: '2026-05-20T14:00:00',
				duracaoEmMinutos: 120,
				valor: 160,
			}),
			// 🔴 THE GHOST: GET returns 404 after successful POST
			getAgendamento: vi
				.fn()
				.mockRejectedValue(new Error('Trinks: GET /v1/agendamentos/500000001 returned 404')),
			getCliente: vi.fn().mockResolvedValue({ id: 100, nome: 'Maria' }),
		};

		const supabase = {
			findServicoByName: vi
				.fn()
				.mockResolvedValue({
					id: 10,
					nome: 'Volume Brasileiro',
					duracao_em_minutos: 120,
					preco: 160,
				}),
			upsertAgendamento: vi.fn(),
			raw: {
				from: vi
					.fn()
					.mockReturnValue({
						update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
					}),
			},
		};

		const postgres = { findClienteByPhone: vi.fn().mockResolvedValue(null) };
		const uazapi = {
			sendText: vi.fn().mockImplementation(async (_: string, text: string) => {
				sentTexts.push(text);
			}),
		};

		// Build registry with criar_agendamento + notificar_time
		const registry = new ToolRegistry();
		registry.register(
			createCriarAgendamento({
				trinks: trinks as never,
				supabase: supabase as never,
				postgres: postgres as never,
				profissionalId: 170223,
			}),
		);
		registry.register(createNotificarTime({ uazapi: uazapi as never }));

		// OpenAI mock: model calls criar_agendamento → sees erro → calls notificar_time → sends apology
		const openai = {
			chat: vi
				.fn()
				// Turn 1: model decides to create agendamento
				.mockResolvedValueOnce({
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc1',
								type: 'function',
								function: {
									name: 'criar_agendamento',
									arguments: JSON.stringify({
										telefone: '5571999999999',
										nome: 'Maria',
										servico: 'Volume Brasileiro',
										data_e_hora: '2026-05-20T14:00:00',
									}),
								},
							},
						],
					},
					finishReason: 'tool_calls',
				})
				// Turn 2: model sees erro → calls notificar_time (as prompt instructs)
				.mockResolvedValueOnce({
					message: {
						content: null,
						tool_calls: [
							{
								id: 'tc2',
								type: 'function',
								function: {
									name: 'notificar_time',
									arguments: JSON.stringify({
										motivo: 'Agendamento fantasma',
										contexto: 'POST retornou 201 mas GET retornou 404',
										urgencia: 'alta',
									}),
								},
							},
						],
					},
					finishReason: 'tool_calls',
				})
				// Turn 3: model sends apology text
				.mockResolvedValueOnce({
					message: {
						content: 'Tive um probleminha técnico. Já chamei a Camila pra confirmar seu horário 💖',
						tool_calls: null,
					},
					finishReason: 'stop',
				}),
		};

		const memory = {
			loadRecent: vi.fn().mockResolvedValue([]),
			save: vi.fn().mockResolvedValue(undefined),
		};

		const lead: LeadCamilaRow = {
			id: 'uuid',
			telefone: '5571999999999',
			nome: 'Maria',
			primeira_interacao: '',
			ultimo_contato: '',
			pdf_catalogo_enviado_em: null,
			pdf_curso_enviado_em: null,
			sinal_pago: false,
			agendamento_pendente_id: null,
			ia_ativa: true,
			etiquetas: [],
			ultimo_servico: null,
			ultimo_agendamento_em: null,
			metadata: {},
			created_at: '',
			updated_at: '',
		};

		await runAgent(
			{
				telefone: '5571999999999',
				mensagem: 'Quero agendar volume brasileiro pra amanhã 14h',
				lead,
			},
			{
				openai: openai as never,
				uazapi: uazapi as never,
				supabase: supabase as never,
				memory: memory as never,
				toolRegistry: registry,
			},
		);

		// ── Assertions ──

		// 1. criar_agendamento was called and POST succeeded
		expect(trinks.createAgendamento).toHaveBeenCalled();

		// 2. GET was called for verification (and returned 404)
		expect(trinks.getAgendamento).toHaveBeenCalledWith(500000001);

		// 3. notificar_time was called (model reacted to the error)
		// The notificar_time tool sends to the group — check uazapi.sendText was called with group message
		const groupMessages = sentTexts.filter((t) => t.includes('Notificação Helena'));
		expect(groupMessages.length).toBeGreaterThanOrEqual(1);

		// 4. Final message to client does NOT contain "confirmado" or "agendado" — ghost rejected
		const clientMessage = sentTexts[sentTexts.length - 1];
		expect(clientMessage).toBeDefined();
		expect(clientMessage?.toLowerCase()).not.toContain('confirmado');
		expect(clientMessage?.toLowerCase()).not.toContain('agendado com sucesso');

		// 5. Final message contains apology / escalation
		expect(clientMessage).toContain('probleminha');
	});
});
