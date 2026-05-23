import type { AppSupabaseClient, LeadCamilaRow } from '../clients/supabase.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

/** Hours before a conversation is considered "new" (resets pdf_catalogo_enviado_em) */
const NEW_CONVERSATION_HOURS = 6;

export type LeadUpsertInput = {
	telefone: string;
	nome?: string;
	wa_label?: string;
};

export class LeadManager {
	private readonly supabase: AppSupabaseClient;
	private readonly log: Logger;

	constructor(supabase: AppSupabaseClient, logger?: Logger) {
		this.supabase = supabase;
		this.log = logger ?? rootLogger.child({ module: 'lead' });
	}

	/**
	 * Get or create a lead. If the last contact was >6h ago, reset pdf_catalogo_enviado_em
	 * (SPEC §4.1 "nova conversa" rule).
	 */
	async getOrCreate(input: LeadUpsertInput): Promise<LeadCamilaRow> {
		const { data: existing, error: fetchErr } = await this.supabase.raw
			.from('leads_energia_solar')
			.select('*')
			.eq('telefone', input.telefone)
			.maybeSingle();

		if (fetchErr) throw new Error(`Lead fetch: ${fetchErr.message}`);

		const now = new Date();

		if (existing) {
			const lead = existing as LeadCamilaRow;
			const lastContact = lead.ultimo_contato ? new Date(lead.ultimo_contato) : new Date(0);
			const hoursSince = (now.getTime() - lastContact.getTime()) / (1000 * 60 * 60);
			const isNewConversation = hoursSince >= NEW_CONVERSATION_HOURS;

			const updates: Record<string, unknown> = { ultimo_contato: now.toISOString() };
			if (input.nome && !lead.nome) updates.nome = input.nome;
			if (isNewConversation) {
				updates.pdf_catalogo_enviado_em = null;
				this.log.info(
					{ telefone: input.telefone.slice(-8), hoursSince: Math.round(hoursSince) },
					'New conversation, resetting pdf flag',
				);
			}

			// Parse wa_label for etiquetas
			const currentEtiquetas = lead.etiquetas ?? [];
			if (input.wa_label && !currentEtiquetas.includes(input.wa_label)) {
				updates.etiquetas = [...currentEtiquetas, input.wa_label];
			}

			const { data: updated, error: updateErr } = await this.supabase.raw
				.from('leads_energia_solar')
				.update(updates)
				.eq('id', lead.id)
				.select('*')
				.single();

			if (updateErr) throw new Error(`Lead update: ${updateErr.message}`);
			return updated as LeadCamilaRow;
		}

		// Create new lead — using ia_on_off (legacy column, TEXT 'on'/'off', not boolean)
		const newLead = {
			telefone: input.telefone,
			nome: input.nome ?? null,
			etiquetas: input.wa_label ? [input.wa_label] : [],
			ia_on_off: 'on',
			sinal_pago: false,
			metadata: {},
			ultimo_contato: now.toISOString(),
		};

		const { data: created, error: createErr } = await this.supabase.raw
			.from('leads_energia_solar')
			.insert(newLead)
			.select('*')
			.single();

		if (createErr) throw new Error(`Lead create: ${createErr.message}`);
		this.log.info({ telefone: input.telefone.slice(-8) }, 'New lead created');
		return created as LeadCamilaRow;
	}

	async updateLead(telefone: string, updates: Partial<LeadCamilaRow>): Promise<void> {
		const { error } = await this.supabase.raw
			.from('leads_energia_solar')
			.update(updates)
			.eq('telefone', telefone);
		if (error) throw new Error(`Lead update: ${error.message}`);
	}

	async setVip(telefone: string, isVip: boolean): Promise<string[]> {
		const lead = await this.getLead(telefone);
		if (!lead) throw new Error('Lead não encontrado');
		const current = lead.etiquetas ?? [];
		const filtered = current.filter((e) => !e.toLowerCase().includes('vip'));
		const next = isVip ? [...filtered, 'vip'] : filtered;
		await this.updateLead(telefone, { etiquetas: next });
		this.log.info({ telefone: telefone.slice(-8), vip: isVip }, 'VIP status changed');
		return next;
	}

