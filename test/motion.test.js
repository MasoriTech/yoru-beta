'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/motion');

const WA = { x: 0, y: 0, width: 1920, height: 1040 };   // área de trabalho (sem a barra de tarefas)
const W = 300, H = 400;
const FLOOR = M.floorTop(WA, H);
const seq = (...v) => { let i = 0; return () => v[Math.min(i++, v.length - 1)]; };

test('chão: os pés passam 5% da altura por cima da borda da área de trabalho', () => {
  assert.equal(FLOOR, 1040 - 400 + 20);
});

test('limites laterais: 20% pode sair pela esquerda, 20% pela direita', () => {
  assert.deepEqual(M.sideLimits(WA, W), { minX: -60, maxX: 1920 - 240 });
  const wa2 = { x: 1920, y: 0, width: 1280, height: 1000 }; // segundo monitor à direita
  assert.deepEqual(M.sideLimits(wa2, W), { minX: 1860, maxX: 1920 + 1280 - 240 });
});

test('passeio: longe do chão manda cair; perto só encosta os pés', () => {
  assert.equal(M.planWalk({ x: 500, y: 100, width: W, height: H }, WA, () => 0.5).kind, 'fall');
  const near = M.planWalk({ x: 500, y: FLOOR - 20, width: W, height: H }, WA, seq(0.5, 0.5));
  assert.equal(near.kind, 'walk'); assert.equal(near.snap, true); assert.equal(near.y, FLOOR);
  const below = M.planWalk({ x: 500, y: FLOOR + 30, width: W, height: H }, WA, seq(0.5, 0.5));
  assert.equal(below.snap, true);
  const on = M.planWalk({ x: 500, y: FLOOR, width: W, height: H }, WA, seq(0.5, 0.5));
  assert.equal(on.snap, false);
});

test('passeio: espalhado de um lado só, sem espaço nenhum, ele não anda', () => {
  const tiny = { x: 0, y: 0, width: 300, height: 1000 }; // área mal maior que a janela: sobra < 90 dos dois lados
  const sl = M.sideLimits(tiny, 300);
  const r = M.planWalk({ x: (sl.minX + sl.maxX) / 2, y: M.floorTop(tiny, 400), width: 300, height: 400 }, tiny, () => 0.5);
  assert.equal(r.kind, 'no');
});

test('passeio: escolhe o lado com espaço e nunca o lado sem espaço', () => {
  const { minX } = M.sideLimits(WA, W);
  // encostada na esquerda: sorteio baixo "pediria" esquerda? roomL ~ 0, então nunca escolhe esquerda
  for (const r of [0, 0.01, 0.5, 0.99]) {
    const p = M.planWalk({ x: minX + 10, y: FLOOR, width: W, height: H }, WA, seq(r, 0.5));
    assert.equal(p.dir, 1, `sorteio ${r}`);
  }
  const { maxX } = M.sideLimits(WA, W);
  for (const r of [0, 0.5, 0.99]) {
    const p = M.planWalk({ x: maxX - 10, y: FLOOR, width: W, height: H }, WA, seq(r, 0.5));
    assert.equal(p.dir, -1, `sorteio ${r}`);
  }
});

test('passeio: distância entre 160 e 680 px e nunca passa do espaço que sobra', () => {
  for (let i = 0; i < 300; i++) {
    const x = Math.random() * 1700 - 50;
    const p = M.planWalk({ x, y: FLOOR, width: W, height: H }, WA, Math.random);
    if (p.kind !== 'walk') continue;
    const room = p.dir > 0 ? p.maxX - x : x - p.minX;
    assert.ok(p.left <= room + 1e-9, 'não passa do limite');
    assert.ok(p.left >= Math.min(room, 160) - 1e-9 && p.left <= 680 + 1e-9);
  }
});

test('stepWalk: nunca sai dos limites e termina quando a distância acaba', () => {
  let p = { x: 1670, dir: 1, speed: 300, left: 500, minX: -60, maxX: 1680 };
  let done = false;
  for (let i = 0; i < 100 && !done; i++) {
    const r = M.stepWalk(p, 0.016);
    assert.ok(r.x <= 1680 && r.x >= -60);
    p = { ...p, x: r.x, left: r.left }; done = r.done;
  }
  assert.equal(done, true);
  assert.equal(p.x, 1680);
  // anda para o lado certo
  assert.ok(M.stepWalk({ x: 500, dir: -1, speed: 100, left: 300, minX: -60, maxX: 1680 }, 0.016).x < 500);
});

test('stepWalk: um engasgo (dt enorme) não dá salto', () => {
  const r = M.stepWalk({ x: 500, dir: 1, speed: 110, left: 400, minX: -60, maxX: 1680 }, 5);
  assert.ok(r.x - 500 <= 110 * 0.05 + 1e-9);
  assert.equal(M.stepWalk({ x: 500, dir: 1, speed: 110, left: 400, minX: -60, maxX: 1680 }, -1).x, 500); // relógio voltou
});

