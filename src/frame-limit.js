// Limite de quadros por segundo do loop do avatar e medidor de FPS que o renderer.js reporta ao painel.
// A regra de effectiveFps é a mesma de src/perf.js (que é CommonJS, usado pelo processo principal); test/perf.test.js confere as duas.

export function effectiveFps(s, pw, active) {
  let fps = active ? Number(s.fpsActive) || 60 : Number(s.fpsIdle) || 24;
  if (pw.battery && s.batterySaver !== false) fps = Math.min(fps, Number(s.fpsBattery) || 30);
  if (pw.away && Number(s.awayMin) > 0) fps = Math.min(fps, Number(s.fpsAway) || 5);
  return Math.max(1, fps);
}

// conta os quadros desenhados e avisa o processo principal a cada 2 s
export function createFpsReporter(api) {
  let frames = 0;
  let start = performance.now();
  return {
    tick() {
      frames++;
      const nowMs = performance.now();
      if (nowMs - start >= 2000) {
        api.reportFps(Math.round((frames * 1000) / (nowMs - start)));
        frames = 0;
        start = nowMs;
      }
    },
  };
}
