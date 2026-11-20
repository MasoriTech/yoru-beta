// Desempenho › Otimizar PC: diagnóstico, limpeza, energia e programas que abrem com o Windows.
// Script comum carregado depois do panel-perf.js; fica dentro de uma função para não misturar nomes com os outros panel-*.js.
// Só textos do próprio app e nomes de programas entram na tela, sempre como texto simples (textContent).
(() => {
  'use strict';
  if (!panel.optimizeCatalog) return; // painel de teste sem essas funções
  const q = (s) => document.querySelector(s);
  const status = q('#optStatus');
  let busy = false, loaded = false, plan = null, startupItems = [];
  const say = (t, bad) => { status.textContent = t || ''; status.style.color = bad ? 'var(--danger, #ff5d5d)' : ''; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const gb = (v) => (v >= 100 ? Math.round(v) : v) + ' GB';
  const mb = (v) => (v >= 1024 ? (v / 1024).toFixed(1) + ' GB' : v + ' MB');

  function renderInfo(d) {
    if (!d || !d.ok) { say((d && d.error) || 'Não consegui ler o estado do PC.', true); return; }
    q('#opt-temp').textContent = mb(d.tempMB);
    plan = d.plan;
    const pill = q('#opt-plan'); pill.textContent = d.planName || (d.plan ? d.plan : 'não identificado'); pill.classList.toggle('on', !!d.plan);
    document.querySelectorAll('#optPower [data-opt]').forEach((b) => b.classList.toggle('primary', b.dataset.opt === 'power-' + plan));
    say('');
  }
  async function refresh() {
    say('Lendo o estado do PC…');
    try { renderInfo(await panel.optimizeInfo()); } catch (_) { say('Não consegui ler o estado do PC.', true); }
  }

  async function run(a, btn) {
    if (busy) return;
    if (a.confirm && !confirm(a.label + '?\n\n' + a.desc)) return;
    busy = true; btn.disabled = true; say('Trabalhando…');
    try {
      const r = await panel.optimizeRun(a.id);
      say(r && r.ok ? '✅ ' + (r.message || 'Pronto.') : '⚠️ ' + ((r && r.error) || 'Não deu certo.'), !(r && r.ok));
      if (r && r.ok) { const d = await panel.optimizeInfo(); if (d && d.ok) renderInfo(d); else say('✅ ' + (r.message || 'Pronto.')); }
    } catch (_) { say('⚠️ Não deu certo.', true); }
    busy = false; btn.disabled = false;
  }

  function drawStartup() {
    const box = q('#optStartup'); box.textContent = '';
    const term = (q('#optStartupSearch').value || '').trim().toLocaleLowerCase('pt-BR');
    const filter = q('#optStartupFilter').value;
    const enabled = startupItems.filter((it) => it.on).length;
    const disabled = startupItems.length - enabled;
    q('#optStartupSummary').textContent = `${startupItems.length} programas · ${enabled} ativados · ${disabled} desativados`;
    const items = startupItems.filter((it) => {
      if (filter === 'on' && !it.on) return false;
      if (filter === 'off' && it.on) return false;
      return !term || it.name.toLocaleLowerCase('pt-BR').includes(term) || it.cmd.toLocaleLowerCase('pt-BR').includes(term);
    }).sort((a, b) => Number(b.on) - Number(a.on) || a.name.localeCompare(b.name, 'pt-BR'));
    if (!items.length) {
      box.appendChild(el('div', 'opt-startup-empty', startupItems.length ? 'Nenhum programa corresponde à busca ou ao filtro.' : 'Nenhum programa encontrado nesta área de inicialização.'));
      return;
    }
    items.forEach((it) => {
      const label = el('label', 'sw opt-startup-item'); label.title = it.cmd || '';
      const info = el('span');
      info.appendChild(el('strong', null, it.name));
      if (it.cmd) info.appendChild(el('small', null, it.cmd));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = it.on; cb.setAttribute('aria-label', (it.on ? 'Desativar ' : 'Ativar ') + it.name);
      cb.addEventListener('change', async () => {
        cb.disabled = true;
        const res = await panel.optimizeStartupSet(it.name, cb.checked).catch(() => null);
        if (!res || !res.ok) { cb.checked = !cb.checked; say('⚠️ ' + ((res && res.error) || 'Não consegui mudar.'), true); }
        else {
          it.on = cb.checked;
          say(cb.checked ? '✅ ' + it.name + ' vai abrir com o Windows.' : '✅ ' + it.name + ' não abre mais sozinho.');
          drawStartup();
        }
        cb.disabled = false;
      });
      label.append(info, cb); box.appendChild(label);
    });
  }

  function renderStartup(r) {
    if (!r || !r.ok) {
      startupItems = []; q('#optStartupSummary').textContent = 'Não foi possível carregar a inicialização.';
      q('#optStartup').textContent = ''; q('#optStartup').appendChild(el('div', 'hint', (r && r.error) || 'Não consegui ler a lista.')); return;
    }
    startupItems = (r.items || []).map((it) => ({ name: String(it.name || ''), on: it.on !== false, cmd: String(it.cmd || '') }));
    drawStartup();
  }
  q('#optStartupSearch').addEventListener('input', drawStartup);
  q('#optStartupFilter').addEventListener('change', drawStartup);

  async function load() {
    const cat = await panel.optimizeCatalog().catch(() => null);
    if (!cat || !cat.actions) return;
    if (!cat.supported) { q('#optMain').style.display = 'none'; q('#optNoWin').style.display = ''; return; }
    for (const [id, boxId] of [['limpeza', '#optClean'], ['energia', '#optPower']]) {
      const box = q(boxId); box.textContent = '';
      cat.actions.filter((a) => a.group === id).forEach((a) => {
        const b = el('button', 'b', a.icon + ' ' + a.label); b.dataset.opt = a.id; b.title = a.desc;
        b.addEventListener('click', () => run(a, b)); box.appendChild(b);
      });
    }
    loaded = true;
    refresh();
    panel.optimizeStartupList().then(renderStartup).catch(() => renderStartup(null));
  }

  q('#optRefresh').addEventListener('click', () => { refresh(); panel.optimizeStartupList().then(renderStartup).catch(() => {}); });
  // só carrega (e só lê o disco) quando a pessoa abre a sub-aba: nada roda em segundo plano
  const tab = document.querySelector('.subtab2[data-sub2="otimizar"]');
  if (tab) tab.addEventListener('click', () => { if (!loaded) load(); });
})();
