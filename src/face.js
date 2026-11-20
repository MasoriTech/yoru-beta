// Rosto do avatar VRM: piscar (com a frequência do painel), expressão com transição suave e boca acompanhando a voz.
// O renderer.js chama update() a cada quadro depois de aplicar a pose dos ossos.

const EMOTIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];

// V: estado da voz (src/voice.js): V.audioEl, V.analyser, V.anaBuf, V.ttsLevel
export function createFace({ S, V }) {
  let blinkTimer = 2;
  let blinkPhase = -1;
  let mouthLevel = 0;

  // em: vrm.expressionManager · expr: expressão desejada · sleepW: quanto está deitada (0..1) · speaking: está falando
  function update(dt, t, { em, expr, sleepW, speaking }) {
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    t = Number.isFinite(t) ? t : 0;
    sleepW = Number.isFinite(sleepW) ? Math.max(0, Math.min(sleepW, 1)) : 0;
    speaking = !!speaking;
    if (!em || typeof em.setValue !== 'function' || typeof em.getValue !== 'function') return;
    // piscar
    if (S.blinking) {
      blinkTimer -= dt;
      if (blinkTimer <= 0 && blinkPhase < 0) blinkPhase = 0;
      if (blinkPhase >= 0) {
        blinkPhase += dt / 0.15;
        em.setValue('blink', Math.sin(Math.min(blinkPhase, 1) * Math.PI));
        if (blinkPhase >= 1) {
          blinkPhase = -1;
          blinkTimer = Math.random() < 0.18 ? 0.2 : (1.8 + Math.random() * 4.5) / Math.max(0.3, S.blinkRate || 1); // às vezes pisca duas vezes seguidas; a frequência vem do painel
        }
      }
    } else {
      em.setValue('blink', 0);
    }

    if (sleepW > 0.05) em.setValue('blink', Math.min(1, sleepW * 1.2));           // dormindo: olhos fechados

    // expressão (transição suave)
    for (const name of EMOTIONS) {
      const strength = Number.isFinite(S.emotionStrength) ? Math.max(0, Math.min(1, S.emotionStrength)) : 1;
      const target = name === expr ? strength : 0;
      const now = em.getValue(name) ?? 0;
      em.setValue(name, now + (target - now) * Math.min(dt * 6, 1));
    }

    // boca: segue o volume real da voz neural; sem áudio, balança no ritmo
    let mouth = 0;
    if (V.audioEl && V.analyser && V.anaBuf && V.anaBuf.length && typeof V.analyser.getByteTimeDomainData === 'function') {
      V.analyser.getByteTimeDomainData(V.anaBuf);
      let sum = 0;
      for (let i = 0; i < V.anaBuf.length; i++) { const v = (V.anaBuf[i] - 128) / 128; sum += v * v; }
      const raw = Math.sqrt(sum / V.anaBuf.length);
      V.ttsLevel += (raw - V.ttsLevel) * Math.min(dt * 18, 1);
      mouth = Math.min(1, V.ttsLevel * 5) * 0.85;
    } else if (speaking) {
      mouth = Math.abs(Math.sin(t * 14)) * 0.6;
    }
    if (!S.lipSync) mouthLevel = 0;
    else mouthLevel += (mouth - mouthLevel) * Math.min(dt * 14, 1);
    em.setValue('aa', mouthLevel);
  }

  return { update };
}
