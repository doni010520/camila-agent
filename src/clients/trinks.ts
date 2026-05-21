import { z } from 'zod';
import { getEnv } from '../infra/env.js';
import { TrinksError } from '../infra/errors.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';
import { isRetryableStatus, withRetry } from '../infra/retry.js';

// ═══════════════════════════════════════════════════════════════
// Schemas — derived from REFERENCE-PAYLOADS.md (real production)
// ═══════════════════════════════════════════════════════════════

// Nested ref: { id, nome } — used in agendamento GET responses
const trinksRefSchema = z.object({ id: z.number(), nome: z.string() });

// ── Phone: GET returns `telefone`, POST requires `numero` (Trinks asymmetry) ──
export const trinksPhoneGetSchema = z.object({
	ddi: z.string().nullable().optional(),
	ddd: z.string().nullable().optional(),
	telefone: z.string(),
});

export const trinksPhonePostSchema = z.object({
	ddi: z.string(),
	ddd: z.string(),
	numero: z.string(),
	tipoId: z.number().default(1),
});

// ── Cliente ──
export const trinksClienteSchema = z.object({
	id: z.number(),
	dataCadastro: z.string().nullable().optional(),
	email: z.string().nullable().optional(),
	nome: z.string(),
	cpf: z.string().nullable().optional(),
	telefones: z.array(trinksPhoneGetSchema).optional(),
	clienteDetalhes: z.unknown().nullable().optional(),
});

export const trinksClienteListSchema = z.object({
	data: z.array(trinksClienteSchema),
	page: z.number().optional(),
	pageSize: z.number().optional(),
	totalPages: z.number().optional(),
	totalRecords: z.number().optional(),
});

export const trinksCreateClienteInputSchema = z.object({
	nome: z.string().min(1),
	email: z.string().email().optional(),
	cpf: z.string().optional(),
	telefones: z.array(trinksPhonePostSchema).min(1),
	preferencias: z
		.object({
			recebeSMSLembreteDeAgendamento: z.boolean().default(true),
			recebeEmailLembreteDeAgendamento: z.boolean().default(true),
			recebeSMSMarketing: z.boolean().default(true),
			recebeEmailMarketing: z.boolean().default(true),
		})
		.optional(),
});

// ── Agendamento ──
export const trinksAgendamentoSchema = z.object({
	id: z.number(),
	status: trinksRefSchema,
	cliente: trinksRefSchema,
	servico: trinksRefSchema,
	profissional: trinksRefSchema,
	dataHoraInicio: z.string(),
	duracaoEmMinutos: z.number(),
	observacoesDoEstabelecimento: z.string().nullable().optional(),
	observacoesDoCliente: z.string().nullable().optional(),
	valor: z.number().nullable().optional(),
});

export const trinksAgendamentoListSchema = z.object({
	data: z.array(trinksAgendamentoSchema),
	page: z.number().optional(),
	pageSize: z.number().optional(),
	totalPages: z.number().optional(),
	totalRecords: z.number().optional(),
});

// POST input: flat IDs (not nested objects) — Trinks asymmetry
export const trinksCreateAgendamentoInputSchema = z.object({
	servicoId: z.number(),
	clienteId: z.number(),
	profissionalId: z.number(),
	dataHoraInicio: z.string(),
	duracaoEmMinutos: z.number().positive(),
	valor: z.number().optional(),
	observacoes: z.string().optional().default(''),
	confirmado: z.boolean().optional().default(false),
});

export const trinksUpdateAgendamentoInputSchema = z.object({
	servicoId: z.number(),
	clienteId: z.number(),
	profissionalId: z.number(),
	dataHoraInicio: z.string(),
	duracaoEmMinutos: z.number().positive(),
	valor: z.number().optional(),
	observacoes: z.string().optional(),
});

// Cancel: QuemCancelou with capital Q (confirmed from real payload)
export const trinksCancelInputSchema = z.object({
	QuemCancelou: z.number().default(1),
	motivo: z.string().optional(),
});

