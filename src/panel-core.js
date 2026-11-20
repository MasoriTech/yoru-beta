// Base do painel: atalhos, estado, troca de abas e sub-abas, abrir aba em janela separada.
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
const $ = (sel) => document.querySelector(sel);
const EMOTES = [
  ['wave', '👋', 'Acenar'], ['happy', '😊', 'Feliz'], ['nod', '🙂', 'Concordar'],
  ['shake', '🙅', 'Negar'], ['surprised', '😲', 'Surpresa'], ['stretch', '🙆', 'Espreguiçar'],
  ['dance', '💃', 'Dançar'], ['bow', '🙇', 'Reverência'], ['spin', '🌀', 'Girar'], ['shy', '😳', 'Tímida'],
  ['cheer', '🎉', 'Comemorar'], ['laugh', '😂', 'Rir'], ['sad', '😢', 'Abatida'], ['angry', '😠', 'Brava'],
  ['sleepy', '😴', 'Sonolenta'], ['think', '🤔', 'Pensar'], ['jump', '🤸', 'Pular'],
  ['disco', '🪩', 'Disco'], ['robot', '🤖', 'Robô'], ['samba', '🥁', 'Samba'], ['ballet', '🩰', 'Balé'], ['hiphop', '🎤', 'Hip hop'],
  ['clap', '👏', 'Palmas'], ['pose', '😎', 'Mãos na cintura'], ['salute', '🫡', 'Continência'], ['sit', '🧘', 'Sentar no chão'], ['chair', '🪑', 'Sentar na cadeira'], ['duck', '🦆', 'Se abaixar'], ['bed', '🛏️', 'Dormir na cama'], ['tent', '⛺', 'Dormir na barraca'],
  ['thumbs_up', '👍', 'Joinha'], ['heart', '🫶', 'Coração'], ['blow_kiss', '😘', 'Mandar beijo'],
  ['point', '👉', 'Apontar'], ['shrug', '🤷', 'Dar de ombros'], ['facepalm', '🤦', 'Facepalm'],
];
let state = {};
let pending = null;

function send(partial) {          // agrupa mudanças rápidas (sliders)
  pending = { ...(pending || {}), ...partial };
  requestAnimationFrame(() => { if (pending) { panel.set(pending); pending = null; } });
}

// ----- navegação principal -----
const navGroups = [...document.querySelectorAll('.nav-group[data-nav-group]')];
const navServers = [...document.querySelectorAll('.server[data-group]')];
const lastTabByGroup = new Map();

function applyNavigationLayout(layout = document.body.dataset.layout || 'discord') {
  const activeGroup = document.body.dataset.navGroup || 'pessoal';
  const isDiscord = layout === 'discord';
  navGroups.forEach((group) => {
    group.hidden = isDiscord && group.dataset.navGroup !== activeGroup;
  });
  navServers.forEach((server) => {
    const active = server.dataset.group === activeGroup;
    server.classList.toggle('active', active);
    if (active) server.setAttribute('aria-current', 'page');
    else server.removeAttribute('aria-current');
  });
}

function setNavigationGroup(group, navigate = false) {
  const targetGroup = navGroups.find((item) => item.dataset.navGroup === group);
  if (!targetGroup) return;
  document.body.dataset.navGroup = group;
  applyNavigationLayout();
  if (navigate) {
    const rememberedId = lastTabByGroup.get(group);
    const rememberedTab = rememberedId && targetGroup.querySelector(`.tab[data-tab="${CSS.escape(rememberedId)}"]`);
    const targetTab = rememberedTab || targetGroup.querySelector('.tab');
    targetTab?.click();
  }
}

window.applyNavigationLayout = applyNavigationLayout;
const initialActive = document.querySelector('.tab.active');
const initialGroup = initialActive?.closest('.nav-group')?.dataset.navGroup;
if (initialGroup && initialActive.dataset.tab) lastTabByGroup.set(initialGroup, initialActive.dataset.tab);

