'use strict';
// Mão livre: mola/passeio (hand-logic), janela transparente (hand-window), roda do mouse, punho que agarra e ligação painel → main.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const HL = require('../src/hand-logic');
const GL = require('../src/gesture-logic');
const { DEFAULTS, sanitize } = require('../src/settings');
const { createAirMouse } = require('../src/air-mouse');
const { createHandOverlay } = require('../src/hand-window');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const seq = (...v) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };

test('mola: a ponta da mão chega no cursor e para lá', () => {
  const s = HL.createHandSim({ rnd: () => 0.5 });
  s.jumpTo(100, 100);
  s.setCursor(900, 500, 0);
  let r;
  for (let i = 0; i < 200; i++) r = s.step(0.016, i * 16);
  assert.ok(Math.abs(r.x - 900) < 1 && Math.abs(r.y - 500) < 1, `${r.x},${r.y}`);
  assert.equal(r.wandering, false);
  assert.ok(Math.abs(r.rot) < 1, 'parada: sem inclinação');
});

test('inclinação acompanha o lado em que vai e fica limitada', () => {
  const s = HL.createHandSim();
  s.jumpTo(0, 300); s.setCursor(1900, 300, 0);
  let max = 0, r;
  for (let i = 0; i < 40; i++) { r = s.step(0.016, i * 16); max = Math.max(max, r.rot); }
  assert.ok(max > 5 && max <= 22, String(max));
});

test('passeia sozinha depois de ~7 s parada e volta quando o cursor mexe', () => {
  const s = HL.createHandSim({ rnd: seq(0.1, 0.9, 0.5, 0.2, 0.7) });
  s.jumpTo(500, 500); s.setCursor(500, 500, 0);
  let t = 0, r;
  for (; t < 6900; t += 16) { r = s.step(0.016, t); assert.equal(r.wandering, false); }
  for (; t < 12000; t += 16) r = s.step(0.016, t);
  assert.equal(r.wandering, true);
  assert.ok(Math.hypot(r.x - 500, r.y - 500) > 50, 'saiu do lugar');
  assert.equal(s.setCursor(520, 500, t), true);          // mexeu mais de 3 px
  r = s.step(0.016, t + 16);
  assert.equal(r.wandering, false);
});

test('passeio desligado nas configurações nunca passeia', () => {
  const s = HL.createHandSim();
  s.setCursor(10, 10, 0);
  for (let t = 0; t < 30000; t += 16) assert.equal(s.step(0.016, t, { wanderEnabled: false }).wandering, false);
});

test('entradas inválidas (NaN) não quebram a mola', () => {
  const s = HL.createHandSim();
  s.setCursor(NaN, undefined, 0);
  const r = s.step(NaN, 0);
  for (const k of ['x', 'y', 'rot', 'bob']) assert.ok(Number.isFinite(r[k]), k);
});

test('wanderTarget fica dentro da tela, longe das bordas', () => {
  for (const v of [0, 0.5, 0.999]) {
    const p = HL.wanderTarget(() => v, 1920, 1080, 90);
    assert.ok(p.x >= 90 && p.x <= 1830 && p.y >= 90 && p.y <= 990, JSON.stringify(p));
  }
});

test('pose: a da câmera vale por 600 ms; depois a própria mão escolhe', () => {
  assert.equal(HL.resolvePose({ remote: 'fist', remoteAt: 1000, now: 1300 }), 'fist');
  assert.equal(HL.resolvePose({ remote: 'fist', remoteAt: 1000, now: 1700, moving: true }), 'point');
  assert.equal(HL.resolvePose({ remote: 'auto', remoteAt: 1000, now: 1100, moving: false }), 'open');
  assert.equal(HL.resolvePose({ remote: 'auto', now: 5000, wandering: true, moving: true }), 'open');
  assert.equal(HL.resolvePose({ remote: 'hack', remoteAt: 1000, now: 1100 }), 'open');
});

test('configurações: valores padrão e limites', () => {
  assert.equal(DEFAULTS.handFree, false);
  assert.equal(DEFAULTS.handWander, true);
  assert.equal(sanitize({ handSize: 99 }, DEFAULTS).handSize, 2);
  assert.equal(sanitize({ handSize: 0 }, DEFAULTS).handSize, 0.6);
  assert.equal(sanitize({ handSize: 'x' }, DEFAULTS).handSize, 1);
  assert.equal(sanitize({ handFree: 1 }, DEFAULTS).handFree, true);
});

