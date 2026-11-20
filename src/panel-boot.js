'use strict';
// tema e cor de destaque chegam pela URL: a janela já abre com a aparência certa
window.setAccent = function (a) {
  if (!/^#[0-9a-f]{6}$/i.test(a || '')) return;
  var rgb = [1, 3, 5].map(function (i) { return parseInt(a.slice(i, i + 2), 16); });
  var st = document.documentElement.style;
  st.setProperty('--accent', a);
  st.setProperty('--on-accent', 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 160 ? '#1b1c22' : '#ffffff');
};
(function () {
  var q = new URLSearchParams(location.search);
  if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
  if (q.get('tb') === '1' && q.get('dockOnly') !== '1') document.documentElement.classList.add('has-tb');   // barra de título própria (Windows)
  if (q.get('dockOnly') === '1') {   // dock exclusivo: fundo transparente e regras em dock.css
    document.documentElement.classList.add('dock-only');
    document.addEventListener('DOMContentLoaded', function () { document.body.classList.add('dock-only'); }, { once: true });
  }
  window.setAccent(q.get('accent'));
})();
