'use strict';
// "Mão livre": a mão virtual flutuante que fica no lugar do cursor, anda pela tela e acompanha o mouse (ou a câmera).
// Aqui mora só a matemática (sem Electron e sem DOM), para testar com `npm test`: a mola que segue o cursor, a inclinação,
// o passeio sozinho quando o cursor fica parado e a escolha da pose. O desenho fica em hand.js.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HandLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // open = mão aberta · point = indicador · pinch = pinça (clicando) · fist = punho (agarrando) · scroll = ✌️ (rolando)
  const POSES = ['open', 'point', 'pinch', 'fist', 'scroll'];
  const REMOTE_POSES = [...POSES, 'auto'];   // 'auto' = quem manda na pose é a própria mão virtual
  const HOLD_POSES = [...POSES, 'none'];     // pose "presa" enquanto o avatar está nas mãos (mouse comum não avisa o clique)
  const REMOTE_TTL = 600;                    // ms que a pose vinda da câmera vale sem uma nova mensagem

  const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ponto sorteado dentro da tela, longe das bordas
  function wanderTarget(rnd, w, h, margin = 90) {
    const mx = Math.min(margin, w / 3), my = Math.min(margin, h / 3);
    return { x: mx + rnd() * Math.max(1, w - 2 * mx), y: my + rnd() * Math.max(1, h - 2 * my) };
  }

  // pose atual: a que a câmera mandou (se for recente) ou a que a mão escolhe sozinha
  function resolvePose({ remote = 'auto', remoteAt = 0, now = 0, moving = false, wandering = false, hold = 'none' }) {
    if (POSES.includes(hold)) return hold;
    if (POSES.includes(remote) && now - remoteAt < REMOTE_TTL) return remote;
    if (wandering) return 'open';
    return moving ? 'point' : 'open';
  }

  // Mola: o cursor é o alvo (a ponta do indicador fica exatamente nele). Cursor parado por `wanderAfterMs` => passeia sozinha.
  function createHandSim({ rnd = Math.random, wanderAfterMs = 7000 } = {}) {
    let W = 1920, H = 1080;
    let x = W / 2, y = H / 2, vx = 0, vy = 0;
    let cx = x, cy = y;            // último cursor
    let lastMoveAt = 0;
    let wander = null;             // { x, y, dwellUntil, visit }
    let friend = null;             // cabeça do avatar { x, y, r } (coordenadas da tela da janela): a mão às vezes vai fazer um carinho
    let arrivedAt = 0;
    let rot = 0;
    return {
      setScreen(w, h) { W = Math.max(200, num(w, 1920)); H = Math.max(200, num(h, 1080)); },
      // posição do cursor em coordenadas da tela da janela; devolve true se mexeu de verdade (mais de 3 px)
      setCursor(px, py, t) {
        px = num(px, cx); py = num(py, cy);
        const moved = Math.hypot(px - cx, py - cy) > 3;
        cx = px; cy = py;
        if (moved) { lastMoveAt = t; wander = null; }
        return moved;
      },
      // onde está a cabeça do avatar (ou null se não está nesta tela)
      setFriend(f) { friend = f && Number.isFinite(f.x) && Number.isFinite(f.y) ? { x: f.x, y: f.y, r: clamp(num(f.r, 60), 20, 300) } : null; },
      jumpTo(px, py) { x = cx = num(px, x); y = cy = num(py, y); vx = vy = 0; wander = null; },
      step(dt, t, { wanderEnabled = true } = {}) {
        dt = clamp(num(dt, 0.016), 0, 0.05);
        const pick = () => (friend && rnd() < 0.55 ? visitTarget() : { ...wanderTarget(rnd, W, H), dwellUntil: 0 });
        const visitTarget = () => ({ x: friend.x + friend.r * 1.15, y: friend.y - friend.r * 0.2, dwellUntil: 0, visit: true });
        let arrived = false;
        if (wanderEnabled && !wander && t - lastMoveAt > wanderAfterMs) wander = pick();
        if (!wanderEnabled) wander = null;
        let tx = cx, ty = cy, k = 320;                       // seguindo o cursor: firme, quase sem atraso
        if (wander && wander.visit) {                         // visita ao avatar: acompanha a cabeça dele (ele anda); se sumiu, desiste
          if (!friend) wander = pick();
          else { wander.x = friend.x + friend.r * 1.15; wander.y = friend.y - friend.r * 0.2; }
        }
        if (wander) {
          tx = wander.x; ty = wander.y; k = 14;              // passeando: bem solta e preguiçosa
          if (Math.hypot(tx - x, ty - y) < (wander.visit ? 40 : 26) && !wander.dwellUntil) {
            wander.dwellUntil = t + (wander.visit ? 3800 : 1800 + rnd() * 2600);
            if (wander.visit) { arrived = true; arrivedAt = t; }
          }
          if (wander.visit && wander.dwellUntil) {            // fazendo carinho: vai e vem ao lado da cabeça
            k = 60;
            tx += Math.sin((t - arrivedAt) / 1000 * 9) * friend.r * 0.35;
            ty -= Math.abs(Math.sin((t - arrivedAt) / 1000 * 4.5)) * friend.r * 0.12;
          }
          if (wander.dwellUntil && t >= wander.dwellUntil) wander = pick();
        }
        const c = 2 * Math.sqrt(k) * 0.9;
        vx += (k * (tx - x) - c * vx) * dt;
        vy += (k * (ty - y) - c * vy) * dt;
        x += vx * dt; y += vy * dt;
        const target = clamp(vx * 0.018, -22, 22);           // inclina para o lado em que está indo
        rot += (target - rot) * Math.min(1, dt * 9);
        const moving = Math.hypot(vx, vy) > 60;
        const bob = Math.sin(t / 1000 * 2.4) * (wander ? 7 : 1.5);
        return { x, y, rot, bob, moving, wandering: !!wander, visiting: !!(wander && wander.visit), arrived, speed: Math.hypot(vx, vy) };
      },
      isWandering: () => !!wander,
    };
  }

  return { POSES, REMOTE_POSES, HOLD_POSES, REMOTE_TTL, wanderTarget, resolvePose, createHandSim };
});
