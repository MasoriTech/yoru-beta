'use strict';
// Regressão do erro "TypeError: Error processing argument at index 0, conversion failure from" em BrowserWindow.setBounds
// (movement.js → setWinPos, chamado a cada 16 ms durante o passeio). O Electron só aceita inteiros de verdade: NaN e -0 são recusados.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/motion');
const { createMovement } = require('../src/movement');

const isElectronInt = (v) => typeof v === 'number' && Number.isInteger(v) && !Object.is(v, -0);

function fakeWin() {
  const calls = [];
  return {
    calls,
    isDestroyed: () => false,
    isVisible: () => true,
    getBounds: () => ({ x: 0, y: 0, width: 300, height: 400 }),
    setBounds(r) {
      for (const k of ['x', 'y', 'width', 'height']) {
        if (!isElectronInt(r[k])) throw new TypeError(`Error processing argument at index 0, conversion failure from ${k}=${Object.is(r[k], -0) ? '-0' : r[k]}`);
      }
      calls.push(r);
    },
  };
}
function setup(settings = {}) {
  const win = fakeWin();
  const mv = createMovement({
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) },
    getWin: () => win, getSettings: () => ({ scale: 1, ...settings }), saveSettings() {}, base: { w: 300, h: 400 },
  });
  return { win, mv };
}

test('toInt: troca -0 por 0 e recusa NaN/Infinity', () => {
  assert.ok(Object.is(M.toInt(-0.3), 0));
  assert.ok(Object.is(M.toInt(-0), 0));
  assert.equal(M.toInt(12.6), 13);
  assert.equal(M.toInt('7'), 7);
  assert.equal(M.toInt(NaN), null);
  assert.equal(M.toInt(Infinity), null);
  assert.equal(M.toInt(undefined), null);
});

test('setWinPos: x entre -0,5 e 0 (passando pelo x=0 da tela) não vira -0', () => {
  const { win, mv } = setup();
  assert.doesNotThrow(() => mv.setWinPos(-0.3, 620));
  assert.ok(Object.is(win.calls[0].x, 0));
});

test('setWinPos: posição inválida (NaN) é ignorada em vez de derrubar o app', () => {
  const { win, mv } = setup();
  assert.doesNotThrow(() => mv.setWinPos(NaN, 620));
  assert.doesNotThrow(() => mv.setWinPos(100, undefined));
  assert.equal(win.calls.length, 0);
});

test('winSize: escala inválida cai no tamanho base', () => {
  const { mv } = setup({ scale: undefined });
  assert.deepEqual(mv.winSize(), { width: 300, height: 400 });
});

test('passeio atravessando x=0 nos dois sentidos nunca manda -0 ao Electron', () => {
  const { win, mv } = setup();
  for (const dir of [-1, 1]) {
    for (let speed = 40; speed <= 300; speed += 7) {   // várias velocidades = vários "fracionados" diferentes
      const p = { x: dir < 0 ? 150 : -60, dir, speed, left: 400, minX: -60, maxX: 1680 };
      let guard = 0;
      while (guard++ < 10000) {
        const r = M.stepWalk(p, 0.016);
        p.x = r.x; p.left = r.left;
        mv.setWinPos(p.x, 620);                          // lançaria TypeError se algum valor fosse -0
        if (r.done) break;
      }
    }
  }
  assert.ok(win.calls.length > 1000);
  assert.ok(win.calls.every((c) => isElectronInt(c.x) && isElectronInt(c.y)));
});

test('queda: x fracionado perto de 0 também passa', () => {
  const { mv } = setup();
  const WA = { x: 0, y: 0, width: 1920, height: 1040 };
  let p = { x: 40, y: 100, w: 300, h: 400, vx: -250, vy: 0 };
  for (let i = 0; i < 400; i++) {
    const r = M.stepFall(p, 0.016, WA, 0.35);
    p = { ...p, x: r.x, y: r.y, vx: r.vx, vy: r.vy };
    mv.setWinPos(p.x, p.y);
    if (r.settled) break;
  }
});
