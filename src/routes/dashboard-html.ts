/**
 * HTML dos dois dashboards servidos como strings.
 *
 * REGRA: não usar backtick nem ${} dentro do JS embutido
 * para não conflitar com o template literal TypeScript.
 * JS usa var + function() {} + concatenação de string.
 */

/* ─────────────────────────────────────────────────────────────
   CLIENTE — Dashboard Camila Rosário
   Rose gold · Josefin Sans · Luxo minimalista
   ───────────────────────────────────────────────────────────── */
export const CLIENTE_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Helena · Studio Camila Rosário</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Josefin+Sans:ital,wght@0,100;0,300;0,400;0,600;0,700;1,300&display=swap" rel="stylesheet">
<style>
:root{
  --bg:#FBF7F3;--wh:#FFFFFF;--bdr:#ECD5BB;
  --acc:#C8A882;--dk:#A07850;--ink:#2C1810;--mut:#9B8070;--lt:#F5EDE3;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font-family:'Josefin Sans',sans-serif;min-height:100vh}

/* ── Login ── */
#login{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.lb{text-align:center;max-width:340px;width:100%}
.lb-mark{font-size:.6rem;letter-spacing:.45em;text-transform:uppercase;color:var(--acc);margin-bottom:6px}
.lb-name{font-size:1.05rem;letter-spacing:.2em;text-transform:uppercase;color:var(--ink);font-weight:600;margin-bottom:28px}
.lb-div{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.lb-div span{height:1px;flex:1;background:var(--bdr)}
.lb-div i{font-style:normal;font-size:.55rem;letter-spacing:.25em;text-transform:uppercase;color:var(--mut);white-space:nowrap}
input[type=password]{width:100%;padding:14px 20px;border:1px solid var(--bdr);border-radius:0;background:var(--wh);color:var(--ink);font-family:'Josefin Sans',sans-serif;font-size:.9rem;outline:none;text-align:center;letter-spacing:.15em}
input[type=password]:focus{border-color:var(--acc)}
input::placeholder{color:var(--mut);font-size:.72rem;letter-spacing:.25em}
.btn-e{display:block;width:100%;padding:14px;background:var(--ink);border:none;color:var(--bg);font-family:'Josefin Sans',sans-serif;font-size:.68rem;font-weight:700;letter-spacing:.35em;text-transform:uppercase;cursor:pointer;margin-top:10px;transition:background .2s}
.btn-e:hover{background:var(--dk)}
.lerr{color:#C0392B;font-size:.7rem;letter-spacing:.12em;margin-top:12px;display:none}

/* ── Dashboard ── */
#dash{display:none}
header{background:var(--wh);border-bottom:1px solid var(--bdr);padding:20px 32px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;position:sticky;top:0;z-index:10}
.hb{flex:1;min-width:160px}
.hb-sub{font-size:.55rem;letter-spacing:.4em;text-transform:uppercase;color:var(--acc)}
.hb-title{font-size:.95rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ink);font-weight:600;margin-top:2px}
.pbts{display:flex;border:1px solid var(--bdr)}
.pbt{padding:8px 18px;border:none;background:transparent;color:var(--mut);font-family:'Josefin Sans',sans-serif;font-size:.65rem;letter-spacing:.22em;text-transform:uppercase;cursor:pointer;transition:all .15s;border-right:1px solid var(--bdr)}
.pbt:last-child{border-right:none}
.pbt:hover{background:var(--lt);color:var(--ink)}
.pbt.active{background:var(--ink);color:var(--bg)}
.btn-lo{padding:8px 14px;border:1px solid var(--bdr);background:transparent;color:var(--mut);font-family:'Josefin Sans',sans-serif;font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:all .15s}
.btn-lo:hover{border-color:var(--ink);color:var(--ink)}

main{max-width:960px;margin:0 auto;padding:40px 24px 64px}

/* ── Motivacional ── */
.motiv{text-align:center;padding:32px 24px;margin-bottom:2px;background:var(--wh);border:1px solid var(--bdr)}
.motiv-txt{font-size:1rem;font-weight:300;font-style:italic;color:var(--dk);letter-spacing:.04em;line-height:1.7}
.motiv-ornament{display:flex;align-items:center;gap:16px;margin-top:16px;justify-content:center}
.motiv-ornament span{height:1px;width:40px;background:var(--bdr)}
.motiv-ornament i{font-style:normal;color:var(--acc);font-size:.7rem}

/* ── Cards ── */
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--bdr);border:1px solid var(--bdr);border-top:none;margin-bottom:1px}
@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:400px){.grid{grid-template-columns:1fr}}
.kc{background:var(--wh);padding:28px 22px;transition:background .2s;cursor:default}
.kc:hover{background:var(--lt)}
.kc-lbl{font-size:.58rem;letter-spacing:.3em;text-transform:uppercase;color:var(--mut);margin-bottom:10px}
.kc-val{font-size:2.3rem;font-weight:700;color:var(--ink);line-height:1;letter-spacing:-.01em}
.kc-val.gold{color:var(--dk)}
.kc-sub{font-size:.68rem;color:var(--acc);margin-top:6px;letter-spacing:.08em}

