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

/* -- Dashboard -- */
header{background:var(--wh);border-bottom:1px solid var(--bdr);padding:20px 32px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;position:sticky;top:0;z-index:10}
.hb{flex:1;min-width:160px}
.hb-sub{font-size:.55rem;letter-spacing:.4em;text-transform:uppercase;color:var(--acc)}
.hb-title{font-size:.95rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ink);font-weight:600;margin-top:2px}
.pbts{display:flex;border:1px solid var(--bdr)}
.pbt{padding:8px 18px;border:none;background:transparent;color:var(--mut);font-family:'Josefin Sans',sans-serif;font-size:.65rem;letter-spacing:.22em;text-transform:uppercase;cursor:pointer;transition:all .15s;border-right:1px solid var(--bdr)}
.pbt:last-child{border-right:none}
.pbt:hover{background:var(--lt);color:var(--ink)}
.pbt.active{background:var(--ink);color:var(--bg)}

main{max-width:960px;margin:0 auto;padding:40px 24px 64px}

/* -- Motivacional -- */
.motiv{text-align:center;padding:32px 24px;margin-bottom:2px;background:var(--wh);border:1px solid var(--bdr)}
.motiv-txt{font-size:1rem;font-weight:300;font-style:italic;color:var(--dk);letter-spacing:.04em;line-height:1.7}
.motiv-ornament{display:flex;align-items:center;gap:16px;margin-top:16px;justify-content:center}
.motiv-ornament span{height:1px;width:40px;background:var(--bdr)}
.motiv-ornament i{font-style:normal;color:var(--acc);font-size:.7rem}

/* -- Cards -- */
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--bdr);border:1px solid var(--bdr);border-top:none;margin-bottom:1px}
@media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:400px){.grid{grid-template-columns:1fr}}
.kc{background:var(--wh);padding:28px 22px;transition:background .2s;cursor:default}
.kc:hover{background:var(--lt)}
.kc-lbl{font-size:.58rem;letter-spacing:.3em;text-transform:uppercase;color:var(--mut);margin-bottom:10px}
.kc-val{font-size:2.3rem;font-weight:700;color:var(--ink);line-height:1;letter-spacing:-.01em}
.kc-val.gold{color:var(--dk)}
.kc-sub{font-size:.68rem;color:var(--acc);margin-top:6px;letter-spacing:.08em}
.kc.clickable{cursor:pointer}
.kc.active{background:var(--lt);border-bottom:2px solid var(--acc)}
.kc-hint{font-size:.55rem;letter-spacing:.22em;text-transform:uppercase;color:var(--bdr);margin-top:10px;transition:color .2s}
.kc.clickable:hover .kc-hint{color:var(--acc)}
.kc.active .kc-hint{color:var(--acc)}

/* -- Drill-down panel -- */
.dpanel{background:var(--wh);border:1px solid var(--bdr);border-top:2px solid var(--acc);display:none;margin-bottom:1px;animation:fadeUp .25s ease forwards}
.dp-hdr{display:flex;justify-content:space-between;align-items:center;padding:14px 22px;border-bottom:1px solid var(--bdr)}
.dp-ttl{font-size:.58rem;letter-spacing:.32em;text-transform:uppercase;color:var(--acc)}
.dp-cls{background:none;border:none;font-family:'Josefin Sans',sans-serif;font-size:.62rem;letter-spacing:.15em;text-transform:uppercase;color:var(--mut);cursor:pointer;padding:4px 0}
.dp-cls:hover{color:var(--dk)}
.dp-item{display:flex;align-items:center;justify-content:space-between;padding:13px 22px;border-bottom:1px solid var(--bdr);font-size:.85rem}
.dp-item:last-child{border-bottom:none}
.dp-nome{font-weight:400;color:var(--ink)}
.dp-info{font-size:.72rem;color:var(--mut);text-align:right;line-height:1.5}
.dp-empty,.dp-loading{text-align:center;padding:28px;font-size:.65rem;letter-spacing:.25em;text-transform:uppercase;color:var(--mut)}

/* -- Servicos -- */
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

/* -- Footer -- */
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

/* -- View tabs -- */
.nav-tabs{display:flex;border:1px solid var(--bdr)}
.ntab{padding:8px 16px;border:none;background:transparent;color:var(--mut);font-family:'Josefin Sans',sans-serif;font-size:.6rem;letter-spacing:.22em;text-transform:uppercase;cursor:pointer;transition:all .15s;border-right:1px solid var(--bdr)}
.ntab:last-child{border-right:none}
.ntab.active{background:var(--ink);color:var(--bg)}
.ntab:hover:not(.active){background:var(--lt);color:var(--ink)}

