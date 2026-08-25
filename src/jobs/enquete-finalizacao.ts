import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { todayBRT } from '../domain/data-brt.js';
import { getEnv } from '../infra/env.js';
import type { Logger } from '../infra/logger.js';
import { rootLogger } from '../infra/logger.js';

const ELIGIBLE_STATUSES = new Set([4, 5]); // Confirmado, Em atendimento
// Dispara o botão pra Camila assim que o horário de FIM do atendimento passa
// (a cliente está saindo do estúdio). Camila clica "finalizei" na hora e a
// cliente recebe a manutenção imediatamente. Rodado a cada ~15min pelo cron.
const HOURS_AFTER_END = 0;

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

	const env = getEnv();
	// Prioriza mandar pra Camila direto (1:1). Sem isso, fallback pro grupo.
	const destinoCamila = env.UAZAPI_CAMILA_PHONE ?? env.UAZAPI_GRUPO_TIME;

	for (const ag of eligible) {
		// 2. Check if enquete already sent
		const existing = await deps.supabase.getAgendamento(ag.id);
		if (existing?.enquete_finalizacao_enviada_em) {
			jaEnviados++;
			continue;
		}

		// Formato horário pra ler no grupo
		const hora = ag.dataHoraInicio.slice(11, 16);

		// 3. Manda menu pra Camila no grupo do time (não pra cliente!)
		try {
			await deps.uazapi.sendMenu({
				number: destinoCamila,
				text: `📋 Camila, você *finalizou* o atendimento da *${ag.cliente.nome}* (${ag.servico.nome}, ${hora})?`,
				choices: [
					{ label: 'Sim, finalizei ✅', id: `Fin_sim${ag.id}` },
					{ label: 'Não compareceu ❌', id: `Fin_nao${ag.id}` },
				],
			});

			// 4. Mirror + mark enviada (pra não duplicar)
			const numeroCliente = `${ag.cliente.id}`; // placeholder, real number será buscado quando Camila clicar Sim
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
				numero: numeroCliente,
			});
			await deps.supabase.markEnqueteEnviada(ag.id);
			enviados++;
		} catch (err) {
			log.error({ err, agId: ag.id }, 'Failed to send enquete to group');
			erros++;
		}
	}

	log.info({ total: eligible.length, enviados, jaEnviados, erros }, 'Enquete run complete');
	return { total: eligible.length, enviados, jaEnviados, erros };
}