/* ── Serviços ── */
.slist{background:var(--wh);border:1px solid var(--bdr);border-top:none;padding:0 24px}
.slist-hdr{padding:20px 0 14px;font-size:.58rem;letter-spacing:.35em;text-transform:uppercase;color:var(--acc);border-bottom:1px solid var(--bdr)}
.srow{display:flex;align-items:center;padding:16px 0;border-bottom:1px solid var(--bdr)}
.srow:last-child{border-bottom:none}
.srk{font-size:.62rem;letter-spacing:.2em;color:var(--mut);width:24px;flex-shrink:0}
.snm{flex:1;font-size:.88rem;letter-spacing:.05em;padding:0 16px}
.sbar-wrap{width:80px;height:2px;background:var(--bdr);margin-right:16px}
.sbar{height:2px;background:var(--acc)}
.sct{font-size:.7rem;letter-spacing:.15em;color:var(--acc);font-weight:600;flex-shrink:0}

.sempty{text-align:center;padding:24px;font-size:.7rem;letter-spacing:.2em;text-transform:uppercase;color:var(--mut)}

/* ── Footer ── */
.ftr{text-align:center;margin-top:36px;display:flex;align-items:center;justify-content:center;gap:20px;flex-wrap:wrap}
.btn-rf{padding:8px 22px;border:1px solid var(--bdr);background:transparent;color:var(--mut);font-family:'Josefin Sans',sans-serif;font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:all .15s}
.btn-rf:hover{border-color:var(--acc);color:var(--acc)}
.ftr-time{font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;color:var(--mut)}

.loading{text-align:center;padding:80px 24px;font-size:.65rem;letter-spacing:.35em;text-transform:uppercase;color:var(--mut)}

@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:none}}
.fa{animation:fadeUp .45s ease forwards;opacity:0}
.fa-d1{animation-delay:.05s}
.fa-d2{animation-delay:.15s}
.fa-d3{animation-delay:.25s}
</style>
</head>
<body>

<div id="login">
  <div class="lb">
    <div class="lb-mark">Studio Camila Ros&#xE1;rio</div>
    <div class="lb-name">Helena &middot; Relat&#xF3;rio</div>
    <div class="lb-div"><span></span><i>acesso restrito</i><span></span></div>
    <input type="password" id="tok" placeholder="&#xB7; &#xB7; &#xB7; &#xB7; &#xB7; &#xB7; &#xB7; &#xB7;">
    <button class="btn-e" onclick="doLogin()">Entrar</button>
    <div class="lerr" id="lerr">Acesso n&#xE3;o autorizado</div>
  </div>
</div>

