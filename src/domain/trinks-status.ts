/**
 * Trinks appointment status IDs.
 *
 * ⚠️ VERIFICADOS NA API REAL em 28/08/2026 (varredura dos agendamentos de agosto
 * do estabelecimento 44992). Os IDs 6 e 8 estavam TROCADOS no código — eram
 * suposição, não medição. O log de produção de 27/08 flagrou:
 *   "Finalize verify failed {agId:521608805, status:{id:8, nome:'Finalizado'}}"
 *
 * Confirmados (vistos em dados reais, com o nome que a Trinks devolve):
 *  - 3: Aguardando Confirmação do Estabelecimento
 *  - 4: Confirmado
 *  - 6: Cliente não compareceu
 *  - 8: Finalizado
 *  - 9: Cancelado
 *
 * Ainda não observados em dados reais (usados só nos PATCH):
 *  - 1: Agendado
 *  - 2: Aguardando confirmação
 *  - 5: Em atendimento
 *
 * Ao mexer aqui, MEÇA na API antes — não deduza pela numeração.
 */
export const TRINKS_STATUS = {
	AGENDADO: 1,
	AGUARDANDO_CONFIRMACAO: 2,
	AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO: 3,
	CONFIRMADO: 4,
	EM_ATENDIMENTO: 5,
	CLIENTE_FALTOU: 6,
	FINALIZADO: 8,
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
	6: 'Cliente não compareceu',
	8: 'Finalizado',
	9: 'Cancelado',
};
