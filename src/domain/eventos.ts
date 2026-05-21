import type { AppSupabaseClient } from '../clients/supabase.js';
import { rootLogger } from '../infra/logger.js';

export type EventoTipo =
	| 'mensagem_recebida'
	| 'agendamento_criado'
	| 'agendamento_cancelado'
	| 'agendamento_reagendado'
	| 'pix_enviado'
	| 'sinal_pago'
	| 'catalogo_enviado'
	| 'curso_enviado'
	| 'transferido_humano'
	| 'erro_tool';

export interface EventoInput {
	telefone?: string;
	tipo: EventoTipo;
	detalhes?: Record<string, unknown>;
	sucesso?: boolean;
	cliente_nome?: string;
	valor?: number;
}

/** Best-effort: nunca lança erro pra cima. Falha silencia em warn log. */
export async function registrarEvento(
	supabase: AppSupabaseClient,
	evento: EventoInput,
): Promise<void> {
	try {
		const { error } = await supabase.raw.from('eventos_helena').insert({
			telefone: evento.telefone ?? null,
			tipo: evento.tipo,
			detalhes: evento.detalhes ?? {},
			sucesso: evento.sucesso ?? true,
			cliente_nome: evento.cliente_nome ?? null,
			valor: evento.valor ?? null,
		});
		if (error) throw new Error(error.message);
	} catch (err) {
		rootLogger
			.child({ module: 'eventos' })
			.warn(
				{ err: err instanceof Error ? err.message : 'unknown', tipo: evento.tipo },
				'registrarEvento failed (silenced)',
			);
	}
}
