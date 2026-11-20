// Início: carrega versão e configurações e liga os eventos. Precisa ser o último dos panel-*.js.
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- início -----
panel.getVersion().then((v) => { $('#ver').textContent = 'v' + v; const t = $('#tbver'); if (t) t.textContent = 'v' + v; });
panel.getSettings().then((s) => { render(s); loadVoices(); loadNeuralVoices(); loadSinks(); });
panel.onSettings(render);
loadConfig();
