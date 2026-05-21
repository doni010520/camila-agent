
var cliPer = 'dia';
var drillOpen = '';

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
  if(ag === 0 && conv === 0) return 'Helena está de prontïdão, pronta para atender suas clientes 🌸';
  if(ag >= 8) return 'Que dia incrível! Helena agendou ' + ag + ' clientes por você ✨';
  if(ag >= 3 && sinais > 0) return 'Helena garantiu ' + ag + ' agendamentos e ' + sinais + ' sinal(is) por você 💰';
  if(ag > 0 && receita > 0) return 'Helena gerou ' + brl(receita) + ' em agendamentos enquanto você trabalhava 🌸';
  if(ag > 0) return 'Helena agendou ' + ag + ' cliente(s) por você hoje ✨';
  if(conv > 5) return 'Helena atendeu ' + conv + ' conversas por você 💬';
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
  catalogos: 'Catálogos enviados',
  encaminhados: 'Encaminhados pra você'
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
  panel.innerHTML = '<div class="dp-hdr"><span class="dp-ttl">' + esc(drillLabels[tipo]||tipo) + '</span><button class="dp-cls" onclick="closeDrill()">Fechar ×</button></div><div class="dp-loading">carregando...</div>';
  apiFetch('/admin/eventos?tipo=' + tipo + '&periodo=' + cliPer)
    .then(function(d){ renderDrill(tipo, d.itens || []); })
    .catch(function(){
      var p2 = document.getElementById('dpanel');
      if(p2) p2.innerHTML = '<div class="dp-hdr"><span class="dp-ttl">' + esc(drillLabels[tipo]||tipo) + '</span><button class="dp-cls" onclick="closeDrill()">Fechar ×</button></div><div class="dp-empty">Não foi possível carregar</div>';
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
  var h = '<div class="dp-hdr"><span class="dp-ttl">' + esc(lbl) + ' · ' + itens.length + '</span><button class="dp-cls" onclick="closeDrill()">Fechar ×</button></div>';
  if(itens.length === 0){
    h += '<div class="dp-empty">Nenhum registro nesse período</div>';
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
  h += mkKC('cat', 'Catálogos enviados', fmt(r.catalogos_enviados), 'novos contatos', '', r.catalogos_enviados, false, 'catalogos');
  h += mkKC('enc', 'Encaminhados pra você', fmt(r.transferidos_humano), 'atenção especial', '', r.transferidos_humano, false, 'encaminhados');
  h += '</div>';
  h += '<div id="dpanel" class="dpanel"></div>';

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
  h += '<button class="btn-rf" onclick="loadData()">&#x21BB; Atualizar</button>';
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
