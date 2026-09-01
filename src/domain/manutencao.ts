import { horarioCabeNosVagos } from './horario-funcionamento.js';

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
	const DIAS = [
		'domingo',
		'segunda-feira',
		'terça-feira',
		'quarta-feira',
		'quinta-feira',
		'sexta-feira',
		'sábado',
	];
	const diaSemana = DIAS[dataObj.getDay()] ?? '';
	const horaFmt = mm === '00' ? `${Number(hh)}h` : `${Number(hh)}h${mm}`;
	return `${diaSemana}, ${dia}/${mes} às ${horaFmt}`;
}

/**
 * Quantos dias até a próxima manutenção, lido do NOME do serviço.
 *
 * Regra da Camila (01/09/2026): "quem for aplicação deixa sempre 15 dias. As que
 * são fixas já está como manutenção então ela só vai repetir (caso seja 15 dias
 * ou 25 dias)". O catálogo tem os dois intervalos escritos no nome, em ordens
 * diferentes ("... 25 dias" e "Manutenção 25 dias ..."), por isso procuramos o
 * número em qualquer posição.
 */
export function intervaloManutencaoDias(nomeServico: string): 15 | 25 {
	return /\b25\s*dias\b/i.test(nomeServico ?? '') ? 25 : 15;
}

/** Minutos desde 00:00 de um "HH:MM". */
function minutosDoHorario(hhmm: string): number {
	const [h, m] = hhmm.split(':').map(Number);
	return (h ?? 0) * 60 + (m ?? 0);
}

/** Soma dias a uma data YYYY-MM-DD sem passar por fuso. */
function somarDias(dataISO: string, dias: number): string {
	const [a, m, d] = dataISO.split('-').map(Number);
	const dt = new Date(Date.UTC(a ?? 0, (m ?? 1) - 1, d ?? 1));
	dt.setUTCDate(dt.getUTCDate() + dias);
	return dt.toISOString().slice(0, 10);
}

export interface EscolhaHorarioManutencao {
	/** ISO naive BRT, ex: "2026-09-12T16:00:00" */
	dataHora: string;
	/** true = conseguiu o mesmo horário do atendimento de hoje */
	exato: boolean;
}

/**
 * Escolhe data e hora da próxima manutenção olhando a agenda ANTES de propor.
 *
 * Antes, a proposta saía às cegas (+15d, mesmo horário) e a cliente só descobria
 * que o horário estava ocupado DEPOIS de clicar "confirmo" — exatamente o atrito
 * que a Camila pediu pra eliminar.
 *
 * Ordem de busca (decidida com o Adonias): o dia alvo vale mais que o horário.
 *   1. dia alvo, mesmo horário
 *   2. dia alvo, horário livre mais próximo
 *   3. dias seguintes, mesma lógica
 *
 * Um dia que falhar na consulta (429 da Trinks) é PULADO, nunca tratado como
 * dia sem vaga — senão a proposta erra por causa de instabilidade.
 */
export async function escolherHorarioManutencao(opts: {
	dataHoraOriginal: string;
	duracaoMin: number;
	intervaloDias: number;
	diasDeBusca?: number;
	vagosDoDia: (data: string) => Promise<string[]>;
}): Promise<EscolhaHorarioManutencao | null> {
	const m = opts.dataHoraOriginal.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
	if (!m?.[1] || !m[2]) return null;
	const diaAlvo = somarDias(m[1], opts.intervaloDias);
	const horaOriginal = m[2];
	const alvoMin = minutosDoHorario(horaOriginal);
	const janela = opts.diasDeBusca ?? 7;

	for (let i = 0; i < janela; i++) {
		const dia = somarDias(diaAlvo, i);

		let vagos: string[];
		try {
			vagos = await opts.vagosDoDia(dia);
		} catch {
			continue; // instabilidade não é ausência de vaga
		}

		const cabem = vagos.filter((h) => horarioCabeNosVagos(h, opts.duracaoMin, vagos));
		if (cabem.length === 0) continue;

		if (cabem.includes(horaOriginal)) {
			return { dataHora: `${dia}T${horaOriginal}:00`, exato: true };
		}

		const maisProximo = cabem.reduce((melhor, h) =>
			Math.abs(minutosDoHorario(h) - alvoMin) < Math.abs(minutosDoHorario(melhor) - alvoMin)
				? h
				: melhor,
		);
		return { dataHora: `${dia}T${maisProximo}:00`, exato: false };
	}

	return null;
}
