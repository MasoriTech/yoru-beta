// Falas espontâneas (Avatar › Comportamento › Fala).
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- falas espontâneas -----
function paintChatter(s) { document.querySelectorAll('.chatter-dep').forEach((el) => el.classList.toggle('dim', !s.convChatter)); }
$('#chatterNow').addEventListener('click', async () => {
  const st = $('#chatterStatus');
  const ok = await panel.chatterNow();
  st.textContent = ok ? 'Pronto — ela falou algo agora.' : 'Ligue pelo menos um tipo de fala em “O que ela diz”.';
  st.className = 'status ' + (ok ? 'ok' : 'bad');
  setTimeout(() => { st.textContent = ''; st.className = 'status'; }, 4000);
});
$('#smashNow').addEventListener('click', async () => {
  const st = $('#smashStatus');
  const ok = await panel.smashNow();
  st.textContent = ok ? 'Olha a tela!' : 'O avatar precisa estar visível para socar a tela.';
  st.className = 'status ' + (ok ? 'ok' : 'bad');
  setTimeout(() => { st.textContent = ''; st.className = 'status'; }, 4000);
});
$('#goComportamento').addEventListener('click', () => {
  document.querySelector('.tab[data-tab="avatar"]').click();
  document.querySelector('#tab-avatar .subtab[data-sub="comportamento"]').click();
  document.querySelector('#tab-avatar .subtab2[data-sub2="fala"]').click();
});