/* -- Cron section -- */
.cron-list{display:flex;flex-direction:column;gap:1px;background:var(--bdr);border:1px solid var(--bdr)}
.cron-card{background:var(--wh);padding:24px 22px;display:flex;flex-direction:column;gap:9px}
.cron-disabled .cron-name{color:var(--mut)}
.cron-disabled .cron-times,.cron-disabled .cron-last{opacity:.45}
.cron-card-hdr{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cron-name{font-size:.8rem;font-weight:600;letter-spacing:.1em;color:var(--ink);text-transform:uppercase;flex:1}
.cron-desc{font-size:.7rem;color:var(--mut);letter-spacing:.04em;line-height:1.55}
.cron-times{font-size:.78rem;color:var(--dk);letter-spacing:.05em;font-weight:600}
.cron-last{font-size:.65rem;color:var(--acc);letter-spacing:.05em}
.cron-actions{margin-top:2px}
.btn-edit{padding:6px 16px;border:1px solid var(--bdr);background:transparent;color:var(--mut);font-family:'Josefin Sans',sans-serif;font-size:.6rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:all .15s}
.btn-edit:hover{border-color:var(--acc);color:var(--acc)}

/* -- Toggle switch -- */
.toggle{position:relative;display:inline-block;width:40px;height:22px;cursor:pointer;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0;position:absolute}
.toggle-sl{position:absolute;inset:0;background:var(--bdr);border-radius:22px;transition:.25s}
.toggle-sl:before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:var(--wh);border-radius:50%;transition:.25s;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.toggle input:checked + .toggle-sl{background:var(--acc)}
.toggle input:checked + .toggle-sl:before{transform:translateX(18px)}

/* -- Modal -- */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(44,24,16,.38);z-index:100;align-items:center;justify-content:center;padding:20px}
.modal-bg.open{display:flex}
.modal{background:var(--wh);max-width:520px;width:100%;max-height:90vh;overflow-y:auto;border:1px solid var(--bdr);padding:32px}
.modal-ttl{font-size:.55rem;letter-spacing:.38em;text-transform:uppercase;color:var(--acc);margin-bottom:4px}
.modal-sub{font-size:.88rem;font-weight:600;color:var(--ink);margin-bottom:22px;letter-spacing:.07em;text-transform:uppercase}
.time-row{display:flex;align-items:center;gap:8px;padding:12px 0;border-bottom:1px solid var(--bdr);flex-wrap:wrap}
.time-inp{width:42px;padding:7px 4px;border:1px solid var(--bdr);background:var(--bg);color:var(--ink);font-family:'Josefin Sans',sans-serif;font-size:.9rem;text-align:center;outline:none}
.time-inp:focus{border-color:var(--acc)}
.time-sep{color:var(--acc);font-size:1.1rem;font-weight:300}
.dias-sel{display:flex;gap:4px;flex-wrap:wrap;flex:1;min-width:0}
.dia-btn{padding:4px 7px;border:1px solid var(--bdr);background:transparent;color:var(--mut);font-family:'Josefin Sans',sans-serif;font-size:.58rem;letter-spacing:.08em;cursor:pointer;transition:all .12s;white-space:nowrap}
.dia-btn.active{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.dia-btn:hover:not(.active){background:var(--lt);color:var(--ink)}
.btn-rm{background:none;border:none;color:var(--mut);font-size:1.1rem;cursor:pointer;padding:0 4px;line-height:1;transition:color .15s;flex-shrink:0}
.btn-rm:hover{color:var(--dk)}
.btn-add{padding:12px 0;border:none;background:transparent;color:var(--acc);font-family:'Josefin Sans',sans-serif;font-size:.62rem;letter-spacing:.22em;text-transform:uppercase;cursor:pointer;width:100%;text-align:left;transition:color .15s;border-bottom:1px solid var(--bdr);display:block}
.btn-add:hover{color:var(--dk)}
.modal-err{font-size:.72rem;color:#b94a3a;margin-top:10px;min-height:18px}
.modal-ftr{display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid var(--bdr)}
.btn-cancel{padding:9px 20px;border:1px solid var(--bdr);background:transparent;color:var(--mut);font-family:'Josefin Sans',sans-serif;font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:all .15s}
.btn-cancel:hover{color:var(--ink);border-color:var(--ink)}
.btn-save{padding:9px 22px;border:1px solid var(--ink);background:var(--ink);color:var(--bg);font-family:'Josefin Sans',sans-serif;font-size:.62rem;letter-spacing:.2em;text-transform:uppercase;cursor:pointer;transition:all .15s}
.btn-save:hover:not(:disabled){background:var(--dk);border-color:var(--dk)}
.btn-save:disabled{opacity:.4;cursor:not-allowed}

/* -- Toast -- */
.toast{position:fixed;bottom:28px;right:24px;background:var(--ink);color:var(--bg);padding:11px 20px;font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;opacity:0;transition:opacity .3s;pointer-events:none;z-index:200}
.toast.show{opacity:1}
</style>
</head>
<body>

<div id="dash">
  <header>
    <div class="hb">
      <div class="hb-sub">Studio Camila Ros&#xE1;rio</div>
      <div class="hb-title">Helena &middot; Painel</div>
    </div>
    <div class="nav-tabs">
      <button class="ntab active" data-v="metricas" onclick="setView('metricas')">Resultados</button>
      <button class="ntab" data-v="crons" onclick="setView('crons')">Lembretes</button>
    </div>
    <div class="pbts" id="pbts-wrap">
      <button class="pbt active" data-p="dia" onclick="setPeriodo('dia')">Hoje</button>
      <button class="pbt" data-p="semana" onclick="setPeriodo('semana')">7 dias</button>
      <button class="pbt" data-p="mes" onclick="setPeriodo('mes')">M&#xEA;s</button>
    </div>
  </header>
  <main><div id="ct"><div class="loading">Carregando...</div></div></main>
</div>

<div id="modal-bg" class="modal-bg" onclick="closeModal()">
  <div class="modal" onclick="event.stopPropagation()">
    <div class="modal-ttl">Editar Hor&#xE1;rios</div>
    <div class="modal-sub" id="modal-job-lbl"></div>
    <div id="modal-slots"></div>
    <button type="button" class="btn-add" onclick="addSlot()">+ Adicionar hor&#xE1;rio</button>
    <div class="modal-err" id="modal-err"></div>
    <div class="modal-ftr">
      <button type="button" class="btn-cancel" onclick="closeModal()">Cancelar</button>
      <button type="button" class="btn-save" id="btn-save" onclick="saveModal()">Salvar</button>
    </div>
  </div>
</div>
<div id="toast-el" class="toast"></div>

<script>
var cliPer = 'dia';
var drillOpen = '';

/* ── Cron state ── */
var cView = 'metricas';
var cronJobs = [];
var modalJob = null;
var modalSlots = [];
var DIAS_NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'S\xE1b'];
var JOB_LABELS = {'lembrete': 'Lembretes', 'enquete': 'Enquete', 'sync_clientes': 'Sincronizar Clientes'};

function apiPatch(path, body){
  return fetch(window.location.origin + path, {
    method: 'PATCH',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body)
  }).then(function(r){ if(!r.ok) throw new Error('err ' + r.status); return r.json(); });
}

