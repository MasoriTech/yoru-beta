'use strict';
// Desenho da mão virtual (arte própria: luva clara com punho laranja, flutuando). A ponta do indicador fica sempre em cima do cursor.
(function () {
  const HL = window.HandLogic;
  const NS = 'http://www.w3.org/2000/svg';
  const q = new URLSearchParams(location.search);
  let accent = /^#[0-9a-f]{6}$/i.test(q.get('accent') || '') ? q.get('accent') : '#ff7a2e';
  const INK = '#2b2233', GLOVE = '#fff8ec', SHADE = '#f0dfc6';

  // dedos: base na palma, ângulo (graus, 0 = para cima), comprimento e espessura
  const FINGERS = [
    { id: 'index', bx: -17, by: -24, a: -9, len: 50, w: 15 },
    { id: 'middle', bx: -4, by: -28, a: -2, len: 56, w: 15 },
    { id: 'ring', bx: 10, by: -26, a: 6, len: 49, w: 14 },
    { id: 'pinky', bx: 22, by: -19, a: 15, len: 38, w: 12 },
  ];
  const THUMB = { bx: -27, by: 10, a: -58, len: 38, w: 14 };
  // cada pose: curl (0 = esticado, 1 = dobrado) por dedo, abertura extra (graus) e quanto o polegar encontra o indicador
  const POSE = {
    open: { index: 0, middle: 0, ring: 0, pinky: 0, thumb: 0, spread: 1, meet: 0 },
    point: { index: 0, middle: 1, ring: 1, pinky: 1, thumb: 0.7, spread: 0, meet: 0 },
    pinch: { index: 0.72, middle: 0.35, ring: 0.45, pinky: 0.55, thumb: 0, spread: 0.2, meet: 1 },
    fist: { index: 1, middle: 1, ring: 1, pinky: 1, thumb: 1, spread: 0, meet: 0 },
    scroll: { index: 0, middle: 0, ring: 1, pinky: 1, thumb: 1, spread: 0.4, meet: 0 },
  };
  const cur = JSON.parse(JSON.stringify(POSE.open));   // valores que estão sendo desenhados (vão se aproximando da pose)

  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const g = document.getElementById('hand');
  const body = el('g', {}, g);
  const outline = el('g', { stroke: INK, fill: INK, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, body);
  const fill = el('g', { stroke: GLOVE, fill: GLOVE, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, body);
  const details = el('g', { fill: 'none', stroke: SHADE, 'stroke-width': 2, 'stroke-linecap': 'round' }, body);
  const cuff = el('g', {}, body);

  const rad = (d) => (d * Math.PI) / 180;
  const dir = (a) => ({ x: Math.sin(rad(a)), y: -Math.cos(rad(a)) });

  function fingerTip(f, curl, spread) {
    const a = f.a + spread * (f.a < 0 ? -1 : 1) * 4 * (f.id === 'index' ? 1 : 0.6);
    const L = f.len * (1 - 0.62 * curl);
    const d = dir(a - curl * 14);                    // dedo dobrado inclina um pouco para dentro
    return { x: f.bx + d.x * L, y: f.by + d.y * L + curl * 14 };
  }

  function draw(t) {
    const idleWiggle = (i) => Math.sin(t / 1000 * 3 + i * 1.3) * 0.05;
    outline.textContent = ''; fill.textContent = ''; details.textContent = ''; cuff.textContent = '';


    const tips = {};
    for (const f of FINGERS) {
      const c = Math.min(1, Math.max(0, cur[f.id] + (cur[f.id] < 0.5 ? idleWiggle(f.a) : 0)));
      const tip = fingerTip(f, c, cur.spread);
      tips[f.id] = tip;
      for (const [grp, extra] of [[outline, 7], [fill, 0]]) {
        el('line', { x1: f.bx, y1: f.by, x2: tip.x, y2: tip.y, 'stroke-width': f.w + extra }, grp);
      }
      if (c > 0.6) el('circle', { cx: tip.x, cy: tip.y, r: 2, fill: SHADE, stroke: 'none' }, details);   // dedo dobrado: pontinho do nó
    }
    // polegar: pode encontrar a ponta do indicador (pinça)
    const td = dir(THUMB.a + cur.thumb * 58);
    const natural = { x: THUMB.bx + td.x * THUMB.len * (1 - 0.35 * cur.thumb), y: THUMB.by + td.y * THUMB.len * (1 - 0.35 * cur.thumb) + cur.thumb * 10 };
    const it = tips.index;
    const tt = { x: natural.x + (it.x - natural.x) * cur.meet, y: natural.y + (it.y - natural.y) * cur.meet };
    for (const [grp, extra] of [[outline, 7], [fill, 0]]) {
      el('line', { x1: THUMB.bx, y1: THUMB.by, x2: tt.x, y2: tt.y, 'stroke-width': THUMB.w + extra }, grp);
    }
    // palma
    el('ellipse', { cx: 0, cy: 6, rx: 33, ry: 38, 'stroke-width': 7 }, outline);
    el('ellipse', { cx: 0, cy: 6, rx: 33, ry: 38, 'stroke-width': 0 }, fill);
    el('path', { d: 'M-14 22 Q0 30 14 22' }, details);          // dobra da palma
    el('path', { d: 'M-8 -8 Q-2 -14 6 -10', opacity: 0.7 }, details);
    // ponta do indicador (o "ponteiro" do mouse): o desenho inteiro é posicionado em volta dela
    // clique: anel de destaque na ponta dos dedos que se encontram
    if (cur.meet > 0.6) el('circle', { cx: it.x, cy: it.y, r: 10 + 3 * Math.sin(t / 90), fill: 'none', stroke: accent, 'stroke-width': 3, opacity: 0.9 }, cuff);
    // pulseira laranja por cima da base da palma: é o que dá a cara da Yoru
    el('path', { d: 'M-27 36 Q0 50 27 36 L25 52 Q0 66 -25 52 Z', fill: accent, stroke: INK, 'stroke-width': 4, 'stroke-linejoin': 'round' }, cuff);
    el('path', { d: 'M-21 43 Q0 55 21 43', fill: 'none', stroke: 'rgba(255,255,255,.55)', 'stroke-width': 2.5, 'stroke-linecap': 'round' }, cuff);
    return it;
  }

  const sim = HL.createHandSim();
  let cfg = { size: 1, wander: true };
  let remote = 'auto', remoteAt = 0, hold = 'none';
  let lastT = performance.now();
  let started = false;

  function resize() { sim.setScreen(window.innerWidth, window.innerHeight); }
  window.addEventListener('resize', resize); resize();

  window.handApi.onConfig((c) => {
    cfg = { size: Number(c.size) || 1, wander: c.wander !== false };
    if (/^#[0-9a-f]{6}$/i.test(c.accent || '')) accent = c.accent;
  });
  window.handApi.onHold((p) => { if (HL.HOLD_POSES.includes(p)) hold = p; });
  window.handApi.onFriend((f) => sim.setFriend(f));
  window.handApi.onPose((p) => { if (HL.REMOTE_POSES.includes(p)) { remote = p; remoteAt = performance.now(); } });
  window.handApi.onCursor((c) => {
    const t = performance.now();
    if (!started) { sim.jumpTo(c.x, c.y); started = true; }
    sim.setCursor(c.x, c.y, t);
  });

  function frame(now) {
    const dt = (now - lastT) / 1000; lastT = now;
    const r = sim.step(dt, now, { wanderEnabled: cfg.wander });
    if (r.arrived) window.handApi.pat();                         // chegou na cabeça do avatar: faz carinho
    const pose = HL.resolvePose({ remote, remoteAt, now, moving: r.moving, wandering: r.wandering, hold });
    const target = POSE[pose];
    const k = Math.min(1, dt * 16);                              // transição suave entre poses
    for (const id of ['index', 'middle', 'ring', 'pinky', 'thumb', 'spread', 'meet']) cur[id] += (target[id] - cur[id]) * k;
    const tip = draw(now);
    g.style.opacity = started ? '1' : '0';                       // só aparece depois do primeiro cursor
    const s = 0.9 * cfg.size;
    const wave = r.wandering ? Math.sin(now / 1000 * 2.2) * 7 : 0;
    // gira em volta da ponta do indicador, que fica em cima do cursor
    body.setAttribute('transform', `translate(${r.x.toFixed(1)} ${(r.y + r.bob).toFixed(1)}) rotate(${(r.rot + wave).toFixed(2)}) scale(${s}) translate(${(-tip.x).toFixed(1)} ${(-tip.y).toFixed(1)})`);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame((t) => { lastT = t; frame(t); });
})();
