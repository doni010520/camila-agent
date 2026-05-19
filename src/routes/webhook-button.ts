import type { ToolRegistry } from '../agent/tools/_registry.js';
import type { AppOpenAIClient } from '../clients/openai.js';
import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { parseButtonId } from '../clients/uazapi.js';
import type { LeadManager } from '../domain/lead.js';
import { createRequestLogger } from '../infra/logger.js';

export interface ButtonHandlerParams {
	telefone: string;
	buttonOrListid: string;
	deps: {
		openai: AppOpenAIClient;
		uazapi: UazapiClient;
		supabase: AppSupabaseClient;
		postgres: PostgresClient;
		toolRegistry: ToolRegistry;
		trinks: TrinksClient;
	};
	leadManager: LeadManager;
}

export async function handleButton(params: ButtonHandlerParams): Promise<void> {
	const { telefone, buttonOrListid, deps } = params;
	const log = createRequestLogger(telefone);
	const { action, agendamentoId } = parseButtonId(buttonOrListid);

	log.info({ action, agendamentoId, buttonOrListid }, 'Processing button click');

	switch (action) {
		case 'confirmar': {
			if (!agendamentoId) {
				log.warn('confirmar button without agendamento ID');
				return;
			}
			const agId = Number(agendamentoId);

			// PATCH confirm
			try {
				await deps.trinks.confirmarAgendamento(agId);
			} catch (err) {
				log.error({ err, agId }, 'Failed to confirm via button');
				await deps.uazapi
					.sendText(telefone, 'Tive um probleminha ao confirmar. Já chamei a Camila 💖')
					.catch(() => {});
				return;
			}

			// VERIFY: status must be 4 (Confirmado) — anti-ghost IB1
			try {
				const readBack = await deps.trinks.getAgendamento(agId);
				if (readBack.status.id !== 4) {
					log.error({ agId, status: readBack.status }, 'Confirm verify failed: status not 4');
					await deps.uazapi
						.sendText(telefone, 'Tive um probleminha ao confirmar. Já chamei a Camila 💖')
						.catch(() => {});
					return;
				}
				try {
					await deps.supabase.upsertAgendamento({ id: agId, status_id: 4 });
				} catch {
					/* best-effort */
				}
				await deps.uazapi.sendText(telefone, 'Perfeito! Te aguardo 💖');
			} catch (err) {
				log.error({ err, agId }, 'Confirm verify read-back failed');
				await deps.uazapi
					.sendText(telefone, 'Tive um probleminha ao confirmar. Já chamei a Camila 💖')
					.catch(() => {});
			}
			break;
		}

		case 'recusar': {
			await deps.uazapi.sendText(
				telefone,
				'Entendi! Quer reagendar pra outro dia? Me conta quando fica melhor pra você 💖',
			);
			break;
		}

		case 'enquete_sim': {
			if (!agendamentoId) return;
			const agId = Number(agendamentoId);

			// PATCH finalize
			try {
				await deps.trinks.finalizarAgendamento(agId);
			} catch (err) {
				log.error({ err, agId }, 'Failed to finalize via enquete');
				return;
			}

			// VERIFY: status must be 6 (Finalizado) — anti-ghost IB1
			try {
				const readBack = await deps.trinks.getAgendamento(agId);
				if (readBack.status.id !== 6) {
					log.error({ agId, status: readBack.status }, 'Finalize verify failed: status not 6');
					return;
				}
				try {
					await deps.supabase.upsertAgendamento({ id: agId, status_id: 6 });
				} catch {
					/* best-effort */
				}
				await deps.uazapi.sendText(
					telefone,
					'Que bom! Espero que tenha amado o resultado 💖 Já te aviso quando for hora da manutenção!',
				);
			} catch (err) {
				log.error({ err, agId }, 'Finalize verify read-back failed');
			}
			break;
		}

		case 'enquete_nao': {
			await deps.uazapi.sendText(telefone, 'Tudo bem! Quando finalizar, me avisa por aqui 😊');
			break;
		}

		default: {
			log.warn({ action, buttonOrListid }, 'Unknown button action');
		}
	}
}