// ── Disponibilidade ──
export const trinksProfissionalAgendaSchema = z.object({
	id: z.number(),
	nome: z.string(),
	horariosVagos: z.array(z.string()).default([]),
	intervalosVagos: z.array(z.object({ inicio: z.string(), fim: z.string() })).default([]),
});

export const trinksProfissionaisAgendaResponseSchema = z.object({
	data: z.array(trinksProfissionalAgendaSchema),
});

// ── Serviço ──
export const trinksServicoSchema = z.object({
	id: z.number(),
	nome: z.string(),
	duracaoEmMinutos: z.number(),
	preco: z.number().nullable().optional(),
	ativo: z.boolean().optional(),
	categoriaId: z.number().nullable().optional(),
	categoriaNome: z.string().nullable().optional(),
});

export const trinksServicoListSchema = z.object({
	data: z.array(trinksServicoSchema),
	page: z.number().optional(),
	pageSize: z.number().optional(),
	totalPages: z.number().optional(),
	totalRecords: z.number().optional(),
});

// ── Profissional ──
export const trinksProfissionalSchema = z.object({
	id: z.number(),
	nome: z.string(),
	ativo: z.boolean().optional(),
	email: z.string().nullable().optional(),
});

export const trinksProfissionalListSchema = z.object({
	data: z.array(trinksProfissionalSchema),
	page: z.number().optional(),
	pageSize: z.number().optional(),
	totalPages: z.number().optional(),
	totalRecords: z.number().optional(),
});

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export type TrinksCliente = z.infer<typeof trinksClienteSchema>;
export type TrinksAgendamento = z.infer<typeof trinksAgendamentoSchema>;
export type TrinksProfissionalAgenda = z.infer<typeof trinksProfissionalAgendaSchema>;
export type TrinksServico = z.infer<typeof trinksServicoSchema>;
export type TrinksCreateClienteInput = z.infer<typeof trinksCreateClienteInputSchema>;
export type TrinksCreateAgendamentoInput = z.infer<typeof trinksCreateAgendamentoInputSchema>;
export type TrinksUpdateAgendamentoInput = z.infer<typeof trinksUpdateAgendamentoInputSchema>;

// ═══════════════════════════════════════════════════════════════
// Client
// ═══════════════════════════════════════════════════════════════

export interface TrinksClientConfig {
	baseUrl?: string;
	apiKey?: string;
	estabelecimentoId?: number;
	dryRun?: boolean;
	logger?: Logger;
}

export class TrinksClient {
	private readonly baseUrl: string;
	private readonly apiKey: string;
	private readonly estabelecimentoId: number;
	private readonly dryRun: boolean;
	private readonly log: Logger;

	constructor(config?: TrinksClientConfig) {
		const env = getEnv();
		this.baseUrl = (config?.baseUrl ?? 'https://api.trinks.com').replace(/\/$/, '');
		this.apiKey = config?.apiKey ?? env.TRINKS_API_KEY;
		this.estabelecimentoId = config?.estabelecimentoId ?? env.TRINKS_ESTABELECIMENTO_ID;
		this.dryRun = config?.dryRun ?? env.TRINKS_DRY_RUN;
		this.log = config?.logger ?? rootLogger.child({ client: 'trinks' });
	}

	// X-Api-Key (confirmed from docs + real n8n workflows + REFERENCE-PAYLOADS.md)
	private headers(): Record<string, string> {
		return {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'X-Api-Key': this.apiKey,
			estabelecimentoId: String(this.estabelecimentoId),
		};
	}