function setView(v){
  cView = v;
  document.querySelectorAll('.ntab').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-v') === v); });
  var pb = document.getElementById('pbts-wrap');
  if(pb) pb.style.display = v === 'metricas' ? '' : 'none';
  if(v === 'metricas'){ loadData(); } else { loadCrons(); }
}

function exprToUi(expr){
  var parts = expr.trim().split(' ');
  if(parts.length < 5) return {hr:'00', min:'00', dias:[]};
  var minStr = parts[0], hrStr = parts[1], dow = parts[4];
  var hr = String(parseInt(hrStr, 10) || 0);
  var mn = String(parseInt(minStr, 10) || 0);
  return {
    hr: hr.length === 1 ? '0' + hr : hr,
    min: mn.length === 1 ? '0' + mn : mn,
    dias: dow === '*' ? [] : dow.split(',').map(Number)
  };
}

function uiToExpr(hr, min, dias){
  var hrN = parseInt(hr, 10); if(isNaN(hrN)) hrN = 0;
  var mnN = parseInt(min, 10); if(isNaN(mnN)) mnN = 0;
  var diasStr = dias.length === 0 ? '*' : dias.slice().sort(function(a,b){return a-b;}).join(',');
  return String(mnN) + ' ' + String(hrN) + ' * * ' + diasStr;
}