document.querySelectorAll('.tab').forEach((t) => {
  const iconLabel = t.querySelector('i')?.textContent || '';
  t.dataset.label = t.textContent.replace(iconLabel, '').replace('⧉', '').trim();
  t.title = t.dataset.label;
  t.setAttribute('aria-label', t.dataset.label);
  t.addEventListener('click', () => {
    // No modo Float Dock exclusivo, cada ícone abre sua página em uma janela própria.
    if (document.body.classList.contains('dock-only')) {
      panel.action('open-tab', t.dataset.tab);
      return;
    }
    document.querySelectorAll('.tab').forEach((x) => {
      const active = x === t;
      x.classList.toggle('active', active);
      if (active) x.setAttribute('aria-current', 'page'); else x.removeAttribute('aria-current');
    });
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + t.dataset.tab));
    const group = t.closest('.nav-group')?.dataset.navGroup;
    if (group) {
      lastTabByGroup.set(group, t.dataset.tab);
      setNavigationGroup(group);
    }
    if (t.dataset.tab === 'chat') { $('#chatInput').focus(); if (window.refreshChatModel) window.refreshChatModel(); }
  });
});

document.querySelectorAll('.server[data-group]').forEach((button) => {
  button.addEventListener('click', () => {
    const group = button.dataset.group;
    if (group === document.body.dataset.navGroup) return;
    setNavigationGroup(group, true);
  });
});

// A configuração inicial também pode vir de um perfil antigo sem o atributo no HTML.
applyNavigationLayout();

// No Float Dock, arrastar o símbolo Y até uma borda muda a posição e salva a escolha.
// Durante o arraste uma área tracejada mostra onde o dock vai encaixar; Esc cancela.
(() => {
  const grip = document.querySelector('.side .brand');
  if (!grip) return;
  grip.title = 'Arraste o símbolo Y para mover o Float Dock para outra borda';
  let start = null;
  let moved = false;
  const nearestEdge = (event) => {
    const x = Math.max(0, Math.min(window.innerWidth, event.clientX));
    const y = Math.max(0, Math.min(window.innerHeight, event.clientY));
    const distances = [
      ['top', y], ['right', window.innerWidth - x],
      ['bottom', window.innerHeight - y], ['left', x],
    ].sort((a, b) => a[1] - b[1]);
    return distances[0][0];
  };
  let announced = false;   // o main já foi avisado de que o arraste começou (dock exclusivo)
  const clearDrag = () => {
    if (announced) { announced = false; panel.action('dock-drag', false); }
    start = null;
    moved = false;
    grip.classList.remove('dock-dragging');
    delete document.body.dataset.dockDragging;
    delete document.body.dataset.dockTarget;
  };
  const finish = (event) => {
    if (!start) return;
    const wasMoved = moved;
    const edge = nearestEdge(event);
    if (wasMoved && document.body.dataset.layout === 'floatdock' && edge !== document.body.dataset.dockPosition) {
      document.body.dataset.dockPosition = edge; // aplica já; o main confirma pelas configurações
      panel.set({ panelDockPosition: edge });
    }
    clearDrag(); // por último: o main só devolve a janela ao tamanho do dock depois de saber a borda nova
  };
  grip.addEventListener('pointerdown', (event) => {
    if (document.body.dataset.layout !== 'floatdock' || event.button !== 0) return;
    start = { x: event.clientX, y: event.clientY, preventClick: false };
    moved = false;
    try { grip.setPointerCapture(event.pointerId); } catch (_) { /* captura opcional */ }
  });
  grip.addEventListener('pointermove', (event) => {
    if (!start || document.body.dataset.layout !== 'floatdock') return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 9) {
      moved = true;
      grip.classList.add('dock-dragging');
      document.body.dataset.dockDragging = 'true';
      if (!announced && document.body.classList.contains('dock-only')) { announced = true; panel.action('dock-drag', true); }
    }
    if (moved) document.body.dataset.dockTarget = nearestEdge(event);
  });
  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', clearDrag);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && start) clearDrag(); });
})();

