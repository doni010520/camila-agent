import { type SupabaseClient, createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

// ═══════════════════════════════════════════════════════════════
// Schemas — Supabase tables (from REFERENCE-PAYLOADS §6 + SPEC §4)
// ═══════════════════════════════════════════════════════════════

export const agendamentoRowSchema = z.object({
	id: z.number(),
	status_id: z.number().nullable().optional(),
	cliente_id: z.number().nullable().optional(),
	cliente_nome: z.string().nullable().optional(),
	servico_id: z.number().nullable().optional(),
	servico_nome: z.string().nullable().optional(),
	profissional_id: z.number().nullable().optional(),
	profissional_nome: z.string().nullable().optional(),
	data_hora_inicio: z.string().nullable().optional(),
	duracao_em_minutos: z.number().nullable().optional(),
	observacoes_estabelecimento: z.string().nullable().optional(),
	observacoes_cliente: z.string().nullable().optional(),
	valor: z.number().nullable().optional(),
	data_agendamento: z.string().nullable().optional(),
	numero: z.string().nullable().optional(),
	ultimo_agendamento: z.string().nullable().optional(),
	ultimo_servico: z.string().nullable().optional(),
	lembrete_enviado_em: z.string().nullable().optional(),
	enquete_finalizacao_enviada_em: z.string().nullable().optional(),
	created_at: z.string().nullable().optional(),
	updated_at: z.string().nullable().optional(),
});

/**
 * Lead row schema — uses the legacy `leads_energia_solar` table (kept for historical data).
 * The table has BOTH legacy fields (Levesol leftover + n8n velho) and new fields (added via ALTER TABLE):
 *  - Legacy boolean flags (`pdf_enviado_nesta_conversa`, `ia_on_off`, `pdf_curso_enviado`) → kept for n8n compatibility
 *  - New timestamptz flags (`pdf_catalogo_enviado_em`, etc) → used by camila-agent
 *
 * IMPORTANT: We map `ia_on_off` (existing boolean) to our domain concept of `ia_ativa`.
 */
export const leadCamilaRowSchema = z.object({
	id: z.string().uuid(),
	telefone: z.string(),
	nome: z.string().nullable().optional(),
	created_at: z.string(),
	ultimo_contato: z.string().nullable().optional(),

	// New columns (added by ALTER TABLE for camila-agent)
	pdf_catalogo_enviado_em: z.string().nullable().optional(),
	pdf_curso_enviado_em: z.string().nullable().optional(),
	ultimo_agendamento_em: z.string().nullable().optional(),
	ultimo_servico: z.string().nullable().optional(),
	etiquetas: z.array(z.string()).default([]),
	sinal_pago: z.boolean().default(false),
	agendamento_pendente_id: z.number().nullable().optional(),
	metadata: z.record(z.unknown()).default({}),

	// Legacy columns from Levesol/n8n velho (kept for backward compat)
	ia_on_off: z.string().nullable().optional(),  // 'on' | 'off' (text, NOT boolean!)
	pdf_enviado_nesta_conversa: z.boolean().nullable().optional(),
	status_funil_vendas: z.string().nullable().optional(),
});

export const servicoRowSchema = z.object({
	id: z.number(),
	nome: z.string(),
	duracao_minutos: z.number(),  // real column name in Supabase (NOT duracao_em_minutos)
	preco: z.coerce.number().nullable().optional(),  // stored as numeric, may come as string
	categoria: z.string().nullable().optional(),
	descricao: z.string().nullable().optional(),
	visivel_cliente: z.boolean().nullable().optional(),
});

export type AgendamentoRow = z.infer<typeof agendamentoRowSchema>;
export type LeadCamilaRow = z.infer<typeof leadCamilaRowSchema>;
export type ServicoRow = z.infer<typeof servicoRowSchema>;

// ═══════════════════════════════════════════════════════════════
// Client
// ═══════════════════════════════════════════════════════════════

export interface SupabaseClientConfig {
	url?: string;
	serviceRoleKey?: string;
	storageBucket?: string;
	logger?: Logger;
}

export class AppSupabaseClient {
	private readonly client: SupabaseClient;
	private readonly storageBucket: string;
	private readonly log: Logger;

	constructor(config?: SupabaseClientConfig) {
		const env = getEnv();
		const url = config?.url ?? env.SUPABASE_URL;
		const key = config?.serviceRoleKey ?? env.SUPABASE_SERVICE_ROLE_KEY;
		this.storageBucket = config?.storageBucket ?? env.SUPABASE_STORAGE_BUCKET;
		this.log = config?.logger ?? rootLogger.child({ client: 'supabase' });
		this.client = createClient(url, key);
	}

	get raw(): SupabaseClient {
		return this.client;
	}

	// ── Agendamentos (espelho local) ──

	async upsertAgendamento(row: Partial<AgendamentoRow> & { id: number }): Promise<void> {
		const { error } = await this.client
			.from('agendamentos')
			.upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'id' });
		if (error) {
			this.log.error({ error, id: row.id }, 'Failed to upsert agendamento');
			throw new Error(`Supabase upsert agendamento: ${error.message}`);
		}
	}

	async getAgendamento(id: number): Promise<AgendamentoRow | null> {
		const { data, error } = await this.client
			.from('agendamentos')
			.select('*')
			.eq('id', id)
			.maybeSingle();
		if (error) throw new Error(`Supabase get agendamento: ${error.message}`);
		return data ? agendamentoRowSchema.parse(data) : null;
	}

	async listAgendamentosByCliente(
		clienteId: number,
		onlyActive = false,
	): Promise<AgendamentoRow[]> {
		let query = this.client.from('agendamentos').select('*').eq('cliente_id', clienteId);
		if (onlyActive) query = query.in('status_id', [1, 2, 3, 4]);
		const { data, error } = await query.order('data_hora_inicio', { ascending: false });
		if (error) throw new Error(`Supabase list agendamentos: ${error.message}`);
		return (data ?? []).map((r) => agendamentoRowSchema.parse(r));
	}

	async markLembreteEnviado(id: number): Promise<void> {
		const { error } = await this.client
			.from('agendamentos')
			.update({ lembrete_enviado_em: new Date().toISOString() })
			.eq('id', id);
		if (error) throw new Error(`Supabase mark lembrete: ${error.message}`);
	}

	async markEnqueteEnviada(id: number): Promise<void> {
		const { error } = await this.client
			.from('agendamentos')
			.update({ enquete_finalizacao_enviada_em: new Date().toISOString() })
			.eq('id', id);
		if (error) throw new Error(`Supabase mark enquete: ${error.message}`);
	}

	// ── Serviços (cache local) ──

	async listServicos(): Promise<ServicoRow[]> {
		const { data, error } = await this.client.from('servicos').select('*');
		if (error) throw new Error(`Supabase list servicos: ${error.message}`);
		return (data ?? []).map((r) => servicoRowSchema.parse(r));
	}

	async upsertServico(row: ServicoRow): Promise<void> {
		const { error } = await this.client.from('servicos').upsert(row, { onConflict: 'id' });
		if (error) throw new Error(`Supabase upsert servico: ${error.message}`);
	}

	async findServicoByName(nome: string): Promise<ServicoRow | null> {
		const { data, error } = await this.client
			.from('servicos')
			.select('*')
			.ilike('nome', `%${nome}%`)
			.limit(1)
			.maybeSingle();
		if (error) throw new Error(`Supabase find servico: ${error.message}`);
		return data ? servicoRowSchema.parse(data) : null;
	}

	// ── Storage (catálogos bucket) ──

	async getPublicUrl(path: string): Promise<string> {
		const { data } = this.client.storage.from(this.storageBucket).getPublicUrl(path);
		return data.publicUrl;
	}

	async downloadFile(path: string): Promise<Uint8Array> {
		const { data, error } = await this.client.storage.from(this.storageBucket).download(path);
		if (error || !data)
			throw new Error(`Supabase download ${path}: ${error?.message ?? 'no data'}`);
		return new Uint8Array(await data.arrayBuffer());
	}
}
