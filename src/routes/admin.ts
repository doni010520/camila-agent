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
import type { TrinksClient } from '../clients/trinks.js';
import type { UazapiClient } from '../clients/uazapi.js';
import { findClienteByTelefone } from '../domain/cliente-lookup.js';
import { todayBRT } from '../domain/data-brt.js';
import { ACTIVE_STATUSES } from '../domain/trinks-status.js';
import { agregarEventos } from '../jobs/relatorio-diario.js';

// Re-exporta os HTMLs para uso no composition-root
export { DASHBOARD_HTML, CLIENTE_HTML } from './dashboard-html.js';

export interface AdminDeps {
	postgres: PostgresClient;
	supabase: AppSupabaseClient;
	trinks: TrinksClient;
	uazapi: UazapiClient;
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

		// Agendamentos: deduplicar por agendamento_id (retentativas da tool não devem
		// aparecer duas vezes na lista). Eventos sem agendamento_id são ignorados.
		if (tipo === 'agendamentos') {
			const seen = new Map<string, EventRow>();
			for (const row of rows) {
				const det = (row.detalhes ?? {}) as Record<string, unknown>;
				const res = (det.result ?? {}) as Record<string, unknown>;
				const agId = res.agendamento_id != null ? String(res.agendamento_id) : null;
				if (agId === null) continue;
				if (!seen.has(agId)) seen.set(agId, row);
			}
			rows = Array.from(seen.values()).sort(
				(a, b) => new Date(b.criado_em).getTime() - new Date(a.criado_em).getTime(),
			);
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

	/**
	 * Lista agendamentos da Trinks (source of truth) de um cliente por telefone
	 * num dia específico. Útil pra diagnosticar duplicatas, conferir status reais.
	 *   GET /admin/trinks/agendamentos?telefone=55XX&data=2026-05-26
	 */
	router.get('/admin/trinks/agendamentos', async (c) => {
		const telefone = c.req.query('telefone');
		const data = c.req.query('data');
		if (!telefone || !data) return c.json({ status: 'erro', razao: 'telefone+data obrigatórios' }, 400);

		const lookup = await findClienteByTelefone(telefone, {
			trinks: deps.trinks,
			postgres: deps.postgres,
		});
		if (!lookup) return c.json({ status: 'erro', razao: 'cliente não encontrado' }, 404);

		const result = await deps.trinks.listAgendamentos({
			clienteId: lookup.cliente.id,
			dataInicio: `${data}T00:00:00`,
			dataFim: `${data}T23:59:59`,
		});

		const agendamentos = (result.data ?? []).map((a) => ({
			id: a.id,
			status_id: a.status.id,
			status_nome: a.status.nome,
			ativo: ACTIVE_STATUSES.has(a.status.id),
			servico: a.servico.nome,
			data_hora_inicio: a.dataHoraInicio,
			duracao_em_minutos: a.duracaoEmMinutos,
			valor: a.valor,
			profissional: a.profissional.nome,
		}));

		return c.json({
			cliente: { id: lookup.cliente.id, nome: lookup.cliente.nome },
			data,
			total: agendamentos.length,
			agendamentos,
		});
	});

	/**
	 * Cancela um agendamento direto via Trinks API. Usar quando duplicata ou
	 * cliente pediu fora da janela normal.
	 *   POST /admin/trinks/cancelar/:id?motivo=...
	 */
	router.post('/admin/trinks/cancelar/:id', async (c) => {
		const id = Number(c.req.param('id'));
		const motivo = c.req.query('motivo') ?? 'Cancelamento administrativo';
		if (!Number.isFinite(id) || id <= 0) {
			return c.json({ status: 'erro', razao: 'id inválido' }, 400);
		}
		try {
			await deps.trinks.cancelarAgendamento(id, { motivo });
			const readBack = await deps.trinks.getAgendamento(id);
			return c.json({
				status: 'ok',
				id,
				motivo,
				status_atual_id: readBack.status.id,
				status_atual_nome: readBack.status.nome,
			});
		} catch (err) {
			return c.json(
				{ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' },
				500,
			);
		}
	});

	/**
	 * Envia mensagem de texto pra um telefone via UAZAPI.
	 * Body: { telefone: '5571...', text: 'mensagem' }
	 * Uso operacional: retomar conversa após bug, mandar aviso, etc.
	 * NÃO aciona Helena — é um envio direto. Ainda assim, a próxima
	 * resposta do cliente cai no fluxo normal da Helena.
	 */
	router.post('/admin/send-text', async (c) => {
		const body = (await c.req.json().catch(() => null)) as
			| { telefone?: string; text?: string }
			| null;
		if (!body?.telefone || !body?.text) {
			return c.json({ status: 'erro', razao: 'telefone+text obrigatórios' }, 400);
		}
		try {
			await deps.uazapi.sendText(body.telefone, body.text);
			return c.json({ status: 'ok', telefone: body.telefone, len: body.text.length });
		} catch (err) {
			return c.json(
				{ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' },
				500,
			);
		}
	});

	/**
	 * Injeta uma mensagem na chat memory (n8n_chat_histories) como se Helena
	 * tivesse mandado. Usado quando a gente envia algo manualmente via
	 * /admin/send-text e quer que a próxima resposta da cliente tenha contexto.
	 * Body: { telefone, role: 'assistant'|'user', content }
	 */
	router.post('/admin/inject-message', async (c) => {
		const body = (await c.req.json().catch(() => null)) as
			| { telefone?: string; role?: string; content?: string }
			| null;
		if (!body?.telefone || !body?.content) {
			return c.json({ status: 'erro', razao: 'telefone+content obrigatórios' }, 400);
		}
		const role = body.role === 'user' ? 'user' : 'assistant';
		try {
			await deps.postgres.saveChatMessage(body.telefone, role, body.content);
			return c.json({ status: 'ok', telefone: body.telefone, role });
		} catch (err) {
			return c.json(
				{ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' },
				500,
			);
		}
	});

	/** Lista todos os serviços do catálogo (cache Supabase). */
	router.get('/admin/servicos', async (c) => {
		const { data, error } = await deps.supabase.raw
			.from('servicos')
			.select('id, nome, duracao_minutos, preco')
			.order('nome');
		if (error) return c.json({ status: 'erro', razao: error.message }, 500);
		return c.json({ total: data?.length ?? 0, servicos: data ?? [] });
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

	// ── Cron job config ──────────────────────────────────────────────────────

	/** Lista todos os jobs com config e última execução. */
	router.get('/admin/cron', async (c) => {
		const jobs = await deps.postgres.listCronJobs();
		return c.json({ total: jobs.length, jobs });
	});

	const CRON_EXPR_RE = /^[0-9*,]+ [0-9*,]+ \* \* [0-9*,]+$/;

	/**
	 * Atualiza enabled e/ou cron_expressions de um job.
	 * O scheduler re-carrega a cada 60s — mudanças entram em vigor sem deploy.
	 */
	router.patch('/admin/cron/:job_name', async (c) => {
		const jobName = c.req.param('job_name');

		let body: Record<string, unknown>;
		try {
			body = await c.req.json();
		} catch {
			return c.json({ status: 'erro', razao: 'corpo JSON inválido' }, 400);
		}

		const jobs = await deps.postgres.listCronJobs();
		const job = jobs.find((j) => j.job_name === jobName);
		if (!job) return c.json({ status: 'erro', razao: 'job não encontrado' }, 404);

		const patch: { enabled?: boolean; cron_expressions?: string[] } = {};
		if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
		if (Array.isArray(body.cron_expressions)) {
			for (const expr of body.cron_expressions as string[]) {
				if (!CRON_EXPR_RE.test(String(expr))) {
					return c.json({ status: 'erro', razao: `cron expression inválida: ${expr}` }, 400);
				}
			}
			patch.cron_expressions = body.cron_expressions as string[];
		}
		if (Object.keys(patch).length === 0) {
			return c.json({ status: 'erro', razao: 'nada para atualizar' }, 400);
		}

		await deps.postgres.updateCronJob(jobName, patch);
		const updated = await deps.postgres.listCronJobs();
		const updatedJob = updated.find((j) => j.job_name === jobName);
		return c.json({ status: 'ok', job: updatedJob });
	});

	return router;
}