test('roda do mouse: só número inteiro limitado vira comando', () => {
  const written = [];
  const fake = () => ({ stdin: { write: (s) => written.push(s), on() {}, end() {} }, on() {}, kill() {} });
  const am = createAirMouse({ platform: 'win32', spawnFn: fake });
  assert.equal(am.handle({ t: 'w', d: 240 }), true);
  assert.equal(am.handle({ t: 'w', d: -99999 }), true);
  assert.equal(am.handle({ t: 'w', d: 'rm -rf' }), false);
  assert.equal(am.handle({ t: 'w', d: 0 }), false);
  assert.deepEqual(written, ['w 240\n', 'w -1200\n']);
  am.stop();
});

function pointerLm({ tipX = 0.5, tipY = 0.5, palmX = 0.5, palmY = 0.6, open = true } = {}) {
  const lm = Array.from({ length: 21 }, () => ({ x: palmX, y: palmY }));
  lm[0] = { x: palmX, y: palmY + 0.2 }; lm[9] = { x: palmX, y: palmY };
  lm[8] = open ? { x: tipX, y: tipY } : { x: palmX, y: palmY + 0.02 };
  lm[4] = { x: palmX - 0.25, y: palmY };                 // polegar longe: sem pinça
  lm[12] = { x: palmX + 0.25, y: palmY };
  return lm;
}

test('punho agarra: aperta o botão sem pular o cursor, arrasta pela palma e solta ao abrir', () => {
  const ptr = GL.createPointer({ now: () => 0, sens: 3 });
  let r = ptr.update(pointerLm({ tipX: 0.5, tipY: 0.4, palmX: 0.5, palmY: 0.6 }));
  const before = { x: r.x, y: r.y };
  r = ptr.update(pointerLm({ open: false, palmX: 0.5, palmY: 0.6 }), 4 / 3, { fist: true });
  assert.deepEqual(r.events, ['down']);
  assert.equal(r.grab, true);
  assert.ok(Math.abs(r.x - before.x) < 1e-9 && Math.abs(r.y - before.y) < 1e-9, 'cursor não pula ao agarrar');
  const r2 = ptr.update(pointerLm({ open: false, palmX: 0.4, palmY: 0.6 }), 4 / 3, { fist: true });
  assert.ok(r2.x > r.x, 'mão foi para a sua direita (imagem espelhada): cursor acompanha');
  assert.deepEqual(r2.events, []);
  const r3 = ptr.update(pointerLm({ tipX: 0.4, tipY: 0.4, palmX: 0.4 }), 4 / 3, { fist: false });
  assert.deepEqual(r3.events, ['up']);
  assert.equal(r3.grab, false);
});

test('release solta o botão se estava agarrando; "hold" congela o cursor', () => {
  const ptr = GL.createPointer({ now: () => 0 });
  ptr.update(pointerLm({ tipX: 0.5, tipY: 0.4 }));
  ptr.update(pointerLm({ open: false }), 4 / 3, { fist: true });
  assert.deepEqual(ptr.release(), ['up']);
  const a = ptr.update(pointerLm({ tipX: 0.5, tipY: 0.4 }));
  const b = ptr.update(pointerLm({ tipX: 0.2, tipY: 0.2 }), 4 / 3, { hold: true });
  assert.equal(b.x, a.x); assert.equal(b.y, a.y);
});

