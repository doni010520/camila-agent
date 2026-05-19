import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { todayBRT } from '../domain/data-brt.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

const ELIGIBLE_STATUSES = new Set([4, 5]); // Confirmado, Em atendimento
const HOURS_AFTER_END = 1; // Wait at least 1h after appointment end time

export interface EnqueteDeps {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	uazapi: UazapiClient;
	profissionalId: number;
	logger?: Logger;
}

export interface EnqueteResult {
	total: number;
	enviados: number;
	jaEnviados: number;
	erros: number;
}

export async function runEnqueteFinalizacao(deps: EnqueteDeps): Promise<EnqueteResult> {
	const log = deps.logger ?? rootLogger.child({ job: 'enquete-finalizacao' });
	const hoje = todayBRT();

	log.info({ date: hoje }, 'Running enquete-finalizacao');

	// 1. Fetch today's agendamentos
	const result = await deps.trinks.listAgendamentos({ dataInicio: hoje, dataFim: hoje });
	const now = Date.now();

	const eligible = result.data
		.filter((a) => ELIGIBLE_STATUSES.has(a.status.id))
		.filter((a) => a.profissional.id === deps.profissionalId)
		.filter((a) => {
			// Check if appointment ended > 1h ago
			const start = new Date(`${a.dataHoraInicio}-03:00`).getTime();
			const end = start + a.duracaoEmMinutos * 60 * 1000;
			const hoursSinceEnd = (now - end) / (1000 * 60 * 60);
			return hoursSinceEnd >= HOURS_AFTER_END;
		});

	if (eligible.length === 0) {
		log.info('No eligible agendamentos for enquete');
		return { total: 0, enviados: 0, jaEnviados: 0, erros: 0 };
	}

	let enviados = 0;
	let jaEnviados = 0;
	let erros = 0;

	for (const ag of eligible) {
		// 2. Check if enquete already sent
		const existing = await deps.supabase.getAgendamento(ag.id);
		if (existing?.enquete_finalizacao_enviada_em) {
			jaEnviados++;
			continue;
		}

		// 3. Find phone by cliente ID (not name)
		let cliente: Awaited<ReturnType<typeof deps.trinks.getCliente>>;
		try {
			cliente = await deps.trinks.getCliente(ag.cliente.id);
		} catch {
			log.warn({ agId: ag.id, clienteId: ag.cliente.id }, 'Failed to get cliente for enquete');
			erros++;
			continue;
		}
		const telefone = cliente.telefones?.[0];
		if (!telefone) {
			log.warn({ agId: ag.id }, 'No phone for enquete');
			erros++;
			continue;
		}

		const number = `${telefone.ddi ?? '55'}${telefone.ddd ?? '71'}${telefone.telefone}`;

		// 4. Send enquete buttons
		try {
			await deps.uazapi.sendMenu({
				number,
				text: `Oi ${ag.cliente.nome.split(' ')[0]}! Já finalizou seu procedimento de *${ag.servico.nome}*?`,
				choices: [
					{ label: 'Sim, finalizou ✅', id: `id_sim${ag.id}` },
					{ label: 'Ainda não', id: 'id_nao' },
				],
			});

			// 5. Mirror + mark
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
			await deps.supabase.markEnqueteEnviada(ag.id);
			enviados++;
		} catch (err) {
			log.error({ err, agId: ag.id }, 'Failed to send enquete');
			erros++;
		}
	}

	log.info({ total: eligible.length, enviados, jaEnviados, erros }, 'Enquete run complete');
	return { total: eligible.length, enviados, jaEnviados, erros };
}
