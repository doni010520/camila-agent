/**
 * Endpoints de auditoria/admin. Protegidos por WEBHOOK_SHARED_SECRET.
 *
 * Os dashboards HTML são registrados no composition-root ANTES deste router
 * para não cair no middleware de auth aqui.
 *   GET /admin/dashboard  → DASHBOARD_HTML  (dev, dark)
 *   GET /admin/cliente    → CLIENTE_HTML    (Camila, rose gold)
 */
import { Hono } from 'hono';
import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import { todayBRT } from '../domain/data-brt.js';
import { agregarEventos } from '../jobs/relatorio-diario.js';

// Re-exporta os HTMLs para uso no composition-root
export { DASHBOARD_HTML, CLIENTE_HTML } from './dashboard-html.js';

export interface AdminDeps {
	postgres: PostgresClient;
	supabase: AppSupabaseClient;
}

function calcRange(periodo: string, dataParam: string | undefined): { inicio: string; fim: string } {
	const hoje = dataParam ?? todayBRT();
	if (periodo === 'semana') {
		const d = new Date(`${hoje}T12:00:00-03:00`);
		d.setDate(d.getDate() - 6);
		const inicio7dias = d.toLocaleDateString('sv-SE', { timeZone: 'America/Bahia' });
		return { inicio: `${inicio7dias}T00:00:00-03:00`, fim: `${hoje}T23:59:59-03:00` };
	}
	if (periodo === 'mes') {
		const [year, month] = hoje.split('-');
		const lastDay = new Date(Number(year), Number(month), 0).getDate();
		return {
			inicio: `${year}-${month}-01T00:00:00-03:00`,
			fim: `${year}-${month}-${String(lastDay).padStart(2, '0')}T23:59:59-03:00`,
		};
	}
	return { inicio: `${hoje}T00:00:00-03:00`, fim: `${hoje}T23:59:59-03:00` };
}

