import { z } from 'zod';
import type { TrinksClient } from '../../clients/trinks.js';
import { parsePhone } from '../../domain/telefone.js';
import type { ToolContext, ToolDefinition, ToolResult } from './_registry.js';

const ACTIVE_STATUSES = new Set([1, 2, 3, 4]);

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
}): ToolDefinition<Input> {
	const { trinks } = deps;

	return {
		name: 'listar_agendamentos',
		description:
			'Lista os agendamentos de um cliente. Útil para cancelar, reagendar ou verificar histórico.',
		inputSchema,
		handler: async (input: Input, _ctx: ToolContext): Promise<ToolResult> => {
			// 1. Find cliente by phone
			const parts = parsePhone(input.telefone);
			if (!parts) return { status: 'erro', razao: 'Telefone inválido' };

			const clientes = await trinks.listClientes({ telefone: parts.numero });
			if (clientes.data.length === 0) {
				return { status: 'erro', razao: 'Cliente não encontrado no Trinks' };
			}

			const clienteId = clientes.data[0]?.id;
			if (!clienteId) return { status: 'erro', razao: 'Cliente sem ID' };

			// 2. List agendamentos
			const result = await trinks.listAgendamentos({ clienteId });
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