// Float Dock: setas/Home/End navegam entre os atalhos e a aba ativa nunca fica escondida na rolagem do dock.
(() => {
  const tabsBox = document.querySelector('.side .tabs');
  if (!tabsBox) return;
  const isDock = () => document.body.dataset.layout === 'floatdock';
  tabsBox.addEventListener('keydown', (event) => {
    if (!isDock() || event.altKey || event.ctrlKey || event.metaKey) return;
    const tabs = [...tabsBox.querySelectorAll('.tab')].filter((t) => t.offsetParent !== null);
    const index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    let next;
    if (step) next = (index + step + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    tabs[next].focus();
  });
  const revealActive = () => {
    const active = tabsBox.querySelector('.tab.active');
    if (!isDock() || !active || tabsBox.offsetParent === null) return;
    const box = tabsBox.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    const pad = 14;
    if (['left', 'right'].includes(document.body.dataset.dockPosition)) {
      if (rect.top < box.top + pad) tabsBox.scrollTop -= box.top + pad - rect.top;
      else if (rect.bottom > box.bottom - pad) tabsBox.scrollTop += rect.bottom - (box.bottom - pad);
    } else if (rect.left < box.left + pad) tabsBox.scrollLeft -= box.left + pad - rect.left;
    else if (rect.right > box.right - pad) tabsBox.scrollLeft += rect.right - (box.right - pad);
  };
  new MutationObserver(revealActive).observe(tabsBox, { subtree: true, attributes: true, attributeFilter: ['class'] });
  new MutationObserver(revealActive).observe(document.body, { attributes: true, attributeFilter: ['data-layout', 'data-dock-position', 'data-dock-collapsed'] });
  window.addEventListener('resize', revealActive);
})();

// ----- sub-abas dentro de uma aba -----
document.querySelectorAll('.subtabs').forEach((nav) => {
  const pane = nav.closest('.pane');
  const show = (name) => {
    nav.querySelectorAll('.subtab').forEach((b) => { const on = b.dataset.sub === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    pane.querySelectorAll('[data-sub]:not(.subtab)').forEach((el) => el.classList.toggle('sub-on', el.dataset.sub.split(' ').includes(name)));
  };
  nav.addEventListener('click', (e) => { const b = e.target.closest('.subtab'); if (b) show(b.dataset.sub); });
  show(nav.querySelector('.subtab').dataset.sub);
});

// ----- segundo nível: pílulas dentro de uma sub-aba (ex.: Avatar › Comportamento › Fala) -----
document.querySelectorAll('.subtabs2').forEach((nav) => {
  const pane = nav.closest('.pane');
  const show = (name) => {
    nav.querySelectorAll('.subtab2').forEach((b) => { const on = b.dataset.sub2 === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
    pane.querySelectorAll('[data-sub2]:not(.subtab2)').forEach((el) => el.classList.toggle('sub2-on', el.dataset.sub2 === name));
  };
  nav.addEventListener('click', (e) => { const b = e.target.closest('.subtab2'); if (b) show(b.dataset.sub2); });
  show(nav.querySelector('.subtab2').dataset.sub2);
});

// ----- abrir uma aba em janela separada (botão ⧉ ou duplo clique na aba) -----
document.querySelectorAll('.tab').forEach((t) => {
  if (t.dataset.tab === 'conversa' || t.dataset.tab === 'gestos') return; // abas de captura continuam sem atalho de destaque no painel clássico
  const pop = document.createElement('span');
  pop.className = 'pop';
  pop.textContent = '⧉';
  pop.title = 'Abrir em janela separada';
  pop.addEventListener('click', (e) => { e.stopPropagation(); panel.action('open-tab', t.dataset.tab); });
  t.appendChild(pop);
  t.addEventListener('dblclick', () => panel.action('open-tab', t.dataset.tab));
});

// janela destacada (?solo=aba): mostra só aquela aba, sem o menu lateral
(() => {
  const solo = new URLSearchParams(location.search).get('solo');
  const tabBtn = solo && document.querySelector(`.tab[data-tab="${CSS.escape(solo)}"]`);
  if (!tabBtn) return;
  document.body.classList.add('solo');
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + solo));
  document.title = 'Avatar — ' + tabBtn.textContent.replace('⧉', '').trim();
  if (solo === 'chat') setTimeout(() => $('#chatInput') && $('#chatInput').focus(), 100);
})();

// a tela de boas-vindas pede para abrir uma aba (Perfil, IA, Voz, Avatar)
panel.onGoTab((t) => {
  const voz = t === 'voz'; // a aba Voz virou uma sub-aba da Conversa
  const b = document.querySelector(`.tab[data-tab="${CSS.escape(voz ? 'conversa' : t)}"]`);
  if (!b) return;
  b.click();
  if (voz) { const sb = document.querySelector('#tab-conversa .subtab[data-sub="voz"]'); if (sb) sb.click(); }
});