	async typedRequest<S extends z.ZodTypeAny>(
		method: string,
		path: string,
		schema: S,
		body?: unknown,
		params?: Record<string, string>,
	): Promise<z.output<S>> {
		if (this.dryRun && method !== 'GET') {
			return this.syntheticResponse(method, path, schema, body);
		}

		const url = new URL(`${this.baseUrl}${path}`);
		if (params) {
			for (const [k, v] of Object.entries(params)) {
				if (v !== undefined && v !== '') url.searchParams.set(k, v);
			}
		}

		const doRequest = async (): Promise<z.output<S>> => {
			this.log.debug({ method, url: url.toString() }, 'Trinks request');
			const res = await fetch(url.toString(), {
				method,
				headers: this.headers(),
				body: body ? JSON.stringify(body) : undefined,
			});

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new TrinksError(
					`${method} ${path} returned ${res.status}`,
					res.status >= 500 ? 502 : res.status,
					{ status: res.status, body: text },
				);
			}

			const json: unknown = await res.json();
			const parsed = schema.safeParse(json);
			if (!parsed.success) {
				this.log.error(
					{ path, zodErrors: parsed.error.flatten(), rawResponse: json },
					'Trinks response schema mismatch',
				);
				throw new TrinksError(
					`Response schema validation failed for ${method} ${path}`,
					502,
					parsed.error.flatten(),
				);
			}
			return parsed.data as z.output<S>;
		};