function fmtExpr(expr){
  var ui = exprToUi(expr);
  var t = ui.hr + 'h' + (ui.min !== '00' ? ui.min : '');
  if(ui.dias.length === 0) return t + ' diariamente';
  return t + ' ' + ui.dias.map(function(d){ return DIAS_NOMES[d] || String(d); }).join('/');
}

function fmtLast(job){
  if(!job.ultima_execucao_em) return 'Nunca executado';
  var d = new Date(job.ultima_execucao_em);
  var hoje = new Date().toLocaleDateString('pt-BR', {timeZone:'America/Bahia'});
  var dtStr = d.toLocaleDateString('pt-BR', {timeZone:'America/Bahia'});
  var hrStr = d.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Bahia'});
  var res = job.ultima_execucao_resultado;
  var suf = '';
  if(res && typeof res === 'object'){
    if(res.enviados !== undefined) suf = ' \xB7 ' + res.enviados + ' enviados';
    else if(res.total !== undefined) suf = ' \xB7 ' + res.total + ' processados';
    else if(res.error) suf = ' \xB7 ⚠️ erro';
  }
  var dl = dtStr === hoje ? 'hoje' : dtStr;
  return '✅ \xDAltima: ' + dl + ' ' + hrStr + suf;
}

function loadCrons(){
  var ct = document.getElementById('ct');
  if(ct) ct.innerHTML = '<div class="loading">Carregando...</div>';
  apiFetch('/admin/cron')
    .then(function(d){
      cronJobs = d.jobs || [];
      renderCrons(cronJobs);
    })
    .catch(function(){
      var c2 = document.getElementById('ct');
      if(c2) c2.innerHTML = '<div class="loading">Erro ao carregar.</div>';
    });
}

function renderCrons(jobs){
  var h = '';
  h += '<div style="padding:28px 0 12px;text-align:center" class="fa fa-d1">';
  h += '<div style="font-size:.58rem;letter-spacing:.38em;text-transform:uppercase;color:var(--acc)">Hor\xE1rios Autom\xE1ticos</div>';
  h += '<div style="font-size:.75rem;color:var(--mut);margin-top:6px;letter-spacing:.04em">Mudan\xE7as entram em vigor em at\xE9 60 segundos</div>';
  h += '</div>';
  h += '<div class="cron-list fa fa-d2">';
  for(var i = 0; i < jobs.length; i++){
    var j = jobs[i];
    var jn = j.job_name;
    var exprs = j.cron_expressions || [];
    var timesStr = exprs.length === 0 ? 'Sem hor\xE1rios configurados' : exprs.map(fmtExpr).join('  \xB7  ');
    var lastStr = fmtLast(j);
    var lbl = JOB_LABELS[jn] || jn;
    var togChk = j.enabled ? ' checked' : '';
    var disCls = j.enabled ? '' : ' cron-disabled';
    h += '<div class="cron-card' + disCls + '">';
    h += '<div class="cron-card-hdr">';
    h += '<span class="cron-name">' + esc(lbl) + '</span>';
    h += '<label class="toggle" title="' + (j.enabled ? 'Pausar job' : 'Reativar job') + '">';
    h += '<input type="checkbox"' + togChk + ' onchange="toggleJob(this.dataset.job,this.checked)" data-job="' + esc(jn) + '">';
    h += '<span class="toggle-sl"></span>';
    h += '</label>';
    h += '</div>';
    h += '<div class="cron-desc">' + esc(j.descricao || '') + '</div>';
    h += '<div class="cron-times">' + esc(timesStr) + '</div>';
    h += '<div class="cron-last">' + esc(lastStr) + '</div>';
    h += '<div class="cron-actions">';
    h += '<button type="button" class="btn-edit" onclick="openModal(this.dataset.job)" data-job="' + esc(jn) + '">Editar hor\xE1rios</button>';
    h += '</div>';
    h += '</div>';
  }
  h += '</div>';
  h += '<div class="ftr">';
  h += '<button class="btn-rf" onclick="loadCrons()">&#x21BB; Atualizar</button>';
  h += '<span class="ftr-time">Atualizado \xE0s ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + '</span>';
  h += '</div>';
  var ct = document.getElementById('ct');
  if(ct) ct.innerHTML = h;
}