<div id="dash">
  <header>
    <div class="hb">
      <div class="hb-sub">Studio Camila Ros&#xE1;rio</div>
      <div class="hb-title">Helena &middot; Painel</div>
    </div>
    <div class="pbts">
      <button class="pbt active" data-p="dia" onclick="setPeriodo('dia')">Hoje</button>
      <button class="pbt" data-p="semana" onclick="setPeriodo('semana')">7 dias</button>
      <button class="pbt" data-p="mes" onclick="setPeriodo('mes')">M&#xEA;s</button>
    </div>
    <button class="btn-lo" onclick="doLogout()">Sair</button>
  </header>
  <main><div id="ct"><div class="loading">Carregando...</div></div></main>
</div>

<script>
var cliTok = localStorage.getItem('helena_cli_token') || '';
var cliPer = 'dia';

function brl(n){ return 'R$ ' + Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmt(n){ return Number(n||0).toLocaleString('pt-BR'); }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function apiFetch(path){
  return fetch(window.location.origin + path, {headers:{'Authorization':'Bearer ' + cliTok}})
    .then(function(r){if(r.status===401)throw new Error('unauth');if(!r.ok)throw new Error('err');return r.json();});
}

function doLogin(){
  var v = (document.getElementById('tok').value || '').trim();
  if(!v) return;
  cliTok = v;
  document.getElementById('lerr').style.display = 'none';
  apiFetch('/admin/relatorio?periodo=dia')
    .then(function(){ localStorage.setItem('helena_cli_token', cliTok); showDash(); })
    .catch(function(){ document.getElementById('lerr').style.display = 'block'; cliTok = ''; });
}

function doLogout(){
  localStorage.removeItem('helena_cli_token'); cliTok = '';
  document.getElementById('dash').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
}

function setPeriodo(p){
  cliPer = p;
  document.querySelectorAll('.pbt').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-p') === p); });
  loadData();
}

function getMotiv(r){
  var ag = r.agendamentos_criados || 0;
  var conv = r.atendimentos_unicos || 0;
  var sinais = r.sinais_pagos || 0;
  var receita = Number(r.receita_potencial_agendada || 0);
  if(ag === 0 && conv === 0) return 'Helena está de prontidão, pronta para atender suas clientes 🌸';
  if(ag >= 8) return 'Que dia incrível! Helena agendou ' + ag + ' clientes por você ✨';
  if(ag >= 3 && sinais > 0) return 'Helena garantiu ' + ag + ' agendamentos e ' + sinais + ' sinal(is) por você 💰';
  if(ag > 0 && receita > 0) return 'Helena gerou ' + brl(receita) + ' em agendamentos enquanto você trabalhava 🌸';
  if(ag > 0) return 'Helena agendou ' + ag + ' cliente(s) por você hoje ✨';
  if(conv > 5) return 'Helena atendeu ' + conv + ' conversas por você 💬';
  return 'Helena cuida das suas clientes com cuidado e carinho 🫦';
}

function animCount(elId, target, isFloat){
  var el = document.getElementById(elId);
  if(!el) return;
  var curr = 0;
  var steps = 28;
  var step = target / steps;
  var i = 0;
  var timer = setInterval(function(){
    i++;
    curr = Math.min(curr + step, target);
    if(isFloat){
      el.textContent = 'R$ ' + curr.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
    } else {
      el.textContent = Math.floor(curr).toLocaleString('pt-BR');
    }
    if(i >= steps){ clearInterval(timer); }
  }, 18);
}

function render(r){
  var ts = r.top_servicos || [];
  var maxTotal = ts.length > 0 ? (ts[0].total || 1) : 1;
  var h = '';

  h += '<div class="motiv fa fa-d1">';
  h += '<div class="motiv-txt">' + esc(getMotiv(r)) + '</div>';
  h += '<div class="motiv-ornament"><span></span><i>&#x2665;</i><span></span></div>';
  h += '</div>';

  h += '<div class="grid fa fa-d2">';
  h += mkKC('conv', 'Conversas atendidas', fmt(r.atendimentos_unicos), '', '', r.atendimentos_unicos, false);
  h += mkKC('ag', 'Agendamentos feitos', fmt(r.agendamentos_criados), '', '', r.agendamentos_criados, false);
  h += mkKC('rec', 'Receita gerada', brl(r.receita_potencial_agendada), '', 'gold', r.receita_potencial_agendada, true);
  h += mkKC('sin', 'Sinais recebidos', fmt(r.sinais_pagos), brl(r.receita_sinais), '', r.sinais_pagos, false);
  h += mkKC('cat', 'Catálogos enviados', fmt(r.catalogos_enviados), 'novos contatos', '', r.catalogos_enviados, false);
  h += mkKC('enc', 'Encaminhados pra você', fmt(r.transferidos_humano), 'atenção especial', '', r.transferidos_humano, false);
  h += '</div>';

  if(ts.length > 0){
    h += '<div class="slist fa fa-d3">';
    h += '<div class="slist-hdr">Serviços mais procurados</div>';
    for(var i = 0; i < ts.length; i++){
      var pct = Math.round((ts[i].total / maxTotal) * 100);
      h += '<div class="srow">';
      h += '<span class="srk">0' + (i+1) + '</span>';
      h += '<span class="snm">' + esc(ts[i].nome || '') + '</span>';
      h += '<div class="sbar-wrap"><div class="sbar" style="width:' + pct + '%"></div></div>';
      h += '<span class="sct">' + (ts[i].total || 0) + 'x</span>';
      h += '</div>';
    }
    h += '</div>';
  }

  h += '<div class="ftr">';
  h += '<button class="btn-rf" onclick="loadData()">↻ Atualizar</button>';
  h += '<span class="ftr-time">Atualizado às ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + '</span>';
  h += '</div>';

  document.getElementById('ct').innerHTML = h;

  animCount('conv', r.atendimentos_unicos || 0, false);
  animCount('ag', r.agendamentos_criados || 0, false);
  animCount('rec', r.receita_potencial_agendada || 0, true);
  animCount('sin', r.sinais_pagos || 0, false);
  animCount('cat', r.catalogos_enviados || 0, false);
  animCount('enc', r.transferidos_humano || 0, false);
}

function mkKC(id, lbl, val, sub, cls, raw, isFloat){
  return '<div class="kc"><div class="kc-lbl">' + esc(lbl) + '</div>' +
    '<div class="kc-val ' + cls + '" id="' + id + '">' + esc(val) + '</div>' +
    (sub ? '<div class="kc-sub">' + esc(sub) + '</div>' : '') +
    '</div>';
}

function loadData(){
  document.getElementById('ct').innerHTML = '<div class="loading">Carregando...</div>';
  apiFetch('/admin/relatorio?periodo=' + cliPer)
    .then(function(d){ render(d.resumo || d); })
    .catch(function(e){
      if(e.message === 'unauth'){ doLogout(); return; }
      document.getElementById('ct').innerHTML = '<div class="loading">Erro ao carregar. Tente novamente.</div>';
    });
}

function showDash(){
  document.getElementById('login').style.display = 'none';
  document.getElementById('dash').style.display = 'block';
  loadData();
}

document.getElementById('tok').addEventListener('keydown', function(e){ if(e.key === 'Enter') doLogin(); });
if(cliTok) showDash();
</script>
</body>
</html>`;

/* ─────────────────────────────────────────────────────────────
   ADMIN/DEV — Dashboard técnico dark
   ───────────────────────────────────────────────────────────── */
export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Helena Admin</title>
<style>
:root{
  --bg:#0f0f13;--s1:#1a1a24;--s2:#21212e;--bdr:#2a2a38;
  --txt:#e8e8f0;--mut:#8888aa;--acc:#a07de0;--acc2:#c9b8f0;
  --grn:#4caf82;--red:#e05c5c;--yel:#e0aa3c;--blu:#5c9de0;
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--txt);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;font-size:14px}

/* ── Login ── */
#login{display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.adm-lb{background:var(--s1);border:1px solid var(--bdr);border-radius:12px;padding:36px;width:100%;max-width:340px}
.adm-lb h1{font-size:1.1rem;margin-bottom:4px;font-weight:600}
.adm-lb p{color:var(--mut);font-size:.82rem;margin-bottom:20px}
input[type=password]{width:100%;padding:11px 14px;background:var(--bg);border:1px solid var(--bdr);border-radius:8px;color:var(--txt);font-size:.88rem;outline:none;font-family:inherit}
input[type=password]:focus{border-color:var(--acc)}
.btn-p{display:block;width:100%;padding:11px;background:var(--acc);border:none;border-radius:8px;color:#fff;font-size:.85rem;font-weight:600;cursor:pointer;margin-top:10px;transition:opacity .15s;font-family:inherit}
.btn-p:hover{opacity:.88}
.adm-lerr{color:var(--red);font-size:.78rem;margin-top:8px;display:none}

/* ── Dashboard ── */
#dash{display:none}
header{background:var(--s1);border-bottom:1px solid var(--bdr);padding:14px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:10}
.h-brand{flex:1;min-width:140px}
.h-brand-name{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--acc);font-weight:600}
.h-brand-sub{font-size:.75rem;color:var(--mut);margin-top:1px}
.pbts{display:flex;gap:6px}
.pbt{padding:5px 14px;border-radius:20px;border:1px solid var(--bdr);background:transparent;color:var(--mut);cursor:pointer;font-size:.75rem;transition:all .15s;font-family:inherit;white-space:nowrap}
.pbt:hover{border-color:var(--acc);color:var(--txt)}
.pbt.active{background:var(--acc);border-color:var(--acc);color:#fff}
.btn-lo{padding:5px 12px;border-radius:8px;border:1px solid var(--bdr);background:transparent;color:var(--mut);cursor:pointer;font-size:.75rem;transition:all .15s;font-family:inherit}
.btn-lo:hover{border-color:var(--red);color:var(--red)}

main{padding:20px 24px 48px;max-width:1100px;margin:0 auto}
.sec{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--mut);margin-bottom:12px;margin-top:28px}

/* ── Cards ── */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px}
.card{background:var(--s1);border:1px solid var(--bdr);border-radius:12px;padding:16px;transition:border-color .15s}
.card:hover{border-color:var(--acc)}
.c-lbl{font-size:.68rem;color:var(--mut);margin-bottom:8px;line-height:1.4}
.c-val{font-size:1.85rem;font-weight:700;line-height:1}
.c-sub{font-size:.72rem;color:var(--mut);margin-top:5px}
.c-acc .c-val{color:var(--acc2)}.c-grn .c-val{color:var(--grn)}.c-red .c-val{color:var(--red)}.c-yel .c-val{color:var(--yel)}

/* ── Lists ── */
.two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:580px){.two{grid-template-columns:1fr}}
.lcard{background:var(--s1);border:1px solid var(--bdr);border-radius:12px;padding:16px}
.lcard h3{font-size:.72rem;color:var(--mut);margin-bottom:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em}
.lrow{display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--bdr);font-size:.85rem}
.lrow:last-child{border-bottom:none}
.lrk{color:var(--mut);font-size:.72rem;width:20px;flex-shrink:0}
.lnm{flex:1;padding:0 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lct{font-weight:600;color:var(--acc);flex-shrink:0;font-size:.8rem}
.lempty{color:var(--mut);text-align:center;padding:16px;font-size:.8rem}

/* ── Errors ── */
.etbl-wrap{background:var(--s1);border:1px solid var(--bdr);border-radius:12px;overflow:hidden}
.etbl{width:100%;border-collapse:collapse;font-size:.8rem}
.etbl th{text-align:left;padding:10px 14px;color:var(--mut);font-weight:600;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid var(--bdr);background:var(--s2)}
.etbl td{padding:10px 14px;border-bottom:1px solid var(--bdr);vertical-align:top}
.etbl tr:last-child td{border-bottom:none}
.etbl tr:hover td{background:rgba(160,125,224,.05)}
.tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.68rem;font-weight:700;background:rgba(224,92,92,.15);color:var(--red);letter-spacing:.04em}
.ph{font-family:'Courier New',monospace;color:var(--mut);font-size:.75rem}
.rz{color:var(--mut);max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.e-none{color:var(--grn);text-align:center;padding:24px;font-size:.82rem}

/* ── Footer ── */
.ftr{display:flex;align-items:center;gap:12px;margin-top:28px;padding-top:16px;border-top:1px solid var(--bdr)}
.btn-rf{padding:6px 14px;border-radius:8px;border:1px solid var(--bdr);background:transparent;color:var(--mut);cursor:pointer;font-size:.75rem;transition:all .15s;font-family:inherit}
.btn-rf:hover{border-color:var(--acc);color:var(--acc)}
.ftr-t{font-size:.7rem;color:var(--mut)}
.loading{text-align:center;padding:48px;color:var(--mut);font-size:.82rem}
</style>
</head>
<body>

<div id="login">
  <div class="adm-lb">
    <h1>&#x1F4CA; Helena Admin</h1>
    <p>Painel do desenvolvedor</p>
    <input type="password" id="atok" placeholder="Bearer secret..." autocomplete="current-password">
    <button class="btn-p" onclick="aLogin()">Entrar</button>
    <div class="adm-lerr" id="alerr">Secret incorreto</div>
  </div>
</div>

<div id="dash">
  <header>
    <div class="h-brand">
      <div class="h-brand-name">&#x25CF; Helena Admin</div>
      <div class="h-brand-sub">Painel t&#xE9;cnico</div>
    </div>
    <div class="pbts">
      <button class="pbt active" data-p="dia" onclick="aPer('dia')">Hoje</button>
      <button class="pbt" data-p="semana" onclick="aPer('semana')">7 dias</button>
      <button class="pbt" data-p="mes" onclick="aPer('mes')">M&#xEA;s</button>
    </div>
    <button class="btn-lo" onclick="aLogout()">Sair</button>
  </header>
  <main><div id="act"><div class="loading">Carregando...</div></div></main>
</div>

<script>
var aTok = localStorage.getItem('helena_adm_token') || '';
var aPeriodo = 'dia';

function afmt(n){ return Number(n||0).toLocaleString('pt-BR'); }
function abrl(n){ return 'R$ ' + Number(n||0).toFixed(2).replace('.',','); }
function aesc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function ahora(iso){
  try{ return new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Bahia'}); }
  catch(e){ return '--'; }
}

function aFetch(path){
  return fetch(window.location.origin + path, {headers:{'Authorization':'Bearer ' + aTok}})
    .then(function(r){if(r.status===401) throw new Error('unauth'); if(!r.ok) throw new Error('err'); return r.json();});
}

function aLogin(){
  var v = (document.getElementById('atok').value || '').trim();
  if(!v) return;
  aTok = v;
  document.getElementById('alerr').style.display = 'none';
  aFetch('/admin/relatorio?periodo=dia')
    .then(function(){ localStorage.setItem('helena_adm_token', aTok); aShowDash(); })
    .catch(function(){ document.getElementById('alerr').style.display = 'block'; aTok = ''; });
}

function aLogout(){
  localStorage.removeItem('helena_adm_token'); aTok = '';
  document.getElementById('dash').style.display = 'none';
  document.getElementById('login').style.display = 'flex';
}

function aPer(p){
  aPeriodo = p;
  document.querySelectorAll('.pbt').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-p') === p); });
  aLoad();
}

function aLoad(){
  document.getElementById('act').innerHTML = '<div class="loading">Carregando...</div>';
  Promise.all([
    aFetch('/admin/relatorio?periodo=' + aPeriodo),
    aFetch('/admin/erros?n=30')
  ]).then(function(rs){ aRender(rs[0].resumo || rs[0], rs[1].erros || []); })
    .catch(function(e){
      if(e.message === 'unauth'){ aLogout(); return; }
      document.getElementById('act').innerHTML = '<div class="loading">Erro ao carregar.</div>';
    });
}

function aCard(lbl, val, sub, cls){
  return '<div class="card ' + (cls||'') + '"><div class="c-lbl">' + aesc(lbl) + '</div><div class="c-val">' + aesc(val) + '</div>' + (sub ? '<div class="c-sub">' + aesc(sub) + '</div>' : '') + '</div>';
}

function aList(title, rows){
  var inner = rows.length === 0 ? '<div class="lempty">Nenhum dado</div>' :
    rows.map(function(r, i){
      return '<div class="lrow"><span class="lrk">' + (i+1) + '.</span><span class="lnm" title="' + aesc(r.nome||r.faixa||'') + '">' + aesc(r.nome||r.faixa||'') + '</span><span class="lct">' + (r.total||0) + 'x</span></div>';
    }).join('');
  return '<div class="lcard"><h3>' + aesc(title) + '</h3>' + inner + '</div>';
}

function aRender(r, erros){
  var ts = r.top_servicos || [];
  var th = r.top_horarios || [];
  var h = '';

  h += '<div class="sec">Visão geral</div><div class="cards">';
  h += aCard('Conversas únicas', afmt(r.atendimentos_unicos), null, 'c-acc');
  h += aCard('Agendamentos', afmt(r.agendamentos_criados), abrl(r.receita_potencial_agendada), 'c-grn');
  h += aCard('Sinais pagos', afmt(r.sinais_pagos), abrl(r.receita_sinais), 'c-grn');
  h += aCard('Cancelamentos', afmt(r.agendamentos_cancelados), null, 'c-red');
  h += aCard('Reagendamentos', afmt(r.agendamentos_reagendados), null, 'c-yel');
  h += aCard('Transferidos', afmt(r.transferidos_humano), null, '');
  h += aCard('Catálogos', afmt(r.catalogos_enviados), null, '');
  h += aCard('PDFs curso', afmt(r.cursos_enviados), null, '');
  h += '</div>';

  if(ts.length > 0 || th.length > 0){
    h += '<div class="sec">Destaques</div><div class="two">';
    h += aList('🔝 Serviços mais procurados', ts);
    h += aList('🕐 Faixas horárias top', th);
    h += '</div>';
  }

  h += '<div class="sec">Erros recentes</div>';
  if(erros.length === 0){
    h += '<div class="e-none">✅ Nenhum erro</div>';
  } else {
    h += '<div class="etbl-wrap"><table class="etbl"><thead><tr><th>Hora</th><th>Tool</th><th>Razão</th><th>Telefone</th></tr></thead><tbody>';
    erros.forEach(function(e){
      var det = e.detalhes || {};
      var res = det.result || {};
      var tool = det.tool || '?';
      var razao = res.razao || det.razao || '—';
      var tel = e.telefone ? ('…' + String(e.telefone).slice(-4)) : '—';
      h += '<tr><td>' + aesc(ahora(e.criado_em)) + '</td>';
      h += '<td><span class="tag">' + aesc(tool) + '</span></td>';
      h += '<td class="rz" title="' + aesc(razao) + '">' + aesc(razao) + '</td>';
      h += '<td class="ph">' + aesc(tel) + '</td></tr>';
    });
    h += '</tbody></table></div>';
  }

  h += '<div class="ftr"><button class="btn-rf" onclick="aLoad()">↻ Atualizar</button>';
  h += '<span class="ftr-t">Atualizado às ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + '</span></div>';

  document.getElementById('act').innerHTML = h;
}

function aShowDash(){
  document.getElementById('login').style.display = 'none';
  document.getElementById('dash').style.display = 'block';
  aLoad();
}

document.getElementById('atok').addEventListener('keydown', function(e){ if(e.key === 'Enter') aLogin(); });
if(aTok) aShowDash();
</script>
</body>
</html>`;
