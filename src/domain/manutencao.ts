/**
 * Mapeia o serviço executado hoje para o serviço de manutenção correspondente
 * (15 dias depois). Usado pelo fluxo de auto-agendamento de manutenção após
 * Camila confirmar finalização.
 *
 * Regra de negócio (definida com a Camila):
 * - Janela padrão de manutenção: 15 dias após o procedimento
 * - Mesmo horário do procedimento original (cliente já sabe que dá certo)
 * - Cílio é um por dia: se cliente tem outro agendamento em 15 dias, oferta
 *   é descartada e Helena pergunta data alternativa
 */

const MANUTENCAO_POR_SERVICO: Record<string, string> = {
	'Volume light': 'Manutenção volume light 15 dias',
	'Volume Russo': 'Manutenção volume Russo 15 dias',
	'Volume Brasileiro': 'Manutenção volume brasileiro 15 dias',
	'Volume híbrido': 'Manutenção volume híbrido 15 dias',
	'Mega volume': 'Manutenção Mega Volume 15 dias',
	'Volume 30+': 'Manutenção Mega Volume 15 dias', // alias plausível — confirmar
	'Volume express': 'Manutenção volume light 15 dias', // fallback
	'Cílios marrons': 'Manutenção 15 dias cílios marrons',
	'Efeito Fox': 'Manutenção fox 15 dias',
	'efeito flecha': 'Manutenção efeito flecha 15 dias',
	'Manutenção Efeito molhado': 'Manutenção Efeito molhado', // ciclo se repete
};

/**
 * Dado o nome do serviço de hoje, retorna o nome do serviço de manutenção
 * (15 dias). Se já for manutenção, retorna o próprio. Null se não mapeável.
 */
export function getManutencaoServiceName(servicoNome: string): string | null {
	// Já é manutenção → o próximo é a mesma manutenção
	if (/manuten|manten|mantenç/i.test(servicoNome)) return servicoNome;
	return MANUTENCAO_POR_SERVICO[servicoNome] ?? null;
}

/**
 * Calcula a data/hora da próxima manutenção a partir de uma data/hora ISO.
 * Adiciona 15 dias mantendo o mesmo horário. Retorna ISO sem timezone (BRT naive).
 */
export function calcularProximaManutencao(
	dataHoraInicioOriginal: string,
	diasAdicionados = 15,
): string {
	// Trinks devolve naive BRT — ex: "2026-05-26T14:00:00"
	// Pra evitar bug de TZ, calcula só na parte da data.
	const m = dataHoraInicioOriginal.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
	if (!m) throw new Error(`Data inválida: ${dataHoraInicioOriginal}`);
	const [, ano, mes, dia, hh, mm] = m;
	const d = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia)));
	d.setUTCDate(d.getUTCDate() + diasAdicionados);
	const novaData = d.toISOString().slice(0, 10); // YYYY-MM-DD
	return `${novaData}T${hh}:${mm}:00`;
}

/**
 * Formata data/hora ISO naive BRT em texto pra cliente: "sábado, 14/06 às 14h".
 */
export function formatarDataManutencao(isoNaive: string): string {
	const m = isoNaive.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
	if (!m) return isoNaive;
	const [, ano, mes, dia, hh, mm] = m;
	const dataObj = new Date(`${ano}-${mes}-${dia}T12:00:00-03:00`);
	const DIAS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
	const diaSemana = DIAS[dataObj.getDay()] ?? '';
	const horaFmt = mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
	return `${diaSemana}, ${dia}/${mes} às ${horaFmt}`;
}