	/**
	 * Marks that a human (Camila, team) typed manually in the conversation.
	 * Helena stays silent for INTERVENCAO_TTL_MIN minutes from this timestamp.
	 */
	async setIntervencaoHumana(telefone: string): Promise<void> {
		const lead = await this.getLead(telefone);
		if (!lead) return; // unknown lead — nothing to mark
		const meta = { ...(lead.metadata ?? {}) } as Record<string, unknown>;
		meta.intervencao_humana_em = new Date().toISOString();
		await this.updateLead(telefone, { metadata: meta as LeadCamilaRow['metadata'] });
		this.log.info({ telefone: telefone.slice(-8) }, 'Intervenção humana registrada');
	}

	/**
	 * Returns minutes elapsed since the last human intervention,
	 * or null if there has never been one (Helena proceeds normally).
	 */
	minutosDesdeIntervencao(lead: LeadCamilaRow): number | null {
		const meta = (lead.metadata ?? {}) as Record<string, unknown>;
		const ts = typeof meta.intervencao_humana_em === 'string' ? meta.intervencao_humana_em : null;
		if (!ts) return null;
		const ms = Date.now() - new Date(ts).getTime();
		if (!Number.isFinite(ms) || ms < 0) return null;
		return ms / (1000 * 60);
	}

	async setIaAtiva(telefone: string, active: boolean): Promise<void> {
		// ia_on_off is TEXT 'on'/'off' (legacy n8n format), not boolean.
		// Quando desativa, registra timestamp em metadata.ia_off_since pra TTL automático.
		const lead = await this.getLead(telefone);
		const meta = { ...(lead?.metadata ?? {}) } as Record<string, unknown>;
		if (active) {
			delete meta.ia_off_since;
		} else {
			meta.ia_off_since = new Date().toISOString();
		}
		await this.updateLead(telefone, {
			ia_on_off: active ? 'on' : 'off',
			metadata: meta as LeadCamilaRow['metadata'],
		});
		this.log.info({ telefone: telefone.slice(-8), ia_ativa: active }, 'IA status changed');
	}

	/** Auto-reactivate IA if it has been off for more than `maxHours` hours (default 24h). */
	async maybeAutoReactivate(lead: LeadCamilaRow, maxHours = 24): Promise<boolean> {
		if (lead.ia_on_off !== 'off') return false;
		const meta = (lead.metadata ?? {}) as Record<string, unknown>;
		const since = typeof meta.ia_off_since === 'string' ? meta.ia_off_since : undefined;
		if (!since) return false;
		const hours = (Date.now() - new Date(since).getTime()) / (1000 * 60 * 60);
		if (hours < maxHours) return false;
		await this.setIaAtiva(lead.telefone, true);
		this.log.info(
			{ telefone: lead.telefone.slice(-8), hoursOff: Math.round(hours) },
			'IA auto-reactivated after TTL',
		);
		return true;
	}

	/** Check if IA is active for this lead (reads ia_on_off legacy column) */
	isIaAtiva(lead: LeadCamilaRow): boolean {
		// 'on' or null → ativa; only 'off' disables
		return lead.ia_on_off !== 'off';
	}

	async markSinalPago(telefone: string): Promise<void> {
		await this.updateLead(telefone, { sinal_pago: true });
	}

	async markPdfCatalogoEnviado(telefone: string): Promise<void> {
		await this.updateLead(telefone, { pdf_catalogo_enviado_em: new Date().toISOString() });
	}

	async markPdfCursoEnviado(telefone: string): Promise<void> {
		await this.updateLead(telefone, { pdf_curso_enviado_em: new Date().toISOString() });
	}

	async getLead(telefone: string): Promise<LeadCamilaRow | null> {
		const { data, error } = await this.supabase.raw
			.from('leads_energia_solar')
			.select('*')
			.eq('telefone', telefone)
			.maybeSingle();
		if (error) throw new Error(`Lead get: ${error.message}`);
		return data as LeadCamilaRow | null;
	}

	/** Check if PDF catálogo was sent within the last 6h */
	wasCatalogoSentRecently(lead: LeadCamilaRow): boolean {
		if (!lead.pdf_catalogo_enviado_em) return false;
		const sent = new Date(lead.pdf_catalogo_enviado_em);
		const hours = (Date.now() - sent.getTime()) / (1000 * 60 * 60);
		return hours < NEW_CONVERSATION_HOURS;
	}

	/** Check if lead is VIP (has the known VIP label from production) */
	isVip(lead: LeadCamilaRow): boolean {
		return lead.etiquetas.some(
			(e) => e.includes('557196416018:9') || e.toLowerCase().includes('vip'),
		);
	}
}
