// Aparência e configurações: temas, grade de emotes, modelo do Whisper e os controles ligados às configurações (render).
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- temas (cartões com pré-visualização) -----
const THEMES = [
  ['auto', 'Automático', null], ['dark', 'Escuro', ['#140f1c', '#0e0a15', '#1f1829']], ['light', 'Claro', ['#f1f2f7', '#e6e8f0', '#ffffff']],
  ['midnight', 'Meia-noite', ['#000000', '#000000', '#0d0e12']], ['ocean', 'Oceano', ['#0d1b2a', '#0a1522', '#13283d']],
  ['forest', 'Floresta', ['#111c17', '#0d1612', '#18281f']], ['sakura', 'Sakura', ['#fff3f7', '#ffe6ee', '#ffffff']],
  ['sepia', 'Sépia', ['#f4ecd8', '#eadfc4', '#fbf6e8']], ['contrast', 'Alto contraste', ['#000000', '#000000', '#000000']],
];
const themeGrid = $('#themeGrid');
const layoutGrid = $('#layoutGrid');
if (layoutGrid) layoutGrid.addEventListener('click', (e) => { const b = e.target.closest('[data-layout]'); if (b) send({ panelLayout: b.dataset.layout }); });
THEMES.forEach(([id, label, c]) => {
  const b = document.createElement('button');
  b.className = 'theme-card';
  b.dataset.theme = id;
  const bg = c ? `background:${c[0]}` : 'background:linear-gradient(135deg,#140f1c 50%,#f1f2f7 50%)';
  const side = c ? `background:${c[1]}` : 'background:rgba(128,128,128,.35)';
  const card = c ? `background:${c[2]}` : 'background:rgba(128,128,128,.25)';
  b.innerHTML = `<div class="pv" style="${bg}"><i style="${side}"></i><b style="${card}"></b></div>${label}`;
  b.onclick = () => send({ panelTheme: id });
  themeGrid.appendChild(b);
});

// ----- grade de emotes -----
const grid = $('#emoteGrid');
EMOTES.forEach(([id, icon, name]) => {
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.innerHTML = `<input type="checkbox" data-emote="${id}" /><button data-play="${id}">${icon} ${name}</button>`;
  grid.appendChild(chip);
});
grid.addEventListener('click', (e) => {
  if (e.target.dataset.play) panel.action('emote', e.target.dataset.play);
});
$('#emoteAll').addEventListener('click', () => send({ emoteList: EMOTES.map((e) => e[0]) }));
$('#emoteNone').addEventListener('click', () => send({ emoteList: [] }));
grid.addEventListener('change', (e) => {
  if (!e.target.dataset.emote) return;
  const list = new Set(state.emoteList || []);
  e.target.checked ? list.add(e.target.dataset.emote) : list.delete(e.target.dataset.emote);
  send({ emoteList: [...list] });
});

// ----- modelo do Whisper -----
const WHISPER = [
  { id: 'tiny', name: 'Tiny', size: '~40 MB', speed: 5, acc: 1, note: 'Muito rápido, erra bastante' },
  { id: 'base', name: 'Base', size: '~80 MB', speed: 4, acc: 2, note: 'Equilibrado (padrão)' },
  { id: 'small', name: 'Small', size: '~250 MB', speed: 3, acc: 3, note: 'Preciso, ainda leve' },
  { id: 'medium', name: 'Medium', size: '~800 MB', speed: 2, acc: 4, note: 'Muito preciso, lento sem placa de vídeo' },
  { id: 'large-v3-turbo', name: 'Large v3 turbo', size: '~900 MB', speed: 2, acc: 5, note: 'Quase o melhor, mais rápido que o large' },
  { id: 'large-v3', name: 'Large v3', size: '~1,6 GB', speed: 1, acc: 5, note: 'Máximo; precisa de PC forte' },
];
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const mgrid = $('#modelGrid');
if (mgrid) {
  WHISPER.forEach((m) => {
    const b = document.createElement('button');
    b.className = 'model-card';
    b.dataset.model = m.id;
    b.innerHTML = '<b></b><span class="mm"></span><span class="st"></span><span class="st sp"></span><span class="mm nt"></span>';
    b.querySelector('b').textContent = m.name;
    b.querySelector('.mm').textContent = m.size;
    const sts = b.querySelectorAll('.st');
    sts[0].textContent = 'Precisão ' + stars(m.acc);
    sts[1].textContent = 'Rapidez ' + stars(m.speed);
    b.querySelector('.nt').textContent = m.note;
    b.addEventListener('click', () => send({ convModel: m.id }));
    mgrid.appendChild(b);
  });
}