test('janela da mão: transparente, sem foco, não pega o mouse e segue a tela do cursor', () => {
  const calls = { opts: null, ignore: null, bounds: [], sent: [], closed: false, loaded: null, finish: null };
  class FakeWin {
    constructor(o) { calls.opts = o; this.webContents = { once: (_e, f) => { calls.finish = f; }, send: (ch, p) => calls.sent.push([ch, p]) }; }
    isDestroyed() { return calls.closed; }
    setAlwaysOnTop() {} setIgnoreMouseEvents(v) { calls.ignore = v; } showInactive() {} on() {}
    setBounds(b) { calls.bounds.push(b); } loadFile(f, o) { calls.loaded = [f, o]; } close() { calls.closed = true; }
  }
  const d1 = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, d2 = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 } };
  let cur = { x: 100, y: 200 };
  const screen = { getCursorScreenPoint: () => cur, getDisplayNearestPoint: (p) => (p.x >= 1920 ? d2 : d1) };
  const settings = { handFree: true, handSize: 1.4, handWander: false, panelAccent: '#00b4d8' };
  const ov = createHandOverlay({ BrowserWindow: FakeWin, screen, getSettings: () => settings, setTimer: () => ({}), clearTimer() {} });
  ov.sync();
  assert.equal(calls.opts.transparent, true); assert.equal(calls.opts.focusable, false); assert.equal(calls.opts.frame, false);
  assert.equal(calls.ignore, true, 'tem de deixar o mouse passar');
  assert.equal(calls.opts.webPreferences.contextIsolation, true); assert.equal(calls.opts.webPreferences.sandbox, true);
  assert.equal(calls.opts.webPreferences.nodeIntegration, undefined);
  assert.match(calls.loaded[0], /hand\.html$/);
  assert.equal(ov.isRunning(), true);
  const first = calls.opts; ov.start(); assert.equal(calls.opts, first, 'ligar de novo não cria outra janela');

  assert.equal(calls.sent.length, 0, 'antes de carregar não manda nada');
  calls.finish();
  assert.deepEqual(calls.sent[0], ['hand-config', { size: 1.4, wander: false, accent: '#00b4d8' }]);
  assert.deepEqual(calls.sent[1], ['hand-friend', null], 'ainda não sabe onde está o avatar');
  assert.deepEqual(calls.sent[2], ['hand-cursor', { x: 100, y: 200 }]);

  cur = { x: 2000, y: 40 };                          // cursor foi para o segundo monitor
  ov.poll();
  assert.deepEqual(calls.bounds.at(-1), { x: 1920, y: 0, width: 1280, height: 1024 });
  assert.deepEqual(calls.sent.at(-1), ['hand-cursor', { x: 80, y: 40 }], 'posição relativa ao monitor');
  const n = calls.sent.length; ov.poll(); assert.equal(calls.sent.length, n, 'cursor parado não manda de novo');

  ov.setPose('fist'); assert.deepEqual(calls.sent.at(-1), ['hand-pose', 'fist']);
  ov.setHold('fist'); assert.deepEqual(calls.sent.at(-1), ['hand-hold', 'fist']);
  ov.setHold('none'); assert.deepEqual(calls.sent.at(-1), ['hand-hold', 'none']);
  const h = calls.sent.length; ov.setHold('<x>'); assert.equal(calls.sent.length, h, 'hold fora da lista é ignorado');
  // cabeça do avatar: só vale no monitor onde a mão está
  ov.setFriend(2100, 300, 70); assert.deepEqual(calls.sent.at(-1), ['hand-friend', { x: 180, y: 300, r: 70 }]);
  ov.setFriend(500, 300, 70); assert.deepEqual(calls.sent.at(-1), ['hand-friend', null], 'avatar em outro monitor');
  ov.setFriend(NaN, 1, 1); assert.deepEqual(calls.sent.at(-1), ['hand-friend', null]);
  assert.equal(ov.isSender({}), false); assert.equal(ov.isSender(null), false);
  const m = calls.sent.length; ov.setPose('<script>'); ov.setPose(42); assert.equal(calls.sent.length, m, 'pose fora da lista é ignorada');

  settings.handFree = false; ov.sync();
  assert.equal(calls.closed, true); assert.equal(ov.isRunning(), false);
});

