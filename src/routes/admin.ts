/**
 * Endpoints de auditoria/admin. Protegidos por WEBHOOK_SHARED_SECRET.
 * Não exposto pro público.
 * /admin/dashboard é a exceção: serve HTML público que faz autenticação client-side.
 */
import { Hono } from 'hono';
import type { PostgresClient } from '../clients/postgres.js';
import type { AppSupabaseClient } from '../clients/supabase.js';
import { todayBRT } from '../domain/data-brt.js';
import { agregarEventos } from '../jobs/relatorio-diario.js';
import { getEnv } from '../infra/env.js';

/* ─────────────────────────────────────────────────────────────
   Dashboard HTML — SPA minimalista, auth via localStorage
   ───────────────────────────────────────────────────────────── */
const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Helena — Dashboard</title>
<style>
:root{--bg:#0f0f13;--surf:#1a1a24;--bdr:#2a2a38;--txt:#e8e8f0;--mut:#8888aa;--acc:#a07de0;--grn:#4caf82;--red:#e05c5c;--yel:#e0aa3c}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh}
#login{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:16px}
.lbox{background:var(--surf);border:1px solid var(--bdr);border-radius:16px;padding:40px;width:100%;max-width:360px}
.lbox h1{font-size:1.4rem;margin-bottom:6px}
.lbox p{color:var(--mut);font-size:.88rem;margin-bottom:24px}
input[type=password]{width:100%;padding:12px 16px;background:var(--bg);border:1px solid var(--bdr);border-radius:8px;color:var(--txt);font-size:.95rem;outline:none}
input[type=password]:focus{border-color:var(--acc)}
.btn-p{display:block;width:100%;padding:12px;background:var(--acc);border:none;border-radius:8px;color:#fff;font-size:.95rem;font-weight:600;cursor:pointer;margin-top:12px;transition:opacity .15s}
.btn-p:hover{opacity:.85}
.err-msg{color:var(--red);font-size:.82rem;margin-top:10px;display:none}
#dash{display:none}
header{background:var(--surf);border-bottom:1px solid var(--bdr);padding:14px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:10}
header h1{font-size:1.1rem;flex:1;min-width:120px}
.pbts{display:flex;gap:6px}
.pbt{padding:5px 14px;border-radius:20px;border:1px solid var(--bdr);background:transparent;color:var(--mut);cursor:pointer;font-size:.82rem;transition:all .15s;white-space:nowrap}
.pbt:hover{border-color:var(--acc);color:var(--txt)}
.pbt.active{background:var(--acc);border-color:var(--acc);color:#fff}
.btn-lo{padding:5px 12px;border-radius:8px;border:1px solid var(--bdr);background:transparent;color:var(--mut);cursor:pointer;font-size:.8rem;white-space:nowrap;transition:all .15s}
.btn-lo:hover{border-color:var(--red);color:var(--red)}
main{padding:20px 24px 48px;max-width:1100px;margin:0 auto}
.stitle{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--mut);margin-bottom:12px;margin-top:28px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px}
.card{background:var(--surf);border:1px solid var(--bdr);border-radius:12px;padding:16px}
.clbl{font-size:.75rem;color:var(--mut);margin-bottom:8px;line-height:1.3}
.cval{font-size:1.9rem;font-weight:700;line-height:1}
.csub{font-size:.8rem;color:var(--mut);margin-top:4px}
.ca .cval{color:var(--acc)}.cg .cval{color:var(--grn)}.cr .cval{color:var(--red)}.cy .cval{color:var(--yel)}
.two-col{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:580px){.two-col{grid-template-columns:1fr}}
.lcard{background:var(--surf);border:1px solid var(--bdr);border-radius:12px;padding:16px}
.lcard h3{font-size:.82rem;color:var(--mut);margin-bottom:12px}
.lrow{display:flex;align-items:center;padding:7px 0;border-bottom:1px solid var(--bdr);font-size:.88rem}
.lrow:last-child{border-bottom:none}
.lrk{color:var(--mut);font-size:.78rem;width:18px;flex-shrink:0}
.lnm{flex:1;padding:0 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lct{font-weight:600;color:var(--acc);flex-shrink:0}
.lempty{color:var(--mut);font-size:.85rem;text-align:center;padding:16px 0}
.ewrap{background:var(--surf);border:1px solid var(--bdr);border-radius:12px;overflow:hidden}
.etbl{width:100%;border-collapse:collapse;font-size:.83rem}
.etbl th{text-align:left;padding:10px 14px;color:var(--mut);font-weight:500;font-size:.75rem;border-bottom:1px solid var(--bdr);white-space:nowrap}
.etbl td{padding:10px 14px;border-bottom:1px solid var(--bdr);vertical-align:top}
.etbl tr:last-child td{border-bottom:none}
.tag{display:inline-block;padding:2px 7px;border-radius:4px;font-size:.72rem;font-weight:600;background:rgba(224,92,92,.15);color:var(--red)}
.ph{font-family:monospace;color:var(--mut);font-size:.8rem}
.rz{color:var(--mut);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.footer{display:flex;align-items:center;gap:12px;margin-top:28px;padding-top:16px;border-top:1px solid var(--bdr)}
.btn-rf{padding:6px 14px;border-radius:8px;border:1px solid var(--bdr);background:transparent;color:var(--mut);cursor:pointer;font-size:.8rem;transition:all .15s}
.btn-rf:hover{border-color:var(--acc);color:var(--acc)}
.lupd{font-size:.75rem;color:var(--mut)}
.empty{color:var(--mut);text-align:center;padding:32px;font-size:.88rem}
.loading{color:var(--mut);text-align:center;padding:48px;font-size:.88rem}
</style>
</head>
<body>

<div id="login">
  <div class="lbox">
    <h1>&#x1F4CA; Helena</h1>
    <p>Acesse com o secret de admin</p>
    <input type="password" id="tok" placeholder="Bearer secret..." autocomplete="current-password">
    <button class="btn-p" onclick="doLogin()">Entrar</button>
    <div class="err-msg" id="lerr">Secret incorreto</div>
  </div>
</div>

<div id="dash">
  <header>
    <h1>&#x1F4CA; Helena</h1>
    <div class="pbts">
      <button class="pbt active" data-p="dia" onclick="setPeriodo('dia')">Hoje</button>
      <button class="pbt" data-p="semana" onclick="setPeriodo('semana')">7 dias</button>
      <button class="pbt" data-p="mes" onclick="setPeriodo('mes')">M&#xEA;s</button>
    </div>
    <button class="btn-lo" onclick="doLogout()">Sair</button>
  </header>
  <main><div id="content"><div class="loading">Carregando...</div></div></main>
</div>

<script>
var token = localStorage.getItem('helena_token') || '';
var periodo = 'dia';

function fmt(n){return Number(n||0).toLocaleString('pt-BR')}
function brl(n){return 'R$ '+Number(n||0).toFixed(2).replace('.',',')}
function hfmt(iso){try{return new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Bahia'})}catch(e){return '-'}}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

function apiFetch(path){
  return fetch(window.location.origin+path,{headers:{Authorization:'Bearer '+token}})
    .then(function(r){if(r.status===401)throw new Error('unauth');if(!r.ok)throw new Error('err'+r.status);return r.json()});
}

function doLogin(){
  var val=(document.getElementById('tok').value||'').trim();
  if(!val)return;
  token=val;
  document.getElementById('lerr').style.display='none';
  apiFetch('/admin/relatorio?periodo=dia')
    .then(function(){localStorage.setItem('helena_token',token);showDash()})
    .catch(function(){document.getElementById('lerr').style.display='block';token=''});
}

function doLogout(){
  localStorage.removeItem('helena_token');token='';
  document.getElementById('dash').style.display='none';
  document.getElementById('login').style.display='flex';
}

function setPeriodo(p){
  periodo=p;
  document.querySelectorAll('.pbt').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-p')===p)});
  loadData();
}

function loadData(){
  document.getElementById('content').innerHTML='<div class="loading">Carregando...</div>';
  Promise.all([apiFetch('/admin/relatorio?periodo='+periodo),apiFetch('/admin/erros?n=30')])
    .then(function(rs){render(rs[0].resumo||rs[0],rs[1].erros||[])})
    .catch(function(e){if(e.message==='unauth'){doLogout();return}document.getElementById('content').innerHTML='<div class="empty">Erro ao carregar. Tente novamente.</div>'});
}

function mkCard(lbl,val,sub,cls){
  return '<div class="card '+(cls||'')+'"><div class="clbl">'+esc(lbl)+'</div><div class="cval">'+esc(val)+'</div>'+(sub?'<div class="csub">'+esc(sub)+'</div>':'')+'</div>';
}

function mkList(title,rows){
  var inner=rows.length===0?'<div class="lempty">Nenhum dado</div>':rows.map(function(r,i){
    var nome=r.nome||r.faixa||'';
    return '<div class="lrow"><span class="lrk">'+(i+1)+'.</span><span class="lnm" title="'+esc(nome)+'">'+esc(nome)+'</span><span class="lct">'+(r.total||0)+'x</span></div>';
  }).join('');
  return '<div class="lcard"><h3>'+esc(title)+'</h3>'+inner+'</div>';
}

function render(r,erros){
  var now=new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  var ts=r.top_servicos||[];var th=r.top_horarios||[];
  var h='';

  h+='<div class="stitle">Visão geral</div><div class="cards">';
  h+=mkCard('Conversas únicas',fmt(r.atendimentos_unicos),null,'ca');
  h+=mkCard('Agendamentos',fmt(r.agendamentos_criados),brl(r.receita_potencial_agendada),'cg');
  h+=mkCard('Sinais pagos',fmt(r.sinais_pagos),brl(r.receita_sinais),'cg');
  h+=mkCard('Cancelamentos',fmt(r.agendamentos_cancelados),null,'cr');
  h+=mkCard('Reagendamentos',fmt(r.agendamentos_reagendados),null,'cy');
  h+=mkCard('Transferidos',fmt(r.transferidos_humano),null,'');
  h+=mkCard('Catálogos',fmt(r.catalogos_enviados),null,'');
  h+=mkCard('PDFs curso',fmt(r.cursos_enviados),null,'');
  h+='</div>';

  if(ts.length>0||th.length>0){
    h+='<div class="stitle">Destaques</div><div class="two-col">';
    h+=mkList('🔝 Serviços mais procurados',ts);
    h+=mkList('🕐 Faixas horárias top',th);
    h+='</div>';
  }

  h+='<div class="stitle">Erros recentes</div>';
  if(erros.length===0){
    h+='<div class="empty">✅ Nenhum erro</div>';
  } else {
    h+='<div class="ewrap"><table class="etbl"><thead><tr><th>Hora</th><th>Tool</th><th>Razão</th><th>Telefone</th></tr></thead><tbody>';
    erros.forEach(function(e){
      var det=e.detalhes||{};var res=det.result||{};
      var tool=det.tool||'?';
      var razao=res.razao||det.razao||'—';
      var tel=e.telefone?('…'+String(e.telefone).slice(-4)):'—';
      h+='<tr><td>'+esc(hfmt(e.criado_em))+'</td><td><span class="tag">'+esc(tool)+'</span></td><td class="rz" title="'+esc(razao)+'">'+esc(razao)+'</td><td class="ph">'+esc(tel)+'</td></tr>';
    });
    h+='</tbody></table></div>';
  }

  h+='<div class="footer"><button class="btn-rf" onclick="loadData()">↻ Atualizar</button><span class="lupd">Atualizado às '+esc(now)+'</span></div>';
  document.getElementById('content').innerHTML=h;
}

function showDash(){
  document.getElementById('login').style.display='none';
  document.getElementById('dash').style.display='block';
  loadData();
}

document.getElementById('tok').addEventListener('keydown',function(e){if(e.key==='Enter')doLogin()});
if(token)showDash();
</script>
</body>
</html>`;

export { DASHBOARD_HTML };

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
	// dia (default)
	return { inicio: `${hoje}T00:00:00-03:00`, fim: `${hoje}T23:59:59-03:00` };
}

export function createAdminRouter(deps: AdminDeps): Hono {
	const router = new Hono();
	const env = getEnv();

	router.use('/admin/*', async (c, next) => {
		if (env.WEBHOOK_SHARED_SECRET) {
			const auth = c.req.header('Authorization');
			if (auth !== `Bearer ${env.WEBHOOK_SHARED_SECRET}`) {
				return c.json({ status: 'erro', razao: 'Unauthorized' }, 401);
			}
		}
		return next();
	});

	/** Quem está interagindo com Helena? Lista sessions ordenadas por última mensagem. */
	router.get('/admin/sessions', async (c) => {
		const sessions = await deps.postgres.listChatSessions();
		return c.json({ total_sessions: sessions.length, sessions });
	});

	/** Últimas mensagens inbound recebidas no webhook UAZAPI. */
	router.get('/admin/inbound', async (c) => {
		const limit = Number(c.req.query('n') ?? 50);
		const includePayload = c.req.query('payload') === '1';
		const rows = await deps.postgres.listWebhookInbound({
			limit: Number.isFinite(limit) ? limit : 50,
			includePayload,
		});
		return c.json({ total: rows.length, mensagens: rows });
	});

	/** Mensagens inbound de um telefone específico. */
	router.get('/admin/inbound/telefone/:telefone', async (c) => {
		const telefone = c.req.param('telefone');
		const limit = Number(c.req.query('n') ?? 50);
		const rows = await deps.postgres.listWebhookInbound({
			telefone,
			limit: Number.isFinite(limit) ? limit : 50,
		});
		return c.json({ telefone, total: rows.length, mensagens: rows });
	});

	/** Sessões com última mensagem do usuário sem resposta da Helena. */
	router.get('/admin/sem-resposta', async (c) => {
		const sessions = await deps.postgres.listSessionsSemResposta();
		return c.json({ total: sessions.length, sessions });
	});

	/** Últimas N mensagens de uma sessão (telefone) pra inspecionar conteúdo. */
	router.get('/admin/session/:telefone', async (c) => {
		const telefone = c.req.param('telefone');
		const limit = Number(c.req.query('n') ?? 10);
		const rows = await deps.postgres.loadRecentMessages(telefone, Number.isFinite(limit) ? limit : 10);
		return c.json({ telefone, total: rows.length, mensagens: rows });
	});

	/** Relatório agregado — período = 'dia' | 'semana' | 'mes'. Cliente nunca acessa. */
	router.get('/admin/relatorio', async (c) => {
		const periodo = c.req.query('periodo') ?? 'dia';
		const dataParam = c.req.query('data');
		try {
			const { inicio, fim } = calcRange(periodo, dataParam);
			const data = dataParam ?? todayBRT();
			const resumo = await agregarEventos(deps.supabase, inicio, fim);
			return c.json({ periodo, data, resumo });
		} catch (err) {
			return c.json({ status: 'erro', razao: err instanceof Error ? err.message : 'unknown' }, 500);
		}
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
		if (error) {
			return c.json({ status: 'erro', razao: error.message }, 500);
		}
		return c.json({ total: data?.length ?? 0, erros: data ?? [] });
	});

	return router;
}