// simula a queda inteira como o main.js faz
function simulate(start, bounce, wa = WA, maxSteps = 20000) {
  let p = { w: W, h: H, ...start };
  const lands = [];
  for (let i = 0; i < maxSteps; i++) {
    const r = M.stepFall(p, 0.016, wa, bounce);
    assert.ok(Number.isFinite(r.x) && Number.isFinite(r.y), 'sem NaN');
    const { minX, maxX } = M.sideLimits(wa, W);
    assert.ok(r.x >= minX - 1e-9 && r.x <= maxX + 1e-9, `x dentro da tela (${r.x})`);
    assert.ok(r.y >= wa.y - 1e-9 && r.y <= M.floorTop(wa, H) + 1e-9, `y dentro da tela (${r.y})`);
    if (r.landVy) lands.push(r.landVy);
    p = { ...p, x: r.x, y: r.y, vx: r.vx, vy: r.vy };
    if (r.settled) return { p, steps: i + 1, lands };
  }
  return { p, steps: maxSteps, lands, stuck: true };
}

test('queda: sempre pousa no chão e para (não trava no ar), com ou sem quique', () => {
  for (const bounce of [0, 0.35, 0.8]) {
    for (const start of [
      { x: 800, y: 0, vx: 0, vy: 0 },
      { x: 800, y: 300, vx: 2500, vy: -1500 },   // arremessada para a direita e para cima
      { x: 800, y: 300, vx: -9000, vy: 0 },       // arremesso absurdo para a esquerda
      { x: 100, y: 0, vx: 0, vy: -20000 },        // bate no teto
    ]) {
      const r = simulate(start, bounce);
      assert.ok(!r.stuck, `travou: bounce=${bounce} ${JSON.stringify(start)}`);
      assert.equal(r.p.y, FLOOR);
      assert.ok(Math.abs(r.p.vx) < 12);
    }
  }
});

test('queda: quique com bounce>0 pousa mais de uma vez; com 0 pousa uma vez só', () => {
  const com = simulate({ x: 800, y: 0, vx: 0, vy: 0 }, 0.5);
  const sem = simulate({ x: 800, y: 0, vx: 0, vy: 0 }, 0);
  assert.ok(com.lands.length > 1, `quiques: ${com.lands.length}`);
  assert.equal(sem.lands.length, 1);
  assert.ok(com.lands[1] < com.lands[0], 'cada quique é mais fraco');
});

test('queda: parede lateral devolve o avatar para dentro e perde energia', () => {
  const { maxX } = M.sideLimits(WA, W);
  const r = M.stepFall({ x: maxX - 1, y: 100, w: W, h: H, vx: 2000, vy: 0 }, 0.016, WA, 0.35);
  assert.equal(r.x, maxX);
  assert.ok(r.vx < 0 && Math.abs(r.vx) <= 1000);
});

test('queda: teto devolve para baixo', () => {
  const r = M.stepFall({ x: 800, y: 2, w: W, h: H, vx: 0, vy: -3000 }, 0.016, WA, 0.35);
  assert.equal(r.y, WA.y);
  assert.ok(r.vy > 0);
});

test('queda: pouso fraco não avisa o avatar; pouso forte avisa', () => {
  const fraco = M.stepFall({ x: 800, y: FLOOR - 0.1, w: W, h: H, vx: 0, vy: 100 }, 0.016, WA, 0.35);
  assert.equal(fraco.landVy, 0);
  const forte = M.stepFall({ x: 800, y: FLOOR - 1, w: W, h: H, vx: 0, vy: 1500 }, 0.016, WA, 0.35);
  assert.ok(forte.landVy > 1500 && forte.vy < 0);
});

test('queda: funciona em monitor com origem diferente (área de trabalho deslocada)', () => {
  const wa2 = { x: -1920, y: 200, width: 1920, height: 1000 };
  const r = simulate({ x: -1500, y: 250, vx: 300, vy: 0 }, 0.35, wa2);
  assert.ok(!r.stuck);
  assert.equal(r.p.y, M.floorTop(wa2, H));
});

test('isAtRest: só dispensa a queda se já está no chão e quase parada', () => {
  assert.equal(M.isAtRest({ y: FLOOR, height: H }, WA, 10, 0), true);
  assert.equal(M.isAtRest({ y: FLOOR, height: H }, WA, 500, 0), false);
  assert.equal(M.isAtRest({ y: FLOOR, height: H }, WA, 0, -400), false);   // jogada para cima
  assert.equal(M.isAtRest({ y: FLOOR - 100, height: H }, WA, 0, 0), false);
});
