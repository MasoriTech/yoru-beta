'use strict';
// Janela da "mão livre": transparente, do tamanho da tela onde está o cursor, sempre por cima e que NUNCA pega o mouse
// (os cliques passam direto para os programas). O processo principal só lê a posição do cursor e repassa para o desenho.
const path = require('node:path');
const MOTION = require('./motion');
const HL = require('./hand-logic');

function createHandOverlay({ BrowserWindow, screen, lockNavigation = () => {}, getSettings, dir = __dirname, setTimer = setInterval, clearTimer = clearInterval }) {
  let win = null;
  let timer = null;
  let ready = false;
  let dispId = null;
  let last = { x: NaN, y: NaN };
  let curBounds = null;            // monitor onde a janela está
  let friendAbs = null;            // cabeça do avatar em coordenadas da tela toda

  const alive = () => win && !win.isDestroyed();
  const send = (channel, payload) => { if (alive() && ready) win.webContents.send(channel, payload); };

  function config() {
    const s = getSettings();
    return { size: s.handSize || 1, wander: s.handWander !== false, accent: s.panelAccent || '#ff7a2e' };
  }

  function place(display) {
    const b = display.bounds;
    const x = MOTION.toInt(b.x), y = MOTION.toInt(b.y), width = MOTION.toInt(b.width), height = MOTION.toInt(b.height);
    if ([x, y, width, height].includes(null)) return;
    win.setBounds({ x, y, width, height });
    dispId = display.id;
    curBounds = display.bounds;
    last = { x: NaN, y: NaN };
    sendFriend();
  }

  // a cabeça do avatar só vale se estiver neste monitor
  function sendFriend() {
    if (!friendAbs || !curBounds) return send('hand-friend', null);
    const x = friendAbs.x - curBounds.x, y = friendAbs.y - curBounds.y;
    const inside = x >= 0 && y >= 0 && x <= curBounds.width && y <= curBounds.height;
    send('hand-friend', inside ? { x, y, r: friendAbs.r } : null);
  }

  function poll() {
    if (!alive()) return;
    const p = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(p);
    if (d.id !== dispId) place(d);
    const x = p.x - d.bounds.x, y = p.y - d.bounds.y;
    if (x !== last.x || y !== last.y) { last = { x, y }; send('hand-cursor', { x, y }); }
  }

  function start() {
    if (alive()) return;
    const p = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(p);
    win = new BrowserWindow({
      x: MOTION.toInt(d.bounds.x), y: MOTION.toInt(d.bounds.y), width: MOTION.toInt(d.bounds.width), height: MOTION.toInt(d.bounds.height),
      transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, show: false, alwaysOnTop: true,
      webPreferences: { preload: path.join(dir, 'hand-preload.js'), contextIsolation: true, sandbox: true },
    });
    const w = win;
    dispId = d.id;
    curBounds = d.bounds;
    ready = false;
    lockNavigation(w);
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true);                 // nunca atrapa o mouse: dá pra clicar através da mão
    w.webContents.once('did-finish-load', () => {
      if (!alive() || win !== w) return;
      ready = true;
      w.showInactive();
      send('hand-config', config());
      sendFriend();
      poll();
    });
    w.on('closed', () => { if (win === w) { win = null; ready = false; } });
    w.loadFile(path.join(dir, 'hand.html'), { query: { accent: config().accent } });
    timer = setTimer(poll, 16);
    if (timer && timer.unref) timer.unref();
  }

  function stop() {
    if (timer) { clearTimer(timer); timer = null; }
    if (alive()) win.close();
    win = null; ready = false; dispId = null; curBounds = null; friendAbs = null;
  }

  // liga ou desliga conforme a configuração `handFree` e manda o tamanho/cor atuais
  function sync() {
    if (getSettings().handFree) { start(); send('hand-config', config()); } else stop();
  }
  // pose vinda da câmera (a lista é fixa; qualquer outra coisa é ignorada)
  function setPose(p) { if (HL.REMOTE_POSES.includes(p)) send('hand-pose', p); }

  // pose "presa" (ex.: punho enquanto o avatar está nas mãos) e cabeça do avatar (para a mão ir fazer carinho)
  function setHold(p) { if (HL.HOLD_POSES.includes(p)) send('hand-hold', p); }
  function setFriend(x, y, r) {
    friendAbs = [x, y].every(Number.isFinite) ? { x, y, r: Number.isFinite(r) ? r : 60 } : null;
    sendFriend();
  }
  // só a própria janela da mão pode avisar que fez um carinho
  const isSender = (wc) => !!(alive() && wc && win.webContents === wc);

  return { start, stop, sync, setPose, setHold, setFriend, isSender, poll, isRunning: () => !!alive() };
}

module.exports = { createHandOverlay };
