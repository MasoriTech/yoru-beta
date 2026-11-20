// Configurações extras do painel: tamanho da janela e zoom da interface.
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);

  // ----- zoom -----
  const zoom = $('#panelZoom'), zoomLabel = $('#v-panelZoom');
  const label = (v) => { zoomLabel.textContent = Math.round(v * 100) + '%'; };
  zoom.addEventListener('input', () => label(Number(zoom.value)));      // só mostra o número enquanto arrasta
  zoom.addEventListener('change', () => panel.set({ panelZoom: Number(zoom.value) })); // aplica ao soltar (a tela muda de tamanho)
  document.querySelectorAll('[data-zoom]').forEach((b) =>
    b.addEventListener('click', () => panel.set({ panelZoom: Number(b.dataset.zoom) })));
  const applyZoom = (s) => {
    const z = typeof s.panelZoom === 'number' ? s.panelZoom : 1;
    if (document.activeElement !== zoom) zoom.value = z;
    label(z);
  };
  panel.onSettings(applyZoom);
  panel.getSettings().then(applyZoom);

  // ----- tamanho da janela -----
  const wIn = $('#panelW'), hIn = $('#panelH'), now = $('#panelSizeNow');
  const show = (b) => {
    if (!b) return;
    now.textContent = (b.max ? 'Maximizado · ' : '') + b.w + ' × ' + b.h + ' px';
    if (document.activeElement !== wIn) wIn.value = b.w;
    if (document.activeElement !== hIn) hIn.value = b.h;
  };
  panel.onPanelBounds(show);
  panel.panelBounds().then(show);
  const apply = () => {
    const w = parseInt(wIn.value, 10), h = parseInt(hIn.value, 10);
    if (w > 0 && h > 0) panel.action('panel-size', { w, h });
  };
  $('#panelApplySize').addEventListener('click', apply);
  [wIn, hIn].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); }));
})();
