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
import { getEnv } from '../infra/env.js';

// Re-exporta os HTMLs para uso no composition-root
export { DASHBOARD_HTML, CLIENTE_HTML } from './dashboard-html.js';

export interface AdminDeps {
	postgres: PostgresClient;
	supabase: AppSupabaseClient;
	trinks: TrinksClient;
	uazapi: UazapiClient;
	openai?: import('../clients/openai.js').AppOpenAIClient;
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

	/**
	 * Busca textual no histórico de conversa. Acha todas as conversas onde
	 * aparece um termo (ex: "marrom" pra auditar o bug do matcher de serviço).
	 *   GET /admin/buscar?q=marrom&role=assistant&n=200
	 * role opcional: 'user' (só cliente) | 'assistant' (só Helena).
	 * Agrupa por telefone pra facilitar a investigação.
	 */
	router.get('/admin/buscar', async (c) => {
		const q = c.req.query('q');
		if (!q) return c.json({ status: 'erro', razao: 'q (termo) obrigatório' }, 400);
		const roleParam = c.req.query('role');
		const role = roleParam === 'user' || roleParam === 'assistant' ? roleParam : undefined;
		const n = Number(c.req.query('n') ?? 200);
		const hits = await deps.postgres.searchChatMessages(q, {
			role,
			limit: Number.isFinite(n) ? n : 200,
		});
		// agrupa por telefone (session_id)
		const porTelefone: Record<string, Array<{ id: number; role: string; content: string }>> = {};
		for (const h of hits) {
			const tel = h.session_id;
			(porTelefone[tel] ??= []).push({ id: h.id, role: h.role, content: h.content });
		}
		return c.json({
			termo: q,
			total_mensagens: hits.length,
			total_conversas: Object.keys(porTelefone).length,
			telefones: Object.keys(porTelefone),
			por_telefone: porTelefone,
		});
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
		// aparecer duas vezes). Eventos sem agendamento_id (legado) são mantidos.
		if (tipo === 'agendamentos') {
			const seen = new Map<string, EventRow>();
			const noId: EventRow[] = [];
			for (const row of rows) {
				const det = (row.detalhes ?? {}) as Record<string, unknown>;
				const res = (det.result ?? {}) as Record<string, unknown>;
				const agId = res.agendamento_id != null ? String(res.agendamento_id) : null;
				if (agId === null) {
					noId.push(row); // sem ID → incluir sempre (retrocompatibilidade)
				} else if (!seen.has(agId)) {
					seen.set(agId, row); // com ID → dedup
				}
			}
			rows = [...Array.from(seen.values()), ...noId].sort(
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
	 * Lista TODOS os agendamentos de um dia (sem filtro de cliente).
	 * Cruza com disponibilidade pra diagnosticar folga vs lotação.
	 *   GET /admin/trinks/dia?data=2026-06-03
	 */
	router.get('/admin/trinks/dia', async (c) => {
		const data = c.req.query('data');
		if (!data) return c.json({ status: 'erro', razao: 'data obrigatória (YYYY-MM-DD)' }, 400);
		try {
			const result = await deps.trinks.listAgendamentos({
				dataInicio: `${data}T00:00:00`,
				dataFim: `${data}T23:59:59`,
			});
			const ags = (result.data ?? [])
				.filter((a) => a.profissional.id === 170223)
				.map((a) => ({
					id: a.id,
					cliente: a.cliente.nome,
					servico: a.servico.nome,
					inicio: a.dataHoraInicio,
					dur: a.duracaoEmMinutos,
					status: a.status.nome,
					status_id: a.status.id,
				}))
				.sort((x, y) => x.inicio.localeCompare(y.inicio));
			return c.json({ data, total: ags.length, agendamentos: ags });
		} catch (err) {
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	/**
	 * Diagnóstico de rede com a OpenAI. Faz N chamadas reais a /v1/models e
	 * reporta status + headers de resposta (content-length, transfer-encoding,
	 * via, server...) pra identificar proxy/header malformado que causa o
	 * "invalid content-length header" / "Premature close".
	 *   GET /admin/diag/openai?n=10
	 */
	router.get('/admin/diag/openai', async (c) => {
		const n = Math.min(Number(c.req.query('n') ?? 10), 50);
		const env = getEnv();
		const proxy = {
			HTTP_PROXY: process.env.HTTP_PROXY ?? process.env.http_proxy ?? null,
			HTTPS_PROXY: process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null,
			NO_PROXY: process.env.NO_PROXY ?? process.env.no_proxy ?? null,
			OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? null,
		};
		const mode = c.req.query('mode') ?? 'models';
		const accept = c.req.query('accept'); // 'identity' pra testar sem compressão
		const results: Array<Record<string, unknown>> = [];
		for (let i = 0; i < n; i++) {
			const t0 = Date.now();
			try {
				const headers: Record<string, string> = {
					Authorization: `Bearer ${env.OPENAI_API_KEY}`,
				};
				if (accept) headers['Accept-Encoding'] = accept;
				let res: Response;
				if (mode === 'chat') {
					// POST real ao /chat/completions (reproduz a condição do erro:
					// resposta grande, dinâmica, chunked + brotli pela Cloudflare).
					headers['Content-Type'] = 'application/json';
					res = await fetch('https://api.openai.com/v1/chat/completions', {
						method: 'POST',
						headers,
						body: JSON.stringify({
							model: env.OPENAI_MODEL,
							messages: [{ role: 'user', content: 'Liste 40 nomes brasileiros femininos, um por linha.' }],
							max_tokens: 800,
						}),
					});
				} else {
					res = await fetch('https://api.openai.com/v1/models', { headers });
				}
				const h: Record<string, string> = {};
				res.headers.forEach((v, k) => {
					h[k] = v;
				});
				// força ler o corpo todo pra reproduzir o erro de content-length
				const body = await res.text();
				results.push({
					i,
					ok: res.ok,
					status: res.status,
					ms: Date.now() - t0,
					bodyLen: body.length,
					contentLength: h['content-length'] ?? null,
					transferEncoding: h['transfer-encoding'] ?? null,
					contentEncoding: h['content-encoding'] ?? null,
					via: h.via ?? null,
					server: h.server ?? null,
					cfRay: h['cf-ray'] ?? null,
				});
			} catch (err) {
				results.push({
					i,
					ok: false,
					ms: Date.now() - t0,
					error: err instanceof Error ? err.message : String(err),
					cause:
						err instanceof Error && 'cause' in err
							? String((err as { cause?: unknown }).cause)
							: null,
				});
			}
		}
		const falhas = results.filter((r) => !r.ok).length;
		return c.json({
			node: process.version,
			proxy,
			tentativas: n,
			falhas,
			results,
		});
	});

	/**
	 * Valida o chat() real (streaming) com tool calling — confirma que a
	 * remontagem dos tool_calls fragmentados funciona em produção. Roda N vezes.
	 *   GET /admin/diag/stream?n=10
	 */
	router.get('/admin/diag/stream', async (c) => {
		if (!deps.openai) return c.json({ status: 'erro', razao: 'openai não injetado' }, 500);
		const n = Math.min(Number(c.req.query('n') ?? 10), 30);
		const tool = {
			type: 'function' as const,
			function: {
				name: 'agendar',
				description: 'Agenda um horário',
				parameters: {
					type: 'object',
					properties: {
						nome: { type: 'string' },
						data_hora: { type: 'string', description: 'ISO datetime' },
					},
					required: ['nome', 'data_hora'],
				},
			},
		};
		const results: Array<Record<string, unknown>> = [];
		for (let i = 0; i < n; i++) {
			const t0 = Date.now();
			try {
				const r = await deps.openai.chat({
					messages: [
						{
							role: 'user',
							content: 'Agende para Maria Silva no dia 2026-07-15 às 14:00. Use a ferramenta.',
						},
					],
					tools: [tool],
				});
				const tcs = r.message.tool_calls ?? [];
				results.push({
					i,
					ms: Date.now() - t0,
					finishReason: r.finishReason,
					toolCalls: tcs.map((t) => ({
						name: t.function.name,
						args: t.function.arguments,
						// argsValido confirma que o JSON remontado parseia
						argsValido: (() => {
							try {
								JSON.parse(t.function.arguments);
								return true;
							} catch {
								return false;
							}
						})(),
					})),
				});
			} catch (err) {
				results.push({ i, ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) });
			}
		}
		const falhas = results.filter((r) => r.error || (r.toolCalls as unknown[])?.length === 0).length;
		return c.json({ tentativas: n, falhas, results });
	});

	/**
	 * Diagnóstico do modo recesso. Confirma que o servidor leu as env vars e
	 * mostra o comportamento pra hoje e pra uma data simulada.
	 *   GET /admin/diag/recesso?data=2026-06-28
	 */
	router.get('/admin/diag/recesso', async (c) => {
		const { getRecesso, estaEmRecesso, dataRetornoRecesso, recessoInfoParaPrompt } = await import(
			'../domain/recesso.js'
		);
		const { todayBRT } = await import('../domain/data-brt.js');
		const hoje = todayBRT();
		const dataSim = c.req.query('data') ?? '2026-06-28';
		return c.json({
			configurado: getRecesso(),
			retorno: dataRetornoRecesso(),
			hoje: { data: hoje, em_recesso: estaEmRecesso(hoje) },
			simulado: {
				data: dataSim,
				em_recesso: estaEmRecesso(dataSim),
				prompt: recessoInfoParaPrompt(dataSim),
			},
		});
	});

	/**
	 * Diagnóstico: checa se um telefone está na lista de bloqueados (sempre
	 * "sem vagas"). Não expõe a lista inteira — só responde sim/não.
	 *   GET /admin/bloqueio/check?tel=5571993536700
	 */
	router.get('/admin/bloqueio/check', async (c) => {
		const tel = c.req.query('tel');
		if (!tel) return c.json({ status: 'erro', razao: 'tel obrigatório' }, 400);
		const { isNumeroBloqueado } = await import('../domain/bloqueio.js');
		return c.json({ telefone: tel, bloqueado: isNumeroBloqueado(tel) });
	});

	/**
	 * Busca cliente(s) na Trinks por nome — retorna id, nome e telefones.
	 * Útil pra achar o telefone de alguém pelo nome (ex: pra bloquear).
	 *   GET /admin/trinks/cliente?nome=Kelen
	 */
	router.get('/admin/trinks/cliente', async (c) => {
		const nome = c.req.query('nome');
		if (!nome) return c.json({ status: 'erro', razao: 'nome obrigatório' }, 400);
		try {
			const r = await deps.trinks.listClientes({ nome, pageSize: 50 });
			const clientes = (r.data ?? []).map((cl) => ({
				id: cl.id,
				nome: cl.nome,
				telefones: (cl.telefones ?? []).map(
					(t) => `${t.ddi ?? ''}${t.ddd ?? ''}${t.telefone}`,
				),
			}));
			return c.json({ nome, total: clientes.length, clientes });
		} catch (err) {
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	/**
	 * JSON CRU de um agendamento direto do Trinks (todos os campos, sem schema).
	 * Pra descobrir se há campo de data de criação/auditoria.
	 *   GET /admin/trinks/raw/:id
	 */
	router.get('/admin/trinks/raw/:id', async (c) => {
		const id = c.req.param('id');
		try {
			const r = await deps.trinks.rawRequest('GET', `/v1/agendamentos/${id}`);
			let parsed: unknown = r.body;
			try {
				parsed = JSON.parse(r.body);
			} catch {
				/* keep raw string */
			}
			return c.json({ id, raw: parsed });
		} catch (err) {
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
	});

	/**
	 * Disponibilidade real da profissional num dia (horariosVagos do Trinks).
	 * Debug: ver se bloqueios (ex: "Lanche") somem dos horariosVagos.
	 *   GET /admin/trinks/disponibilidade?data=2026-06-03&profissionalId=170223
	 */
	router.get('/admin/trinks/disponibilidade', async (c) => {
		const data = c.req.query('data');
		if (!data) return c.json({ status: 'erro', razao: 'data obrigatória (YYYY-MM-DD)' }, 400);
		try {
			const resp = await deps.trinks.listProfissionaisComAgenda(data);
			return c.json({ data, profissionais: resp.data });
		} catch (err) {
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
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

	/**
	 * Lista eventos brutos de um tipo (debug/auditoria). Retorna detalhes
	 * completos incluindo args + result. Cliente NUNCA acessa.
	 *   GET /admin/eventos-raw?tipo=agendamento_reagendado&n=30
	 *   GET /admin/eventos-raw?telefone=557182404610&n=50
	 */
	router.get('/admin/eventos-raw', async (c) => {
		const tipo = c.req.query('tipo');
		const telefone = c.req.query('telefone');
		const n = Number(c.req.query('n') ?? 50);
		const limit = Number.isFinite(n) && n > 0 ? n : 50;

		let q = deps.supabase.raw
			.from('eventos_helena')
			.select('id, criado_em, telefone, cliente_nome, tipo, sucesso, valor, detalhes')
			.order('criado_em', { ascending: false })
			.limit(limit);
		if (tipo) q = q.eq('tipo', tipo);
		if (telefone) q = q.eq('telefone', telefone);

		const { data, error } = await q;
		if (error) return c.json({ status: 'erro', razao: error.message }, 500);
		return c.json({ total: data?.length ?? 0, eventos: data ?? [] });
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
