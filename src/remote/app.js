'use strict';
// App do celular da Yoru (PWA). Sem bibliotecas; todo texto vindo do PC/IA entra por textContent.
(() => {
  const $ = (id) => document.getElementById(id);
  const store = {
    get: (k) => { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* modo privado */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* modo privado */ } },
  };
  let token = store.get('yoru.token');
  let control = '';
  try { control = sessionStorage.getItem('yoru.control') || ''; } catch (_) { control = ''; }
  let ctl = { available: false, unlocked: false, expiresIn: null };
  let pcSupported = false;
  let canScreen = false;
  let timerLeft = 0;
  let liveTimer = 0;
  let busy = false;

  // ---------- configurações (guardadas só neste celular) ----------
  const SET_KEY = 'yoru.settings';
  const DEF = { speak: true, auto: false, avatarPc: false, av3d: true, keepAwake: false, haptic: true, reducedMotion: false, notifications: false, theme: 'dark', accent: 'orange', backdrop: 'plain', voice: '', rate: 1, pitch: 1, lang: 'pt-BR', quality: 'normal', fs: 'm' };
  const num = (v, a, b, d) => (Number.isFinite(Number(v)) ? Math.min(b, Math.max(a, Number(v))) : d);
  function cleanCfg(o) {
    const c = { ...DEF };
    if (!o || typeof o !== 'object') return c;
    for (const k of ['speak', 'auto', 'avatarPc', 'av3d', 'keepAwake', 'haptic', 'reducedMotion', 'notifications']) if (typeof o[k] === 'boolean') c[k] = o[k];
    if (typeof o.voice === 'string') c.voice = o.voice.slice(0, 200);
    if (['dark', 'light', 'system'].includes(o.theme)) c.theme = o.theme;
    if (['orange', 'violet', 'blue', 'rose', 'green'].includes(o.accent)) c.accent = o.accent;
    if (['plain', 'aurora', 'midnight', 'sunset'].includes(o.backdrop)) c.backdrop = o.backdrop;
    c.rate = num(o.rate, 0.6, 1.6, 1); c.pitch = num(o.pitch, 0.6, 1.6, 1);
    if (['pt-BR', 'en-US', 'es-ES'].includes(o.lang)) c.lang = o.lang;
    if (['eco', 'normal', 'alta'].includes(o.quality)) c.quality = o.quality;
    if (['p', 'm', 'g'].includes(o.fs)) c.fs = o.fs;
    return c;
  }
  let cfg = DEF;
  try { cfg = cleanCfg(JSON.parse(store.get(SET_KEY) || '{}')); } catch (_) { cfg = cleanCfg(null); }

  const toastEl = $('toast');
  let toastT = 0;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('show'), 2600); }
  function buzz() { if (!cfg.haptic) return; try { navigator.vibrate && navigator.vibrate(12); } catch (_) { /* sem vibração */ } }
  function ask(text) {
    const dlg = $('dlg');
    if (typeof dlg.showModal !== 'function') return Promise.resolve(window.confirm(text));
    $('dlg-text').textContent = text;
    return new Promise((resolve) => {
      const done = (v) => { dlg.close(); $('dlg-yes').onclick = $('dlg-no').onclick = null; resolve(v); };
      $('dlg-yes').onclick = () => done(true);
      $('dlg-no').onclick = () => done(false);
      dlg.oncancel = () => done(false);
      dlg.showModal();
    });
  }

  // ---------- conexão ----------
  let online = true;
  let retryTimer = 0;
  let retryAttempt = 0;
  let lastLatencyMs = null;
  let lastCheckAt = 0;
  let statusRequest = null;
  let pairBusy = false;
  function setOnline(on) {
    $('dot').className = on ? 'dot on' : 'dot off';
    $('offline').hidden = on;
    if (on === online) { if (sheet && sheet.open) updateDeviceStats(); return; }
    online = on;
    if (sheet && sheet.open) updateDeviceStats();
    clearTimeout(retryTimer); retryTimer = 0;
    if (!on) scheduleReconnect();
    else {
      retryAttempt = 0;
      if (token) {
      toast('Reconectado ao PC ✓');
      if (cfg.notifications && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
        try { new Notification('Yoru reconectada', { body: 'A conexão com seu computador foi restabelecida.', icon: '/icon-192.png', tag: 'yoru-reconnect' }); } catch (_) {}
      }
      }
    }
  }

  // Reagendamento progressivo: timers podem ser suspensos em segundo plano.
  // Ao voltar ao app, focus/pageshow/visibilitychange disparam uma checagem imediata.
  function scheduleReconnect() {
    clearTimeout(retryTimer);
    retryTimer = 0;
    if (!token || document.hidden || !navigator.onLine) return;
    const delays = [2000, 5000, 10000, 20000, 30000];
    const delay = delays[Math.min(retryAttempt, delays.length - 1)];
    retryTimer = window.setTimeout(async () => {
      retryTimer = 0;
      if (!token || document.hidden || !navigator.onLine) return;
      const result = await refreshStatus();
      if (!result || !result.ok) {
        retryAttempt = Math.min(retryAttempt + 1, delays.length - 1);
        scheduleReconnect();
      } else retryAttempt = 0;
    }, delay);
  }

  function resumeConnectionCheck() {
    if (!token || document.hidden) return;
    clearTimeout(retryTimer);
    retryTimer = 0;
    refreshStatus().then((result) => {
      if (!result || !result.ok) {
        retryAttempt = Math.min(retryAttempt + 1, 4);
        scheduleReconnect();
      } else retryAttempt = 0;
    });
  }

  async function api(path, { method = 'GET', body, withControl = false, raw = false, timeoutMs = 12000 } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (withControl && control) headers['X-Yoru-Control'] = control;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const started = Date.now();
    let timeout = 0;
    try {
      const request = { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' };
      if (controller) {
        request.signal = controller.signal;
        timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      }
      const res = await fetch(path, request);
      if (timeout) window.clearTimeout(timeout);
      lastLatencyMs = Date.now() - started;
      lastCheckAt = Date.now();
      setOnline(true);
      if (res.status === 401) { forgetDevice(); return { ok: false, status: 401, data: { ok: false, error: 'Aparelho não autorizado. Faça o pareamento novamente.' } }; }
      let data = null;
      if (raw && res.ok) data = await res.blob();
      else { try { data = await res.json(); } catch (_) { data = { ok: false, error: 'O computador respondeu em um formato inesperado.' }; } }
      if (res.status === 403 && data && data.code === 'control_locked') lockLocal();
      return { ok: res.ok && (raw || data.ok !== false), status: res.status, data };
    } catch (error) {
      if (timeout) window.clearTimeout(timeout);
      setOnline(false);
      const timedOut = error && error.name === 'AbortError';
      return { ok: false, status: 0, data: { ok: false, error: timedOut ? 'O computador demorou para responder. Verifique se o Yoru está aberto.' : 'Sem conexão com o PC. Verifique se ele está ligado e se o Yoru está aberto.' } };
    }
  }

  // ---------- telas ----------
  function show(view) { $('view-pair').hidden = view !== 'pair'; $('view-main').hidden = view !== 'main'; }
  function forgetDevice() { token = ''; store.del('yoru.token'); lockLocal(); show('pair'); stopLive(); }
  function deviceName() {
    const ua = navigator.userAgent || '';
    const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : 'Celular';
    const br = /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
    return `${os}${br ? ' · ' + br : ''}`;
  }
  async function pair(code) {
    if (pairBusy) return;
    const normalizedCode = String(code || '').replace(/\D/g, '');
    const msg = $('pair-msg');
    if (!/^\d{8}$/.test(normalizedCode)) { msg.className = 'msg'; msg.textContent = 'Digite o código de 8 números mostrado no computador.'; return; }
    pairBusy = true;
    const submit = $('pair-form').querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    msg.className = 'msg'; msg.textContent = 'Conectando ao computador…';
    try {
      const r = await api('/api/pair', { method: 'POST', body: { code: normalizedCode, name: deviceName() }, timeoutMs: 10000 });
      if (!r.ok) { msg.textContent = r.data.error || 'Não consegui parear. Confira o código e tente novamente.'; return; }
      if (!r.data.token) { msg.textContent = 'O computador respondeu sem uma credencial válida. Gere outro código.'; return; }
      token = r.data.token; store.set('yoru.token', token);
      msg.textContent = '';
      await enterMain();
    } finally {
      pairBusy = false;
      if (submit) submit.disabled = false;
    }
  }
  async function enterMain() {
    show('main');
    await refreshStatus();
    if (!$('messages').children.length) greet();
  }

  // ---------- chat ----------
  const HISTORY_KEY = 'yoru.chat';
  let history = [];
  try { history = JSON.parse(store.get(HISTORY_KEY) || '[]').filter((m) => m && typeof m.t === 'string').slice(-40); } catch (_) { history = []; }
  function bubble(kind, text) {
    const b = document.createElement('div');
    b.className = `bubble ${kind}`; b.textContent = text;
    $('messages').appendChild(b);
    $('messages').scrollTop = $('messages').scrollHeight;
    return b;
  }
  function remember(kind, text) { history.push({ k: kind, t: text }); history = history.slice(-40); store.set(HISTORY_KEY, JSON.stringify(history)); }
  function greet() {
    history.forEach((m) => bubble(m.k === 'me' ? 'me' : 'yoru', m.t));
    if (!history.length) bubble('yoru', 'Oi! Sou a Yoru. Pode falar comigo por aqui. 💜');
  }
  async function clearChat() {
    if (!history.length && !$('messages').children.length) return;
    if (!(await ask('Apagar a conversa deste celular? Isso não afeta o histórico no PC.'))) return;
    history = []; store.set(HISTORY_KEY, '[]');
    $('messages').textContent = '';
    greet(); toast('Conversa limpa.');
  }
  async function sendChat(text) {
    if (busy || !text.trim()) return;
    busy = true;
    bubble('me', text); remember('me', text);
    const wait = bubble('yoru typing', 'Yoru está pensando…');
    try {
      const r = await api('/api/chat', { method: 'POST', body: { text, avatar: cfg.avatarPc }, timeoutMs: 45000 });
      if (r.ok && r.data.ok && r.data.text) { bubble('yoru', r.data.text); remember('yoru', r.data.text); }
      else bubble('err', (r.data && (r.data.text || r.data.error)) || 'Não consegui responder agora.');
    } catch (_) {
      bubble('err', 'Ocorreu um erro inesperado. Tente enviar novamente.');
    } finally {
      wait.remove();
      busy = false;
    }
  }

  // ---------- controle do PC ----------
  function lockLocal() {
    control = ''; try { sessionStorage.removeItem('yoru.control'); } catch (_) { /* sem storage */ }
    ctl.unlocked = false; timerLeft = 0; stopLive(); renderPc();
  }
  function paintTimer() {
    const t = Math.max(0, timerLeft);
    $('pc-timer').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }
  function renderPc() {
    paintTimer();
    const usable = ctl.available && pcSupported;
    $('pc-locked').hidden = ctl.unlocked;
    $('pc-unlocked').hidden = !ctl.unlocked;
    $('unlock-form').hidden = !usable;
    $('pc-locked-note').textContent = !ctl.available ? 'O controle do PC está desativado no computador (Yoru › Celular).'
      : !pcSupported ? 'O controle do PC só funciona quando o Yoru roda no Windows.' : 'Digite a senha de controle definida no computador.';
    $('btn-screen').hidden = !canScreen;
    $('live').parentElement.hidden = !canScreen;
  }
  async function refreshStatus() {
    if (statusRequest) return statusRequest;
    statusRequest = (async () => {
      const r = await api('/api/status', { timeoutMs: 8000 });
      if (!r.ok) { renderPc(); return r; }
      ctl = r.data.control || ctl; pcSupported = !!r.data.pcSupported; canScreen = !!r.data.screen;
      if (!ctl.unlocked) { control = ''; try { sessionStorage.removeItem('yoru.control'); } catch (_) { /* sem storage */ } } else timerLeft = ctl.expiresIn || 0;
      renderPc();
      return r;
    })();
    try { return await statusRequest; } finally { statusRequest = null; }
  }
  async function unlock(password) {
    const msg = $('unlock-msg');
    msg.className = 'msg'; msg.textContent = 'Verificando…';
    const r = await api('/api/control/unlock', { method: 'POST', body: { password } });
    if (!r.ok) {
      const wait = r.data.retryAfter ? ` Tente de novo em ${Math.ceil(r.data.retryAfter / 60) || 1} min.` : '';
      msg.textContent = (r.data.error || 'Não consegui liberar.') + (r.status === 429 ? wait : '');
      return;
    }
    control = r.data.control; try { sessionStorage.setItem('yoru.control', control); } catch (_) { /* sem storage */ }
    ctl.unlocked = true; timerLeft = r.data.expiresIn; $('pc-pass').value = ''; msg.textContent = '';
    renderPc(); buzz();
  }
  async function act(action, args, confirm) {
    const r = await api('/api/control/action', { method: 'POST', withControl: true, body: { action, args, confirm } });
    if (r.status === 403 && r.data.code === 'control_locked') { toast('Controle bloqueado. Digite a senha.'); return r; }
    toast(r.ok ? (r.data.note || 'Feito ✓') : (r.data.error || 'Não deu certo.'));
    if (r.ok) buzz();
    return r;
  }
  async function loadWindows() {
    const r = await api('/api/control/action', { method: 'POST', withControl: true, body: { action: 'list', args: {} } });
    const ul = $('win-list'); ul.textContent = '';
    if (!r.ok) { toast(r.data.error || 'Não consegui listar.'); return; }
    if (!r.data.windows.length) { const li = document.createElement('li'); li.textContent = 'Nenhuma janela aberta.'; ul.appendChild(li); return; }
    for (const w of r.data.windows) {
      const li = document.createElement('li');
      const label = document.createElement('span'); label.textContent = w.title || w.proc; label.title = w.proc;
      const focus = document.createElement('button'); focus.className = 'btn'; focus.textContent = 'Focar';
      focus.onclick = () => act('window', { act: 'focus', query: w.proc });
      const close = document.createElement('button'); close.className = 'btn danger'; close.textContent = '✕';
      close.setAttribute('aria-label', `Fechar ${w.proc}`);
      close.onclick = async () => { if (await ask(`Fechar "${w.title || w.proc}"?`)) { await act('window', { act: 'close', query: w.proc }); loadWindows(); } };
      li.append(label, focus, close); ul.appendChild(li);
    }
  }
  let lastShot = '';
  async function loadScreen() {
    const r = await api('/api/control/screen', { withControl: true, raw: true });
    if (!r.ok) { if (r.status !== 403) toast((r.data && r.data.error) || 'Não consegui ver a tela.'); stopLive(); return; }
    const img = $('screen');
    const url = URL.createObjectURL(r.data);
    img.src = url; img.hidden = false;
    if (lastShot) URL.revokeObjectURL(lastShot);
    lastShot = url;
  }
  let wakeLock = null;
  async function keepAwake(on) {
    try {
      if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
      else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
    } catch (_) { wakeLock = null; /* sem suporte ou negado */ }
  }
  function stopLive() { clearInterval(liveTimer); liveTimer = 0; const l = $('live'); if (l) l.checked = false; keepAwake(false); }

  // ---------- eventos ----------
  $('pair-form').addEventListener('submit', (e) => { e.preventDefault(); pair($('pair-code').value.replace(/\D/g, '')); });
  $('composer').addEventListener('submit', (e) => { e.preventDefault(); const t = $('input').value; $('input').value = ''; grow(); sendChat(t); });
  const grow = () => { const t = $('input'); t.style.height = 'auto'; t.style.height = `${Math.min(140, t.scrollHeight)}px`; };
  $('input').addEventListener('input', grow);
  $('messages').addEventListener('click', async (e) => { // toque numa mensagem copia o texto
    const b = e.target.closest('.bubble');
    if (!b || b.classList.contains('typing') || !b.textContent) return;
    try { await navigator.clipboard.writeText(b.textContent); toast('Mensagem copiada.'); } catch (_) { /* sem permissão */ }
  });
  $('screen').addEventListener('click', () => $('screen').classList.toggle('full'));

  // ---------- ditado por voz (só onde o navegador oferece e em conexão segura) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  if (SR && window.isSecureContext) {
    const mic = $('btn-mic');
    mic.hidden = false;
    mic.addEventListener('click', () => {
      if (rec) { rec.stop(); return; }
      const base = $('input').value.trim();
      const r = new SR();
      r.lang = cfg.lang; r.interimResults = true; r.continuous = false;
      r.onresult = (ev) => { let t = ''; for (const res of ev.results) t += res[0].transcript; $('input').value = base ? `${base} ${t}` : t; grow(); };
      r.onerror = (ev) => toast(ev.error === 'not-allowed' ? 'Permita o microfone no navegador.' : ev.error === 'no-speech' ? 'Não ouvi nada. Tente de novo.' : 'Não consegui ouvir.');
      r.onend = () => { rec = null; mic.classList.remove('rec'); $('input').focus(); };
      try { r.start(); rec = r; mic.classList.add('rec'); buzz(); } catch (_) { rec = null; mic.classList.remove('rec'); }
    });
  }

  // ---------- avatar por voz: ouve → manda pro chat → fala a resposta ----------
  const talk = $('btn-talk');
  const aPane = $('pane-avatar');
  const IMG = { idle: 'aguardando', listening: 'ouvindo', thinking: 'processando', speaking: 'haha', error: 'ops' };
  let vrec = null;
  let vState = 'idle';
  // ----- avatar 3D (VRM): carrega só na primeira vez que a tela do Avatar abre; se falhar, fica a imagem -----
  let av3d = null, av3dTried = false, av3dOn = false;
  async function initAvatar3d() {
    if (av3dTried) return;
    av3dTried = true;
    const canvas = $('avatar-canvas'), load = $('avatar-loading'), stage = canvas.parentElement;
    load.hidden = false; load.textContent = 'Carregando avatar…';
    try {
      const mod = await import('/avatar3d.js');
      canvas.hidden = false; stage.classList.add('is3d');
      av3d = await mod.createAvatar3D({ canvas, token, maxTex: { eco: 512, normal: 1024, alta: 2048 }[cfg.quality] || 1024, onProgress: (f) => { load.textContent = `Carregando avatar… ${Math.round(f * 100)}%`; } });
      av3d.setState(vState); av3d.setQuality(cfg.quality);
      av3d.lost.then(() => { stage.classList.remove('is3d'); canvas.hidden = true; if (av3d) av3d.stop(); av3d = null; toast('O 3D parou; usando a imagem.'); });
      load.hidden = true;
      apply3dVisibility();
    } catch (_) {
      stage.classList.remove('is3d'); canvas.hidden = true; load.hidden = true; av3d = null;
      toast('Avatar 3D indisponível; usando a imagem.');
    }
  }
  function avatar3dVisible(on) { av3dOn = on; if (on && cfg.av3d) { initAvatar3d(); if (av3d) av3d.start(); } else if (av3d) av3d.stop(); }
  // liga/desliga o 3D sem recarregar o modelo (a primeira carga só acontece com o 3D ligado)
  function apply3dVisibility() {
    const canvas = $('avatar-canvas'), stage = canvas.parentElement;
    if (!cfg.av3d) { if (av3d) av3d.stop(); canvas.hidden = true; stage.classList.remove('is3d'); return; }
    if (curPane !== 'avatar') return;
    if (!av3dTried) initAvatar3d();
    else if (av3d) { canvas.hidden = false; stage.classList.add('is3d'); av3d.start(); }
  }
  function avatarState(st, msg) {
    vState = st; aPane.dataset.state = st;
    $('avatar-img').src = `/reactions/${IMG[st] || IMG.idle}.webp`;
    if (av3d) av3d.setState(st);
    if (msg != null) $('avatar-status').textContent = msg;
    talk.classList.toggle('rec', st === 'listening');
  }
  function stopVoice() {
    if (vrec) { try { vrec.abort(); } catch (_) { /* já parou */ } vrec = null; }
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) { /* sem TTS */ }
    avatarState('idle', 'Toque no microfone para falar com a Yoru');
  }
  function finishTurn() {
    avatarState('idle', 'Pronto! Toque para falar de novo.');
    // conversa contínua: ela terminou de responder, o microfone reabre sozinho
    if (cfg.auto) setTimeout(() => { if (vState === 'idle' && curPane === 'avatar' && !document.hidden) talk.click(); }, 700);
  }
  function makeUtterance(text) {
    const u = new SpeechSynthesisUtterance(text);
    const voices = speechSynthesis.getVoices() || [];
    const v = voices.find((x) => x.voiceURI === cfg.voice) || voices.find((x) => /^pt(-|_)BR/i.test(x.lang));
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'pt-BR';
    u.rate = cfg.rate; u.pitch = cfg.pitch;
    return u;
  }
  function speak(text) {
    if (!cfg.speak || !('speechSynthesis' in window)) { finishTurn(); return; }
    try {
      const u = makeUtterance(text.slice(0, 600));
      u.onend = u.onerror = () => { if (vState === 'speaking') finishTurn(); };
      avatarState('speaking', 'Yoru está falando…');
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch (_) { finishTurn(); }
  }
  async function voiceSend(text) {
    avatarState('thinking', 'Yoru está pensando…');
    $('avatar-reply').textContent = `Você: ${text}`;
    if (busy) { avatarState('error', 'Ainda respondendo outra mensagem…'); return; }
    busy = true;
    bubble('me', text); remember('me', text);
    const r = await api('/api/chat', { method: 'POST', body: { text, avatar: cfg.avatarPc } });
    busy = false;
    if (r.ok && r.data.ok && r.data.text) {
      bubble('yoru', r.data.text); remember('yoru', r.data.text);
      $('avatar-reply').textContent = r.data.text;
      speak(r.data.text);
    } else {
      const err = (r.data && (r.data.text || r.data.error)) || 'Não consegui responder agora.';
      bubble('err', err); avatarState('error', err);
    }
  }
  if (SR && window.isSecureContext) {
    talk.hidden = false;
    talk.addEventListener('click', () => {
      if (vState === 'listening' && vrec) { vrec.stop(); return; }
      stopVoice();
      const r = new SR();
      let heard = '';
      r.lang = cfg.lang; r.interimResults = true; r.continuous = false;
      r.onresult = (ev) => { heard = ''; for (const res of ev.results) heard += res[0].transcript; $('avatar-reply').textContent = heard; };
      r.onerror = (ev) => { heard = ''; avatarState('error', ev.error === 'not-allowed' ? 'Permita o microfone no navegador.' : ev.error === 'no-speech' ? 'Não ouvi nada. Tente de novo.' : 'Não consegui ouvir.'); };
      r.onend = () => { vrec = null; if (heard.trim()) voiceSend(heard.trim()); else if (vState === 'listening') avatarState('idle', 'Toque no microfone para falar com a Yoru'); };
      try { r.start(); vrec = r; avatarState('listening', 'Ouvindo… fale agora'); buzz(); } catch (_) { vrec = null; avatarState('error', 'Não consegui abrir o microfone.'); }
    });
  } else {
    const np = $('avatar-nosupport');
    np.textContent = !window.isSecureContext
      ? 'O microfone só funciona em HTTPS. No PC, ative o Tailscale (Yoru › Celular › Fora de casa) e abra o endereço https://….ts.net. Enquanto isso, escreva abaixo: a Yoru responde falando.'
      : 'Este navegador não tem reconhecimento de voz. Escreva abaixo: a Yoru responde falando.';
    np.hidden = false;
  }
  $('avatar-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $('avatar-input').value.trim();
    if (!t) return;
    $('avatar-input').value = '';
    stopVoice(); voiceSend(t);
  });

  // ---------- programas usados recentemente ----------
  const FAV_KEY = 'yoru.favs';
  let favs = [];
  try { favs = JSON.parse(store.get(FAV_KEY) || '[]').filter((n) => typeof n === 'string' && n.length <= 60).slice(0, 8); } catch (_) { favs = []; }
  function saveFavs() { store.set(FAV_KEY, JSON.stringify(favs)); renderFavs(); }
  function renderFavs() {
    const box = $('launch-favs'); box.textContent = '';
    for (const name of favs) {
      const chip = document.createElement('span'); chip.className = 'chip';
      const go = document.createElement('button'); go.type = 'button'; go.textContent = name;
      go.onclick = () => act('launch', { name });
      const x = document.createElement('button'); x.type = 'button'; x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', `Remover ${name} dos recentes`);
      x.onclick = () => { favs = favs.filter((f) => f !== name); saveFavs(); };
      chip.append(go, x); box.appendChild(chip);
    }
  }
  renderFavs();
  $('input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('composer').requestSubmit(); } });
  $('unlock-form').addEventListener('submit', (e) => { e.preventDefault(); const v = $('pc-pass').value; if (v) unlock(v); });
  $('btn-lock').addEventListener('click', async () => { await api('/api/control/lock', { method: 'POST', body: {} }); lockLocal(); toast('Controle bloqueado.'); });
  $('btn-list').addEventListener('click', loadWindows);
  $('btn-screen').addEventListener('click', loadScreen);
  $('live').addEventListener('change', (e) => { clearInterval(liveTimer); liveTimer = 0; keepAwake(e.target.checked); if (e.target.checked) { loadScreen(); liveTimer = setInterval(() => { if (!document.hidden) loadScreen(); }, 1500); } });
  $('launch-form').addEventListener('submit', async (e) => { e.preventDefault(); const n = $('launch-name').value.trim(); if (n) { const r = await act('launch', { name: n }); if (r.ok) { $('launch-name').value = ''; favs = [n, ...favs.filter((f) => f.toLowerCase() !== n.toLowerCase())].slice(0, 8); saveFavs(); } } });
  $('vol').addEventListener('change', (e) => act('volume', { op: 'set', n: Number(e.target.value) }));
  $('pane-pc').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.confirm && !(await ask(b.dataset.confirm))) return;
    let args = {};
    try { args = b.dataset.args ? JSON.parse(b.dataset.args) : {}; } catch (_) { args = {}; }
    act(b.dataset.act, args, b.dataset.danger ? true : undefined);
  });
  // ---------- carrossel: deslizar (ou tocar na aba) gira entre Chat, Avatar e PC ----------
  const PANES = ['chat', 'avatar', 'pc'];
  const car = $('carousel');
  let curPane = 'chat';
  function setPane(name) {
    if (name === curPane) return;
    const leaving = curPane; curPane = name;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.dataset.pane === name));
    document.querySelectorAll('#dots i').forEach((d, i) => d.classList.toggle('on', PANES[i] === name));
    if (leaving === 'pc') stopLive();
    if (leaving === 'avatar') { stopVoice(); avatar3dVisible(false); keepAwake(false); }
    if (name === 'avatar') { avatar3dVisible(true); if (cfg.keepAwake) keepAwake(true); }
    if (name === 'pc') refreshStatus();
    buzz();
  }
  function goPane(name) { const el = $(`pane-${name}`); if (el) car.scrollTo({ left: el.offsetLeft, behavior: 'smooth' }); setPane(name); }
  let scrollRaf = 0;
  car.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => {
      scrollRaf = 0;
      const w = car.clientWidth || 1;
      const pos = car.scrollLeft / w;
      PANES.forEach((n, i) => { const el = $(`pane-${n}`); el.classList.toggle('away-l', i < pos - 0.35); el.classList.toggle('away-r', i > pos + 0.35); });
      const idx = Math.max(0, Math.min(PANES.length - 1, Math.round(pos)));
      setPane(PANES[idx]);
    });
  }, { passive: true });
  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    if (t.id === 'tab-settings') { openSettings(); return; }
    if (t.dataset.pane) goPane(t.dataset.pane);
  });

  $('btn-clear').addEventListener('click', clearChat);
  // ---------- tela de configurações ----------
  const sheet = $('settings');
  const CHECKS = ['speak', 'auto', 'avatarPc', 'av3d', 'keepAwake', 'haptic', 'reducedMotion', 'notifications'];
  const VALUES = ['voice', 'rate', 'pitch', 'lang', 'quality', 'fs', 'theme', 'accent', 'backdrop'];
  function paintRanges() { $('cfg-rate-v').textContent = `${cfg.rate.toFixed(1)}×`; $('cfg-pitch-v').textContent = cfg.pitch.toFixed(1); }
  function syncSheet() {
    for (const k of CHECKS) $(`cfg-${k}`).checked = !!cfg[k];
    for (const k of VALUES) $(`cfg-${k}`).value = String(cfg[k]);
    paintRanges();
  }
  function fillVoices() {
    const sel = $('cfg-voice');
    if (!('speechSynthesis' in window)) { sel.disabled = true; $('set-test').hidden = true; return; }
    const all = speechSynthesis.getVoices() || [];
    const pt = all.filter((v) => /^pt/i.test(v.lang));
    sel.textContent = '';
    const def = document.createElement('option'); def.value = ''; def.textContent = 'Padrão (português)'; sel.appendChild(def);
    for (const v of (pt.length ? pt : all)) { const o = document.createElement('option'); o.value = v.voiceURI; o.textContent = `${v.name} (${v.lang})`; sel.appendChild(o); }
    sel.value = cfg.voice;
  }
  function applyCfg() {
    document.documentElement.dataset.fs = cfg.fs;
    document.documentElement.dataset.theme = cfg.theme;
    document.documentElement.dataset.accent = cfg.accent;
    document.documentElement.dataset.backdrop = cfg.backdrop;
    document.documentElement.dataset.motion = cfg.reducedMotion ? 'reduced' : 'full';
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      const light = cfg.theme === 'light' || (cfg.theme === 'system' && window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches);
      metaTheme.content = light ? '#f5f2f8' : '#140f1c';
    }
    if (av3d) av3d.setQuality(cfg.quality);
    apply3dVisibility();
    if (curPane === 'avatar') keepAwake(cfg.keepAwake);
  }
  function saveCfg() { store.set(SET_KEY, JSON.stringify(cfg)); applyCfg(); }
  async function requestReconnectNotifications() {
    if (!('Notification' in window)) { cfg.notifications = false; saveCfg(); syncSheet(); toast('Este navegador não oferece notificações.'); return; }
    if (Notification.permission === 'default') {
      try {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') { cfg.notifications = false; saveCfg(); syncSheet(); toast('Permissão não concedida.'); }
        else toast('Notificações ativadas ✓');
      } catch (_) { cfg.notifications = false; saveCfg(); syncSheet(); }
    } else if (Notification.permission === 'denied') {
      cfg.notifications = false; saveCfg(); syncSheet(); toast('Libere notificações nas permissões do navegador.');
    }
  }
  async function updateDeviceStats() {
    $('cfg-connection').textContent = online ? 'Conectado' : 'Sem conexão';
    $('cfg-latency').textContent = lastLatencyMs == null ? '—' : `${lastLatencyMs} ms`;
    $('cfg-lastcheck').textContent = lastCheckAt ? new Date(lastCheckAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Ainda não verificado';
    const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    $('cfg-mode').textContent = standalone ? 'Instalado' : 'Navegador';
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    $('cfg-network').textContent = conn ? `${conn.effectiveType || 'Rede'}${conn.downlink ? ` · ${conn.downlink} Mb/s` : ''}${conn.saveData ? ' · economia' : ''}` : (navigator.onLine ? 'Internet disponível' : 'Sem internet');
    $('cfg-battery').textContent = 'Não suportado';
    if (navigator.getBattery) {
      try { const battery = await navigator.getBattery(); $('cfg-battery').textContent = `${Math.round(battery.level * 100)}%${battery.charging ? ' · carregando' : ''}`; } catch (_) { $('cfg-battery').textContent = 'Sem permissão'; }
    }
  }
  function openSettings() {
    syncSheet(); fillVoices(); updateDeviceStats();
    const di = $('set-3dinfo'); di.hidden = !(av3d && av3d.info); di.textContent = av3d && av3d.info ? `Diagnóstico 3D: ${av3d.info}` : '';
    if (typeof sheet.showModal === 'function') sheet.showModal(); else toast('Seu navegador não abre esta tela.');
  }
  $('btn-settings').addEventListener('click', openSettings);
  $('tab-settings').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSettings(); } });
  $('set-close').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); }); // toque fora fecha
  sheet.addEventListener('input', (e) => { if (e.target.type === 'range') { cfg = cleanCfg({ ...cfg, rate: Number($('cfg-rate').value), pitch: Number($('cfg-pitch').value) }); paintRanges(); } });
  sheet.addEventListener('change', (e) => {
    const el = e.target; const k = el.id && el.id.startsWith('cfg-') ? el.id.slice(4) : '';
    if (!k || ![...CHECKS, ...VALUES].includes(k)) return;
    cfg = cleanCfg({ ...cfg, [k]: el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value });
    saveCfg(); syncSheet();
    if (k === 'notifications' && cfg.notifications) requestReconnectNotifications();
  });
  $('cfg-sync').addEventListener('click', async () => {
    const button = $('cfg-sync');
    button.disabled = true; $('cfg-sync-note').textContent = 'Testando a conexão com o computador…';
    try {
      const result = token ? await refreshStatus() : { ok: false };
      await updateDeviceStats();
      if (result && result.ok) {
        $('cfg-sync-note').textContent = `Computador respondeu em ${lastLatencyMs} ms. Verificado às ${new Date(lastCheckAt).toLocaleTimeString('pt-BR')}.`;
        toast('Conexão verificada ✓');
      } else {
        $('cfg-sync-note').textContent = 'Não foi possível confirmar a conexão. Confira se o Yoru está aberto no computador.';
        toast('Não foi possível sincronizar.');
      }
    } finally { button.disabled = false; }
  });
  $('set-test').addEventListener('click', () => {
    try { speechSynthesis.cancel(); speechSynthesis.speak(makeUtterance('Oi! Eu sou a Yoru. Assim que eu vou falar com você.')); } catch (_) { toast('Não consegui falar agora.'); }
  });
  $('set-reset').addEventListener('click', async () => {
    if (!(await ask('Voltar todas as configurações ao padrão?'))) return;
    cfg = cleanCfg(null); saveCfg(); syncSheet(); fillVoices(); toast('Configurações restauradas.');
  });
  $('set-clear').addEventListener('click', () => { sheet.close(); clearChat(); });
  $('set-logout').addEventListener('click', async () => {
    sheet.close();
    if (!(await ask('Desconectar este celular da Yoru? Para voltar, será preciso parear de novo.'))) return;
    await api('/api/logout', { method: 'POST', body: {} });
    forgetDevice();
  });
  if ('speechSynthesis' in window && speechSynthesis.addEventListener) speechSynthesis.addEventListener('voiceschanged', () => { if (sheet.open) fillVoices(); });
  applyCfg();
  if (window.matchMedia) {
    const colorScheme = window.matchMedia('(prefers-color-scheme: light)');
    const onSchemeChange = () => { if (cfg.theme === 'system') applyCfg(); };
    if (colorScheme.addEventListener) colorScheme.addEventListener('change', onSchemeChange);
    else if (colorScheme.addListener) colorScheme.addListener(onSchemeChange);
  }
  setInterval(() => { // contagem regressiva do controle + checagem periódica
    if (ctl.unlocked && timerLeft > 0) {
      timerLeft -= 1;
      paintTimer();
      if (timerLeft <= 0) refreshStatus();
    }
  }, 1000);
  setInterval(() => {
    if (token && !document.hidden && !$('view-main').hidden && online) refreshStatus();
  }, 20000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resumeConnectionCheck();
    else { clearTimeout(retryTimer); retryTimer = 0; }
    if (sheet.open) updateDeviceStats();
    if (av3d) { if (document.hidden) av3d.stop(); else if (curPane === 'avatar') av3d.start(); }
  });
  window.addEventListener('focus', resumeConnectionCheck);
  window.addEventListener('pageshow', resumeConnectionCheck);
  window.addEventListener('pagehide', () => { clearTimeout(retryTimer); retryTimer = 0; });
  if (navigator.connection && navigator.connection.addEventListener) {
    navigator.connection.addEventListener('change', () => {
      if (navigator.onLine) resumeConnectionCheck();
      else setOnline(false);
    });
  }

  // ---------- início ----------
  // O QR Code abre "/#pair=CODIGO": o código vai no fragmento (não é enviado ao servidor nem aparece em logs) e some da barra de endereço.
  function pairFromHash() {
    const m = /^#pair=(\d{8})$/.exec(location.hash);
    if (!m) return false;
    try { window.history.replaceState(null, '', location.pathname); } catch (_) { /* sem history */ }
    show('pair');
    pair(m[1]);
    return true;
  }
  let installPrompt = null;
  function showInstallButtons(show) {
    $('install-btn').hidden = !show;
    $('btn-install').hidden = !show;
  }
  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (_) { /* escolha cancelada */ }
    installPrompt = null; showInstallButtons(false);
  }
  $('install-btn').addEventListener('click', installApp);
  $('btn-install').addEventListener('click', installApp);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); installPrompt = event; showInstallButtons(true);
    $('install-hint').hidden = false; $('install-hint').textContent = 'Instale a Yoru para abrir em tela cheia e acessar mais rápido.';
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; showInstallButtons(false); $('install-hint').hidden = true; toast('Yoru instalada ✓'); });
  function installHint() {
    const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    const ua = navigator.userAgent || '';
    const el = $('install-hint');
    if (standalone) return;
    if (/iPhone|iPad|iPod/.test(ua)) el.textContent = 'Dica: no Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início” para usar como app.';
    else if (/Android/.test(ua)) el.textContent = 'Dica: no menu ⋮ do Chrome, escolha “Instalar app” (ou “Adicionar à tela inicial”).';
    else return;
    el.hidden = false;
  }
  installHint();
  window.addEventListener('online', () => { retryAttempt = 0; if (token) resumeConnectionCheck(); else setOnline(true); });
  window.addEventListener('offline', () => { setOnline(false); });
  window.addEventListener('hashchange', pairFromHash);
  if (!pairFromHash()) { if (token) enterMain(); else show('pair'); }
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting) $('app-update').hidden = false;
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) $('app-update').hidden = false;
        });
      });
      $('btn-update').addEventListener('click', () => {
        const waiting = registration.waiting;
        if (waiting) waiting.postMessage('SKIP_WAITING');
      });
    }).catch(() => {});
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return; reloading = true; window.location.reload();
    });
  }
})();
