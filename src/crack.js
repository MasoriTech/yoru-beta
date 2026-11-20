'use strict';
// Efeito "Yoru socou a tela": flash, rachaduras saindo do ponto do impacto, estilhaços caindo
// e, no fim, tudo some aos poucos e a tela volta ao normal. A janela é transparente e não pega o mouse.
(function () {
  const q = new URLSearchParams(location.search);
  const total = Math.max(1500, Number(q.get('ms')) || 4600);
  const cv = document.getElementById('c');
  const W = (cv.width = window.innerWidth), H = (cv.height = window.innerHeight);
  const ctx = cv.getContext('2d');
  const ix = Math.min(Math.max(Number(q.get('x')) || W / 2, 0), W);
  const iy = Math.min(Math.max(Number(q.get('y')) || H / 2, 0), H);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const diag = Math.hypot(W, H);

  // ----- rachaduras: raios tortos com ramificações + anéis ao redor do impacto -----
  const rays = [];
  const nRays = 11 + Math.floor(Math.random() * 5);
  for (let i = 0; i < nRays; i++) {
    const base = (i / nRays) * Math.PI * 2 + rnd(-0.2, 0.2);
    const len = diag * rnd(0.35, 0.8);
    const pts = [[ix, iy]];
    let ang = base, d = 0;
    while (d < len) {
      const step = rnd(18, 60);
      ang += rnd(-0.16, 0.16);
      d += step;
      const p = pts[pts.length - 1];
      pts.push([p[0] + Math.cos(ang) * step, p[1] + Math.sin(ang) * step]);
    }
    const branches = [];
    for (let k = 2; k < pts.length - 1; k++) {
      if (Math.random() < 0.38) {
        const b = [pts[k]];
        let a2 = base + rnd(0.45, 0.9) * (Math.random() < 0.5 ? -1 : 1), n = Math.floor(rnd(2, 6));
        for (let j = 0; j < n; j++) {
          const st = rnd(14, 45); a2 += rnd(-0.2, 0.2);
          const p = b[b.length - 1];
          b.push([p[0] + Math.cos(a2) * st, p[1] + Math.sin(a2) * st]);
        }
        branches.push({ pts: b, at: k });
      }
    }
    rays.push({ pts, branches });
  }
  // anéis: ligam pontos de raios vizinhos na mesma distância
  const rings = [];
  for (const frac of [0.05, 0.09, 0.15]) {
    const ring = [];
    for (const r of rays) {
      const idx = Math.max(1, Math.min(r.pts.length - 1, Math.round(frac * r.pts.length * 2.2)));
      ring.push(r.pts[idx]);
    }
    rings.push(ring);
  }
  // pedaços de vidro que caem
  const shards = [];
  for (let i = 0; i < 38; i++) {
    const a = rnd(0, Math.PI * 2), d = rnd(10, 260);
    shards.push({ x: ix + Math.cos(a) * d, y: iy + Math.sin(a) * d, vx: Math.cos(a) * rnd(20, 140), vy: rnd(-120, 40),
      s: rnd(5, 17), r: rnd(0, 6.28), vr: rnd(-6, 6), delay: rnd(0.35, 1.6) });
  }

  function poly(pts, upTo) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < Math.min(pts.length, upTo + 1); i++) ctx.lineTo(pts[i][0], pts[i][1]);
  }
  function stroke(alpha) {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,' + (alpha * 0.45) + ')'; ctx.lineWidth = 3.2; ctx.stroke();
    ctx.strokeStyle = 'rgba(235,245,255,' + (alpha * 0.9) + ')'; ctx.lineWidth = 1.4; ctx.stroke();
  }

  const GROW = 0.28, HOLD_END = total / 1000 - 1.0; // cresce em 0,28 s; some nos últimos 1 s
  const t0 = performance.now();
  function frame(now) {
    const t = Math.max(0, (now - t0) / 1000);
    ctx.clearRect(0, 0, W, H);
    const fade = t > HOLD_END ? Math.max(0, 1 - (t - HOLD_END)) : 1;
    if (fade <= 0) return;
    const grow = Math.min(1, t / GROW);
    // tremida curta logo após o impacto (as rachaduras vibram)
    const sh = t < 0.35 ? Math.sin(t * 90) * (1 - t / 0.35) * 5 : 0;
    ctx.save();
    ctx.translate(sh, sh * 0.6);

    // clarão do impacto
    if (t < 0.22) {
      const g = ctx.createRadialGradient(ix, iy, 0, ix, iy, diag * 0.5);
      g.addColorStop(0, 'rgba(255,255,255,' + 0.75 * (1 - t / 0.22) + ')');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-10, -10, W + 20, H + 20);
    }
    // vidro levemente escurecido perto do impacto
    const gl = ctx.createRadialGradient(ix, iy, 0, ix, iy, diag * 0.45 * grow);
    gl.addColorStop(0, 'rgba(20,30,45,' + 0.22 * fade + ')');
    gl.addColorStop(1, 'rgba(20,30,45,0)');
    ctx.fillStyle = gl; ctx.fillRect(-10, -10, W + 20, H + 20);

    for (const r of rays) {
      const n = Math.max(1, Math.round((r.pts.length - 1) * grow));
      poly(r.pts, n); stroke(fade);
      for (const b of r.branches) if (b.at <= n) { poly(b.pts, b.pts.length); stroke(fade * 0.8); }
    }
    if (grow > 0.5) for (const ring of rings) {
      ctx.beginPath(); ctx.moveTo(ring[0][0], ring[0][1]);
      for (let i = 1; i < ring.length; i++) ctx.lineTo(ring[i][0], ring[i][1]);
      ctx.closePath(); stroke(fade * 0.65 * Math.min(1, (grow - 0.5) * 3));
    }
    // ponto de impacto: estrela branca com lasquinhas
    ctx.fillStyle = 'rgba(255,255,255,' + 0.55 * fade + ')';
    ctx.beginPath(); ctx.arc(ix, iy, 9 * grow, 0, 6.28); ctx.fill();

    // estilhaços
    for (const s of shards) {
      const st = t - s.delay;
      if (st < 0) continue;
      const x = s.x + s.vx * st * 0.3, y = s.y + s.vy * st + 520 * st * st;
      ctx.save();
      ctx.translate(x, y); ctx.rotate(s.r + s.vr * st);
      ctx.globalAlpha = Math.max(0, 1 - st / 1.1) * fade;
      ctx.fillStyle = 'rgba(225,240,255,.55)'; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, -s.s); ctx.lineTo(s.s * 0.7, s.s * 0.6); ctx.lineTo(-s.s * 0.8, s.s * 0.4); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // barulho de vidro quebrando (sintetizado, sem arquivo de áudio)
  if (q.get('sound') === '1') {
    try {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      const dur = 0.9, buf = ac.createBuffer(1, ac.sampleRate * dur, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) {
        const tt = i / ac.sampleRate;
        d[i] = (Math.random() * 2 - 1) * Math.exp(-tt * 9);                            // estalo
        if (tt > 0.04 && Math.random() < 0.012) d[i] += (Math.random() * 2 - 1) * 1.6 * Math.exp(-(tt - 0.04) * 4); // caquinhos
      }
      const src = ac.createBufferSource(); src.buffer = buf;
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
      const gain = ac.createGain(); gain.gain.value = 0.35;
      src.connect(hp); hp.connect(gain); gain.connect(ac.destination);
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      src.start();
    } catch (_) { /* sem áudio: só o visual */ }
  }
})();
