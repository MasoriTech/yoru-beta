'use strict';
// Conversa por voz (processo principal): recebe o áudio do painel, transcreve (Whisper local),
// decide se era com ela (nome ou conversa em andamento) e executa o pedido ou chama a IA.

const { spawn } = require('child_process');
const V = require('./voice-logic');
const { fetchHeadlines } = require('./news');
const YT = require('./youtube');
const { Stt } = require('./stt');
const W = require('./weather');
const A = require('./agenda');
const { parseTapoVoiceCommand } = require('./tapo-voice');
const { createPc } = require('./pc-control');
const { createOptimizer } = require('./pc-optimize');
const { parseBluetoothIndex, findBluetoothDeviceByName } = require('./bluetooth-devices');
const os = require('os');
const path = require('path');

const APPS = {
  calc: { win32: ['calc.exe'], darwin: ['open', '-a', 'Calculator'] },
  notepad: { win32: ['notepad.exe'], darwin: ['open', '-a', 'TextEdit'] },
  paint: { win32: ['mspaint.exe'] },
  explorer: { win32: ['explorer.exe'], darwin: ['open', '-a', 'Finder'] },
  taskmgr: { win32: ['taskmgr.exe'] },
};
const MEDIA_OPS = ['media-next', 'media-prev', 'media-playpause'];
const MAX_TIMER_MS = 24 * 3600 * 1000;
const isTimer = (x) => /^Timer de /.test(x.title);

/**
 * ctx: {
 *   settings(): config atual, panel(): BrowserWindow|null, avatar(): BrowserWindow|null,
 *   askAI(text, {voice, hint}), remember(user, assistant), logToPanel(entry),
 *   rollDice(speak), stopSpeak(), openExternal(url), cacheDir, platform, stt? (para testes)
 * }
 */
