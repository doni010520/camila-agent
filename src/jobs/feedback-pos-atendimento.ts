/**
 * Pergunta à cliente, 3 dias depois do atendimento, como ficou o resultado.
 *
 * Pedido da Camila (01/09/2026): "Após 3 dias enviar mensagem para cliente para
 * colher feedback positivo (prova social) se for negativo ela manda a msg eu
 * entro em contato para entender a queixa".
 *
 * Resposta boa  -> a Helena agradece e pede a avaliação (prova social), e avisa
 *                  a Camila que tem depoimento pra colher.
 * Resposta ruim -> a Helena acolhe e avisa a Camila pra ela ligar. NÃO tenta
 *                  resolver sozinha: reclamação de resultado é conversa de dona.
 * (o que acontece no clique está em routes/webhook-button.ts)
 *
 * Só perguntamos de atendimento FINALIZADO — mesma restrição da manutenção. A
 * Camila é a única fonte de verdade sobre o atendimento ter acontecido, e
 * perguntar "como ficaram seus cílios?" pra quem não compareceu é pior que não
 * perguntar.
 */
import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { addDaysBRT, todayBRT } from '../domain/data-brt.js';
import { TRINKS_STATUS } from '../domain/trinks-status.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

/** Dias entre o atendimento e a pergunta. Definido pela Camila. */
const DIAS_DEPOIS = 3;
/** Teto por execução — o job roda 1x/dia, isso é folga suficiente. */
const MAX_POR_EXECUCAO = 10;

export interface FeedbackDeps {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	uazapi: UazapiClient;
	postgres: PostgresClient;
	profissionalId: number;
	logger?: Logger;
	/** Relógio injetável (deixa o comportamento testável sem esperar 3 dias). */
	agora?: Date;
}

export interface FeedbackResult {
	candidatos: number;
	enviados: number;
	semTelefone: number;
	erros: number;
}

export async function runFeedbackPosAtendimento(deps: FeedbackDeps): Promise<FeedbackResult> {
	const log = deps.logger ?? rootLogger.child({ job: 'feedback-pos-atendimento' });
	const agora = deps.agora ?? new Date();
	const alvo = addDaysBRT(todayBRT(agora), -DIAS_DEPOIS);

	const lista = await deps.trinks.listAgendamentos({
		dataInicio: `${alvo}T00:00:00`,
		dataFim: `${alvo}T23:59:59`,
	});

	const candidatos = (lista.data ?? []).filter(
		(a) =>
			a.profissional.id === deps.profissionalId &&
			a.status.id === TRINKS_STATUS.FINALIZADO &&
			a.dataHoraInicio.slice(0, 10) === alvo,
	);

	let enviados = 0;
	let semTelefone = 0;
	let erros = 0;

	for (const ag of candidatos) {
		if (enviados >= MAX_POR_EXECUCAO) break;

		// Já perguntamos? Ninguém gosta de responder a mesma coisa duas vezes.
		try {
			const espelho = await deps.supabase.getAgendamento(ag.id);
			if (espelho?.feedback_enviado_em) continue;
		} catch (err) {
			log.warn({ err, agId: ag.id }, 'Falha ao ler espelho');
			erros++;
			continue;
		}

		const numero = await resolverTelefone(deps, ag.cliente.id, log);
		if (!numero) {
			log.warn({ agId: ag.id, cliente: ag.cliente.nome }, 'Sem telefone pra pedir feedback');
			semTelefone++;
			continue;
		}

		const primeiroNome = ag.cliente.nome.trim().split(/\s+/)[0] ?? '';
		try {
			await deps.uazapi.sendMenu({
				number: numero,
				text: `Oi ${primeiroNome}! 💖 Faz uns dias que você fez seu *${ag.servico.nome}*. Como estão seus cílios?`,
				choices: [
					{ label: 'Amei o resultado 😍', id: `Fb_bom${ag.id}` },
					{ label: 'Podia estar melhor', id: `Fb_ruim${ag.id}` },
				],
			});
			await deps.supabase.markFeedbackEnviado(ag.id);
			enviados++;
		} catch (err) {
			log.error({ err, agId: ag.id }, 'Falha ao pedir feedback');
			erros++;
		}
	}

	log.info(
		{ data: alvo, candidatos: candidatos.length, enviados, semTelefone, erros },
		'Feedback pós-atendimento concluído',
	);
	return { candidatos: candidatos.length, enviados, semTelefone, erros };
}

/** Telefone da cliente: Trinks primeiro, cache local depois. Muitos cadastros
 *  da Trinks vieram do painel sem telefone (ver jobs/lembrete-amanha.ts). */
async function resolverTelefone(
	deps: FeedbackDeps,
	clienteId: number,
	log: Logger,
): Promise<string | null> {
	try {
		const cliente = await deps.trinks.getCliente(clienteId);
		const tel = cliente.telefones?.[0];
		if (tel) return `${tel.ddi ?? '55'}${tel.ddd ?? '71'}${tel.telefone}`;
	} catch (err) {
		log.warn({ err, clienteId }, 'getCliente falhou, tentando cache local');
	}
	return deps.postgres.findPhoneByTrinksId(clienteId).catch(() => null);
}