function toggleJob(jobName, enabled){
  apiPatch('/admin/cron/' + jobName, {enabled: enabled})
    .then(function(){
      showToast(enabled ? 'Job reativado' : 'Job pausado');
      for(var i = 0; i < cronJobs.length; i++){
        if(cronJobs[i].job_name === jobName){ cronJobs[i].enabled = enabled; break; }
      }
    })
    .catch(function(){
      showToast('Erro ao salvar');
      loadCrons();
    });
}

function openModal(jobName){
  var job = null;
  for(var i = 0; i < cronJobs.length; i++){
    if(cronJobs[i].job_name === jobName){ job = cronJobs[i]; break; }
  }
  if(!job) return;
  modalJob = jobName;
  modalSlots = [];
  var exprs = job.cron_expressions || [];
  for(var j = 0; j < exprs.length; j++){ modalSlots.push(exprToUi(exprs[j])); }
  if(modalSlots.length === 0) modalSlots.push({hr:'09', min:'00', dias:[]});
  document.getElementById('modal-job-lbl').textContent = JOB_LABELS[jobName] || jobName;
  document.getElementById('modal-err').textContent = '';
  renderModalSlots();
  document.getElementById('modal-bg').classList.add('open');
}

function closeModal(){
  modalJob = null;
  modalSlots = [];
  document.getElementById('modal-bg').classList.remove('open');
}

function renderModalSlots(){
  var h = '';
  for(var i = 0; i < modalSlots.length; i++){
    var s = modalSlots[i];
    h += '<div class="time-row">';
    h += '<input class="time-inp" type="text" maxlength="2" value="' + esc(s.hr) + '" oninput="updSlot(' + i + ',this)" data-field="hr" placeholder="HH">';
    h += '<span class="time-sep">:</span>';
    h += '<input class="time-inp" type="text" maxlength="2" value="' + esc(s.min) + '" oninput="updSlot(' + i + ',this)" data-field="min" placeholder="MM">';
    h += '<div class="dias-sel">';
    var todAct = s.dias.length === 0 ? ' active' : '';
    h += '<button type="button" class="dia-btn' + todAct + '" onclick="setDias(' + i + ',null)">Todos</button>';
    for(var d = 0; d < 7; d++){
      var dAct = s.dias.indexOf(d) >= 0 ? ' active' : '';
      h += '<button type="button" class="dia-btn' + dAct + '" onclick="setDias(' + i + ',' + d + ')">' + esc(DIAS_NOMES[d]) + '</button>';
    }
    h += '</div>';
    if(modalSlots.length > 1){
      h += '<button type="button" class="btn-rm" onclick="removeSlot(' + i + ')" title="Remover">\xD7</button>';
    }
    h += '</div>';
  }
  document.getElementById('modal-slots').innerHTML = h;
}

function updSlot(idx, input){
  var field = input.getAttribute('data-field');
  modalSlots[idx][field] = input.value.replace(/[^0-9]/g, '').slice(0, 2);
}

function setDias(idx, dia){
  if(dia === null){
    modalSlots[idx].dias = [];
  } else {
    var pos = modalSlots[idx].dias.indexOf(dia);
    if(pos >= 0){ modalSlots[idx].dias.splice(pos, 1); }
    else { modalSlots[idx].dias.push(dia); }
  }
  renderModalSlots();
}

function addSlot(){
  modalSlots.push({hr:'09', min:'00', dias:[]});
  renderModalSlots();
}

function removeSlot(idx){
  modalSlots.splice(idx, 1);
  renderModalSlots();
}

function validateSlots(){
  if(modalSlots.length === 0) return 'Adicione pelo menos um hor\xE1rio';
  for(var i = 0; i < modalSlots.length; i++){
    var s = modalSlots[i];
    var hr = parseInt(s.hr, 10);
    var mn = parseInt(s.min, 10);
    if(isNaN(hr) || hr < 0 || hr > 23) return 'Hora inv\xE1lida no hor\xE1rio ' + (i+1) + ' (00–23)';
    if(isNaN(mn) || mn < 0 || mn > 59) return 'Minuto inv\xE1lido no hor\xE1rio ' + (i+1) + ' (00–59)';
  }
  return null;
}

