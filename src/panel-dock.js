'use strict';
// Float Dock exclusivo (janela transparente só com a barra): ajusta a janela ao conteúdo, deixa o clique atravessar a área
// transparente e mostra dicas flutuantes. Fora do modo exclusivo este arquivo não faz nada.
(() => {
  if (new URLSearchParams(location.search).get('dockOnly') !== '1') return;
  const body = document.body;
  const side = document.querySelector('.side');
  const tabs = side && side.querySelector('.tabs');
  if (!side || !tabs) return;
  document.documentElement.classList.add('dock-only');
  body.classList.add('dock-only');

  // ---------- tamanho da janela = tamanho natural da barra + folga (sombra e dica flutuante) ----------
  const PAD = 26;     // folga em volta (sombra, brilho e a alça de recolher); igual a --dp no dock.css
  const TIP_Y = 46;   // folga extra para a dica, no lado voltado para o centro da tela (dock em cima/embaixo)
  const TIP_X = 150;  // idem para dock nas laterais (a dica fica ao lado do ícone)
  let lastSent = null;
  let frame = 0;
  function measure() {
    frame = 0;
    const pos = body.dataset.dockPosition || 'bottom';
    const collapsed = body.dataset.dockCollapsed === 'true';
    const vertical = pos === 'left' || pos === 'right';
    const r = side.getBoundingClientRect();
    let w = r.width;
    let h = r.height;
    if (!collapsed && tabs.offsetParent !== null) {
      // tamanho natural dos atalhos mesmo que a janela ainda esteja menor (a rolagem interna não entra na conta)
      if (vertical) h = r.height - tabs.clientHeight + tabs.scrollHeight;
      else w = r.width - tabs.clientWidth + tabs.scrollWidth;
      tabs.classList.toggle('is-scrolling', vertical ? tabs.scrollHeight > tabs.clientHeight + 1 : tabs.scrollWidth > tabs.clientWidth + 1);
    }
    const pad = { t: PAD, r: PAD, b: PAD, l: PAD };
    if (pos === 'bottom') pad.t += TIP_Y;
    else if (pos === 'top') pad.b += TIP_Y;
    else if (pos === 'left') pad.r += TIP_X;
    else pad.l += TIP_X;
    const size = { w: Math.ceil(w + pad.l + pad.r), h: Math.ceil(h + pad.t + pad.b) };
    // histerese: diferenças de 1–2px (arredondamento/animação) não redimensionam a janela de novo
    if (lastSent && lastSent.pos === pos && Math.abs(lastSent.w - size.w) <= 2 && Math.abs(lastSent.h - size.h) <= 2) return;
    lastSent = { ...size, pos };
    panel.action('dock-fit', size);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
  new ResizeObserver(schedule).observe(side);
  new ResizeObserver(schedule).observe(tabs);
  new MutationObserver(schedule).observe(body, { attributes: true, attributeFilter: ['data-dock-position', 'data-dock-collapsed', 'data-layout'] });
  window.addEventListener('resize', schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  schedule();
  setTimeout(schedule, 300); // imagens e emojis que chegam depois do primeiro desenho

  // ---------- clique atravessa a área transparente ----------
  let hit = null;
  const overDock = (t) => !!(t && t.closest && t.closest('.side'));
  const sendHit = (v) => { if (v !== hit) { hit = v; panel.action('dock-hit', v); } };
  const onMove = (e) => sendHit(body.dataset.dockDragging === 'true' || overDock(e.target));
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('pointermove', onMove, true);
  document.documentElement.addEventListener('mouseleave', () => { if (body.dataset.dockDragging !== 'true') sendHit(false); });
  document.addEventListener('pointerup', (e) => { hit = null; sendHit(overDock(e.target)); }, true);

  // ---------- dicas flutuantes (a dica nativa do sistema fica cortada numa janela transparente) ----------
  const tip = document.createElement('div');
  tip.className = 'dock-tip';
  tip.setAttribute('role', 'tooltip');
  body.appendChild(tip);
  const stripTitles = () => side.querySelectorAll('[title]').forEach((el) => {
    el.dataset.tip = el.getAttribute('title');
    el.removeAttribute('title');
  });
  stripTitles();
  new MutationObserver(stripTitles).observe(side, { attributes: true, attributeFilter: ['title'], subtree: true });

  function showTip(el) {
    const text = el.dataset.tip;
    if (!text || body.dataset.dockDragging === 'true') return;
    tip.textContent = text;
    if (el.id === 'vis') {
      const hint = document.createElement('small');
      hint.textContent = 'Ctrl+Shift+H';
      tip.appendChild(hint);
    }
    tip.style.display = 'block';
    const r = el.getBoundingClientRect();
    const pos = body.dataset.dockPosition || 'bottom';
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const gap = 12;
    let x;
    let y;
    if (pos === 'bottom') { x = r.left + r.width / 2 - tw / 2; y = r.top - th - gap - 4; }
    else if (pos === 'top') { x = r.left + r.width / 2 - tw / 2; y = r.bottom + gap + 4; }
    else if (pos === 'left') { x = r.right + gap; y = r.top + r.height / 2 - th / 2; }
    else { x = r.left - tw - gap; y = r.top + r.height / 2 - th / 2; }
    x = Math.max(6, Math.min(window.innerWidth - tw - 6, x));
    y = Math.max(6, Math.min(window.innerHeight - th - 6, y));
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    tip.classList.add('show');
  }
  const hideTip = () => { tip.classList.remove('show'); tip.style.display = ''; };
  side.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); if (el) showTip(el); else hideTip(); });
  side.addEventListener('pointerleave', hideTip);
  side.addEventListener('pointerdown', hideTip);
  side.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); if (el && el.matches(':focus-visible')) showTip(el); });
  side.addEventListener('focusout', hideTip);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });
})();
