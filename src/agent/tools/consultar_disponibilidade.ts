import { z } from 'zod';
import type { AppSupabaseClient } from '../../clients/supabase.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { todayBRT } from '../../domain/data-brt.js';
import { filterByTurno, isLunchBreak } from '../../domain/horario-funcionamento.js';
import { isNumeroBloqueado } from '../../domain/bloqueio.js';
import { getAgendaDoDiaCached } from '../../infra/disponibilidade-cache.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const inputSchema = z.object({
	servico: z.string().describe('Nome aproximado do serviço (ex: "Volume Brasileiro")'),
	data: z.string().optional().describe('Data inicial ISO YYYY-MM-DD. Default = hoje.'),
	hora_e_turno: z
		.enum(['manha', 'tarde', 'noite', 'qualquer'])
		.optional()
		.default('qualquer')
		.describe('Filtro de turno'),
	duracao_minutos: z
		.number()
		.optional()
		.describe('Duração em minutos. Se omitido, deduz do serviço.'),
});

type Input = z.infer<typeof inputSchema>;

export function createConsultarDisponibilidade(deps: {
	trinks: TrinksClient;
	supabase: AppSupabaseClient;
	profissionalId: number;
}): ToolDefinition<Input> {
	const { trinks, supabase, profissionalId } = deps;

	return {
		name: 'consultar_disponibilidade',
		description:
			'Consulta horários disponíveis para agendamento nos próximos 14 dias. Retorna datas e horários livres.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// Número bloqueado: sempre "sem vagas", sem nunca consultar a Trinks,
			// sem oferecer encaixe nem avisar a Camila.
			if (isNumeroBloqueado(_ctx.telefone)) {
				return {
					status: 'erro',
					razao:
						'Responda com carinho e gentileza que, no momento, não temos horários disponíveis na agenda. Seja acolhedora. NUNCA diga, insinue ou deixe transparecer que a cliente está bloqueada, impedida ou em qualquer lista — isso é interno e jamais pode ser revelado. Não ofereça encaixe, não cite lista de espera e não acione a Camila.',
				};
			}

			// 1. Resolve serviço
			const servico = await supabase.findServicoByName(input.servico);
			if (!servico) {
				// Try refreshing cache from Trinks
				const fromTrinks = await trinks.listServicos({ pageSize: 50 });
				for (const s of fromTrinks.data) {
					await supabase.upsertServico({
						id: s.id,
						nome: s.nome,
						duracao_minutos: s.duracaoEmMinutos,
						preco: s.preco ?? null,
					});
				}
				const retry = await supabase.findServicoByName(input.servico);
				if (!retry) {
					return { status: 'erro', razao: `Serviço "${input.servico}" não encontrado` };
				}
				return await searchSlots(retry, input);
			}
			return await searchSlots(servico, input);

			async function searchSlots(
				svc: { id: number; nome: string; duracao_minutos: number; preco?: number | null },
				inp: Input,
			): Promise<ToolResult> {
				const duracao = inp.duracao_minutos ?? svc.duracao_minutos;
				const turno = inp.hora_e_turno ?? 'qualquer';
				const startDate = inp.data
					? new Date(`${inp.data}T12:00:00-03:00`)
					: new Date(`${todayBRT()}T12:00:00-03:00`);
				const slotsNeeded = Math.ceil(duracao / 30); // each slot is 30min

				const opcoes: Array<{
					data: string;
					dia_semana: string;
					horarios: string[];
				}> = [];

				const DAYS_PT = [
					'domingo',
					'segunda-feira',
					'terça-feira',
					'quarta-feira',
					'quinta-feira',
					'sexta-feira',
					'sábado',
				];

				// Para de varrer assim que tiver dias suficientes com vaga — a Helena
				// só oferece alguns dias por vez. No caso comum (tem vaga logo),
				// fazemos ~4 chamadas em vez de 14, aliviando o rate limit da Trinks.
				const MAX_DIAS_OFERTA = 4;
				let diasComErro = 0;

				for (let i = 0; i < 14 && opcoes.length < MAX_DIAS_OFERTA; i++) {
					const d = new Date(startDate);
					d.setDate(d.getDate() + i);
					const dayOfWeek = d.getDay();

					// Skip Sunday (0)
					if (dayOfWeek === 0) continue;

					const dateStr = d.toISOString().split('T')[0];
					if (!dateStr) continue;

					// try/catch POR DIA: um 429/timeout num dia não derruba a consulta
					// inteira — pula esse dia e segue. Antes, qualquer erro num dos
					// 14 dias travava a Helena (crash → fallback "probleminha").
					let agenda: Awaited<ReturnType<typeof getAgendaDoDiaCached>>;
					try {
						agenda = await getAgendaDoDiaCached(trinks, dateStr);
					} catch {
						diasComErro++;
						continue;
					}
					const prof = agenda.find((p) => p.id === profissionalId);
					if (!prof || prof.horariosVagos.length === 0) continue;

					// Filter by turno
					let filtered = filterByTurno(prof.horariosVagos, turno);

					// Filter out lunch break
					filtered = filtered.filter((h) => !isLunchBreak(h));

					// Filter by consecutive slots needed
					if (slotsNeeded > 1) {
						filtered = filterConsecutiveSlots(filtered, slotsNeeded);
					}

					if (filtered.length > 0) {
						opcoes.push({
							data: dateStr,
							dia_semana: DAYS_PT[dayOfWeek] ?? '',
							horarios: filtered,
						});
					}
				}

				if (opcoes.length === 0) {
					// Distingue "agenda cheia" de "não consegui consultar" (rate limit/
					// timeout). Se TODOS os dias deram erro, é técnico — não diga à
					// cliente que está cheio (pode ter vaga).
					if (diasComErro > 0) {
						return {
							status: 'erro',
							razao: 'Não consegui consultar a agenda agora (instabilidade). Tente de novo em instantes.',
						};
					}
					return { status: 'erro', razao: 'Sem horários disponíveis nos próximos 14 dias' };
				}

				return {
					status: 'ok',
					servico: {
						id: svc.id,
						nome: svc.nome,
						duracao: svc.duracao_minutos,
						preco: svc.preco ?? 0,
					},
					opcoes,
				};
			}
		},
	};
}

/**
 * Filter for slots that have enough consecutive 30-min blocks.
 * e.g. for 120min (4 slots), "14:00" is valid only if 14:30, 15:00, 15:30 are also available.
 */
function filterConsecutiveSlots(horarios: string[], slotsNeeded: number): string[] {
	const set = new Set(horarios);
	return horarios.filter((start) => {
		const [hStr, mStr] = start.split(':');
		if (!hStr || !mStr) return false;
		let h = Number.parseInt(hStr, 10);
		let m = Number.parseInt(mStr, 10);

		for (let i = 1; i < slotsNeeded; i++) {
			m += 30;
			if (m >= 60) {
				h += 1;
				m -= 60;
			}
			const next = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
			if (!set.has(next) || isLunchBreak(next)) return false;
		}
		return true;
	});
}