function saveModal(){
  var err = validateSlots();
  if(err){ document.getElementById('modal-err').textContent = err; return; }
  document.getElementById('modal-err').textContent = '';
  var btn = document.getElementById('btn-save');
  btn.disabled = true;
  var exprs = modalSlots.map(function(s){ return uiToExpr(s.hr, s.min, s.dias); });
  apiPatch('/admin/cron/' + modalJob, {cron_expressions: exprs})
    .then(function(){
      btn.disabled = false;
      closeModal();
      showToast('Salvo. Novo hor\xE1rio ativo em at\xE9 60s');
      loadCrons();
    })
    .catch(function(){
      btn.disabled = false;
      document.getElementById('modal-err').textContent = 'Erro ao salvar. Tente novamente.';
    });
}

function showToast(msg){
  var t = document.getElementById('toast-el');
  if(!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 3000);
}

function brl(n){ return 'R$ ' + Number(n||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmt(n){ return Number(n||0).toLocaleString('pt-BR'); }
function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function apiFetch(path){
  return fetch(window.location.origin + path)
    .then(function(r){ if(!r.ok) throw new Error('err'); return r.json(); });
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
  if(ag === 0 && conv === 0) return 'Helena est\xE1 de pront\xEFd\xE3o, pronta para atender suas clientes 🌸';
  if(ag >= 8) return 'Que dia incr\xEDvel! Helena agendou ' + ag + ' clientes por voc\xEA ✨';
  if(ag >= 3 && sinais > 0) return 'Helena garantiu ' + ag + ' agendamentos e ' + sinais + ' sinal(is) por voc\xEA 💰';
  if(ag > 0 && receita > 0) return 'Helena gerou ' + brl(receita) + ' em agendamentos enquanto voc\xEA trabalhava 🌸';
  if(ag > 0) return 'Helena agendou ' + ag + ' cliente(s) por voc\xEA hoje ✨';
  if(conv > 5) return 'Helena atendeu ' + conv + ' conversas por voc\xEA 💬';
  return 'Helena cuida das suas clientes com cuidado e carinho 🪶';
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
      el.textContent = 'R$ ' + curr.toLocaleString('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
    } else {
      el.textContent = Math.floor(curr).toLocaleString('pt-BR');
    }
    if(i >= steps){ clearInterval(timer); }
  }, 18);
}

function mkKC(id, lbl, val, sub, cls, raw, isFloat, tipo){
  var clickCls = tipo ? ' clickable' : '';
  var attrs = tipo ? (' onclick="drill(this.dataset.tipo)" data-tipo="' + tipo + '"') : '';
  return '<div class="kc' + clickCls + '"' + attrs + '>' +
    '<div class="kc-lbl">' + esc(lbl) + '</div>' +
    '<div class="kc-val ' + (cls||'') + '" id="' + id + '">' + esc(val) + '</div>' +
    (sub ? '<div class="kc-sub">' + esc(sub) + '</div>' : '') +
    (tipo ? '<div class="kc-hint">ver detalhes ›</div>' : '') +
    '</div>';
}

var drillLabels = {
  conversas: 'Conversas atendidas',
  agendamentos: 'Agendamentos feitos',
  sinais: 'Sinais recebidos',
  catalogos: 'Cat\xE1logos enviados',
  encaminhados: 'Encaminhados pra voc\xEA'
};

function drill(tipo){
  if(drillOpen === tipo){ closeDrill(); return; }
  drillOpen = tipo;
  document.querySelectorAll('.kc.clickable').forEach(function(el){
    el.classList.toggle('active', el.getAttribute('data-tipo') === tipo);
  });
  var panel = document.getElementById('dpanel');
  if(!panel) return;
  panel.style.display = 'block';
  panel.innerHTML = '<div class="dp-hdr"><span class="dp-ttl">' + esc(drillLabels[tipo]||tipo) + '</span><button class="dp-cls" onclick="closeDrill()">Fechar \xD7</button></div><div class="dp-loading">carregando...</div>';
  apiFetch('/admin/eventos?tipo=' + tipo + '&periodo=' + cliPer)
    .then(function(d){ renderDrill(tipo, d.itens || []); })
    .catch(function(){
      var p2 = document.getElementById('dpanel');
      if(p2) p2.innerHTML = '<div class="dp-hdr"><span class="dp-ttl">' + esc(drillLabels[tipo]||tipo) + '</span><button class="dp-cls" onclick="closeDrill()">Fechar \xD7</button></div><div class="dp-empty">N\xE3o foi poss\xEDvel carregar</div>';
    });
}

function closeDrill(){
  drillOpen = '';
  document.querySelectorAll('.kc.clickable').forEach(function(el){ el.classList.remove('active'); });
  var panel = document.getElementById('dpanel');
  if(panel){ panel.style.display = 'none'; panel.innerHTML = ''; }
}

