'use strict';
// Movimento da janela do avatar: passeio pela tela, queda/quique ao soltar, mudança de escala e canto.
// Só mexe na janela por getters (`getWin`, `getSettings`), então não guarda estado do app além do próprio movimento.
const MOTION = require('./motion');

function createMovement({ screen, getWin, getSettings, saveSettings, base }) {
  let walk = null;        // { x, y, dir, speed, left, minX, maxX, last, timer }
  let walkTimer = null;   // agenda o próximo passeio
  let walkBusy = false;   // o avatar avisa quando está ocupado (falando, balão, chat, gesto, mouse em cima...)
  let phys = null;        // queda em andamento
  let voiceMove = null;   // deslocamento curto solicitado por voz
  const floorTop = MOTION.floorTop; // os pés encostam na barra de tarefas

  // Mover com setPosition() repetido faz o Windows (com escala de tela fracionada, ex. 125%/150%) ir aumentando a janela
  // alguns pixels a cada chamada. Por isso toda movimentação passa por aqui e reafirma o tamanho certo.
  function winSize() {
    const s = getSettings();
    return { width: MOTION.toInt(base.w * s.scale) || base.w, height: MOTION.toInt(base.h * s.scale) || base.h };
  }
  // O Electron recusa NaN e -0 em setBounds (e derrubava o app com um erro no processo principal): ver MOTION.toInt.
  function setWinPos(x, y) {
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    const ix = MOTION.toInt(x), iy = MOTION.toInt(y);
    if (ix === null || iy === null) return;   // posição inválida: ignora este quadro em vez de estourar
    win.setBounds({ x: ix, y: iy, ...winSize() });
  }

  function applyScale(scale) {
    stopWalk();
    const win = getWin();
    if (!win || win.isDestroyed()) return; // mudar o tamanho com a janela já fechada derrubava o app
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const w = MOTION.toInt(base.w * scale) || base.w;
    const h = MOTION.toInt(base.h * scale) || base.h;
    // mantém o centro horizontal e a base da janela no lugar
    const x = Math.min(wa.x + wa.width - w, Math.max(wa.x, Math.round(b.x + (b.width - w) / 2)));
    const wasOnFloor = b.y >= floorTop(wa, b.height) - 2;
    const y = wasOnFloor ? floorTop(wa, h) : Math.max(wa.y, b.y + b.height - h);
    const ix = MOTION.toInt(x), iy = MOTION.toInt(y);
    if (ix === null || iy === null) return;
    win.setBounds({ x: ix, y: iy, width: w, height: h });
  }

  function moveToCorner(c) {
    stopWalk();
    const w0 = getWin();
    if (!w0 || w0.isDestroyed()) return;
    const b = w0.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const x = c.includes('l') ? wa.x : wa.x + wa.width - b.width;
    const y = c.includes('t') ? wa.y : floorTop(wa, b.height);
    setWinPos(x, y);
  }

  // ---------- Passeio (ela anda pela tela) ----------
  function scheduleWalk(ms) {
    clearTimeout(walkTimer);
    walkTimer = null;
    const settings = getSettings();
    if (!settings.walkEnabled) return;
    const wait = ms != null ? ms : (0.5 + Math.random()) * (settings.walkEvery || 15) * 1000;
    walkTimer = setTimeout(() => {
      walkTimer = null;
      if (!getSettings().walkEnabled) return;
      if (!startWalk()) scheduleWalk(2500); // ocupada agora: tenta de novo daqui a pouco
    }, wait);
  }

  function startWalk(manual) {
    const win = getWin(), settings = getSettings();
    if (!win || win.isDestroyed() || walk || phys || walkBusy) return false;
    if (!settings.visible || !win.isVisible()) return false;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const plan = MOTION.planWalk(b, wa, Math.random);   // chão = barra de tarefas; limites e sorteio: ver motion.js
    if (plan.kind === 'fall') { startFall(0, 0); return false; }
    if (plan.kind === 'no') return false;
    if (plan.snap) setWinPos(b.x, plan.y);
    const speed = settings.walkSpeed || 110;
    walk = { x: plan.x, y: plan.y, dir: plan.dir, speed, left: plan.left, minX: plan.minX, maxX: plan.maxX, last: Date.now(), timer: null };
    walk.timer = setInterval(stepWalk, 16);
    win.webContents.send('walk', true, plan.dir, speed);
    return true;
  }

  function stepWalk() {
    const p = walk, win = getWin();
    if (!p || !win || win.isDestroyed()) return stopWalk(false);
    const now = Date.now();
    const dt = (now - p.last) / 1000;
    p.last = now;
    const r = MOTION.stepWalk(p, dt);
    p.x = r.x;
    p.left = r.left;
    setWinPos(p.x, p.y);
    if (r.done) stopWalk();
  }

  function stopWalk(reschedule = true) {
    if (walk) {
      clearInterval(walk.timer);
      walk = null;
      const win = getWin();
      if (win && !win.isDestroyed()) {
        win.webContents.send('walk', false, 0, 0);
        const [px, py] = win.getPosition();
        getSettings().pos = { x: px, y: py };
        saveSettings();
      }
    }
    if (reschedule) scheduleWalk();
  }

  // o avatar avisa que está ocupado: se estava andando, para na hora
  function setWalkBusy(busy) {
    walkBusy = !!busy;
    if (walkBusy && walk) stopWalk();
  }


  // Deslocamento curto e controlado por voz. Não depende do passeio aleatório
  // e respeita os limites da área útil do monitor atual.
  function moveAside(direction = 'right', distance = 220) {
    const win = getWin();
    if (!win || win.isDestroyed() || !win.isVisible() || phys) return false;
    stopWalk(false);
    clearTimeout(walkTimer); walkTimer = null;
    if (voiceMove) { clearInterval(voiceMove.timer); voiceMove = null; }
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    const minX = wa.x, maxX = wa.x + wa.width - b.width;
    const sign = direction === 'left' ? -1 : 1;
    const target = Math.max(minX, Math.min(maxX, b.x + sign * Math.max(80, Math.min(360, Number(distance) || 220))));
    if (Math.abs(target - b.x) < 4) return false;
    voiceMove = { x: b.x, y: b.y, target, last: Date.now(), timer: null };
    const state = voiceMove;
    try { win.webContents.send('walk', true, sign, 260); } catch (_) {}
    state.timer = setInterval(() => {
      const current = getWin();
      if (voiceMove !== state || !current || current.isDestroyed()) {
        clearInterval(state.timer); if (voiceMove === state) voiceMove = null; return;
      }
      const now = Date.now(), dt = Math.min(0.05, Math.max(0.008, (now - state.last) / 1000));
      state.last = now;
      const delta = state.target - state.x;
      const step = Math.sign(delta) * Math.min(Math.abs(delta), 260 * dt);
      state.x += step;
      setWinPos(state.x, state.y);
      if (Math.abs(state.target - state.x) < 1) {
        setWinPos(state.target, state.y);
        clearInterval(state.timer); voiceMove = null;
        try { current.webContents.send('walk', false, 0, 0); } catch (_) {}
        const [px, py] = current.getPosition(); getSettings().pos = { x: px, y: py }; saveSettings();
        scheduleWalk();
      }
    }, 16);
    return true;
  }

  // ---------- Física de soltar (queda, quique, pouso) ----------
  function stopFall(rest) {
    if (phys) clearInterval(phys.timer);
    const was = !!phys;
    phys = null;
    const win = getWin();
    if (rest && win && !win.isDestroyed()) {
      win.webContents.send('phys', 'rest');
      const [px, py] = win.getPosition();
      getSettings().pos = { x: px, y: py };
      saveSettings();
      scheduleWalk();
    }
    return was;
  }

  function startFall(vx, vy) {
    stopFall(false);
    stopWalk(false);
    const win = getWin();
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const wa = screen.getDisplayMatching(b).workArea;
    if (MOTION.isAtRest(b, wa, vx, vy)) { win.webContents.send('phys', 'rest'); return; }
    phys = { x: b.x, y: b.y, w: b.width, h: b.height, vx, vy, last: Date.now(), timer: null };
    phys.timer = setInterval(stepFall, 16);
    win.webContents.send('phys', 'fall');
  }

  function stepFall() {
    const p = phys, win = getWin();
    if (!p || !win || win.isDestroyed()) return stopFall(false);
    const now = Date.now();
    const dt = (now - p.last) / 1000;
    p.last = now;
    const wa = screen.getDisplayMatching({ x: Math.round(p.x), y: Math.round(p.y), width: p.w, height: p.h }).workArea;
    const r = MOTION.stepFall(p, dt, wa, getSettings().bounce);
    p.x = r.x; p.y = r.y; p.vx = r.vx; p.vy = r.vy;
    if (r.landVy) win.webContents.send('phys', 'land', r.landVy);
    setWinPos(p.x, p.y);
    if (r.settled) stopFall(true);
  }

  return { winSize, setWinPos, applyScale, moveToCorner, scheduleWalk, startWalk, stopWalk, setWalkBusy, startFall, stopFall, moveAside };
}

module.exports = { createMovement };