		return withRetry(doRequest, {
			maxRetries: 2,
			baseDelayMs: 500,
			shouldRetry: (err) => err instanceof TrinksError && isRetryableStatus(err.statusCode),
			logger: this.log,
			label: `trinks:${method} ${path}`,
		});
	}

	async rawRequest(
		method: string,
		path: string,
		body?: unknown,
	): Promise<{ ok: boolean; status: number; body: string }> {
		if (this.dryRun && method !== 'GET') {
			this.log.info({ method, path, dry_run: true }, 'Trinks dry-run: skipping write');
			return { ok: true, status: 204, body: '{"dry_run":true}' };
		}

		const url = `${this.baseUrl}${path}`;
		const doRequest = async () => {
			const res = await fetch(url, {
				method,
				headers: this.headers(),
				body: body ? JSON.stringify(body) : undefined,
			});
			const text = await res.text().catch(() => '');
			if (!res.ok)
				throw new TrinksError(
					`${method} ${path} returned ${res.status}`,
					res.status >= 500 ? 502 : res.status,
					{ status: res.status, body: text },
				);
			return { ok: true, status: res.status, body: text };
		};

		return withRetry(doRequest, {
			maxRetries: 2,
			baseDelayMs: 500,
			shouldRetry: (err) => err instanceof TrinksError && isRetryableStatus(err.statusCode),
			logger: this.log,
			label: `trinks:${method} ${path}`,
		});
	}

	private syntheticResponse<S extends z.ZodTypeAny>(
		method: string,
		path: string,
		_schema: S,
		body?: unknown,
	): z.output<S> {
		const syntheticId = -Date.now();
		this.log.info({ method, path, syntheticId, dry_run: true }, 'Trinks dry-run');
		const payload = body as Record<string, unknown> | undefined;
		return {
			id: syntheticId,
			status: { id: 1, nome: 'Agendado' },
			cliente: { id: payload?.clienteId ?? syntheticId, nome: 'DryRun' },
			servico: { id: payload?.servicoId ?? 0, nome: 'DryRun' },
			profissional: { id: payload?.profissionalId ?? 170223, nome: 'Camila Rosario' },
			dataHoraInicio: (payload?.dataHoraInicio as string) ?? new Date().toISOString(),
			duracaoEmMinutos: (payload?.duracaoEmMinutos as number) ?? 60,
			valor: null,
			nome: 'DryRun',
			dataCadastro: new Date().toISOString(),
			email: null,
			telefones: [],
			clienteDetalhes: null,
		} as z.output<S>;
	}

	// ═══════════════ Clientes ═══════════════

	async listClientes(filters?: {
		nome?: string;
		cpf?: string;
		telefone?: string;
		email?: string;
		page?: number;
		pageSize?: number;
	}) {
		const params: Record<string, string> = {};
		if (filters?.nome) params.nome = filters.nome;
		if (filters?.cpf) params.cpf = filters.cpf;
		if (filters?.telefone) params.telefone = filters.telefone;
		if (filters?.email) params.email = filters.email;
		if (filters?.page) params.page = String(filters.page);
		if (filters?.pageSize) params.pageSize = String(filters.pageSize);
		return this.typedRequest('GET', '/v1/clientes', trinksClienteListSchema, undefined, params);
	}

	async getCliente(id: number) {
		return this.typedRequest('GET', `/v1/clientes/${id}`, trinksClienteSchema);
	}

	async createCliente(input: TrinksCreateClienteInput) {
		trinksCreateClienteInputSchema.parse(input);
		return this.typedRequest('POST', '/v1/clientes', trinksClienteSchema, input);
	}

	async updateCliente(id: number, input: Partial<TrinksCreateClienteInput>) {
		return this.typedRequest('PUT', `/v1/clientes/${id}`, trinksClienteSchema, input);
	}

	// ═══════════════ Agendamentos ═══════════════

	async listAgendamentos(filters?: {
		clienteId?: number;
		profissionalId?: number;
		dataInicio?: string;
		dataFim?: string;
		page?: number;
		pageSize?: number;
	}) {
		const params: Record<string, string> = {};
		if (filters?.clienteId) params.clienteId = String(filters.clienteId);
		if (filters?.profissionalId) params.profissionalId = String(filters.profissionalId);
		if (filters?.dataInicio) params.dataInicio = filters.dataInicio;
		if (filters?.dataFim) params.dataFim = filters.dataFim;
		if (filters?.page) params.page = String(filters.page);
		if (filters?.pageSize) params.pageSize = String(filters.pageSize);
		return this.typedRequest(
			'GET',
			'/v1/agendamentos',
			trinksAgendamentoListSchema,
			undefined,
			params,
		);
	}

	async getAgendamento(id: number) {
		return this.typedRequest('GET', `/v1/agendamentos/${id}`, trinksAgendamentoSchema);
	}

	async createAgendamento(input: TrinksCreateAgendamentoInput): Promise<{ id: number }> {
		trinksCreateAgendamentoInputSchema.parse(input);
		// Trinks POST /agendamentos returns ONLY { id } — NOT the full agendamento.
		// Use a minimal schema; fetch full details via getAgendamento if needed.
		return this.typedRequest('POST', '/v1/agendamentos', z.object({ id: z.number() }), input);
	}

	async updateAgendamento(id: number, input: TrinksUpdateAgendamentoInput) {
		trinksUpdateAgendamentoInputSchema.parse(input);
		return this.typedRequest('PUT', `/v1/agendamentos/${id}`, trinksAgendamentoSchema, input);
	}

	async confirmarAgendamento(id: number) {
		return this.rawRequest('PATCH', `/v1/agendamentos/${id}/status/confirmado`);
	}

	async cancelarAgendamento(id: number, input?: { motivo?: string }) {
		return this.rawRequest('PATCH', `/v1/agendamentos/${id}/status/cancelado`, {
			QuemCancelou: 1,
			motivo: input?.motivo ?? 'Cancelado a pedido do cliente',
		});
	}

	async finalizarAgendamento(id: number) {
		return this.rawRequest('PATCH', `/v1/agendamentos/${id}/status/finalizado`);
	}
	async marcarClienteFaltou(id: number) {
		return this.rawRequest('PATCH', `/v1/agendamentos/${id}/status/clientefaltou`);
	}

	// ═══════════════ Disponibilidade ═══════════════

	async listProfissionaisComAgenda(data: string) {
		return this.typedRequest(
			'GET',
			`/v1/agendamentos/profissionais/${data}`,
			trinksProfissionaisAgendaResponseSchema,
		);
	}

	async listServicos(filters?: { page?: number; pageSize?: number }) {
		const params: Record<string, string> = {};
		if (filters?.page) params.page = String(filters.page);
		if (filters?.pageSize) params.pageSize = String(filters.pageSize);
		return this.typedRequest('GET', '/v1/servicos', trinksServicoListSchema, undefined, params);
	}

	async listProfissionais(filters?: { page?: number; pageSize?: number }) {
		const params: Record<string, string> = {};
		if (filters?.page) params.page = String(filters.page);
		if (filters?.pageSize) params.pageSize = String(filters.pageSize);
		return this.typedRequest(
			'GET',
			'/v1/profissionais',
			trinksProfissionalListSchema,
			undefined,
			params,
		);
	}
}
