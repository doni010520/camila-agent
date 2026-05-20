import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { addDaysBRT, formatDateTimeBRT, todayBRT } from '../domain/data-brt.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

const ACTIVE_STATUSES = new Set([1, 3, 4]); // Agendado, Aguardando confirmação estab., Confirmado

export interface LembreteDeps {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	uazapi: UazapiClient;
	postgres: PostgresClient;
	profissionalId: number;
	logger?: Logger;
}

export interface LembreteResult {
	date: string;
	total: number;
	enviados: number;
	jaEnviados: number;
	erros: number;
}

export async function runLembreteAmanha(deps: LembreteDeps): Promise<LembreteResult> {
	const log = deps.logger ?? rootLogger.child({ job: 'lembrete-amanha' });
	const amanha = addDaysBRT(todayBRT(), 1);

	log.info({ date: amanha }, 'Running lembrete-amanha');

	// 1. Fetch tomorrow's agendamentos from Trinks
	const result = await deps.trinks.listAgendamentos({ dataInicio: amanha, dataFim: amanha });
	const agendamentos = result.data
		.filter((a) => ACTIVE_STATUSES.has(a.status.id))
		.filter((a) => a.profissional.id === deps.profissionalId);

	if (agendamentos.length === 0) {
		log.info('No agendamentos for tomorrow');
		return { date: amanha, total: 0, enviados: 0, jaEnviados: 0, erros: 0 };
	}

	let enviados = 0;
	let jaEnviados = 0;
	let erros = 0;

	for (const ag of agendamentos) {
		// 2. Check Supabase if lembrete already sent
		const existing = await deps.supabase.getAgendamento(ag.id);
		if (existing?.lembrete_enviado_em) {
			jaEnviados++;
			continue;
		}

		// 3. Find phone from cliente by ID (not name — avoids "wrong Roseli" bug)
		let cliente: Awaited<ReturnType<typeof deps.trinks.getCliente>>;
		try {
			cliente = await deps.trinks.getCliente(ag.cliente.id);
		} catch {
			log.warn({ agId: ag.id, clienteId: ag.cliente.id }, 'Failed to get cliente for lembrete');
			erros++;
			continue;
		}
		const telefone = cliente.telefones?.[0];
		let number: string;
		if (telefone) {
			number = `${telefone.ddi ?? '55'}${telefone.ddd ?? '71'}${telefone.telefone}`;
		} else {
			// Fallback: muitos clientes têm cadastro Trinks sem telefone preenchido
			// (importados via painel). Buscamos no cache local Postgres `clientes`.
			const fallback = await deps.postgres.findPhoneByTrinksId(ag.cliente.id);
			if (!fallback) {
				log.warn({ agId: ag.id, clienteNome: ag.cliente.nome, clienteId: ag.cliente.id }, 'No phone found for lembrete (Trinks + cache)');
				erros++;
				continue;
			}
			number = fallback;
			log.info({ agId: ag.id, clienteId: ag.cliente.id }, 'Phone resolved via postgres cache');
		}
		const formatted = formatDateTimeBRT(ag.dataHoraInicio);

		// 4. Send confirm/decline buttons
		try {
			await deps.uazapi.sendText(
				number,
				`Oi ${ag.cliente.nome.split(' ')[0]} 💖\n\nLembrando que amanhã você tem *${ag.servico.nome}* ${formatted}\n\nVocê confirma?`,
			);
			await deps.uazapi.sendMenu({
				number,
				text: 'Confirma presença?',
				choices: [
					{ label: 'Sim ✅', id: `Id_sim${ag.id}` },
					{ label: 'Não posso ❌', id: `Id_nao${ag.id}` },
				],
			});

			// 5. Mirror + mark lembrete
			await deps.supabase.upsertAgendamento({
				id: ag.id,
				status_id: ag.status.id,
				cliente_id: ag.cliente.id,
				cliente_nome: ag.cliente.nome,
				servico_id: ag.servico.id,
				servico_nome: ag.servico.nome,
				profissional_id: ag.profissional.id,
				profissional_nome: ag.profissional.nome,
				data_hora_inicio: ag.dataHoraInicio,
				duracao_em_minutos: ag.duracaoEmMinutos,
				valor: ag.valor ?? undefined,
				numero: number,
			});
			await deps.supabase.markLembreteEnviado(ag.id);
			enviados++;
		} catch (err) {
			log.error({ err, agId: ag.id }, 'Failed to send lembrete');
			erros++;
		}
	}

	log.info(
		{ date: amanha, total: agendamentos.length, enviados, jaEnviados, erros },
		'Lembrete run complete',
	);
	return { date: amanha, total: agendamentos.length, enviados, jaEnviados, erros };
}