function createVoice(ctx) {
  const stt = ctx.stt || new Stt({ cacheDir: ctx.cacheDir, threads: () => (ctx.settings ? Number(ctx.settings().sttThreads) || 0 : 0), device: () => (ctx.settings && ctx.settings().sttDevice === 'gpu' ? 'gpu' : 'cpu') });
  const platform = ctx.platform || process.platform;
  const now = ctx.now || (() => new Date());
  const rnd = ctx.rnd || Math.random;
  const weather = ctx.weather || W.createWeather({ fetchFn: ctx.fetch });
  const pc = ctx.pc || createPc({ platform });
  const optimizer = ctx.optimizer || createOptimizer({ platform });
  const agenda = ctx.agenda || A.createStore(ctx.agendaFile || path.join(os.tmpdir(), 'avatar-agenda.json'), now);
  let pending = null; // pergunta em aberto: { kind, until, ... }
  let lead = '';      // abertura de saudação ("Bom dia!") colada na resposta de um pedido
  const timerHandles = new Set();
  let tapoVoiceTimer = null;

  let awakeUntil = 0;     // enquanto estiver no futuro, ela responde sem precisar do nome
  let speaking = false;
  let chain = Promise.resolve();
  let queued = 0;
  let nextChatterAt = 0;
  let modelPct = null;
  let modelAutoRetries = 0; // novas tentativas automáticas do modelo depois de uma falha de rede

  const S = () => ctx.settings();
  const model = () => (['tiny', 'base', 'small', 'medium', 'large-v3-turbo', 'large-v3'].includes(S().convModel) ? S().convModel : 'base');

  function emit(ev) {
    const p = ctx.panel && ctx.panel();
    if (p && !p.isDestroyed()) p.webContents.send('voice-event', ev);
  }
  let lastStatus = '';
  const status = (state) => {
    const awake = Date.now() < awakeUntil;
    const key = state + (awake ? '1' : '0');
    if (key === lastStatus) return; // mesmo estado de antes: não manda mensagem à toa para o painel
    lastStatus = key;
    emit({ type: 'status', state, awake });
  };

  stt.on('loading', () => { modelPct = 0; emit({ type: 'model', pct: 0 }); });
  stt.on('progress', (m) => { modelPct = m.pct; emit({ type: 'model', pct: m.pct, mb: m.mb }); });
  stt.on('retry', (m) => { console.log('[voz] nova tentativa do modelo ' + m.attempt + '/' + m.max + ' (' + m.reason + ')'); emit({ type: 'model', pct: modelPct || 0, retry: m.attempt + 1, max: m.max, reason: m.reason }); });
  stt.on('ready', (m) => { modelAutoRetries = 0; modelPct = null; emit({ type: 'model', pct: 100, done: true, device: m && m.device }); });
  stt.on('device', (m) => {
    console.log('[voz] ' + (m.backend || 'Whisper') + ' em ' + m.device + (m.reason ? ' (' + m.reason + ')' : ''));
    emit({ type: 'backend', backend: m.backend || 'transformers', device: m.device || 'cpu', reason: m.reason || '' });
  });

  // ----- eco: ela ouvindo a própria voz -----
  // Guarda o que acabou de dizer. Se o microfone captar a cauda da fala (alto-falante, Bluetooth, sala) e o
  // Whisper transcrever o mesmo texto, isso NÃO é o usuário: sem esta checagem ela "respondia a si mesma".
  let lastSaid = { words: new Set(), at: 0 };
  const ECHO_WINDOW_MS = 25000;
  function rememberSaid(text) {
    lastSaid = { words: new Set(V.norm(String(text || '')).split(/\s+/).filter(Boolean)), at: Date.now() };
  }
  function isEcho(text) {
    if (Date.now() - lastSaid.at > ECHO_WINDOW_MS || !lastSaid.words.size) return false;
    const w = V.norm(text).split(/\s+/).filter(Boolean);
    if (w.length < 4) return false; // frases curtas ("sim", "para") são do usuário
    const hit = w.filter((x) => lastSaid.words.has(x)).length;
    return hit / w.length >= 0.8;
  }

  // ----- respostas -----
  function reply(r, { userText = null } = {}) {
    const s = S();
    if (lead && !r.streamed) r = { ...r, text: `${lead} ${r.text}` };
    lead = '';
    const res = {
      ok: true,
      text: r.text,
      emotion: r.emotion || null,
      emotes: r.emotes || (r.emote ? [r.emote] : []),
      speak: !!s.convSpeak, // força a voz mesmo com "Falar as respostas" desligado na aba Voz
      streamed: !!r.streamed, // o avatar já mostrou/falou esta resposta aos poucos
    };
    rememberSaid(r.text);
    ctx.logToPanel({ role: 'assistant', text: r.text });
    const av = ctx.avatar && ctx.avatar();
    if (av && !av.isDestroyed()) av.webContents.send('ai-reply', res);
    emit({ type: 'reply', text: r.text });
    if (userText) ctx.remember(userText, r.text);
    awakeUntil = Date.now() + s.convFollow * 1000 + Math.min(r.text.length * 80, 20000);
    status('idle');
  }

  function fail(text) {
    ctx.logToPanel({ role: 'error', text });
    const av = ctx.avatar && ctx.avatar();
    if (av && !av.isDestroyed()) av.webContents.send('ai-reply', { ok: false, text });
    emit({ type: 'error', text });
    status('idle');
  }

  // ----- ações no computador -----
  function launchApp(key) {
    const cmd = APPS[key] && APPS[key][platform];
    if (!cmd) return false;
    try {
      const p = spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore' });
      p.on('error', () => {});
      p.unref();
      return true;
    } catch (_) { return false; }
  }

  async function doNews(userText) {
    lead = '';
    status('thinking');
    let items;
    try { items = await fetchHeadlines(5, ctx.fetch); }
    catch (_) { return reply({ text: 'Não consegui buscar as notícias agora. A internet está funcionando?', emotion: 'sad' }, { userText }); }
    const list = items.map((x, i) => `${i + 1}. ${x.title} (${x.source})`).join('\n');
    const hint = `[Manchetes de agora, vindas de sites de notícias:\n${list}\n]\n` +
      'Conte as principais notícias em até 3 frases curtas e faladas, em tom natural, sem listas e sem inventar nada além das manchetes.';
    const res = await ctx.askAI(userText, { voice: true, hint });
    if (res.ok) return reply(res); // o askAI já guardou na memória da conversa
    const plain = 'Olha só as manchetes: ' + items.slice(0, 3).map((x) => x.title.replace(/[.!?]+$/, '')).join('. ') + '.';
    reply({ text: plain, emotion: 'neutral' }, { userText });
  }


  // ----- clima -----
  async function doWeather(userText, body) {
    status('thinking');
    const req = W.parseRequest(body);
    const fallback = String(S().convCity || '').trim() || null;
    try {
      const w = await weather.get({ city: req.city || fallback });
      return reply({ text: W.weatherText(w, req.day), emotion: W.emotionFor(w, req.day) }, { userText });
    } catch (e) {
      const text = e && e.code === 'NOCITY' ? 'Não encontrei essa cidade. Pode repetir o nome?'
        : e && e.code === 'NOLOC' ? 'Não descobri onde você está. Diga a cidade, por exemplo “clima em Curitiba”, ou escreva a cidade na aba Conversa.'
        : 'Não consegui ver o clima agora. A internet está funcionando?';
      return reply({ text, emotion: 'sad' }, { userText });
    }
  }

  // ----- agenda -----
  const agendaChanged = () => emit({ type: 'agenda' });

  function agendaAdd(userText, body) {
    const d = now();
    const ev = A.parseEvent(body, d);
    if (!ev.title) {
      pending = { kind: 'agenda-add', until: Date.now() + 45000 };
      return reply({ text: 'Agenda pronta! O que você quer anotar? Por exemplo: dentista amanhã às 15 horas.', emotion: 'happy' }, { userText });
    }
    const item = agenda.add(ev);
    agendaChanged();
    let text;
    if (!ev.at) text = `Anotado na agenda: ${ev.title}. Sem data, mas fica guardado.`;
    else if (!ev.allDay && ev.at < d) text = `Anotei ${ev.title}, mas esse horário já passou hoje.`;
    else text = `Anotado! ${ev.title}, ${ev.rel ? 'daqui a ' + ev.rel : A.whenText(item, d)}.`;
    return reply({ text, emotion: 'happy', emote: rnd() < 0.4 ? 'nod' : null }, { userText });
  }

  function agendaList(userText, body) {
    const d = now();
    const low = A.deaccent(body).toLowerCase();
    const t0 = A.startOfDay(d);
    let items, head;
    if (/\bamanha\b/.test(low)) { items = agenda.range(A.addDays(t0, 1), A.addDays(t0, 2)); head = 'Amanhã'; }
    else if (/\bhoje\b/.test(low)) { items = agenda.range(t0, A.addDays(t0, 1)).filter((x) => x.allDay || new Date(x.at) >= d); head = 'Hoje'; }
    else if (/\bsemana\b/.test(low)) { items = agenda.range(t0, A.addDays(t0, 7)).filter((x) => x.allDay || new Date(x.at) >= d); head = 'Nesta semana'; }
    else { items = agenda.upcoming(10, d).filter((x) => x.allDay || new Date(x.at) >= d); head = 'Nos próximos dias'; }
    const undated = agenda.undated().length;
    if (!items.length) {
      const extra = undated ? ` Só tenho ${undated} ${undated === 1 ? 'anotação' : 'anotações'} sem data.` : '';
      const none = head === 'Hoje' ? 'Sua agenda de hoje está livre!' : head === 'Amanhã' ? 'Amanhã você está livre!' : 'Você não tem compromissos marcados.';
      return reply({ text: none + extra, emotion: 'happy' }, { userText });
    }
    const scoped = head === 'Hoje' || head === 'Amanhã';
    const part = (x) => scoped && !x.allDay ? `${x.title} ${A.whenText(x, d).replace(/^(hoje|amanhã) ?/, '')}`.trim() : `${x.title}, ${A.whenText(x, d)}`;
    const shown = items.slice(0, 4).map(part);
    const more = items.length > 4 ? `, e mais ${items.length - 4}` : '';
    const n = items.length;
    const text = `${head} você tem ${n} ${n === 1 ? 'compromisso' : 'compromissos'}: ${shown.join('; ')}${more}.`;
    return reply({ text, emotion: 'neutral', emote: 'nod' }, { userText });
  }

  function agendaRemove(userText, body, fromPending = false) {
    const q = A.removeQuery(body);
    if (!q) {
      if (fromPending) return reply({ text: 'Não entendi qual. Tente de novo falando o nome do compromisso.', emotion: 'neutral' }, { userText });
      pending = { kind: 'agenda-remove', until: Date.now() + 45000 };
      return reply({ text: 'Qual compromisso você quer apagar?', emotion: 'neutral' }, { userText });
    }
    const item = agenda.find(q);
    if (!item) return reply({ text: 'Não achei nenhum compromisso com esse nome na agenda.', emotion: 'sad' }, { userText });
    agenda.remove(item.id);
    agendaChanged();
    return reply({ text: `Pronto, apaguei ${item.title}.`, emotion: 'neutral', emote: 'nod' }, { userText });
  }

  function agendaClear(userText) {
    const n = agenda.size();
    if (!n) return reply({ text: 'A agenda já está vazia.', emotion: 'neutral' }, { userText });
    pending = { kind: 'agenda-clear', until: Date.now() + 30000 };
    return reply({ text: `Quer mesmo apagar a agenda inteira, com ${n} ${n === 1 ? 'item' : 'itens'}? Diga sim ou não.`, emotion: 'surprised' }, { userText });
  }

  // avisa falando quando chega a hora de um compromisso
  function agendaTick() {
    if (speaking || queued > 0) return;
    const due = agenda.due(now());
    const x = S().convReminders === false ? due.find(isTimer) : due[0]; // timer toca mesmo com os lembretes desligados
    if (!x) return;
    agenda.markReminded(x.id);
    agendaChanged();
    const late = now().getTime() - new Date(x.at).getTime() > 5 * 60000;
    const text = isTimer(x) ? `Acabou o tempo! O ${x.title.charAt(0).toLowerCase() + x.title.slice(1)} terminou.`
      : x.allDay ? `Lembrete de hoje: ${x.title}.`
      : late ? `Lembrete atrasado: ${x.title}, era ${A.whenText(x, now())}.`
      : `Lembrete: ${x.title}!`;
    reply({ text, emotion: 'surprised', emote: 'wave' });
  }

  // ----- música e vídeo: ela pergunta "qual?" e já abre o vídeo -----
  async function doPlay(userText, it) {
    const s = S();
    const media = it.media === 'video' ? 'video' : 'music';
    if (!s.convPcActions) return reply({ text: 'Abrir sites está desligado nas configurações da conversa.', emotion: 'neutral' }, { userText });
    if (!it.query && !it.random) {
      pending = { kind: 'play', media, where: it.where, until: Date.now() + 45000 };
      const ask = media === 'music'
        ? ['Claro! Qual música você quer ouvir?', 'Bora! Qual música? Pode falar o nome ou o artista.', 'Qual música você quer escutar?']
        : ['Claro! Qual vídeo você quer ver?', 'Bora! Me diz o assunto do vídeo.'];
      return reply({ text: pickOf(ask), emotion: 'happy', emote: media === 'music' && rnd() < 0.4 ? 'dance' : null }, { userText });
    }
    const q = it.query || pickOf(V.MUSIC_RANDOM);
    const label = it.query || 'uma seleção surpresa';
    if (it.where === 'spotify') {
      ctx.openExternal(YT.spotifyUrl(q));
      return reply({ text: `Procurando ${label} no Spotify! Lá é só dar o play.`, emotion: 'happy', emote: rnd() < 0.4 ? 'dance' : null }, { userText });
    }
    status('thinking');
    let url = null;
    try { url = (await YT.findVideo(q, ctx.fetch)).url; } catch (_) { /* sem rede ou página mudou: cai na busca */ }
    ctx.openExternal(url || YT.searchUrl(q));
    return reply(url
      ? { text: pickOf([`Pronto, tocando ${label} no YouTube!`, `Achei! Tocando ${label}.`]), emotion: 'happy', emote: media === 'music' && rnd() < 0.5 ? 'dance' : null }
      : { text: `Não consegui pegar o vídeo direto, então abri a busca por ${label} no YouTube.`, emotion: 'neutral' }, { userText });
  }


  // ----- controle do computador (volume, mídia, janelas, print, energia) -----
  const YES_RE = /\b(sim|pode|claro|quero|confirmo|isso|com certeza|fecha|desliga|reinicia|manda ver|vai)\b/i;
  const PC_ASK = {
    shutdown: 'Quer mesmo desligar o computador? Diga sim ou não.',
    restart: 'Quer mesmo reiniciar o computador? Diga sim ou não.',
    sleep: 'Quer mesmo colocar o computador para dormir? Diga sim ou não.',
    'opt-recycle': 'Quer mesmo esvaziar a lixeira? Não dá para desfazer. Diga sim ou não.',
  };
  const askConfirm = (it) => it.op === 'win'
    ? (it.act === 'closetab' ? `Quer mesmo fechar a aba do ${it.label}? Diga sim ou não.` : `Quer mesmo fechar ${it.target ? 'o ' + it.label : it.label}? Diga sim ou não.`)
    : PC_ASK[it.op];

  // otimizar o PC por voz: limpeza, energia e espaço livre (as ações vêm da lista fixa do pc-optimize.js)
  async function doOptimize(userText, it, done, fail_) {
    const id = it.op.slice(4);
    if (id === 'info') {
      const d = await optimizer.info();
      if (!d.ok) return fail_('Não consegui ver o estado do computador agora.');
      const plano = { high: 'alto desempenho', balanced: 'equilibrado', saver: 'economia de energia' }[d.plan];
      return done(`O disco ${d.drive} tem ${d.freeGB} giga livres, ${d.freePct} por cento. A memória tem ${d.ramFreeGB} giga livres de ${d.ramTotalGB}. ${d.tempMB >= 500 ? `Dá para liberar uns ${d.tempMB >= 1024 ? (d.tempMB / 1024).toFixed(1) + ' giga' : d.tempMB + ' mega'} de temporários: peça para eu limpar o computador. ` : ''}${plano ? `O plano de energia é ${plano}.` : ''}`.trim());
    }
    const r = await optimizer.run(id);
    if (!r.ok) return fail_(r.error || 'Não consegui fazer isso.');
    return done(r.message || 'Pronto!', { emote: 'nod' });
  }

  async function doPc(userText, it, confirmed = false) {
    const s = S();
    if (!s.convPcActions) return reply({ text: 'Mexer no computador está desligado nas configurações da conversa.', emotion: 'neutral' }, { userText });
    if (!pc.supported) return reply({ text: 'Esse controle do computador só funciona no Windows por enquanto.', emotion: 'neutral' }, { userText });
    if (it.danger && !confirmed) {
      pending = { kind: 'pc-confirm', it, until: Date.now() + 20000 };
      return reply({ text: askConfirm(it), emotion: 'surprised' }, { userText });
    }
    const done = (text, extra = {}) => reply({ text, emotion: 'happy', emote: null, ...extra }, { userText });
    const fail_ = (text) => reply({ text, emotion: 'sad' }, { userText });
    status('thinking');
    if (/^opt-/.test(it.op)) return doOptimize(userText, it, done, fail_);
    switch (it.op) {
      case 'volume-up': return (await pc.volume('up', it.steps)) ? done(pickOf(['Aumentei o volume!', 'Mais alto!'])) : fail_('Não consegui mexer no volume.');
      case 'volume-down': return (await pc.volume('down', it.steps)) ? done(pickOf(['Abaixei o volume.', 'Mais baixinho!'])) : fail_('Não consegui mexer no volume.');
      case 'volume-set': return (await pc.volume('set', it.level)) ? done(`Volume em ${it.level} por cento.`) : fail_('Não consegui mexer no volume.');
      case 'volume-mute': return (await pc.volume('mute')) ? done('Pronto, alternei o mudo.') : fail_('Não consegui mexer no som.');
      case 'media-playpause': return (await pc.media('playpause')) ? done(pickOf(['Feito!', 'Pronto!'])) : fail_('Não consegui controlar a mídia.');
      case 'media-next': return (await pc.media('next')) ? done('Próxima!') : fail_('Não consegui controlar a mídia.');
      case 'media-prev': return (await pc.media('prev')) ? done('Voltando!') : fail_('Não consegui controlar a mídia.');
      case 'switch': return (await pc.switchWindow()) ? done('Troquei de janela.') : fail_('Não consegui trocar de janela.');
      case 'desktop': return (await pc.desktop()) ? done('Pronto, área de trabalho.') : fail_('Não consegui mostrar a área de trabalho.');
      case 'lock': {
        done('Bloqueando o computador. Até já!');
        await pc.lock();
        return;
      }
      case 'screenshot': {
        const r = await pc.screenshot();
        return r.ok ? done('Tirei o print! Salvei na pasta Imagens e copiei para colar onde quiser.', { emote: 'nod' }) : fail_('Não consegui tirar o print.');
      }
      case 'list': {
        const seen = new Set();
        const names = [];
        for (const w of await pc.list()) {
          const n = /^ApplicationFrameHost$/i.test(w.proc) ? w.title : w.proc;
          const k = n.toLowerCase();
          if (!seen.has(k)) { seen.add(k); names.push(n); }
        }
        if (!names.length) return done('Não vi nenhum programa com janela aberta.');
        const shown = names.slice(0, 8).join(', ');
        return done(`Abertos agora: ${shown}${names.length > 8 ? ` e mais ${names.length - 8}` : ''}.`);
      }
      case 'power-cancel':
        return (await pc.cancelPower()) ? done('Cancelado! Tudo como estava.') : fail_('Não tinha nenhum desligamento para cancelar.');
      case 'shutdown':
        return (await pc.shutdown()) ? done('Desligando o computador em 30 segundos. Diga “cancelar desligamento” se mudar de ideia.', { emotion: 'neutral' }) : fail_('Não consegui desligar o computador.');
      case 'restart':
        return (await pc.restart()) ? done('Reiniciando em 30 segundos. Diga “cancelar reinício” se mudar de ideia.', { emotion: 'neutral' }) : fail_('Não consegui reiniciar o computador.');
      case 'sleep': {
        done('Boa noite! Colocando o computador para dormir.');
        await pc.sleep();
        return;
      }
      case 'win': {
        const r = await pc.window(it.act, it.target || '');
        const who = it.target ? it.label : 'a janela em foco';
        if (!r.ok && !r.found) {
          if (it.act === 'focus') { // não está aberto: tenta abrir pelo menu Iniciar
            const l = await pc.launch(it.label);
            return l.ok ? done(`${it.label} não estava aberto, então abri ${l.name}!`) : fail_(`Não achei ${it.label} aberto nem instalado.`);
          }
          return fail_(it.target ? `Não achei ${it.label} aberto.` : 'Não achei nenhuma janela para isso.');
        }
        if (!r.ok) return fail_('Não consegui fazer isso com a janela.');
        const txt = { minimize: `Minimizei ${who}.`, maximize: `Maximizei ${who}.`, restore: `Restaurei ${who}.`,
          close: `Fechei ${who}.`, closetab: `Fechei a aba do ${it.label}.`, focus: `Pronto, ${it.label} na frente!` }[it.act];
        return done(txt, { emote: it.act === 'focus' ? 'nod' : null });
      }
    }
    return fail_('Não entendi o que fazer no computador.');
  }

  // ----- Tapo L530E por voz -----
  function tapoCancelVoiceTimer() {
    if (!tapoVoiceTimer) return false;
    clearTimeout(tapoVoiceTimer.handle);
    tapoVoiceTimer = null;
    return true;
  }

  async function handleTapoVoice(userText) {
    const command = parseTapoVoiceCommand(userText, { random: rnd });
    if (!command) return false;
    const finish = (response, options) => { reply(response, options); return true; };
    if (command.type === 'error') return finish({ text:command.say, emotion:'neutral' }, { userText });
    if (command.type === 'help' || command.type === 'unsupported') return finish({ text:command.say, emotion:'happy' }, { userText });
    if (command.type === 'cancel-timer') {
      const canceled = tapoCancelVoiceTimer();
      return finish({ text:canceled ? 'Pronto, cancelei o temporizador da lâmpada.' : 'Não havia temporizador da lâmpada pendente.', emotion:'happy' }, { userText });
    }
    if (typeof ctx.tapoControl !== 'function') {
      if (command.soft) return false; // frase solta ("vou dormir"): sem lâmpada disponível, segue a conversa normal
      return finish({ text:'O controle de voz da Tapo não está disponível nesta sessão. Abra a aba Conectividade para verificar o Smart Home.', emotion:'sad' }, { userText });
    }
    if (command.type === 'query') {
      try {
        const current = await ctx.tapoControl('state', {});
        if (!current || current.ok === false) throw new Error(current?.error || 'Não consegui consultar a lâmpada.');
        const hue = Number(current.hsv?.hue || 0);
        const saturation = Number(current.hsv?.saturation || 0);
        const colorText = saturation < 12 ? (current.colorTemp ? `${current.colorTemp} Kelvin` : 'branco') : `cor HSV com matiz ${hue} graus`;
        const overheating = current.overheated === true ? ' Atenção: o dispositivo informa superaquecimento.' : current.overheated === false ? ' Sem alerta de superaquecimento.' : '';
        const sentence = `A lâmpada está ${current.isOn ? 'ligada' : 'desligada'}. Brilho em ${current.brightness ?? 'não informado'} por cento; ${colorText}.${overheating}`;
        return finish({ text:sentence, emotion:'happy' }, { userText });
      } catch (error) {
        return finish({ text:`Não consegui consultar a lâmpada: ${String(error.message || error).slice(0,180)}`, emotion:'sad' }, { userText });
      }
    }
    if (command.type === 'timer') {
      tapoCancelVoiceTimer();
      const handle = setTimeout(async () => {
        tapoVoiceTimer = null;
        try {
          const result = await ctx.tapoControl(command.target, {});
          if (!result || result.ok === false) throw new Error(result?.error || 'A lâmpada não confirmou a ação.');
          reply({ text:command.target === 'off' ? 'O temporizador terminou. Apaguei a lâmpada.' : 'O temporizador terminou. Acendi a lâmpada.', emotion:'happy', emote:'nod' });
        } catch (error) {
          reply({ text:`O temporizador da lâmpada terminou, mas não consegui executar a ação: ${String(error.message || error).slice(0,180)}`, emotion:'sad' });
        }
      }, command.delayMs);
      if (handle.unref) handle.unref();
      tapoVoiceTimer = { handle, target:command.target, at:Date.now() + command.delayMs };
      return finish({ text:command.say + ' O Yoru precisa permanecer aberto para executar esse temporizador.', emotion:'happy' }, { userText });
    }
    if (command.type !== 'actions' || !Array.isArray(command.actions)) return false;
    status('thinking');
    try {
      const needsState = command.actions.some(item => item.action === 'brightness-step' || (item.action === 'color' && (!item.args || item.args.brightness == null)));
      let current = needsState ? await ctx.tapoControl('state', {}) : null;
      if (current && current.ok === false) throw new Error(current.error || 'Não consegui consultar a lâmpada.');
      for (const item of command.actions) {
        if (item.action === 'brightness-step') {
          const base = Number(current?.brightness);
          const brightness = Math.max(1, Math.min(100, (Number.isFinite(base) ? base : 50) + Number(item.args.step || 0)));
          current = await ctx.tapoControl('brightness', { brightness });
        } else if (item.action === 'color') {
          const brightness = item.args.brightness == null ? Math.max(1, Math.min(100, Number(current?.brightness) || 100)) : item.args.brightness;
          current = await ctx.tapoControl('color', { ...item.args, brightness });
        } else {
          current = await ctx.tapoControl(item.action, item.args || {});
        }
        if (!current || current.ok === false) throw new Error(current?.error || 'A lâmpada não confirmou a alteração.');
      }
      return finish({ text:command.say, emotion:'happy', emote:'nod' }, { userText });
    } catch (error) {
      const detail = String(error?.message || error || 'Falha ao controlar a lâmpada.').slice(0,220);
      const unconfigured = /configure|credenciais|senha|conta tp.link|conta tapo/i.test(detail);
      if (command.soft && unconfigured) return false; // quem não configurou a Tapo não deve ser empurrado para o Smart Home
      if (unconfigured && typeof ctx.openSmartHome === 'function') ctx.openSmartHome();
      return finish({ text:unconfigured ? 'Para eu controlar a L530E por voz, configure primeiro sua conta Tapo na aba Conectividade, em MASORI Smart Home. Já abri essa área.' : `Não consegui controlar a lâmpada Tapo: ${detail}`, emotion:'sad' }, { userText });
    }
  }

  // ----- timer -----
  function startTimer(userText, ms) {
    if (ms < 1000) return reply({ text: 'Esse tempo é curto demais. Tente pelo menos 1 segundo.', emotion: 'neutral' }, { userText });
    if (ms > MAX_TIMER_MS) return reply({ text: 'Eu marco timers de até 24 horas. Para mais que isso, use a agenda.', emotion: 'neutral' }, { userText });
    const label = V.durationText(ms);
    agenda.add({ title: `Timer de ${label}`, at: new Date(now().getTime() + ms), allDay: false });
    agendaChanged();
    // além da checagem a cada 15 s, acorda no instante exato
    const h = setTimeout(() => { timerHandles.delete(h); agendaTick(); }, Math.min(ms + 300, 2147483000));
    if (h.unref) h.unref();
    timerHandles.add(h);
    return reply({ text: pickOf([`Timer de ${label} começou!`, `Pode deixar, te aviso em ${label}.`]), emotion: 'happy', emote: rnd() < 0.5 ? 'nod' : null }, { userText });
  }

  // ----- processa uma frase (já transcrita) -----
  async function handle(text, { force = false, ms = null } = {}) {
    const s = S();
    text = String(text || '').trim();
    if (V.isNoise(text)) return;
    if (!force && isEcho(text)) { emit({ type: 'heard', text, accepted: false, called: false, ms, echo: true }); return; }
    const w = V.findWake(text, s.convWake, s.convAliases);
    const body = w.called ? w.rest : text;
    const intent = V.parseIntent(body, { lib: ctx.library ? ctx.library() : null });
    // Com um vídeo/música tocando, o microfone capta o áudio do próprio YouTube: um trecho solto como "passa" ou "pula"
    // virava "próxima música". Pular/pausar só vale quando ela é chamada pelo nome (ou o pedido é digitado).
    const mediaKey = intent.type === 'pc' && MEDIA_OPS.includes(intent.op);
    const accepted = (force || w.called || Date.now() < awakeUntil || s.convMode === 'always') && (!mediaKey || force || w.called);
    emit({ type: 'heard', text, accepted, called: w.called, ms });
    if (!accepted) return;
    const d = now();
    if (intent.type === 'stop') { pending = null; lead = ''; ctx.stopSpeak(); return status('idle'); }

    ctx.logToPanel({ role: 'user', text: body || text });
    const userText = body || text;
    lead = intent.lead ? V.greetShort(intent.lead, d) : ''; // "Bom dia!" + o pedido (com correção se o horário não bate)

    // resposta a uma pergunta que ela fez (o que anotar, qual apagar, confirmar)
    const p = pending;
    pending = null;
    if (p && Date.now() < p.until && intent.type !== 'bye') {
      if (p.kind === 'agenda-clear') {
        if (/\b(sim|pode|claro|quero|confirmo|isso|com certeza)\b/i.test(V.norm(userText)) && !/\b(nao|nunca|para|cancela|deixa)\b/.test(V.norm(userText))) {
          const n = agenda.clear();
          agendaChanged();
          return reply({ text: `Pronto, apaguei ${n} ${n === 1 ? 'item' : 'itens'} da agenda.`, emotion: 'neutral' }, { userText });
        }
        return reply({ text: 'Tudo bem, deixei a agenda como estava.', emotion: 'happy' }, { userText });
      }
      if (p.kind === 'pc-confirm') {
        if (YES_RE.test(V.norm(userText)) && !/\b(nao|nunca|para|cancela)\b/.test(V.norm(userText))) return doPc(userText, p.it, true);
        return reply({ text: 'Tudo bem, não fiz nada.', emotion: 'happy' }, { userText });
      }
      if (p.kind === 'play') {
        if (intent.type === 'play' && (intent.query || intent.random)) return doPlay(userText, intent); // "toque Evidências"
        if (!['bye', 'open', 'agenda-add', 'agenda-list', 'agenda-remove', 'agenda-clear', 'timer', 'greet', 'thanks', 'empty'].includes(intent.type)) {
          const a = V.mediaAnswer(userText);
          return doPlay(userText, { media: p.media, query: a.query, random: a.random, where: a.where || p.where });
        }
      }
      if (p.kind === 'timer' && (intent.type === 'chat' || intent.type === 'timer')) {
        const ms = intent.ms || V.durationMs(userText, true);
        if (ms) return startTimer(userText, ms);
        return reply({ text: 'Não entendi o tempo. Diga algo como “10 minutos”.', emotion: 'neutral' }, { userText });
      }
      if (p.kind === 'agenda-add' && (intent.type === 'chat' || intent.type === 'agenda-add')) return agendaAdd(userText, userText);
      if (p.kind === 'agenda-remove' && intent.type === 'chat') return agendaRemove(userText, userText, true);
    }


    // Ações de iluminação vêm antes da conversa genérica para manter os comandos previsíveis.
    if (await handleTapoVoice(userText)) return;

    // Fluxo Bluetooth: lista dispositivos clássicos reconhecidos pelo Windows + anúncios BLE,
    // abre uma janela numerada e exige confirmação verbal antes de iniciar o fluxo de conexão.
    const startBluetoothDiscovery = async () => {
      if (!ctx.hubBluetoothScan) return reply({ text:'A central Bluetooth ainda não está disponível nesta sessão.', emotion:'sad' }, { userText });
      status('thinking');
      let result;
      try { result = await ctx.hubBluetoothScan(); }
      catch (error) { return reply({ text:`Não consegui consultar o Bluetooth do Windows: ${String(error?.message || error).slice(0,180)}`, emotion:'sad' }, { userText }); }
      const devices = (Array.isArray(result?.devices) ? result.devices : Array.isArray(result?.bluetooth) ? result.bluetooth : []).slice(0,12);
      if (!devices.length) {
        const detail = result?.error || result?.bleError || '';
        if (ctx.openBluetoothPicker) ctx.openBluetoothPicker({ stage:'empty', devices:[], message:detail || 'Nenhum dispositivo foi encontrado. Verifique se está ligado ou em modo de pareamento.' });
        return reply({ text:detail ? `Não encontrei dispositivos. O Windows informou: ${detail}` : 'Não encontrei dispositivos Bluetooth agora. Vou deixar a janela aberta para você tentar novamente. Ligue o dispositivo ou coloque-o em modo de pareamento.', emotion:'neutral' }, { userText });
      }
      pending = { kind:'bluetooth-device-select', devices, until:Date.now()+60000 };
      if (ctx.openBluetoothPicker) ctx.openBluetoothPicker({ stage:'list', devices, total:devices.length, message:`${devices.length} dispositivo(s) encontrado(s). Diga o número ou clique em um deles.` });
      // A Yoru só informa a quantidade; os nomes ficam na janela e ela só fala o que for selecionado.
      return reply({ text:devices.length === 1 ? 'Encontrei 1 dispositivo Bluetooth.' : `Encontrei ${devices.length} dispositivos Bluetooth.`, emotion:'happy' }, { userText });
    };

    if (p && Date.now() < p.until && p.kind === 'bluetooth-transport') {
      const answer=V.norm(userText);
      if (/\b(bluetooth)\b/.test(answer)) return startBluetoothDiscovery();
      if (/\b(wi fi|wifi|wireless)\b/.test(answer)) return reply({ text:'Wi-Fi fica na central Conectividade. Posso abrir essa área para você.', emotion:'neutral' }, { userText });
      pending={kind:'bluetooth-transport',until:Date.now()+30000};
      return reply({text:'Responda Wi-Fi ou Bluetooth para eu abrir a central certa.',emotion:'neutral'}, { userText });
    }

    if (p && Date.now() < p.until && p.kind === 'bluetooth-device') return startBluetoothDiscovery();

    if (p && Date.now() < p.until && p.kind === 'bluetooth-device-select') {
      const answer = V.norm(userText);
      if (/\b(cancelar|cancela|deixa|nao|parar|fecha)\b/.test(answer)) {
        pending = null;
        if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'cancelled', message:'Seleção cancelada.' });
        return reply({ text:'Tudo bem, cancelei a seleção Bluetooth.', emotion:'happy' }, { userText });
      }
      if (/\b(buscar|busca|procurar|procura|atualizar|atualiza|nova busca|de novo)\b/.test(answer)) return startBluetoothDiscovery();
      const index = parseBluetoothIndex(answer, p.devices.length);
      const selected = index >= 0 ? p.devices[index] : findBluetoothDeviceByName(answer, p.devices);
      if (!selected) {
        pending = { ...p, until:Date.now()+60000 };
        return reply({ text:'Não identifiquei o dispositivo. Diga o número da lista, por exemplo “o 2”, ou o nome dele.', emotion:'neutral' }, { userText });
      }
      pending = { kind:'bluetooth-device-confirm', device:selected, until:Date.now()+45000 };
      if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'confirm', device:selected, message:`Você escolheu ${selected.FriendlyName || 'o dispositivo'}. Confirma o pareamento?` });
      return reply({ text:`Você escolheu ${selected.FriendlyName || 'esse dispositivo'}. Quer que eu pareie agora? O dispositivo precisa estar em modo de pareamento. Diga sim ou não.`, emotion:'happy' }, { userText });
    }

    if (p && Date.now() < p.until && p.kind === 'bluetooth-device-confirm') {
      const answer = V.norm(userText);
      if (/\b(nao|não|nunca|cancela|cancelar|deixa|volta)\b/.test(answer) || !YES_RE.test(answer)) {
        pending = null;
        if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'cancelled', message:'Pareamento cancelado. Nenhuma alteração foi feita.' });
        return reply({ text:'Tudo bem. Não iniciei o pareamento.', emotion:'happy' }, { userText });
      }
      const device = p.device;
      try {
        if (!ctx.bluetoothConnect) throw new Error('A conexão Bluetooth não está disponível nesta sessão.');
        reply({ text:`Pareando ${device.FriendlyName || 'o dispositivo'}… pode levar alguns segundos.`, emotion:'happy' }, { userText });
        status('thinking');
        const result = await ctx.bluetoothConnect(device);
        pending = null;
        if (!result?.ok) throw new Error(result?.error || 'O Windows não confirmou a solicitação de conexão.');
        const label = device.FriendlyName || 'o dispositivo';
        if (result.paired && result.connected === false) {
          const dev = { ...device, Address: result.address || device.Address };
          pending = { kind:'bluetooth-connect-confirm', device:dev, until:Date.now()+45000 };
          if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'confirm', device:dev, message:`${label} está pareado, mas não conectado. Quer conectar agora?` });
          return reply({ text:`${label} está pareado, mas não está conectado. Quer que eu conecte agora? Diga sim ou não.`, emotion:'happy' }, { userText });
        }
        if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'result', device, message:result.message || `Pareamento de ${label} concluído.` });
        return reply({ text: result.paired ? (result.connected ? `Pronto! ${label} está pareado e conectado.` : `Pronto! Pareei ${label}.`) : `${label} precisa de uma confirmação no Windows. Abri o Bluetooth do sistema para você concluir.`, emotion:'happy' }, { userText });
      } catch (error) {
        pending = null;
        if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'error', device, message:String(error?.message || error) });
        return reply({ text:`Não consegui parear ${device.FriendlyName || 'o dispositivo'}: ${String(error?.message || error).slice(0,180)}`, emotion:'sad' }, { userText });
      }
    }

    if (p && Date.now() < p.until && p.kind === 'bluetooth-connect-confirm') {
      const answer = V.norm(userText);
      const device = p.device; const label = device.FriendlyName || 'o dispositivo';
      pending = null;
      if (/\b(nao|nunca|cancela|cancelar|deixa|volta)\b/.test(answer) || !YES_RE.test(answer)) {
        if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'result', device, message:`${label} ficou pareado, sem conectar.` });
        return reply({ text:`Tudo bem. ${label} ficou pareado, mas não conectado.`, emotion:'happy' }, { userText });
      }
      try {
        if (!ctx.bluetoothConnectNow) throw new Error('A conexão Bluetooth não está disponível nesta sessão.');
        status('thinking');
        const r = await ctx.bluetoothConnectNow(device);
        if (!r?.ok || !r.connected) throw new Error(r?.error || 'O Windows não confirmou a conexão.');
        if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'result', device, message:r.message || `${label} conectado.` });
        return reply({ text:`Pronto! ${label} está conectado.`, emotion:'happy' }, { userText });
      } catch (error) {
        if (ctx.updateBluetoothPicker) ctx.updateBluetoothPicker({ stage:'error', device, message:String(error?.message || error) });
        return reply({ text:`Não consegui conectar ${label}: ${String(error?.message || error).slice(0,180)}`, emotion:'sad' }, { userText });
      }
    }

    // Se o pedido já cita Bluetooth, começa a busca sem perguntar novamente se é Wi-Fi ou Bluetooth.
    if (/\b(bluetooth)\b/.test(V.norm(userText)) && /\b(mostra|mostre|lista|listar|buscar|busca|procurar|encontra|encontrar|dispositivo|conectar|conecte|parear|pareamento|abrir|abre)\b/.test(V.norm(userText))) return startBluetoothDiscovery();
    if (/\b(bluetooth|dispositivos bluetooth)\b/.test(V.norm(userText)) && !(p && ['bluetooth-transport','bluetooth-device','bluetooth-device-select','bluetooth-device-confirm','bluetooth-connect-confirm'].includes(p.kind))) return startBluetoothDiscovery();

    if (/\b(mostra|mostre|abr[ae]|abrir|conectar|conecte|gerenciar|controle)\b/.test(V.norm(userText)) && /\b(dispositivo|dispositivos)\b/.test(V.norm(userText)) && !(p && ['bluetooth-transport','bluetooth-device','bluetooth-device-select','bluetooth-device-confirm','bluetooth-connect-confirm'].includes(p.kind))) {
      pending={kind:'bluetooth-transport',until:Date.now()+30000};
      return reply({text:'Você quer acessar os dispositivos Wi-Fi ou Bluetooth?',emotion:'happy'}, { userText });
    }


    switch (intent.type) {
      case 'weather':
        return doWeather(userText, body || text);

      case 'agenda-add':
        return agendaAdd(userText, body || text);
      case 'agenda-list':
        return agendaList(userText, body || text);
      case 'agenda-remove':
        return agendaRemove(userText, body || text);
      case 'agenda-clear':
        return agendaClear(userText);

      case 'empty':
        return reply(V.ackLine(rnd));

      case 'greet':
        return reply(V.greetReply(intent.kind, d, rnd, intent.howru), { userText });
      case 'howru':
        return reply(V.howruLine(rnd), { userText });
      case 'thanks':
        return reply(V.thanksLine(rnd), { userText });
      case 'who':
        return reply(V.whoLine(s.convWake), { userText });
      case 'help':
        return reply(V.helpLine(), { userText });
      case 'joke':
        return reply(V.jokeLine(rnd), { userText });
      case 'coin':
        return reply(V.coinLine(rnd), { userText });
      case 'avatar-move': {
        const moved = typeof ctx.moveAvatar === 'function' && ctx.moveAvatar(intent.direction);
        const side = intent.direction === 'left' ? 'esquerda' : 'direita';
        return reply({ text: moved ? `Claro! Vou para a ${side} para liberar seu caminho.` : 'Não consegui me deslocar agora. Tente novamente em um instante.', emotion: moved ? 'happy' : 'neutral', emote: moved ? 'nod' : null }, { userText });
      }
      case 'pose':
        return reply(V.poseLine(intent, rnd), { userText });
      case 'app': { // tema, cor, avatar, item na mão
        const r = ctx.appAction ? ctx.appAction(intent) : { ok: false, say: 'Ainda não sei mexer nisso aqui.' };
        return reply({ text: r.say, emotion: r.ok ? 'happy' : 'neutral', emote: r.ok && rnd() < 0.35 ? 'nod' : null }, { userText });
      }

      case 'number': {
        const n = intent.min + Math.floor(rnd() * (intent.max - intent.min + 1));
        return reply({ text: `Sorteei o número ${n}, entre ${intent.min} e ${intent.max}.`, emotion: 'happy', emote: null }, { userText });
      }

      case 'math': {
        if (intent.error === 'div0') return reply({ text: 'Dividir por zero? Nem eu consigo isso.', emotion: 'surprised', emote: 'shake' }, { userText });
        const r = intent.text;
        return reply({ text: pickOf([`Dá ${r}!`, `${r}. Fácil!`, `O resultado é ${r}.`]), emotion: 'happy', emote: rnd() < 0.3 ? 'nod' : null }, { userText });
      }

      case 'timer': {
        if (!intent.ms) {
          pending = { kind: 'timer', until: Date.now() + 30000 };
          return reply({ text: 'Quanto tempo? Por exemplo: 10 minutos.', emotion: 'neutral' }, { userText });
        }
        return startTimer(userText, intent.ms);
      }

      case 'play':
        return doPlay(userText, intent);

      case 'bye': {
        reply(V.byeLine(rnd), { userText });
        awakeUntil = 0; // volta a precisar do nome
        return status('idle'); // reenvia o estado, agora "dormindo"

      }

      case 'time': {
        let txt = V.timeText(d);
        let emotion = 'neutral', emote = null;
        if (s.convComments && V.shouldComment(d.getHours(), rnd)) {
          const c = V.timeComment(d.getHours(), rnd);
          txt += ' ' + c.text;
          emotion = c.emotion; emote = c.emote;
        }
        return reply({ text: txt, emotion, emote }, { userText });
      }

      case 'date':
        return reply({ text: V.dateText(d), emotion: 'happy' }, { userText });

      case 'dice': {
        status('thinking');
        ctx.rollDice(!!s.convSpeak); // ela mesma anuncia o resultado quando os dados param
        ctx.remember(userText, 'Rolei os dados.');
        awakeUntil = Date.now() + s.convFollow * 1000 + 6000;
        return status('idle');
      }

      case 'news':
        return doNews(userText);

      case 'open': {
        if (!s.convPcActions) return reply({ text: 'Abrir programas e sites está desligado nas configurações da conversa.', emotion: 'neutral' }, { userText });
        const ok = intent.app ? launchApp(intent.app) : (ctx.openExternal(intent.url), true);
        return reply(ok
          ? { text: pickOf(['Abrindo ' + intent.label + '!', 'Pronto, abrindo ' + intent.label + '.']), emotion: 'happy', emote: rnd() < 0.5 ? 'nod' : null }
          : { text: 'Não consegui abrir ' + intent.label + ' neste computador.', emotion: 'sad' }, { userText });
      }

      case 'pc':
        return doPc(userText, intent);

      case 'open-unknown':
        if (intent.target && s.convPcActions && pc.supported) { // programa instalado que ela não conhecia: procura no menu Iniciar
          status('thinking');
          const l = await pc.launch(intent.target);
          return reply(l.ok ? { text: `Abrindo ${l.name}!`, emotion: 'happy', emote: 'nod' } : { text: `Não achei ${intent.target} nos programas instalados.`, emotion: 'sad' }, { userText });
        }
        return reply({ text: intent.target ? `Ainda não sei abrir ${intent.target}. Posso abrir o navegador, YouTube, Gmail, WhatsApp, Maps e outros.` : 'O que você quer que eu abra?', emotion: 'neutral' }, { userText });

      case 'search': {
        if (!s.convPcActions) return reply({ text: 'Abrir o navegador está desligado nas configurações da conversa.', emotion: 'neutral' }, { userText });
        const q = encodeURIComponent(intent.query);
        ctx.openExternal(intent.where === 'youtube'
          ? `https://www.youtube.com/results?search_query=${q}`
          : `https://www.google.com/search?q=${q}`);
        return reply({ text: `Pesquisando ${intent.query} ${intent.where === 'youtube' ? 'no YouTube' : 'no Google'}!`, emotion: 'happy' }, { userText });
      }

      default: { // conversa normal com a IA
        status('thinking');
        const res = await ctx.askAI(userText, { voice: true });
        if (res.ok) return reply(res);
        return fail(res.text);
      }
    }
  }
  const pickOf = (a) => a[Math.floor(rnd() * a.length) % a.length];

  // fila: uma frase por vez, na ordem em que foram faladas
  function enqueue(fn, urgent = false) {
    if (queued >= 3 && !urgent) { emit({ type: 'error', text: 'A fila de voz está ocupada. Aguarde a transcrição atual terminar e tente novamente.' }); return Promise.resolve(); }
    queued++;
    const run = chain.then(fn).catch((e) => fail(String((e && e.message) || e))).finally(() => { queued--; });
    chain = run;
    return run;
  }

  // áudio vindo do painel (Float32Array 16 kHz mono)
  function toFloat32(a) {
    if (a instanceof Float32Array) return a;
    if (ArrayBuffer.isView(a)) {
      const u8 = new Uint8Array(a.byteLength);
      u8.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
      return new Float32Array(u8.buffer);
    }
    if (a instanceof ArrayBuffer) return new Float32Array(a.slice(0));
    return new Float32Array(0);
  }

  // libera o Whisper da memória quando fica muito tempo sem uso (a próxima fala recarrega o modelo)
  let lastSttUse = Date.now();
  const unloadTimer = setInterval(() => {
    const min = Number(S().sttUnloadMin) || 0;
    // não descarrega no meio de um download/carga do modelo (modelPct !== null), senão a carga é derrubada
    if (min > 0 && stt.worker && queued === 0 && modelPct === null && Date.now() - lastSttUse > min * 60000) {
      stt.dispose();
      emit({ type: 'model', pct: null, unloaded: true });
    }
  }, 30000);
  if (unloadTimer.unref) unloadTimer.unref();
  // muda o número de núcleos: reinicia a thread do Whisper (e já carrega de novo se a escuta está ligada)
  function reloadStt() {
    if (!stt.worker) return;
    stt.dispose();
    if (S().convListening) prepare().catch(() => {});
  }

  // trocou o modelo na aba Conversa. Com a escuta ligada, o painel já pede o preparo do novo (e a thread
  // libera o antigo). Com a escuta desligada, só libera o antigo da memória: o novo carrega quando ela ligar.
  function modelChanged() {
    if (S().convListening) return;
    if (stt.worker && queued === 0 && modelPct === null) {
      stt.dispose();
      emit({ type: 'model', pct: null, unloaded: true });
    }
  }

  const IDLE_MAX_S = 6; // dormindo: o nome vem no começo da frase, então só os primeiros 6 s bastam (menos texto para decodificar)
  function onAudio(raw, force = false) {
    let audio = toFloat32(raw);
    if (audio.length > 16000 * 90) { emit({ type: 'error', text: 'O trecho de áudio passou de 90 segundos e foi descartado para proteger a memória.' }); return Promise.resolve({ ok: false }); }
    if (audio.length < 16000 * 0.2) return Promise.resolve({ ok: true, text: '' });
    const listeningForName = !force && S().convMode !== 'always' && Date.now() >= awakeUntil;
    let full = null; // fala completa, para quando o nome aparece nos primeiros segundos
    if (listeningForName && audio.length > 16000 * IDLE_MAX_S) { full = audio; audio = audio.subarray(0, 16000 * IDLE_MAX_S); }
    return enqueue(async () => {
      status('transcribing');
      let text;
      const t0 = Date.now();
      try {
        lastSttUse = Date.now();
        text = await stt.transcribe(audio, model());
        if (full && V.findWake(text, S().convWake, S().convAliases).called) text = await stt.transcribe(full, model()); // o pedido não pode ser cortado
        lastSttUse = Date.now();
      } catch (e) {
        emit({ type: 'error', text: 'Reconhecimento de voz: ' + String((e && e.message) || e) });
        status('idle');
        return { ok: false };
      }
      status('idle');
      await handle(text, { force, ms: Date.now() - t0 });
      return { ok: true, text };
    }, force);
  }

  // duas palmas: acorda (conversa sem precisar do nome) e avisa com uma fala curta. Vale no modo "só quando chamar"
  // e no "sempre ouvindo" (neste ela já ouve tudo, mas responde ao chamado e cancela o que estava pendente).
  const CLAP_REPLIES = [
    'Oi? Pode falar!', 'Pois não?', 'Tô aqui!', 'Fala comigo!', 'Chamou? Tô aqui!',
    'Ouvi as palmas! O que foi?', 'Palminhas! Pode falar.', 'Opa, me chamou?', 'Pode mandar!', 'Tô ouvindo, diga!',
    'Presente!', 'Sim? O que você precisa?', 'Eita, ouvi! Pode falar.', 'Às ordens!', 'Oi, oi! Tô de ouvidos abertos.',
    'Acordei! O que vamos fazer?', 'Diga lá!', 'Quem chamou? Ah, foi você!', 'Pronta! Pode pedir.', 'Fala que eu escuto!',
    'Tô na escuta!', 'Opa! Qual é o plano?', 'Pode falar, tô prontinha.', 'Oi! Em que posso ajudar?'
  ];
  let lastClapAt = 0, lastClapReply = -1; // não repete a mesma fala duas vezes seguidas
  function clap() {
    if (S().convClap === false || !S().convListening || speaking) return Promise.resolve({ ok: false });
    if (Date.now() - lastClapAt < 2000) return Promise.resolve({ ok: false });
    lastClapAt = Date.now();
    return enqueue(async () => {
      pending = null;
      let ci = Math.floor(rnd() * CLAP_REPLIES.length) % CLAP_REPLIES.length;
      if (ci === lastClapReply) ci = (ci + 1) % CLAP_REPLIES.length;
      lastClapReply = ci;
      reply({ text: CLAP_REPLIES[ci], emotion: 'happy', emote: 'wave' });
      return { ok: true };
    }, true);
  }

  function typed(text) {
    return enqueue(() => handle(text, { force: true }), true);
  }

  // Chat digitado: pedidos que ela resolve sozinha (hora, abrir site, timer, volume...) não precisam esperar a IA.
  // Devolve true se tratou (a resposta sai pelo avatar); false se é conversa normal e deve seguir para a IA.
  function tryLocal(text) {
    text = String(text || '').trim();
    if (!text) return false;
    const s = S();
    const w = V.findWake(text, s.convWake, s.convAliases);
    const intent = V.parseIntent(w.called ? w.rest : text, { lib: ctx.library ? ctx.library() : null });
    const waiting = !!(pending && Date.now() < pending.until); // ela fez uma pergunta e espera a resposta
    if (intent.type === 'chat' && !waiting) return false;
    typed(text);
    return true;
  }

  function prepare() {
    lastSttUse = Date.now();
    return stt.prepare(model()).then(() => ({ ok: true }), (e) => {
      const msg = String((e && e.message) || e);
      const hint = /Cannot find (package|module)/i.test(msg) ? ' Rode "npm install" na pasta do app.'
        : /ERR_DLOPEN_FAILED|not a valid Win32|runtime/i.test(msg) ? ' Um arquivo instalado está corrompido ou é de outra arquitetura: apague a pasta node_modules, rode "npm install" de novo e depois "npm run check".'
        : '';
      const netFail = /Sem conexão estável|ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|fetch failed|network|offline|stalled|timed? ?out/i.test(msg);
      emit({ type: 'error', text: 'Não consegui carregar o modelo de voz: ' + msg.slice(0, 220) + hint + (netFail && modelAutoRetries < 5 ? ' Vou tentar de novo sozinha em 1 minuto.' : '') });
      emit({ type: 'model', pct: null, failed: true });
      // falha de rede: tenta de novo sozinha (até 5 vezes) em vez de deixar a voz parada até reiniciar o app
      if (netFail && modelAutoRetries < 5) {
        modelAutoRetries++;
        const h = setTimeout(() => { timerHandles.delete(h); if (S().convListening) prepare().catch(() => {}); }, 60000);
        if (h.unref) h.unref();
        timerHandles.add(h);
      }
      return { ok: false, error: msg };
    });
  }

  // o avatar avisa quando começa/termina de falar (para o microfone não ouvir a própria voz dela)
  function speakingState(on) {
    speaking = !!on;
    if (!speaking) lastSaid.at = Date.now(); // a cauda do eco conta a partir do fim da fala, não do início da resposta
    emit({ type: 'speaking', on: speaking });
    if (!speaking && Date.now() < awakeUntil + 60000) {
      awakeUntil = Math.max(awakeUntil, Date.now() + S().convFollow * 1000); // a contagem recomeça quando ela termina de falar
      status('idle');
    }
  }

  // ----- falas espontâneas (opcional) -----
  // Configuradas na aba Comportamento: tipos de fala, intervalo (min–max, em minutos) e "só se eu estiver parado".
  let lastChatterKind = null, lastChatterText = '', chatterSig = '';
  const chatterRange = () => {
    const s = S();
    const a = Math.max(1, Number(s.chatterMin) || 25);
    return [a, Math.max(a, Number(s.chatterMax) || 60)];
  };
  const chatterDelay = () => { const [a, b] = chatterRange(); return (a + rnd() * (b - a)) * 60000; };
  const chatterKinds = () => {
    const s = S();
    return {
      checkin: s.chatterCheckin !== false, time: s.chatterTime !== false, sleep: s.chatterSleep !== false, talk: s.chatterTalk !== false, care: s.chatterCare !== false,
      sulk: s.chatterSulk !== false,
      smash: s.chatterSmash !== false && typeof ctx.smash === 'function', // sem o efeito de tela (testes) não sorteia o soco
      custom: V.parseCustomLines(s.chatterCustom).length > 0,
    };
  };
  // o soco só acontece depois que ela termina de falar (ou após ~2 s se a voz estiver desligada)
  function smashAfterSpeech() {
    let started = false, tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (speaking) started = true;
      const voiceOff = !S().convSpeak && tries >= 8;
      if ((started && !speaking) || voiceOff || tries > 60 || (!started && tries > 16)) { clearInterval(iv); try { ctx.smash(); } catch (_) { /* efeito é só enfeite */ } }
    }, 250);
    if (iv.unref) iv.unref();
  }
  // horário de silêncio (ex.: 23h–7h): nada de falas espontâneas
  const isQuiet = (s, h) => {
    if (!s.chatterQuiet) return false;
    const a = Number.isFinite(Number(s.chatterQuietFrom)) ? Number(s.chatterQuietFrom) : 23;
    const b = Number.isFinite(Number(s.chatterQuietTo)) ? Number(s.chatterQuietTo) : 7;
    if (a === b) return false;
    return a < b ? h >= a && h < b : h >= a || h < b;
  };
  // fala uma frase agora; false = nenhum tipo de fala está ligado
  function chatterSay() {
    const d = now();
    const kinds = chatterKinds();
    let kind = V.pickChatterKind(kinds, d.getHours(), rnd, lastChatterKind);
    if (!kind) return false;
    // o soco só acontece na "chance" escolhida; fora dela sorteia outro tipo (se não houver outro, solta o soco mesmo)
    if (kind === 'smash') {
      const chance = Number.isFinite(Number(S().chatterSmashChance)) ? Number(S().chatterSmashChance) : 50;
      if (rnd() * 100 >= chance) kind = V.pickChatterKind({ ...kinds, smash: false }, d.getHours(), rnd, lastChatterKind) || 'smash';
    }
    const r = V.chatterLine(kind, d, rnd, lastChatterText, V.parseCustomLines(S().chatterCustom));
    lastChatterKind = kind; lastChatterText = r.text;
    reply(r);
    if (r.smash && typeof ctx.smash === 'function') smashAfterSpeech();
    return true;
  }
  // botão "Falar agora" do painel: funciona mesmo com as falas periódicas desligadas (serve de teste)
  function chatterNow() {
    const ok = chatterSay();
    if (ok && S().convChatter) nextChatterAt = Date.now() + chatterDelay();
    return ok;
  }
  let lastHourSaid = -1;
  function hourlyTick() {
    const s = S();
    if (!s.chatterHourly || s.visible === false || speaking || queued > 0) return;
    const d = now();
    if (d.getMinutes() > 1 || isQuiet(s, d.getHours())) return;
    const key = d.getFullYear() * 1e6 + d.getMonth() * 1e4 + d.getDate() * 100 + d.getHours();
    if (key === lastHourSaid) return;
    lastHourSaid = key;
    reply(V.chatterLine('time', d, rnd, ''));
  }
  function chatterTick() {
    const s = S();
    hourlyTick();
    if (!s.convChatter) { nextChatterAt = 0; chatterSig = ''; return; }
    const t = Date.now();
    const sig = chatterRange().join('|');
    if (!nextChatterAt || sig !== chatterSig) { chatterSig = sig; nextChatterAt = t + chatterDelay(); return; } // (re)agenda ao ligar ou mudar o intervalo
    if (t < nextChatterAt || speaking || queued > 0) return;
    if (s.visible === false) return;                                  // avatar escondido: não fala sozinha
    if (isQuiet(s, now().getHours())) return;                         // horário de silêncio
    const idleMin = Number(s.chatterIdleMin) || 0;
    if (idleMin > 0 && ctx.idleSeconds && ctx.idleSeconds() < idleMin * 60) return; // você está usando o PC: espera ficar parado
    nextChatterAt = t + chatterDelay();
    chatterSay();
  }
  const chatterTimer = setInterval(chatterTick, 30000);
  if (chatterTimer.unref) chatterTimer.unref();
  const agendaTimer = setInterval(agendaTick, 15000);
  if (agendaTimer.unref) agendaTimer.unref();

  // usados pelo painel (lista da agenda)
  const agendaList_ = () => agenda.all().map((x) => ({ id: x.id, title: x.title, when: A.whenText(x, now()), past: !!(x.at && !x.allDay && new Date(x.at) < now()) }));
  const agendaRemove_ = (id) => { const ok = agenda.remove(String(id)); agendaChanged(); return ok; };
  const agendaAddText = (text) => {
    const ev = A.parseEvent(text, now());
    if (!ev.title) return { ok: false };
    const item = agenda.add(ev);
    agendaChanged();
    return { ok: true, when: A.whenText(item, now()) };
  };

  return {
    handle, typed, tryLocal, onAudio, prepare, reloadStt, modelChanged, clap, speakingState, chatterTick, chatterNow, agendaTick, say: (r) => reply(r),
    agendaList: agendaList_, agendaRemove: agendaRemove_, agendaAddText,
    isAwake: () => Date.now() < awakeUntil,
    modelProgress: () => modelPct,
    dispose() { clearInterval(chatterTimer); clearInterval(agendaTimer); clearInterval(unloadTimer); for (const h of timerHandles) clearTimeout(h); tapoCancelVoiceTimer(); if (stt.dispose) stt.dispose(); },
    _stt: stt,
  };
}

module.exports = { createVoice };