// ----- controles ligados às configurações -----
document.querySelectorAll('[data-key]').forEach((el) => {
  const key = el.dataset.key;
  el.addEventListener('input', () => {
    if (el.type === 'checkbox') return send({ [key]: el.checked });
    if (el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.type === 'text') return send({ [key]: el.value });
    updateLabel(el, Number(el.value));
    send({ [key]: Number(el.value) });
  });
});
document.querySelectorAll('[data-set]').forEach((b) =>
  b.addEventListener('click', () => panel.set(JSON.parse(b.dataset.set))));
document.querySelectorAll('[data-action]').forEach((b) =>
  b.addEventListener('click', () => panel.action(b.dataset.action, b.dataset.arg)));
$('#vis').addEventListener('click', () => panel.set({ visible: !state.visible }));
const dockCollapse = $('#dockCollapse');
if (dockCollapse) dockCollapse.addEventListener('click', () => send({ panelDockCollapsed: !state.panelDockCollapsed }));

function updateLabel(el, v) {
  const out = document.getElementById('v-' + el.dataset.key);
  if (!out) return;
  const mult = Number(el.dataset.mult || 1);
  out.textContent = v === 0 && el.dataset.zero ? el.dataset.zero : (v * mult).toFixed(Number(el.dataset.dec || 0)) + (el.dataset.suffix || '');
}

