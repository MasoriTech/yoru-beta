// Aba Voz: cor personalizada, teste de voz, vozes do sistema e neurais, saída de áudio.
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- cor personalizada e teste de voz -----
$('#accentPick').addEventListener('input', (e) => send({ panelAccent: e.target.value }));
const speakNow = () => panel.action('speak-test', $('#speakText').value.trim());
$('#speakBtn').addEventListener('click', speakNow);
$('#speakText').addEventListener('keydown', (e) => { if (e.key === 'Enter') speakNow(); });
$('#stopBtn').addEventListener('click', () => panel.action('stop-speak'));

// ----- vozes disponíveis -----
function loadVoices() {
  const sel = $('#voiceName');
  const vs = speechSynthesis.getVoices();
  const isPt = (v) => /^pt/i.test(v.lang);
  sel.innerHTML = '';
  sel.add(new Option('Automática (feminina, português)', ''));
  [...vs.filter(isPt), ...vs.filter((v) => !isPt(v))].forEach((v) => sel.add(new Option(`${v.name} (${v.lang})`, v.name)));
  if (state.voiceName !== undefined) sel.value = state.voiceName;
  if (!vs.length) $('#voiceHint').textContent = 'Nenhuma voz encontrada neste sistema.';
}
speechSynthesis.onvoiceschanged = loadVoices;
let neuralList = [], neuralKey = '';
const langName = (c) => { try { const n = new Intl.DisplayNames(['pt-BR'], { type: 'language' }).of(c); return n.charAt(0).toUpperCase() + n.slice(1); } catch (_) { return c; } };
// monta a lista de idiomas e a lista de vozes do idioma escolhido (a voz em uso sempre aparece)
function fillNeural() {
  if (!neuralList.length) return;
  const lang = state.neuralLang || 'pt', cur = state.neuralVoice || 'pt-BR-FranciscaNeural';
  const key = lang + '|' + cur + '|' + neuralList.length;
  if (key === neuralKey) return;
  neuralKey = key;
  const langs = [...new Set(neuralList.map((v) => v.lang || 'pt'))].sort((a, b) => (a === 'pt' ? -1 : b === 'pt' ? 1 : langName(a).localeCompare(langName(b))));
  const ls = $('#neuralLang'); ls.innerHTML = '';
  langs.forEach((l) => ls.add(new Option(langName(l), l)));
  ls.value = langs.includes(lang) ? lang : 'pt';
  $('#rowLang').style.display = langs.length > 1 ? '' : 'none';
  const sel = $('#neuralVoice'); sel.innerHTML = '';
  const shown = neuralList.filter((v) => (v.lang || 'pt') === ls.value || v.id === cur);
  shown.forEach((v) => sel.add(new Option(v.label + (v.multi ? ' ✦' : ''), v.id)));
  if (cur) sel.value = cur;
}
async function loadNeuralVoices() {
  try { neuralList = await panel.ttsVoices(); neuralKey = ''; fillNeural(); } catch (_) { /* mantém a opção fixa */ }
}
// saídas de áudio (alto-falante, fone...)
async function loadSinks() {
  const sel = $('#voiceSink');
  let devs = [];
  try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audiooutput'); } catch (_) {}
  sel.innerHTML = '';
  sel.add(new Option('Padrão do sistema', ''));
  devs.filter((d) => !['default', 'communications'].includes(d.deviceId)).forEach((d, i) => sel.add(new Option(d.label || 'Saída ' + (i + 1), d.deviceId)));
  sel.value = state.voiceSink || '';
}
$('#sinkRefresh').addEventListener('click', loadSinks);
try { navigator.mediaDevices.addEventListener('devicechange', loadSinks); } catch (_) {}
// medição da última voz neural
function paintTts(d) {
  const el = $('#ttsStat'); if (!el || !d) return;
  const mem = ` Memória de falas: ${d.cacheItems || 0} (${d.cacheKB || 0} KB).`;
  if (d.ok === false) el.textContent = '⚠ A voz neural falhou (' + String(d.error || 'sem resposta').slice(0, 90) + '): ela usou a voz do Windows. Confira a internet.' + mem;
  else if (d.ok) el.textContent = `Última voz neural: ${d.cached ? 'tocou na hora, direto da memória' : 'sintetizada em ' + d.ms + ' ms'} · ${d.chars} caracteres · ${Math.round(d.bytes / 1024)} KB.` + mem;
  else el.textContent = 'Última voz neural: ainda nenhuma nesta sessão.' + mem;
}
panel.onTtsStat(paintTts);
panel.ttsStat().then(paintTts).catch(() => {});
$('#ttsClear').addEventListener('click', () => panel.ttsClear());
$('#speakChips').addEventListener('click', (e) => { const t = e.target.dataset && e.target.dataset.say; if (t) { $('#speakText').value = t; speakNow(); } });
