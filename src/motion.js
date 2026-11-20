'use strict';
// Matemática do passeio e da queda do avatar, sem Electron e sem relógio: tudo aqui é função pura
// (entra tamanho da janela, área de trabalho, sorteio e tempo; sai a próxima posição), para testar com `npm test`.
// O main.js só liga isso a setWinPos/setInterval.

const GRAVITY = 2800;        // px/s²
const AIR_DRAG = 0.6;        // fração da velocidade horizontal perdida por segundo no ar
const FLOOR_FRICTION = 0.005; // fator por segundo do atrito no chão (vx *= 0.005^dt)
const MIN_ROOM = 90;         // espaço mínimo (px) para valer a pena sair andando para um lado
const LAND_VY = 300;         // abaixo disso o pouso não avisa o avatar
const BOUNCE_VY = 260;       // abaixo disso não quica
const REST_VY = 140;         // velocidade vertical abaixo disso zera
const REST_VX = 12;          // deslizando mais devagar que isso, ela para

// O Electron só aceita inteiros "de verdade" em setBounds: NaN, Infinity e até -0 dão
// "TypeError: Error processing argument at index 0, conversion failure from ...".
// Math.round(-0.3) é -0, e isso acontece sempre que o avatar anda passando pelo x = 0 da tela.
// Retorna um inteiro finito (com +0) ou null se o valor não presta.
function toInt(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n + 0 : null;   // n + 0 troca -0 por +0
}

// os pés encostam na barra de tarefas
function floorTop(wa, h) {
  return wa.y + wa.height - h + Math.round(h * 0.05);
}

// a janela pode sair 20% pela esquerda e 20% pela direita (o avatar nunca some inteiro)
function sideLimits(wa, w) {
  return { minX: wa.x - w * 0.2, maxX: wa.x + wa.width - w * 0.8 };
}

// Decide o que fazer ao começar um passeio. `rnd` é um sorteio () => [0,1) (injetável para testar).
// Retorna { kind: 'no' } | { kind: 'fall' } | { kind: 'walk', snap, x, y, dir, left, minX, maxX }
// snap = true quando precisa só encostar os pés no chão antes de andar.
function planWalk(b, wa, rnd, o = {}) {
  const floor = floorTop(wa, b.height);
  let snap = false;
  if (b.y < floor - 2) {
    if (floor - b.y <= b.height * 0.08) snap = true;   // quase no chão: só encosta os pés
    else return { kind: 'fall' };                      // longe do chão: cai primeiro e passeia depois
  } else if (b.y > floor) snap = true;
  const { minX, maxX } = sideLimits(wa, b.width);
  const roomL = b.x - minX, roomR = maxX - b.x;
  if (roomL < MIN_ROOM && roomR < MIN_ROOM) return { kind: 'no' };
  let dir = rnd() < roomR / (roomL + roomR) ? 1 : -1;  // tende a ir para o lado com mais espaço
  if ((dir > 0 ? roomR : roomL) < MIN_ROOM) dir = -dir;
  const room = dir > 0 ? roomR : roomL;
  const left = Math.min(room, (o.minDist || 160) + rnd() * (o.spread || 520));
  return { kind: 'walk', snap, x: b.x, y: floor, dir, left, minX, maxX };
}

// Um passo do passeio. p: { x, dir, speed, left, minX, maxX }. dt em segundos (já limitado pelo chamador ou aqui).
function stepWalk(p, dt) {
  dt = Math.min(0.05, Math.max(0, dt));
  const d = Math.min(p.left, p.speed * dt);
  let x = p.x + p.dir * d;
  let left = p.left - d;
  if (x < p.minX) { x = p.minX; left = 0; }
  if (x > p.maxX) { x = p.maxX; left = 0; }
  return { x, left, done: left <= 0.5 };
}

// Um passo da queda. p: { x, y, w, h, vx, vy }; wa: área de trabalho; bounce: 0..0.8.
// Retorna { x, y, vx, vy, landVy, settled }: landVy > 0 quando tocou o chão forte o bastante para avisar o avatar.
function stepFall(p, dt, wa, bounce) {
  dt = Math.min(0.04, Math.max(0, dt));
  let { x, y, vx, vy } = p;
  vy += GRAVITY * dt;
  vx *= Math.max(0, 1 - AIR_DRAG * dt);
  x += vx * dt;
  y += vy * dt;

  const { minX, maxX } = sideLimits(wa, p.w);
  if (x < minX) { x = minX; vx = Math.abs(vx) * 0.5; }
  if (x > maxX) { x = maxX; vx = -Math.abs(vx) * 0.5; }
  if (y < wa.y) { y = wa.y; vy = Math.abs(vy) * 0.3; }

  const floor = floorTop(wa, p.h);
  let landVy = 0;
  if (y >= floor) {
    y = floor;
    if (vy > LAND_VY) landVy = vy;
    if (vy > BOUNCE_VY && bounce > 0.05) { vy = -vy * bounce; vx *= 0.7; }
    else vy = 0;
    if (Math.abs(vy) < REST_VY) vy = 0;
  }

  let settled = false;
  if (y >= floor && vy === 0) {        // no chão: o atrito freia o deslize
    vx *= Math.pow(FLOOR_FRICTION, dt);
    if (Math.abs(vx) < REST_VX) settled = true;
  }
  return { x, y, vx, vy, landVy, settled };
}

// Soltar já no chão e quase parada não precisa cair
function isAtRest(b, wa, vx, vy) {
  return b.y >= floorTop(wa, b.height) - 2 && Math.abs(vx) < 60 && vy > -60;
}

module.exports = { toInt, floorTop, sideLimits, planWalk, stepWalk, stepFall, isAtRest, MIN_ROOM };
