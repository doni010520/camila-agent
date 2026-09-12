/**
 * Política de compromisso da cliente (pedido da Camila, 12/09/26).
 *
 * Cliente que remarca ou falta demais passa a SÓ conseguir horário pagando o
 * sinal antes — a Helena não remarca mais de graça. Remarcações e faltas somam
 * no mesmo contador; a cliente se redime cumprindo atendimentos sem furar.
 *
 * A decisão fica no CÓDIGO, não no LLM — mesma lição do VIP (ver `isLeadVip`),
 * que falhava quando o modelo tinha que interpretar etiquetas cruas.
 */

/** Remarcações + faltas a partir das quais o sinal passa a ser obrigatório. */
export const LIMITE_STRIKES = 3;

/** Atendimentos concluídos sem furo que zeram o histórico da cliente. */
export const ATENDIMENTOS_PARA_LIMPAR = 2;

/** Etiqueta que a Camila liga na mão (`#sinal-on`) pra forçar a regra. */
export const ETIQUETA_SINAL_SEMPRE = 'sinal-sempre';

export type HistoricoCompromisso = {
	remarcacoes: number;
	faltas: number;
	/** Atendimentos concluídos SEGUIDOS desde o último furo. */
	atendimentos_limpos: number;
};

type LeadParcial = {
	etiquetas?: string[] | null;
	metadata?: Record<string, unknown> | null;
};

const HISTORICO_ZERADO: HistoricoCompromisso = {
	remarcacoes: 0,
	faltas: 0,
	atendimentos_limpos: 0,
};

/** Lixo no jsonb (string, null, negativo) vira 0 em vez de contaminar a conta. */
function contador(valor: unknown): number {
	return typeof valor === 'number' && Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 0;
}

export function lerHistorico(lead: LeadParcial): HistoricoCompromisso {
	const bruto = (lead.metadata?.compromisso ?? {}) as Record<string, unknown>;
	return {
		remarcacoes: contador(bruto.remarcacoes),
		faltas: contador(bruto.faltas),
		atendimentos_limpos: contador(bruto.atendimentos_limpos),
	};
}

export function exigeSinalSempre(lead: LeadParcial): boolean {
	const marcadaNaMao = (lead.etiquetas ?? []).some(
		(e) => e.toLowerCase() === ETIQUETA_SINAL_SEMPRE,
	);
	if (marcadaNaMao) return true;

	const h = lerHistorico(lead);
	return h.remarcacoes + h.faltas >= LIMITE_STRIKES;
}

function registrarFuro(h: HistoricoCompromisso, campo: 'remarcacoes' | 'faltas') {
	return { ...h, [campo]: h[campo] + 1, atendimentos_limpos: 0 };
}

export function registrarRemarcacao(h: HistoricoCompromisso): HistoricoCompromisso {
	return registrarFuro(h, 'remarcacoes');
}

export function registrarFalta(h: HistoricoCompromisso): HistoricoCompromisso {
	return registrarFuro(h, 'faltas');
}

export function registrarAtendimentoConcluido(h: HistoricoCompromisso): HistoricoCompromisso {
	const limpos = h.atendimentos_limpos + 1;
	if (limpos >= ATENDIMENTOS_PARA_LIMPAR) return { ...HISTORICO_ZERADO };
	return { ...h, atendimentos_limpos: limpos };
}

export type EventoCompromisso = 'remarcacao' | 'falta' | 'atendimento_concluido';

/**
 * Traduz o resultado de uma tool em furo de compromisso.
 * Só conta quando a tool REALMENTE concluiu (`ok`) — erro ou pedido de escolha
 * não significa que a cliente remarcou.
 */
export function eventoCompromissoDaTool(
	nomeDaTool: string,
	status: string,
): EventoCompromisso | null {
	if (status !== 'ok') return null;
	if (nomeDaTool === 'reagendar_agendamento') return 'remarcacao';
	if (nomeDaTool === 'marcar_falta') return 'falta';
	return null;
}
