// Aba Gestos: webcam -> mão (MediaPipe Hand Landmarker, local) -> gesto (gesture-logic.js) -> ação (main: gesture-actions.js).
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// A câmera e o reconhecimento vivem só na janela principal do painel (esta aba não abre destacada): duas janelas abririam a câmera em dobro.
(() => {
  const GL = window.GestureLogic;
  const g = (id) => document.getElementById(id);
  if (!GL || !g('tab-gestos')) return;

  const MP = './vendor/mediapipe/';
  let cfg = {};
  let landmarker = null, stream = null, running = false, starting = false, timer = null, lastT = -1, autoTried = false;
  let dry = false;
  const engine = GL.createEngine({});
  const smoother = GL.createSmoother({ size: 5, min: 3 });
  let frames = 0, fpsAt = 0;
  const pointer = GL.createPointer({});
  let mouseOn = false, mouseLostAt = 0, mouseExitAt = 0;
  let handPose = '', scrollY = null;   // mão livre: pose que a mão virtual faz e onde estava o dedo ao rolar a página
  let lastActive = 0;        // última vez que havia mão à vista (ou o mouse no ar ligado): serve para desligar a câmera sozinha
  let lmDetect = 'normal';   // sensibilidade com que o reconhecimento foi criado
  const gestureInfo = (id) => GL.GESTURES.find((x) => x[0] === id);
  const emoteName = (id) => { const e = (typeof EMOTES !== 'undefined' ? EMOTES : []).find((x) => x[0] === id); return e ? `${e[1]} Gesto da Yoru: ${e[2]}` : 'Gesto da Yoru'; };
  const actionLabel = (a) => (a.startsWith('emote:') ? emoteName(a.slice(6)) : (GL.ACTIONS.find((x) => x[0] === a) || [a, a])[1]);
  const mapOf = () => ({ ...GL.DEFAULT_MAP, ...(cfg.gestureMap || {}) });

  // ----- registro, selo e bipe -----
  const ago = () => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function log(text, bad) {
    const box = g('gLog');
    if (!box.querySelector('time')) box.innerHTML = '';
    const row = document.createElement('div');
    if (bad) row.className = 'bad';
    const t = document.createElement('time'); t.textContent = ago();
    const m = document.createElement('span'); m.textContent = text;
    row.append(t, m);
    box.prepend(row);
    while (box.children.length > 40) box.lastChild.remove();
  }
  g('gLogClear').addEventListener('click', () => { g('gLog').innerHTML = '<div style="color:var(--muted)">Os gestos reconhecidos aparecem aqui.</div>'; });
  const status = (text, kind) => { const el = g('gStatus'); el.textContent = text || ''; el.className = 'status' + (kind ? ' ' + kind : ''); };
  const badge = (st, text) => { const b = g('gBadge'); if (b.dataset.st !== st) b.dataset.st = st; if (b.textContent !== text) b.textContent = text; };
  let actx = null;
  function beep(freq, ms = 90) {
    if (cfg.gestureSound === false) return;
    try {
      actx = actx || new AudioContext();
      const o = actx.createOscillator(), v = actx.createGain();
      o.frequency.value = freq; o.type = 'sine';
      v.gain.value = 0.06;
      o.connect(v); v.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + ms / 1000);
    } catch (_) { /* sem áudio: segue sem bipe */ }
  }

  // ----- tabela gesto -> ação -----
  function buildMap() {
    const box = g('gMap');
    box.innerHTML = '';
    for (const [id, icon, name, how] of GL.GESTURES) {
      const lab = document.createElement('label');
      lab.dataset.g = id;
      const i = document.createElement('span'); i.className = 'gi'; i.textContent = icon;
      const n = document.createElement('span'); n.className = 'gn'; n.textContent = name;
      const sm = document.createElement('small'); sm.textContent = how; n.appendChild(sm);
      const sel = document.createElement('select'); sel.dataset.g = id;
      for (const [a, l] of GL.ACTIONS) sel.add(new Option(l, a));
      const og = document.createElement('optgroup'); og.label = 'A Yoru faz um gesto';
      for (const e of (typeof EMOTES !== 'undefined' ? EMOTES : [])) og.appendChild(new Option(`${e[1]} ${e[2]}`, 'emote:' + e[0]));
      sel.appendChild(og);
      sel.addEventListener('change', () => send({ gestureMap: { ...mapOf(), [id]: sel.value } }));
      const test = document.createElement('button');
      test.className = 'gtest'; test.type = 'button'; test.textContent = '▶'; test.title = 'Testar esta ação agora';
      test.addEventListener('click', () => perform(id, false, true));
      lab.append(i, n, sel, test);
      box.appendChild(lab);
    }
  }
  function paintMap() {
    const m = mapOf();
    g('gMap').querySelectorAll('select').forEach((s) => { if (s !== document.activeElement) s.value = m[s.dataset.g] || 'none'; });
    g('gMap').querySelectorAll('label').forEach((l) => { l.querySelector('.gtest').disabled = (m[l.dataset.g] || 'none') === 'none'; });
    lastNow = undefined; paintNow(nowId); // a ação mostrada ao lado do gesto muda junto com a tabela
    document.querySelectorAll('[data-gpreset]').forEach((b) => { const p = GL.PRESETS[b.dataset.gpreset]; b.classList.toggle('primary', !!p && GL.GESTURE_IDS.every((id) => p[id] === m[id])); });
  }
  document.querySelectorAll('[data-gpreset]').forEach((b) => b.addEventListener('click', () => {
    const p = GL.PRESETS[b.dataset.gpreset];
    if (p) { send({ gestureMap: { ...p } }); log('Predefinição aplicada: ' + b.textContent.trim()); }
  }));
  g('gDry').addEventListener('change', (e) => { dry = e.target.checked; log(dry ? '🧪 Modo teste ligado: reconhece, mas não executa.' : 'Modo teste desligado.'); });

  // ----- câmeras -----
  async function fillCams() {
    const sel = g('gCamSel');
    let devs = [];
    try { devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'); } catch (_) { /* sem lista */ }
    sel.innerHTML = '';
    sel.add(new Option('Câmera padrão', ''));
    devs.forEach((d, i) => d.deviceId && sel.add(new Option(d.label || 'Câmera ' + (i + 1), d.deviceId)));
    sel.value = [...sel.options].some((o) => o.value === cfg.gestureCam) ? cfg.gestureCam : '';
  }
  try { navigator.mediaDevices.addEventListener('devicechange', fillCams); } catch (_) {}
  g('gCamSel').addEventListener('change', () => { if (running) restart(); });

  // ----- reconhecimento da mão -----
  async function loadLandmarker() {
    if (landmarker) return landmarker;
    const mod = await import(MP + 'vision_bundle.mjs');
    const files = { ...(await mod.FilesetResolver.forVisionTasks(MP + 'wasm')) };
    // o navegador não lê file:// por fetch: os arquivos .wasm e o modelo vêm pelo processo principal e entram como blob:/bytes
    for (const k of Object.keys(files)) {
      if (!/BinaryPath$/.test(k) || typeof files[k] !== 'string') continue;
      const bytes = await panel.gestureFile(files[k].split('/').pop());
      if (!bytes) throw new Error('arquivo do MediaPipe não encontrado: ' + files[k].split('/').pop());
      files[k] = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
    }
    const model = await panel.gestureFile('hand_landmarker.task');
    if (!model) throw new Error('modelo da mão não encontrado');
    const buf = new Uint8Array(model);
    const make = (delegate) => mod.HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetBuffer: buf, delegate },
      runningMode: 'VIDEO', numHands: 1,
      ...GL.detectConfig(cfg.gestureDetect),
    });
    lmDetect = GL.DETECT_IDS.includes(cfg.gestureDetect) ? cfg.gestureDetect : 'normal';
    try { landmarker = await make('GPU'); } catch (_) { landmarker = await make('CPU'); } // sem GPU compatível: usa o processador
    return landmarker;
  }

  const camError = (e) => {
    const n = e && e.name;
    if (n === 'NotAllowedError' || n === 'SecurityError') return 'Acesso à câmera negado. No Windows: Configurações › Privacidade e segurança › Câmera › permitir apps de área de trabalho.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Nenhuma câmera encontrada.';
    if (n === 'NotReadableError') return 'A câmera está em uso por outro programa. Feche-o e tente de novo.';
    return String((e && e.message) || e);
  };

  async function start() {
    if (running || starting) return;
    starting = true;
    const btn = g('gToggle');
    btn.disabled = true;
    status('Carregando o reconhecimento de mão…');
    badge('wait', 'Carregando…');
    try {
      const info = await panel.gestureModel();
      if (!info || !info.runtime || !info.model) {
        throw new Error('Faltam arquivos do reconhecimento de mão. Feche o app e rode "npm install" (ou "npm run vendor") com internet, uma vez.');
      }
      await loadLandmarker();
      const want = cfg.gestureCam ? { deviceId: { exact: cfg.gestureCam } } : {};
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { ...want, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
      } catch (e) {
        if (!cfg.gestureCam || e.name !== 'OverconstrainedError') throw e;
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }); // a câmera salva sumiu
      }
      const v = g('gVideo');
      v.srcObject = stream;
      await v.play();
      const c = g('gCanvas');
      c.width = v.videoWidth || 640; c.height = v.videoHeight || 480;
      running = true; paintHandBtn();
      lastT = -1;
      lastActive = performance.now();
      engine.disarm();
      smoother.reset(); frames = 0; fpsAt = performance.now();
      fillCams();
      btn.textContent = '⏹ Desligar a câmera';
      status('Câmera ligada. Mostre a palma aberta por 1 s para armar.', 'ok');
      log('📷 Câmera ligada.');
      tick();
    } catch (e) {
      status(camError(e), 'bad');
      log('Não consegui ligar a câmera: ' + camError(e), true);
      teardown();
    } finally {
      starting = false;
      btn.disabled = false;
    }
  }

  function teardown() {
    stopMouse('câmera desligada');
    running = false;
    clearTimeout(timer);
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const v = g('gVideo'); v.srcObject = null;
    if (landmarker) { try { landmarker.close(); } catch (_) {} landmarker = null; } // libera a memória (recarrega rápido ao religar)
    engine.disarm();
    const c = g('gCanvas'); c.getContext('2d').clearRect(0, 0, c.width, c.height);
    g('gToggle').textContent = '📷 Ligar a câmera'; paintHandBtn();
    g('gProg').style.width = '0';
    g('gFps').textContent = '';
    paintNow(null);
    badge('off', 'Câmera desligada');
  }
  function stop() { if (running) log('Câmera desligada.'); teardown(); status(''); }
  async function restart() { teardown(); await start(); }
  g('gToggle').addEventListener('click', () => (running ? stop() : start()));
  window.addEventListener('beforeunload', teardown);

  // ----- mouse no ar -----
  async function toggleMouse() {
    if (mouseOn) return stopMouse('desligado');
    if (!running) { await start(); if (!running) return; }
    const info = await panel.gestureModel();
    if (info && info.mouse === false) { log('O mouse no ar só funciona no Windows.', true); return; }
    mouseOn = true; mouseLostAt = 0; mouseExitAt = 0;
    pointer.reset(); engine.disarm();
    g('gMouse').textContent = '🖱️ Desligar o mouse no ar'; paintHandBtn();
    log('🖱️ Mouse no ar ligado: indicador move, pinça clica, palma aberta por 1,2 s desliga.');
    beep(990);
  }
  function stopMouse(why) {
    if (!mouseOn) return;
    mouseOn = false;
    panel.airMouse({ t: 'u' }); panel.airMouse({ t: 'off' }); // sempre solta o botão
    pointer.reset();
    g('gMouse').textContent = '🖱️ Ativar o mouse no ar'; sendHandPose('auto'); scrollY = null; paintHandBtn();
    g('gProg').style.width = '0';
    log('🖱️ Mouse no ar desligado' + (why ? ' (' + why + ')' : '') + '.');
    beep(440);
  }
  g('gMouse').addEventListener('click', toggleMouse);

  // ----- mão livre: a mão virtual no lugar do cursor; com a câmera ela clica, agarra e rola -----
  const paintHandBtn = () => {
    g('gHand').textContent = cfg.handFree && mouseOn ? '✋ Desligar a mão livre' : '✋ Ativar a mão livre';
    const chip = (id, on, text) => { const e = g(id); if (!e) return; e.dataset.on = on ? '1' : '0'; e.querySelector('b').textContent = text; };
    chip('chipCam', running, running ? 'Câmera ligada' : 'Câmera desligada');
    chip('chipMouse', mouseOn, mouseOn ? 'Mouse no ar ligado' : 'Mouse no ar desligado');
    chip('chipHand', !!cfg.handFree, cfg.handFree ? 'Mão virtual ligada' : 'Mão virtual desligada');
  };
  async function toggleHand() {
    if (cfg.handFree && mouseOn) { stopMouse('mão livre desligada'); panel.set({ handFree: false }); return; }
    panel.set({ handFree: true });
    if (!mouseOn) await toggleMouse();     // liga a câmera e o mouse no ar (sem câmera, a mão só segue o mouse comum)
    paintHandBtn();
  }
  g('gHand').addEventListener('click', toggleHand);
  function sendHandPose(p) { if (p !== handPose) { handPose = p; panel.handPose(p); } }

  function drawCursor(lm, r) {
    const c = g('gCanvas'), x = c.getContext('2d');
    x.beginPath(); x.arc(lm[8].x * c.width, lm[8].y * c.height, r.pinch ? 12 : 18, 0, 6.3);
    x.lineWidth = 4; x.strokeStyle = r.pinch ? '#37d67a' : '#fff'; x.fillStyle = r.pinch ? 'rgba(55,214,122,.45)' : 'rgba(255,255,255,.12)';
    x.fill(); x.stroke();
  }
  function mouseFrame(lm, gesture, aspect) {
    const t = performance.now();
    if (!lm) {
      if (!mouseLostAt) mouseLostAt = t;
      if (t - mouseLostAt > 3000) { stopMouse('a mão ficou fora da imagem por 3 s'); return; }
      badge('armed', '🖱️ Mouse · sem mão');
      return;
    }
    mouseLostAt = 0;
    const scrolling = gesture === 'victory';                       // ✌️ sobe/desce a página
    const r = pointer.update(lm, aspect, { fist: gesture === 'fist', hold: scrolling });
    panel.airMouse({ t: 'm', x: r.x, y: r.y });
    for (const e of r.events) panel.airMouse({ t: e === 'down' ? 'd' : e === 'up' ? 'u' : 'r' });
    if (scrolling) {
      const y = lm[8].y;
      if (scrollY !== null && Math.abs(y - scrollY) > 0.004) panel.airMouse({ t: 'w', d: Math.max(-480, Math.min(480, Math.round((y - scrollY) * 2400))) });   // mão para baixo = página sobe
      scrollY = y;
    } else scrollY = null;
    sendHandPose(r.pinch ? 'pinch' : r.grab ? 'fist' : scrolling ? 'scroll' : gesture === 'open_palm' ? 'open' : 'point');
    drawCursor(lm, r);
    if (gesture === 'open_palm') { // palma aberta parada: sair
      if (!mouseExitAt) mouseExitAt = t;
      g('gProg').style.width = Math.min(100, Math.round((t - mouseExitAt) / 12)) + '%';
      if (t - mouseExitAt >= 1200) { stopMouse('palma aberta'); return; }
    } else { mouseExitAt = 0; g('gProg').style.width = '0'; }
    badge('armed', r.pinch ? '🖱️ Mouse · clicando' : r.grab ? '✊ Mouse · agarrando' : scrolling ? '✌️ Mouse · rolando' : '🖱️ Mouse no ar');
  }

  // ----- laço de leitura -----
  function tick() {
    if (!running) return;
    let delay = 70;
    try {
      const v = g('gVideo');
      if (v.readyState >= 2 && v.currentTime !== lastT) {
        lastT = v.currentTime;
        const r = landmarker.detectForVideo(v, performance.now());
        const lm = r && r.landmarks && r.landmarks[0];
        frame(lm || null, v);
        delay = lm ? 40 : 90; // com mão: ~25 quadros/s; sem mão, poupa o processador
      }
    } catch (e) {
      status('Erro no reconhecimento: ' + e.message, 'bad');
      log('Erro no reconhecimento: ' + e.message, true);
      teardown();
      return;
    }
    if (!mouseOn && GL.idleExpired(performance.now() - lastActive, cfg.gestureIdleOff)) {
      log(`📷 Câmera desligada sozinha: ${cfg.gestureIdleOff} min sem nenhuma mão.`);
      status(`Câmera desligada sozinha (${cfg.gestureIdleOff} min sem mão). Clique em Ligar quando precisar.`);
      teardown();
      return;
    }
    timer = setTimeout(tick, delay);
  }

  let lastNow = '', nowId = null;
  function paintNow(id) {
    nowId = id;
    if (id === lastNow) return;
    lastNow = id;
    const gi = id && gestureInfo(id);
    g('gNowIcon').textContent = gi ? gi[1] : '✋';
    g('gNowName').textContent = gi ? gi[2] : id === '' ? 'Mão sem gesto definido' : 'Nenhuma mão à vista';
    // o que esse gesto vai fazer (para ninguém ser pego de surpresa)
    const act = gi ? mapOf()[id] || 'none' : null, el = g('gNowAct');
    el.textContent = act === null ? '' : act === 'none' ? 'sem ação ligada' : '→ ' + actionLabel(act);
    el.classList.toggle('on', !!act && act !== 'none');
    g('gMap').querySelectorAll('label').forEach((l) => l.classList.toggle('on', l.dataset.g === id));
  }
  let accent = '';
  function draw(lm) {
    const c = g('gCanvas'), x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    if (!lm || cfg.gesturePreview === false) return;
    accent = accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff7a2e';
    x.lineWidth = 3; x.strokeStyle = accent; x.fillStyle = '#fff';
    for (const [a, b] of GL.CONNECTIONS) { x.beginPath(); x.moveTo(lm[a].x * c.width, lm[a].y * c.height); x.lineTo(lm[b].x * c.width, lm[b].y * c.height); x.stroke(); }
    for (const p of lm) { x.beginPath(); x.arc(p.x * c.width, p.y * c.height, 3.5, 0, 6.3); x.fill(); }
  }

  function frame(lm, v) {
    const aspect = (v.videoWidth / v.videoHeight) || 4 / 3;
    let gesture = null;
    if (lm) gesture = smoother.push(GL.classify(lm, aspect)); else smoother.reset();
    if (lm || mouseOn) lastActive = performance.now();
    frames++;
    const nowMs = performance.now();
    if (nowMs - fpsAt >= 1000) { g('gFps').textContent = Math.round((frames * 1000) / (nowMs - fpsAt)) + ' quadros/s' + (lm ? '' : ' · sem mão'); frames = 0; fpsAt = nowMs; }
    if (mouseOn) { draw(lm); paintNow(lm ? gesture || '' : null); mouseFrame(lm, gesture, aspect); return; }
    const events = engine.update(lm ? { gesture, x: lm[0].x, y: lm[0].y } : null);
    draw(lm);
    paintNow(lm ? gesture || '' : null);
    const st = engine.status();
    g('gProg').style.width = Math.round(st.progress * 100) + '%';
    if (!st.armRequired) badge('armed', 'Pronto');
    else if (st.armed) badge('armed', 'Armado · ' + Math.ceil(st.leftMs / 1000) + ' s');
    else badge('wait', 'Mostre a palma aberta por 1 s');
    for (const e of events) onEvent(e);
  }

  async function onEvent(e) {
    if (e.type === 'arm') { beep(880); log('🟠 Armado: faça um gesto.'); if (cfg.gestureReact !== false && !dry) panel.action('emote', 'nod'); return; }
    if (e.type === 'disarm') { beep(440); log('Desarmado. Palma aberta por 1 s para acordar de novo.'); return; }
    if (e.type !== 'gesture') return;
    perform(e.id, e.repeat, false);
  }

  // executa a ação ligada a um gesto: vindo da câmera (e.repeat = volume repetindo) ou do botão ▶ da tabela (manual = true)
  async function perform(id, repeat, manual) {
    const [, icon, name] = gestureInfo(id);
    const action = mapOf()[id] || 'none';
    const tag = manual ? ' (teste manual)' : '';
    if (action === 'none') { log(`${icon} ${name} — sem ação ligada`); return; }
    if (dry && !manual) { log(`🧪 ${icon} ${name} → ${actionLabel(action)} (teste: não executado)`); return; }
    if (!repeat) beep(660, 70);
    if (action === 'air-mouse') { log(`${icon} ${name} → ${actionLabel(action)}${tag}`); toggleMouse(); return; }
    if (action === 'hand-free') { log(`${icon} ${name} → ${actionLabel(action)}${tag}`); toggleHand(); return; }
    if (GL.UI_ACTIONS.includes(action)) {
      const b = g(action === 'talk' ? 'convTalk' : 'convToggle');
      if (b) b.click();
      log(`${icon} ${name} → ${actionLabel(action)}${tag}`);
      return;
    }
    try {
      const r = await panel.gestureAction(action);
      if (repeat && r && r.ok) return; // volume repetindo: não enche o registro
      log(`${icon} ${name} → ${actionLabel(action)}${tag}${r && r.ok ? '' : ' — falhou: ' + ((r && r.error) || 'sem resposta')}${r && r.extra ? ' (' + r.extra + ')' : ''}`, !(r && r.ok));
    } catch (err) { log(`${icon} ${name} — falhou: ${err.message}`, true); }
  }

  // ----- configurações -----
  function apply(s) {
    cfg = s || {};
    pointer.configure({ sens: cfg.gestureMouseSens || 3 });
    paintHandBtn();
    engine.configure({ holdMs: cfg.gestureHold || 600, cooldownMs: cfg.gestureCooldown || 1500, arm: cfg.gestureArm !== false, repeat: (id) => /^volume-(up|down)$/.test(mapOf()[id] || '') });
    g('gStage').classList.toggle('nopreview', cfg.gesturePreview === false);
    paintMap();
    const sel = g('gCamSel');
    if (cfg.gestureCam !== undefined && sel !== document.activeElement && [...sel.options].some((o) => o.value === cfg.gestureCam)) sel.value = cfg.gestureCam;
    if (running && lmDetect !== (GL.DETECT_IDS.includes(cfg.gestureDetect) ? cfg.gestureDetect : 'normal')) { log('Sensibilidade alterada: reiniciando a câmera.'); restart(); }
    if (cfg.gestureAuto && !autoTried) { autoTried = true; setTimeout(start, 1200); }
  }
  buildMap();
  fillCams();
  panel.getSettings().then(apply);
  panel.onSettings(apply);
})();
