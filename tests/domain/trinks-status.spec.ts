import { describe, expect, it } from 'vitest';
import { ACTIVE_STATUSES, STATUS_NAMES, TRINKS_STATUS } from '../../src/domain/trinks-status.js';

/**
 * Os IDs 6 e 8 estavam INVERTIDOS no código (eram chutes — o comentário original
 * dizia "Likely… not yet seen as listed status").
 *
 * Medido na API real da Trinks em 28/08/2026, varrendo os agendamentos de agosto
 * do estabelecimento 44992:
 *   3 = Aguardando Confirmação do Estabelecimento
 *   4 = Confirmado
 *   6 = Cliente não compareceu   ← o código chamava de FINALIZADO
 *   8 = Finalizado               ← o código chamava de CLIENTE_FALTOU
 *   9 = Cancelado
 *
 * Confirmado também pelo log de produção de 27/08/2026 19:04:
 *   "Finalize verify failed {agId:521608805, status:{id:8, nome:'Finalizado'}}"
 */
describe('TRINKS_STATUS (IDs medidos na API real)', () => {
	it('FINALIZADO é 8', () => {
		expect(TRINKS_STATUS.FINALIZADO).toBe(8);
	});

	it('CLIENTE_FALTOU é 6', () => {
		expect(TRINKS_STATUS.CLIENTE_FALTOU).toBe(6);
	});

	it('STATUS_NAMES usa os nomes que a Trinks devolve', () => {
		expect(STATUS_NAMES[8]).toBe('Finalizado');
		expect(STATUS_NAMES[6]).toBe('Cliente não compareceu');
		expect(STATUS_NAMES[9]).toBe('Cancelado');
	});

	it('nem finalizado nem faltou contam como agendamento ativo', () => {
		expect(ACTIVE_STATUSES.has(TRINKS_STATUS.FINALIZADO)).toBe(false);
		expect(ACTIVE_STATUSES.has(TRINKS_STATUS.CLIENTE_FALTOU)).toBe(false);
	});
});