test('ligação: painel → preload → main; a janela da mão não envia nada ao main', () => {
  assert.match(read('src', 'panel-preload.js'), /handPose: \(pose\) => ipcRenderer\.send\('hand-pose', pose\)/);
  const main = read('src', 'main.js');
  assert.match(main, /secureIpcMain\.on\('hand-pose', \(e, pose\) => \{ if \(isPanelSender\(e\.sender\)\) handOverlay\.setPose\(pose\); \}\)/);
  assert.match(main, /will-quit', \(\) => handOverlay\.stop\(\)/);
  assert.match(main, /'handFree' in partial \|\| 'handSize' in partial \|\| 'handWander' in partial\) handOverlay\.sync\(\)/);
  const pre = read('src', 'hand-preload.js');
  assert.deepEqual([...pre.matchAll(/ipcRenderer\.(send|invoke)\('([\w-]+)'/g)].map((m) => m[2]), ['hand-pat'], 'a janela da mão só pode avisar "fiz carinho", sem dados');
  assert.match(main, /secureIpcMain\.on\('hand-pat', \(e\) => \{\n    if \(!handOverlay\.isSender\(e\.sender\)/);
  assert.match(main, /secureIpcMain\.on\('avatar-grab', \(e, on\) => \{ if \(fromAvatar\(e\)\)/);
  assert.match(main, /secureIpcMain\.on\('avatar-head', \(e, x, y, r\) => \{\n    if \(!fromAvatar\(e\) \|\| !settings\.handFree\) return;/);
  assert.match(read('src', 'preload.js'), /grabState: \(on\) => ipcRenderer\.send\('avatar-grab', !!on\)/);
  assert.match(read('src', 'preload.js'), /reportHead: \(x, y, r\) => ipcRenderer\.send\('avatar-head', x, y, r\)/);
  assert.match(main, /!\(settings\.followCursor \|\| settings\.handFree\) \|\| !settings\.visible/, 'o avatar recebe o cursor também só com a mão livre (carinho)');
  const rend = read('src', 'renderer.js') + read('src', 'pointer.js') + read('src', 'cursor-follow.js'); // o mouse mora em pointer.js e o carinho em cursor-follow.js
  assert.match(rend, /api\.grabState\(true\)/); assert.match(rend, /api\.grabState\(false\)/); assert.match(rend, /patCheck\(c\)/);
  assert.match(read('src', 'hand.html'), /hand-logic\.js/);
  assert.ok(GL.isValidAction('hand-free') && GL.UI_ACTIONS.includes('hand-free'));
  const html = read('src', 'panel.html');
  for (const id of ['gHand']) assert.match(html, new RegExp(`id="${id}"`));
  for (const key of ['handFree', 'handSize', 'handWander']) assert.match(html, new RegExp(`data-key="${key}"`));
});

test('visita: com o avatar por perto a mão vai até a cabeça, faz carinho (avisa uma vez) e depois segue passeando', () => {
  const s = HL.createHandSim({ rnd: seq(0.2, 0.5, 0.5, 0.5, 0.9, 0.9, 0.9) });   // 0.2 < 0.55: escolhe visitar
  s.jumpTo(200, 800); s.setCursor(200, 800, 0);
  s.setFriend({ x: 1000, y: 300, r: 70 });
  let t = 0, r, arrivedTimes = 0, maxVisit = 0;
  for (; t < 7100; t += 16) s.step(0.016, t);
  for (; t < 30000; t += 16) {
    r = s.step(0.016, t);
    if (r.arrived) arrivedTimes++;
    if (r.visiting) maxVisit = Math.max(maxVisit, 1);
  }
  assert.equal(maxVisit, 1, 'visitou');
  assert.ok(arrivedTimes >= 1, 'avisou que chegou');
  s.jumpTo(0, 0);
});

test('visita: fica ao lado da cabeça, balança para os lados e acompanha o avatar andando', () => {
  const s = HL.createHandSim({ rnd: () => 0.1 });                  // sempre escolhe visitar
  s.jumpTo(900, 300); s.setCursor(900, 300, 0);
  s.setFriend({ x: 1000, y: 300, r: 70 });
  let t = 0, r, xs = [];
  for (; t < 7100; t += 16) s.step(0.016, t);
  for (let i = 0; i < 300; i++, t += 16) { r = s.step(0.016, t); if (r.visiting) xs.push(r.x); }
  assert.ok(xs.length > 100);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 20, 'vai e vem');
  assert.ok(xs.every((x) => x > 900 && x < 1200), 'ao lado da cabeça');
  s.setFriend({ x: 1500, y: 300, r: 70 });                         // o avatar andou
  for (let i = 0; i < 200; i++, t += 16) r = s.step(0.016, t);
  assert.ok(r.x > 1300, `acompanhou: ${r.x}`);
  s.setFriend(null);                                               // sumiu: desiste da visita
  r = s.step(0.016, t);
  assert.equal(r.visiting, false);
});

test('visita nunca acontece com o passeio desligado nem sem avatar na tela', () => {
  const a = HL.createHandSim({ rnd: () => 0.1 }); a.setFriend({ x: 500, y: 300, r: 60 });
  for (let t = 0; t < 30000; t += 16) assert.equal(a.step(0.016, t, { wanderEnabled: false }).visiting, false);
  const b = HL.createHandSim({ rnd: () => 0.1 });
  for (let t = 0; t < 30000; t += 16) assert.equal(b.step(0.016, t).visiting, false);
});

test('pose presa (avatar nas mãos) vence qualquer outra', () => {
  assert.equal(HL.resolvePose({ hold: 'fist', remote: 'point', remoteAt: 1000, now: 1100 }), 'fist');
  assert.equal(HL.resolvePose({ hold: 'none', moving: true, now: 0 }), 'point');
  assert.equal(HL.resolvePose({ hold: 'bogus', now: 0 }), 'open');
});
