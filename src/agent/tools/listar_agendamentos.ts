import { z } from 'zod';
import type { PostgresClient } from '../../clients/postgres.js';
import type { TrinksClient } from '../../clients/trinks.js';
import { findClienteByTelefone } from '../../domain/cliente-lookup.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

import { ACTIVE_STATUSES } from "../../domain/trinks-status.js";

const STATUS_NAMES: Record<number, string> = {
	1: 'Agendado',
	2: 'Aguardando confirmação',
	3: 'Aguardando confirmação do estabelecimento',
	4: 'Confirmado',
	5: 'Em atendimento',
	6: 'Finalizado',
	7: 'Cancelado',
	8: 'Cliente não compareceu',
};

const inputSchema = z.object({
	telefone: z.string().describe('Telefone do cliente'),
	apenas_ativos: z
		.boolean()
		.optional()
		.default(true)
		.describe('Se true, retorna apenas agendamentos ativos'),
});

type Input = z.infer<typeof inputSchema>;

export function createListarAgendamentos(deps: {
	trinks: TrinksClient;
	postgres: PostgresClient;
}): ToolDefinition<Input> {
	const { trinks, postgres } = deps;

	return {
		name: 'listar_agendamentos',
		description:
			'Lista os agendamentos de um cliente. Útil para cancelar, reagendar ou verificar histórico.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// 1. Find cliente (cache Postgres + fallback Trinks)
			const lookup = await findClienteByTelefone(input.telefone, { trinks, postgres });
			if (!lookup) return { status: 'erro', razao: 'Cliente não encontrado' };
			const clienteId = lookup.cliente.id;

			// 2. List agendamentos futuros (evita lixo histórico)
			const hoje = new Date().toISOString().split('T')[0];
			const result = await trinks.listAgendamentos({
				clienteId,
				dataInicio: `${hoje}T00:00:00`,
				dataFim: '2027-12-31T23:59:59',
			});
			let agendamentos = result.data;

			if (input.apenas_ativos) {
				agendamentos = agendamentos.filter((a) => ACTIVE_STATUSES.has(a.status.id));
			}

			if (agendamentos.length === 0) {
				return {
					status: 'ok',
					total: 0,
					mensagem: 'Nenhum agendamento ativo encontrado.',
					agendamentos: [],
				};
			}

			// 3. Format for agent
			const formatted = agendamentos.map((a) => {
				const dt = new Date(a.dataHoraInicio);
				const DAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
				return {
					id: a.id,
					servico: a.servico.nome,
					data: a.dataHoraInicio.split('T')[0],
					hora: dt.toLocaleTimeString('pt-BR', {
						hour: '2-digit',
						minute: '2-digit',
						timeZone: 'America/Bahia',
					}),
					dia_semana: DAYS[dt.getDay()] ?? '',
					profissional: a.profissional.nome,
					valor: a.valor ?? 0,
					status: STATUS_NAMES[a.status.id] ?? `Status ${a.status.id}`,
					status_id: a.status.id,
				};
			});

			return {
				status: 'ok',
				total: formatted.length,
				agendamentos: formatted,
			};
		},
	};
}