function renderDrill(tipo, itens){
  var panel = document.getElementById('dpanel');
  if(!panel) return;
  var lbl = drillLabels[tipo] || tipo;
  var h = '<div class="dp-hdr"><span class="dp-ttl">' + esc(lbl) + ' \xB7 ' + itens.length + '</span><button class="dp-cls" onclick="closeDrill()">Fechar \xD7</button></div>';
  if(itens.length === 0){
    h += '<div class="dp-empty">Nenhum registro nesse per\xEDodo</div>';
  } else {
    for(var i = 0; i < itens.length; i++){
      var it = itens[i];
      h += '<div class="dp-item">';
      h += '<span class="dp-nome">' + esc(it.nome || 'Cliente') + '</span>';
      h += '<span class="dp-info">';
      if(it.detalhe) h += esc(it.detalhe) + '<br>';
      h += esc(it.hora || '');
      h += '</span>';
      h += '</div>';
    }
  }
  panel.innerHTML = h;
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
  h += mkKC('conv', 'Conversas atendidas', fmt(r.atendimentos_unicos), '', '', r.atendimentos_unicos, false, 'conversas');
  h += mkKC('ag', 'Agendamentos feitos', fmt(r.agendamentos_criados), '', '', r.agendamentos_criados, false, 'agendamentos');
  h += mkKC('rec', 'Receita gerada', brl(r.receita_potencial_agendada), '', 'gold', r.receita_potencial_agendada, true, 'agendamentos');
  h += mkKC('sin', 'Sinais recebidos', fmt(r.sinais_pagos), brl(r.receita_sinais), '', r.sinais_pagos, false, 'sinais');
  h += mkKC('cat', 'Cat\xE1logos enviados', fmt(r.catalogos_enviados), 'novos contatos', '', r.catalogos_enviados, false, 'catalogos');
  h += mkKC('enc', 'Encaminhados pra voc\xEA', fmt(r.transferidos_humano), 'aten\xE7\xE3o especial', '', r.transferidos_humano, false, 'encaminhados');
  h += '</div>';
  h += '<div id="dpanel" class="dpanel"></div>';

  if(ts.length > 0){
    h += '<div class="slist fa fa-d3">';
    h += '<div class="slist-hdr">Servi\xE7os mais procurados</div>';
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
  h += '<button class="btn-rf" onclick="loadData()">&#x21BB; Atualizar</button>';
  h += '<span class="ftr-time">Atualizado \xE0s ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + '</span>';
  h += '</div>';

  document.getElementById('ct').innerHTML = h;

  animCount('conv', r.atendimentos_unicos || 0, false);
  animCount('ag', r.agendamentos_criados || 0, false);
  animCount('rec', r.receita_potencial_agendada || 0, true);
  animCount('sin', r.sinais_pagos || 0, false);
  animCount('cat', r.catalogos_enviados || 0, false);
  animCount('enc', r.transferidos_humano || 0, false);
}

function loadData(){
  closeDrill();
  document.getElementById('ct').innerHTML = '<div class="loading">Carregando...</div>';
  apiFetch('/admin/relatorio?periodo=' + cliPer)
    .then(function(d){ render(d.resumo || d); })
    .catch(function(){
      document.getElementById('ct').innerHTML = '<div class="loading">Erro ao carregar. Tente novamente.</div>';
    });
}

loadData();
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

/* -- Dashboard -- */
header{background:var(--s1);border-bottom:1px solid var(--bdr);padding:14px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:10}
.h-brand{flex:1;min-width:140px}
.h-brand-name{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--acc);font-weight:600}
.h-brand-sub{font-size:.75rem;color:var(--mut);margin-top:1px}
.pbts{display:flex;gap:6px}
.pbt{padding:5px 14px;border-radius:20px;border:1px solid var(--bdr);background:transparent;color:var(--mut);cursor:pointer;font-size:.75rem;transition:all .15s;font-family:inherit;white-space:nowrap}
.pbt:hover{border-color:var(--acc);color:var(--txt)}
.pbt.active{background:var(--acc);border-color:var(--acc);color:#fff}

main{padding:20px 24px 48px;max-width:1100px;margin:0 auto}
.sec{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--mut);margin-bottom:12px;margin-top:28px}