function render(s) {
  state = s;
  paintChatter(s);
  document.querySelectorAll('[data-key]').forEach((el) => {
    const v = s[el.dataset.key];
    if (v === undefined) return;
    if (el.type === 'checkbox') el.checked = v;
    else {
      if (el !== document.activeElement) el.value = v;
      if (el.type === 'range') updateLabel(el, v);
    }
  });
  document.querySelectorAll('[data-emote]').forEach((c) => (c.checked = (s.emoteList || []).includes(c.dataset.emote)));
  const vis = $('#vis');
  vis.classList.toggle('off', !s.visible);
  const visLabel = vis.querySelector('.chip-label');
  if (visLabel) visLabel.textContent = s.visible ? '🙈 Ocultar avatar' : '👁 Mostrar avatar';
  const visFace = vis.querySelector('.chip-face');
  if (visFace) visFace.src = s.visible ? '../assets/reactions/ola.webp' : '../assets/reactions/dormindo.webp'; // acordada / dormindo
  vis.title = s.visible ? 'Ocultar avatar' : 'Mostrar avatar';
  vis.setAttribute('aria-label', vis.title);
  vis.setAttribute('aria-pressed', String(!!s.visible));
  document.documentElement.dataset.theme = s.panelTheme || 'auto';
  const layout = ['floatdock', 'iconsidebar', 'discord'].includes(s.panelLayout) ? s.panelLayout : 'discord';
  document.body.dataset.layout = layout;
  const dockPosition = ['top', 'right', 'bottom', 'left'].includes(s.panelDockPosition) ? s.panelDockPosition : 'bottom';
  const dockCollapsed = !!s.panelDockCollapsed;
  document.body.dataset.dockPosition = dockPosition;
  document.body.dataset.dockCollapsed = String(dockCollapsed);
  const dockSettings = $('#dockSettings');
  if (dockSettings) dockSettings.hidden = layout !== 'floatdock';
  if (dockCollapse) {
    dockCollapse.textContent = dockCollapsed ? '＋' : '−';
    dockCollapse.title = dockCollapsed ? 'Expandir navegação' : 'Recolher navegação';
    dockCollapse.setAttribute('aria-label', dockCollapse.title);
    dockCollapse.setAttribute('aria-expanded', String(!dockCollapsed));
  }
  if (window.applyNavigationLayout) window.applyNavigationLayout(layout);
  document.querySelectorAll('.layout-card').forEach((b) => b.classList.toggle('sel', b.dataset.layout === layout));
  document.querySelectorAll('.theme-card').forEach((c) => c.classList.toggle('sel', c.dataset.theme === (s.panelTheme || 'auto')));
  document.querySelectorAll('.model-card').forEach((c) => c.classList.toggle('sel', c.dataset.model === (s.convModel || 'base')));
  const ms = $('#modelStatus'); if (ms) { const cur = WHISPER.find((m) => m.id === (s.convModel || 'base')); ms.textContent = cur ? 'Em uso: ' + cur.name + ' (' + cur.size + ')' : ''; }
  if (s.panelAccent) {
    window.setAccent(s.panelAccent);
    $('#accentPick').value = s.panelAccent;
    document.querySelectorAll('.sw-dot').forEach((d) => d.classList.toggle('sel', JSON.parse(d.dataset.set).panelAccent === s.panelAccent));
  }
  document.querySelectorAll('.perf-profile').forEach((b) => {
    const want = JSON.parse(b.dataset.set);
    const dflt = { processPriority: 'normal', sttUnloadMin: 0, antialias: 'auto' };
    b.classList.toggle('on', Object.keys(want).every((k) => (s[k] === undefined ? dflt[k] : s[k]) === want[k]));
  });
  fillNeural();
  document.querySelectorAll('.voice-preset').forEach((b) => {
    const w = JSON.parse(b.dataset.set);
    b.classList.toggle('on', Math.abs((s.voiceRate ?? 1) - w.voiceRate) < 0.01 && Math.abs((s.voicePitch ?? 1) - w.voicePitch) < 0.01);
  });
  const libKey = (s.avatarFile || '') + '|' + (s.item || '') + '|' + (s.itemHand || '');
  if (libKey !== lastLibKey && typeof renderLib === 'function' && $('#avatarList')) renderLib();
  const neural = s.voiceEngine !== 'system';
  $('#rowNeural').style.display = neural ? '' : 'none';
  $('#rowSystem').style.display = neural ? 'none' : '';
  if (window.voiceUI) voiceUI.onSettings(s);
}


// Backup e recuperação com diálogos nativos e confirmação no processo principal.
const backupCreateBtn = $('#backupCreate');
const backupRestoreBtn = $('#backupRestore');
const backupStatus = $('#backupStatus');
if (backupCreateBtn && backupRestoreBtn && backupStatus) {
  backupCreateBtn.addEventListener('click', async () => {
    backupCreateBtn.disabled = true; backupStatus.textContent = 'Preparando backup…';
    try { const r = await panel.backupCreate(); backupStatus.textContent = r.ok ? `Backup salvo (${(r.bytes / 1048576).toFixed(1)} MB).` : (r.canceled ? 'Operação cancelada.' : (r.error || 'Não foi possível criar o backup.')); }
    catch (e) { backupStatus.textContent = String(e.message || e); }
    finally { backupCreateBtn.disabled = false; }
  });
  backupRestoreBtn.addEventListener('click', async () => {
    backupRestoreBtn.disabled = true; backupStatus.textContent = 'Aguardando seleção do backup…';
    try { const r = await panel.backupRestore(); backupStatus.textContent = r.ok ? 'Backup restaurado. O Yoru será reiniciado.' : (r.canceled ? 'Restauração cancelada.' : (r.error || 'Não foi possível restaurar o backup.')); }
    catch (e) { backupStatus.textContent = String(e.message || e); }
    finally { backupRestoreBtn.disabled = false; }
  });
}
