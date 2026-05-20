/**
 * Trinks appointment status IDs.
 *
 * IMPORTANT: These IDs were discovered empirically via direct API inspection.
 * The Trinks public docs are unclear; do NOT assume sequential numbering.
 *
 * Confirmed (seen in real data):
 *  - 3: Aguardando Confirmação do Estabelecimento
 *  - 4: Confirmado
 *  - 9: Cancelado  ← NOT 7!
 *
 * Likely (used in PATCH endpoints but not yet seen as listed status):
 *  - 1: Agendado
 *  - 5: Em atendimento
 *  - 6: Finalizado
 *  - 8: Cliente não compareceu
 */
export const TRINKS_STATUS = {
	AGENDADO: 1,
	AGUARDANDO_CONFIRMACAO: 2,
	AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO: 3,
	CONFIRMADO: 4,
	EM_ATENDIMENTO: 5,
	FINALIZADO: 6,
	CLIENTE_FALTOU: 8,
	CANCELADO: 9,
} as const;

/** Statuses where the agendamento is still "alive" (not concluded). */
export const ACTIVE_STATUSES: ReadonlySet<number> = new Set([
	TRINKS_STATUS.AGENDADO,
	TRINKS_STATUS.AGUARDANDO_CONFIRMACAO,
	TRINKS_STATUS.AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO,
	TRINKS_STATUS.CONFIRMADO,
	TRINKS_STATUS.EM_ATENDIMENTO,
]);

/** Statuses where the agendamento is concluded (cancelled, no-show, or finished). */
export const INACTIVE_STATUSES: ReadonlySet<number> = new Set([
	TRINKS_STATUS.FINALIZADO,
	TRINKS_STATUS.CLIENTE_FALTOU,
	TRINKS_STATUS.CANCELADO,
]);

export const STATUS_NAMES: Record<number, string> = {
	1: 'Agendado',
	2: 'Aguardando confirmação',
	3: 'Aguardando Confirmação do Estabelecimento',
	4: 'Confirmado',
	5: 'Em atendimento',
	6: 'Finalizado',
	8: 'Cliente não compareceu',
	9: 'Cancelado',
};