/* -- Cards -- */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:10px}
.card{background:var(--s1);border:1px solid var(--bdr);border-radius:12px;padding:16px;transition:border-color .15s}
.card:hover{border-color:var(--acc)}
.c-lbl{font-size:.68rem;color:var(--mut);margin-bottom:8px;line-height:1.4}
.c-val{font-size:1.85rem;font-weight:700;line-height:1}
.c-sub{font-size:.72rem;color:var(--mut);margin-top:5px}
.c-acc .c-val{color:var(--acc2)}.c-grn .c-val{color:var(--grn)}.c-red .c-val{color:var(--red)}.c-yel .c-val{color:var(--yel)}

/* -- Lists -- */
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

/* -- Errors -- */
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

/* -- Footer -- */
.ftr{display:flex;align-items:center;gap:12px;margin-top:28px;padding-top:16px;border-top:1px solid var(--bdr)}
.btn-rf{padding:6px 14px;border-radius:8px;border:1px solid var(--bdr);background:transparent;color:var(--mut);cursor:pointer;font-size:.75rem;transition:all .15s;font-family:inherit}
.btn-rf:hover{border-color:var(--acc);color:var(--acc)}
.ftr-t{font-size:.7rem;color:var(--mut)}
.loading{text-align:center;padding:48px;color:var(--mut);font-size:.82rem}
</style>
</head>
<body>

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
  </header>
  <main><div id="act"><div class="loading">Carregando...</div></div></main>
</div>

<script>
var aPeriodo = 'dia';

function afmt(n){ return Number(n||0).toLocaleString('pt-BR'); }
function abrl(n){ return 'R$ ' + Number(n||0).toFixed(2).replace('.',','); }
function aesc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function ahora(iso){
  try{ return new Date(iso).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit',timeZone:'America/Bahia'}); }
  catch(e){ return '--'; }
}

function aFetch(path){
  return fetch(window.location.origin + path)
    .then(function(r){ if(!r.ok) throw new Error('err'); return r.json(); });
}

function aPer(p){
  aPeriodo = p;
  document.querySelectorAll('.pbt').forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-p') === p); });
  aLoad();
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

  h += '<div class="sec">Vis\xE3o geral</div><div class="cards">';
  h += aCard('Conversas \xFAnicas', afmt(r.atendimentos_unicos), null, 'c-acc');
  h += aCard('Agendamentos', afmt(r.agendamentos_criados), abrl(r.receita_potencial_agendada), 'c-grn');
  h += aCard('Sinais pagos', afmt(r.sinais_pagos), abrl(r.receita_sinais), 'c-grn');
  h += aCard('Cancelamentos', afmt(r.agendamentos_cancelados), null, 'c-red');
  h += aCard('Reagendamentos', afmt(r.agendamentos_reagendados), null, 'c-yel');
  h += aCard('Transferidos', afmt(r.transferidos_humano), null, '');
  h += aCard('Cat\xE1logos', afmt(r.catalogos_enviados), null, '');
  h += aCard('PDFs curso', afmt(r.cursos_enviados), null, '');
  h += '</div>';

  if(ts.length > 0 || th.length > 0){
    h += '<div class="sec">Destaques</div><div class="two">';
    h += aList('🔝 Servi\xE7os mais procurados', ts);
    h += aList('🕐 Faixas hor\xE1rias top', th);
    h += '</div>';
  }

  h += '<div class="sec">Erros recentes</div>';
  if(erros.length === 0){
    h += '<div class="e-none">✅ Nenhum erro</div>';
  } else {
    h += '<div class="etbl-wrap"><table class="etbl"><thead><tr><th>Hora</th><th>Tool</th><th>Raz\xE3o</th><th>Telefone</th></tr></thead><tbody>';
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

  h += '<div class="ftr"><button class="btn-rf" onclick="aLoad()">&#x21BB; Atualizar</button>';
  h += '<span class="ftr-t">Atualizado \xE0s ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + '</span></div>';

  document.getElementById('act').innerHTML = h;
}

function aLoad(){
  document.getElementById('act').innerHTML = '<div class="loading">Carregando...</div>';
  Promise.all([
    aFetch('/admin/relatorio?periodo=' + aPeriodo),
    aFetch('/admin/erros?n=30')
  ]).then(function(rs){ aRender(rs[0].resumo || rs[0], rs[1].erros || []); })
    .catch(function(){
      document.getElementById('act').innerHTML = '<div class="loading">Erro ao carregar.</div>';
    });
}

aLoad();
</script>
</body>
</html>`;
