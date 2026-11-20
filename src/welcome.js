'use strict';
// saudação conforme a hora do dia (só texto, sem HTML)
{
  const h = new Date().getHours();
  document.getElementById('hello').textContent = h < 5 ? 'Boa madrugada' : h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}
document.querySelectorAll('.card').forEach((b) => b.addEventListener('click', () => window.welcome.go(b.dataset.tab)));
document.getElementById('go').addEventListener('click', () => window.welcome.done());
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.welcome.done(); });
