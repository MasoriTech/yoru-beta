// Aba "Conversa" do painel: captura o microfone, corta em frases (vad.js) e manda para o app
// transcrever. Tudo que é decidido (nome, pedidos, respostas) acontece no processo principal.
(() => {
  'use strict';
  // O microfone fica em UMA janela: o painel principal, ou, no Float Dock (a janela principal é só a barra), a janela solo da Conversa.
  const qs = new URLSearchParams(location.search);
  if (qs.get('dockOnly') === '1') return;
  if (qs.get('solo') && qs.get('solo') !== 'conversa') return;
  const $ = (s) => document.querySelector(s);
  const { Segmenter, resample } = window.VAD;

  let S = {};                // configurações atuais
  let listening = false;     // microfone aberto
  let starting = false;
  let stream = null, ctx = null, srcNode = null, node = null, sink = null;
  let forceNext = false;     // "Falar agora": a próxima frase vale sem o nome
  let speaking = false;      // ela está falando (microfone fica mudo para não ouvir a própria voz)
  let mutedUntil = 0;
  let mainState = 'idle';    // idle | transcribing | thinking (vem do app)
  let awake = false;
  let modelPct = null;       // null = pronto/sem download
  let modelRetry = null;     // { n, max } quando o download está sendo repetido
  let lastModel = null;
  let prepSeq = 0;           // só o preparo mais recente mexe no "carregando" (trocas rápidas de modelo)
  let lastMic = null;
  let lastRms = 0, lastThr = 0, meterQueued = false;
  let recognizedCount = 0, latencyTotal = 0;

  const seg = new Segmenter({
    sensitivity: 3,
    onLevel: (rms, thr) => { lastRms = rms; lastThr = thr; if (rms > thr && !isMuted()) hearAt = performance.now(); pushOrb(); queueMeter(); },
    onClap: () => {
      if (isMuted() || S.convClap === false) return;
      const g = $('#convGesture');
      if (g) { g.classList.add('hit'); setTimeout(() => g.classList.remove('hit'), 600); } // pisca: "ouvi"
      panel.voiceClap().catch(() => {}); // duas palmas / dois estalos acordam ela
    },
    onSegment: (audio) => {
      const force = forceNext;
      forceNext = false;
      $('#convTalk').classList.remove('on');
      panel.voiceAudio(audio, force).catch(() => {});
    },
  });

  const isMuted = () => speaking || performance.now() < mutedUntil;

  // Bolinha no avatar que mostra se ela está ouvindo: off | listening | hearing (captando sua voz) | busy | muted (falando)
  let hearAt = 0, lastOrb = '';
  function pushOrb() {
    const ph = phase()[0];
    let st = 'listening';
    if (ph === 'off' || ph === 'loading') st = 'off';
    else if (ph === 'speaking') st = 'muted';
    else if (ph === 'busy') st = 'busy';
    else if (performance.now() - hearAt < 350) st = 'hearing';
    if (st === lastOrb) return;
    lastOrb = st;
    try { panel.action('voice-orb', st); } catch (_) { /* a bolinha é só um aviso visual */ }
  }

  // ----- interface -----
  let lastW = '', lastHot = false;
  function queueMeter() {
    if (meterQueued || document.hidden) return; // painel escondido: não gasta quadro à toa
    meterQueued = true;
    requestAnimationFrame(() => {
      meterQueued = false;
      const el = q('convLevel');
      if (!el) return;
      const lv = listening && !isMuted() ? Math.min(1, lastRms * 8) : 0;
      const w = Math.round(lv * 50) * 2 + '%'; // passos de 2%: sem repintar por diferenças invisíveis
      if (w !== lastW) { el.style.width = w; lastW = w; }
      const hot = lv > 0 && lastRms > lastThr;
      if (hot !== lastHot) { el.classList.toggle('hot', hot); lastHot = hot; }
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) queueMeter(); });

  function prepareModel() {
    const my = ++prepSeq;
    modelPct = 0;
    panel.voicePrepare().then((r) => { if (my === prepSeq && r && r.ok) modelPct = null; paint(); });
  }

  function phase() {
    if (starting) return ['loading', 'Abrindo o microfone...'];
    if (!listening) return ['off', 'Desligado'];
    if (modelPct !== null && modelRetry) return ['loading', `Conexão instável. Tentando baixar o modelo de novo (${modelRetry.n}/${modelRetry.max})...`];
    if (modelPct !== null) return ['loading', modelPct > 0 ? `Baixando o modelo de voz... ${modelPct}% (só na primeira vez)` : 'Carregando o modelo de voz...'];
    if (speaking) return ['speaking', 'Falando... (o microfone fica mudo enquanto ela fala)'];
    if (mainState === 'transcribing') return ['busy', 'Entendendo o que você disse...'];
    if (mainState === 'thinking') return ['busy', 'Pensando...'];
    if (forceNext) return ['hot', 'Pode falar!'];
    if (awake || S.convMode === 'always') return ['awake', S.convMode === 'always' ? 'Ouvindo tudo (não precisa chamar)' : 'Conversando — pode falar sem me chamar'];
    return ['on', `Ouvindo — me chame de "${S.convWake || 'Yoru'}"`];
  }

  // elementos buscados uma vez e DOM só mexe quando o valor muda (paint() roda a cada evento: progresso, status, fala...)
  const el$ = {};
  const q = (id) => el$[id] || (el$[id] = document.getElementById(id));
  let lastPh = null, lastText = null, lastBtn = null;
  function paint() {
    const [ph, text] = phase();
    const dot = q('convDot');
    if (!dot) return;
    if (ph !== lastPh) { dot.dataset.ph = ph; lastPh = ph; }
    if (text !== lastText) { q('convStateText').textContent = text; lastText = text; }
    const btn = listening || starting;
    if (btn !== lastBtn) {
      const t = q('convToggle');
      t.textContent = btn ? '⏹ Parar de ouvir' : '🎙️ Começar a ouvir';
      t.classList.toggle('primary', !btn);
      lastBtn = btn;
    }
    pushOrb();
    queueMeter();
  }

  const log = $('#convLog');
  function addLine(kind, text, ms) {
    if (!log) return;
    const empty = log.querySelector('.empty');
    if (empty) empty.remove();
    const d = document.createElement('div');
    d.className = 'msg conv-' + kind;
    d.textContent = (kind === 'ignored' ? '🙉 ' : kind === 'user' ? '🗣️ ' : kind === 'she' ? '💬 ' : '⚠️ ') + text;
    if (kind === 'ignored') d.title = 'Ela ouviu, mas não era com ela (faltou o nome, ou era o eco da própria voz)';
    if (ms != null) d.title = (d.title ? d.title + ' · ' : '') + 'reconhecido em ' + (ms / 1000).toFixed(1) + ' s';
    log.appendChild(d);
    while (log.children.length > 80) log.removeChild(log.firstChild);
    log.scrollTop = log.scrollHeight;
  }
  function showError(text) {
    const e = $('#convErr');
    e.textContent = text || '';
    e.className = 'status' + (text ? ' bad' : '');
  }

  // ----- microfones -----
  async function loadDevices() {
    const sel = $('#convMic');
    if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId);
      sel.innerHTML = '';
      sel.add(new Option('Padrão do sistema', ''));
      devs.forEach((d, i) => { if (d.deviceId !== 'default' && d.deviceId !== 'communications') sel.add(new Option(d.label || 'Microfone ' + (i + 1), d.deviceId)); });
      sel.value = S.convMic || '';
      if (sel.value !== (S.convMic || '')) sel.value = '';
    } catch (_) { /* sem lista: fica só o padrão */ }
  }
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', loadDevices);

  // ----- captura -----
  const WORKLET = `
    class Cap extends AudioWorkletProcessor {
      constructor() { super(); this.b = new Float32Array(640); this.n = 0; } // junta 40 ms antes de enviar (menos mensagens)
      process(inputs) {
        const c = inputs[0] && inputs[0][0];
        if (c) {
          for (let i = 0; i < c.length; i++) {
            this.b[this.n++] = c[i];
            if (this.n === this.b.length) { this.port.postMessage(this.b); this.b = new Float32Array(640); this.n = 0; }
          }
        }
        return true;
      }
    }
    registerProcessor('cap', Cap);`;

  // Interromper: enquanto ela fala o microfone fica mudo (para não ouvir a própria voz). Com a opção ligada, voz
  // MUITO alta e contínua (~0,4 s, bem acima do eco que o cancelamento do navegador deixa passar) faz ela parar.
  let loudMs = 0;
  let startToken = 0; // invalida aberturas assíncronas quando o usuário desliga rapidamente
  function bargeCheck(x) {
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    const rms = Math.sqrt(sum / (x.length || 1));
    loudMs = rms > 0.15 ? loudMs + (x.length / ctx.sampleRate) * 1000 : 0;
    if (loudMs >= 400) { loudMs = 0; panel.action('stop-speak'); }
  }

  function onSamples(x) {
    if (speaking && S.convBargeIn === true) bargeCheck(x); else loudMs = 0;
    if (isMuted()) { seg.reset(); lastRms = 0; queueMeter(); return; }
    seg.push(ctx.sampleRate === 16000 ? x : resample(x, ctx.sampleRate, 16000));
  }

  async function openStream() {
    const base = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true };
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: S.convMic ? { ...base, deviceId: { exact: S.convMic } } : base });
    } catch (e) {
      if (S.convMic && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
        return navigator.mediaDevices.getUserMedia({ audio: base }); // microfone escolhido sumiu: usa o padrão
      }
      throw e;
    }
  }

  async function start() {
    if (listening || starting) return;
    const token = ++startToken;
    starting = true;
    showError('');
    paint();
    try {
      const allowed = await panel.voiceMicAccess();
      if (token !== startToken) return;
      if (allowed === false) throw Object.assign(new Error('mac'), { name: 'NotAllowedError' });
      stream = await openStream();
      if (token !== startToken) { stream.getTracks().forEach((t) => t.stop()); stream = null; return; }
      try { ctx = new AudioContext({ sampleRate: 16000 }); } catch (_) { ctx = new AudioContext(); }
      ctx.resume().catch(() => {}); // sem await: se o navegador pedir gesto do usuário, não trava aqui
      srcNode = ctx.createMediaStreamSource(stream);
      sink = ctx.createGain();
      sink.gain.value = 0; // o nó precisa estar ligado à saída para o navegador processar, mas sem fazer barulho
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        try { await ctx.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        if (token !== startToken) { teardown(); return; }
        node = new AudioWorkletNode(ctx, 'cap', { numberOfOutputs: 1, outputChannelCount: [1] });
        node.port.onmessage = (e) => onSamples(e.data);
      } catch (_) {
        node = ctx.createScriptProcessor(2048, 1, 1); // plano B em navegadores sem AudioWorklet
        node.onaudioprocess = (e) => onSamples(new Float32Array(e.inputBuffer.getChannelData(0)));
      }
      if (token !== startToken) { teardown(); return; }
      srcNode.connect(node);
      node.connect(sink);
      sink.connect(ctx.destination);
      for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => { if (listening && token === startToken) { showError('O microfone foi desconectado.'); panel.set({ convListening: false }); } });
      listening = true;
      seg.reset();
      loadDevices();
      prepareModel();
    } catch (e) {
      teardown();
      const msg = e.name === 'NotAllowedError' || e.name === 'SecurityError'
        ? 'Sem permissão para usar o microfone. No Windows: Configurações › Privacidade e segurança › Microfone, e permita o acesso para apps de desktop. No Mac: Ajustes › Privacidade › Microfone.'
        : e.name === 'NotFoundError' ? 'Nenhum microfone encontrado. Conecte um e tente de novo.'
        : 'Não consegui abrir o microfone: ' + (e.message || e.name);
      showError(msg);
      panel.set({ convListening: false });
    } finally {
      starting = false;
      paint();
    }
  }

  function teardown() {
    startToken++; // qualquer await pendente em start() passa a ser obsoleto
    listening = false;
    forceNext = false;
    try { if (node) { node.disconnect(); if (node.port) node.port.onmessage = null; node.onaudioprocess = null; } } catch (_) {}
    try { if (srcNode) srcNode.disconnect(); } catch (_) {}
    try { if (sink) sink.disconnect(); } catch (_) {}
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    try { if (ctx) ctx.close(); } catch (_) {}
    node = srcNode = sink = stream = ctx = null;
    seg.reset();
    lastRms = 0;
    modelPct = null;
  }
  function stop() { starting = false; teardown(); paint(); }

  // ----- botões -----
  $('#convToggle').addEventListener('click', () => panel.set({ convListening: !(listening || starting) }));
  $('#convTalk').addEventListener('click', () => {
    forceNext = true;
    $('#convTalk').classList.add('on');
    if (!listening && !starting) panel.set({ convListening: true });
    paint();
  });
  $('#convGesture').addEventListener('click', () => panel.set({ convClap: S.convClap === false }));
  $('#convStop').addEventListener('click', () => panel.action('stop-speak'));
  const sendTyped = () => {
    const inp = $('#convType');
    const t = inp.value.trim();
    if (!t) return;
    inp.value = '';
    panel.voiceText(t);
  };
  $('#convTypeBtn').addEventListener('click', sendTyped);
  $('#convType').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTyped(); });
  $('#convClear').addEventListener('click', () => { log.innerHTML = '<div class="empty">Nada por aqui ainda.</div>'; });


  // ----- agenda (lista no painel) -----
  let agendaSig = null;
  async function renderAgenda() {
    const box = $('#agendaList');
    if (!box || !panel.agendaList) return;
    let items = [];
    try { items = await panel.agendaList(); } catch (_) {}
    const sig = JSON.stringify(items);
    if (sig === agendaSig) return; // nada mudou: não refaz a lista
    agendaSig = sig;
    box.innerHTML = '';
    if (!items.length) { box.innerHTML = '<div class="ag-empty">Nenhum compromisso ainda.</div>'; return; }
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'ag-item' + (it.past ? ' past' : '');
      const t = document.createElement('span'); t.className = 'ag-title'; t.textContent = it.title;
      const w = document.createElement('span'); w.className = 'ag-when'; w.textContent = it.when;
      const x = document.createElement('button'); x.className = 'ag-del'; x.textContent = '✕'; x.title = 'Apagar';
      x.addEventListener('click', async () => { await panel.agendaRemove(it.id); renderAgenda(); });
      row.append(t, w, x);
      box.appendChild(row);
    }
  }
  async function addAgenda() {
    const inp = $('#agendaInput'), msg = $('#agendaMsg');
    const t = inp.value.trim();
    if (!t) return;
    const r = await panel.agendaAdd(t);
    if (r && r.ok) { inp.value = ''; msg.className = 'status'; msg.textContent = 'Anotado: ' + r.when + '.'; }
    else { msg.className = 'status bad'; msg.textContent = 'Não entendi o que anotar. Escreva, por exemplo: dentista amanhã às 15h.'; }
    renderAgenda();
  }
  $('#agendaAddBtn').addEventListener('click', addAgenda);
  $('#agendaInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addAgenda(); });
  renderAgenda();
  setInterval(() => { if (!document.hidden) renderAgenda(); }, 60000); // marca como "passado" os que já foram (só com o painel visível)

  // ----- eventos do app -----
  panel.onVoiceEvent((e) => {
    switch (e.type) {
      case 'heard': {
        addLine(e.accepted ? 'user' : 'ignored', e.text, e.ms);
        if (e.accepted && Number.isFinite(Number(e.ms)) && Number(e.ms) >= 0) {
          recognizedCount += 1; latencyTotal += Number(e.ms);
          const count = q('convMetricCount'), avg = q('convMetricAvg'), last = q('convMetricLast');
          if (count) count.textContent = String(recognizedCount);
          if (avg) avg.textContent = (latencyTotal / recognizedCount / 1000).toFixed(1) + ' s';
          if (last) last.textContent = (Number(e.ms) / 1000).toFixed(1) + ' s';
        }
        break;
      }
      case 'reply': addLine('she', e.text); break;
      case 'agenda': renderAgenda(); break;
      case 'error': addLine('sys', e.text); showError(e.text); break;
      case 'status': mainState = e.state; awake = !!e.awake; break;
      case 'model':
        modelPct = e.done || e.pct === null ? null : e.pct;
        modelRetry = e.retry && !e.done && !e.failed ? { n: e.retry, max: e.max } : (e.pct > 0 || e.done || e.failed ? null : modelRetry);
        if (e.failed) modelPct = null;
        break;
      case 'backend': {
        const el = q('convBackend');
        if (el) {
          const name = e.backend === 'faster-whisper' ? 'Faster-Whisper' : 'Whisper integrado';
          el.textContent = name + ' · ' + String(e.device || 'cpu').toUpperCase() + (e.reason ? ' · ' + e.reason : '');
          el.className = 'status' + (e.reason ? ' bad' : '');
        }
        break;
      }
      case 'speaking':
        speaking = !!e.on;
        if (speaking) seg.reset(); else mutedUntil = performance.now() + 800; // cauda do eco (alto-falante/Bluetooth demoram a calar)
        break;
    }
    paint();
  });

  // ----- configurações vindas do app -----
  window.voiceUI = {
    onSettings(s) {
      const micChanged = listening && lastMic !== null && (s.convMic || '') !== lastMic;
      lastMic = s.convMic || '';
      S = s;
      seg.setSensitivity(s.convSens || 3);
      if (micChanged && s.convListening) { teardown(); start(); return; } // trocou de microfone
      if (s.convListening && !listening && !starting) start();
      else if (!s.convListening && (listening || starting)) stop();
      if (listening && lastModel && s.convModel !== lastModel) prepareModel();
      lastModel = s.convModel;
      const sel = $('#convMic');
      if (sel && sel.value !== (s.convMic || '') && document.activeElement !== sel) sel.value = s.convMic || '';
      const g = $('#convGesture');
      if (g) {
        const on = s.convClap !== false;
        g.textContent = on ? '👏 Palmas e estalos: ligado' : '👏 Palmas e estalos: desligado';
        g.classList.toggle('on', on);
        g.classList.toggle('off', !on);
      }
      $('#convAliasRow').style.display = s.convMode === 'always' ? 'none' : '';
      paint();
    },
  };
  paint();
  panel.getSettings().then((s) => window.voiceUI.onSettings(s)); // garante o estado inicial (render() do painel pode chegar antes deste script)
})();