export function createAdminRouter(deps: AdminDeps): Hono {
	const router = new Hono();

	router.get('/admin/sessions', async (c) => {
		const sessions = await deps.postgres.listChatSessions();
		return c.json({ total_sessions: sessions.length, sessions });
	});

	router.get('/admin/inbound', async (c) => {
		const limit = Number(c.req.query('n') ?? 50);
		const includePayload = c.req.query('payload') === '1';
		const rows = await deps.postgres.listWebhookInbound({
			limit: Number.isFinite(limit) ? limit : 50,
			includePayload,
		});
		return c.json({ total: rows.length, mensagens: rows });
	});

	router.get('/admin/inbound/telefone/:telefone', async (c) => {
		const telefone = c.req.param('telefone');
		const limit = Number(c.req.query('n') ?? 50);
		const rows = await deps.postgres.listWebhookInbound({
			telefone,
			limit: Number.isFinite(limit) ? limit : 50,
		});
		return c.json({ telefone, total: rows.length, mensagens: rows });
	});

	router.get('/admin/sem-resposta', async (c) => {
		const sessions = await deps.postgres.listSessionsSemResposta();
		return c.json({ total: sessions.length, sessions });
	});

	router.get('/admin/session/:telefone', async (c) => {
		const telefone = c.req.param('telefone');
		const limit = Number(c.req.query('n') ?? 10);
		const rows = await deps.postgres.loadRecentMessages(
			telefone,
			Number.isFinite(limit) ? limit : 10,
		);
		return c.json({ telefone, total: rows.length, mensagens: rows });
	});

	/** Relatório agregado — período = 'dia' | 'semana' | 'mes'. */
	router.get('/admin/relatorio', async (c) => {
		const periodo = c.req.query('periodo') ?? 'dia';
		const dataParam = c.req.query('data');
		try {
			const { inicio, fim } = calcRange(periodo, dataParam);
			const data = dataParam ?? todayBRT();
			const resumo = await agregarEventos(deps.supabase, inicio, fim);
			return c.json({ periodo, data, resumo });
		} catch (err) {
			return c.json(
				{ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' },
				500,
			);
		}
	});

	/**
	 * Detalhamento por métrica — usado pelo drill-down do dashboard cliente.
	 * tipo: conversas | agendamentos | sinais | catalogos | encaminhados
	 */
	router.get('/admin/eventos', async (c) => {
		const tipo = c.req.query('tipo') ?? 'agendamentos';
		const periodo = c.req.query('periodo') ?? 'dia';

		const tipoMap: Record<string, string> = {
			conversas: 'mensagem_recebida',
			agendamentos: 'agendamento_criado',
			sinais: 'sinal_pago',
			catalogos: 'catalogo_enviado',
			encaminhados: 'transferido_humano',
		};
		const tipoEvento = tipoMap[tipo];
		if (!tipoEvento) return c.json({ status: 'erro', razao: 'tipo inválido' }, 400);

		const { inicio, fim } = calcRange(periodo, undefined);
		const { data, error } = await deps.supabase.raw
			.from('eventos_helena')
			.select('cliente_nome, criado_em, valor, detalhes, telefone')
			.eq('tipo', tipoEvento)
			.eq('sucesso', true)
			.gte('criado_em', inicio)
			.lte('criado_em', fim)
			.order('criado_em', { ascending: false });

		if (error) return c.json({ status: 'erro', razao: error.message }, 500);

		type EventRow = {
			cliente_nome: string | null;
			criado_em: string;
			valor: number | null;
			detalhes: Record<string, unknown> | null;
			telefone: string | null;
		};
		let rows = (data ?? []) as EventRow[];

		// Conversas: deduplicar por telefone (1 entrada por cliente único)
		if (tipo === 'conversas') {
			const seen = new Set<string>();
			rows = rows.filter((r) => {
				const key = r.telefone ?? r.cliente_nome ?? String(Math.random());
				if (seen.has(key)) return false;
				seen.add(key);
				return true;
			});
		}

		const itens = rows.map((r) => {
			const det = (r.detalhes ?? {}) as Record<string, unknown>;
			const res = (det.result ?? {}) as Record<string, unknown>;
			const hora = new Date(r.criado_em).toLocaleTimeString('pt-BR', {
				hour: '2-digit',
				minute: '2-digit',
				timeZone: 'America/Bahia',
			});

			let detalhe = '';
			if (tipo === 'agendamentos') {
				const servico = typeof res.servico_nome === 'string' ? res.servico_nome : '';
				const val = r.valor ? ` · R$ ${Number(r.valor).toFixed(2).replace('.', ',')}` : '';
				const dhStr = typeof res.data_hora_inicio === 'string' ? res.data_hora_inicio : '';
				const horario = dhStr
					? new Date(dhStr).toLocaleTimeString('pt-BR', {
							hour: '2-digit',
							minute: '2-digit',
							timeZone: 'America/Bahia',
						})
					: '';
				detalhe = servico + val + (horario ? ` · ${horario}` : '');
			} else if (tipo === 'sinais' && r.valor) {
				detalhe = `R$ ${Number(r.valor).toFixed(2).replace('.', ',')}`;
			}

			return { nome: r.cliente_nome ?? 'Cliente', hora, detalhe };
		});

		return c.json({ tipo, periodo, total: itens.length, itens });
	});

	/** Lista de erros — SEPARADO. Cliente NUNCA vê esse endpoint. */
	router.get('/admin/erros', async (c) => {
		const n = Number(c.req.query('n') ?? 50);
		const limit = Number.isFinite(n) && n > 0 ? n : 50;
		const { data, error } = await deps.supabase.raw
			.from('eventos_helena')
			.select('criado_em, telefone, tipo, detalhes, cliente_nome')
			.eq('sucesso', false)
			.order('criado_em', { ascending: false })
			.limit(limit);
		if (error) return c.json({ status: 'erro', razao: error.message }, 500);
		return c.json({ total: data?.length ?? 0, erros: data ?? [] });
	});

	return router;
}
