// Yoru Chibi Emotion Engine — camada comportamental para o pack de reações existente.
// Mantém os assets originais; suaviza transições e acrescenta microexpressões sem trocar o VRM.
const PROFILES = {
  happy:     { filter: 'saturate(1.12) brightness(1.035)', tilt: -0.45, pulse: 1.012, aura: 0.82 },
  excited:   { filter: 'saturate(1.22) brightness(1.06)', tilt: 0.7, pulse: 1.022, aura: 1 },
  sad:       { filter: 'saturate(.78) brightness(.96)', tilt: -0.8, pulse: .995, aura: 0.48 },
  angry:     { filter: 'saturate(1.18) contrast(1.035)', tilt: 0.55, pulse: 1.006, aura: 0.9 },
  surprised: { filter: 'saturate(1.08) brightness(1.045)', tilt: 0, pulse: 1.018, aura: 0.92 },
  relaxed:   { filter: 'saturate(.94) brightness(1.015)', tilt: 0, pulse: 1.004, aura: 0.58 },
  neutral:   { filter: 'none', tilt: 0, pulse: 1, aura: 0.62 },
};
const ALIASES = {
  feliz: 'happy', alegria: 'happy', love: 'excited', apaixonada: 'excited',
  triste: 'sad', sadness: 'sad', irritada: 'angry', raiva: 'angry',
  surpresa: 'surprised', assustado: 'surprised', calma: 'relaxed',
  relaxada: 'relaxed', neutro: 'neutral',
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function createEmotionEngine({ root, image }) {
  let current = 'neutral';
  let mix = 0;
  let mouth = 0;
  let lastFilter = '';
  let aura = 0.62;

  function update(dt, t, { emotion = 'neutral', speaking = false, level = 0 } = {}) {
    dt = Number.isFinite(dt) ? clamp(dt, 0, 0.1) : 0;
    t = Number.isFinite(t) ? t : 0;
    level = Number.isFinite(level) ? clamp(level, 0, 1) : 0;
    const raw = String(emotion || 'neutral').toLowerCase();
    const next = PROFILES[raw] ? raw : (ALIASES[raw] || 'neutral');
    if (next !== current) { current = next; mix = 0; }
    mix = Math.min(1, mix + dt * 3.8);
    const p = PROFILES[current] || PROFILES.neutral;
    aura += ((p.aura ?? 0.62) - aura) * Math.min(1, dt * 4.5);
    const targetMouth = speaking ? clamp(level * 2.8 + Math.abs(Math.sin(t * 12)) * .12, 0, 1) : 0;
    mouth += (targetMouth - mouth) * Math.min(1, dt * 13);

    if (root && root.dataset) root.dataset.emotion = current;
    root.style.setProperty('--yoru-emotion-mix', String(mix));
    root.style.setProperty('--yoru-mouth', String(mouth));
    root.style.setProperty('--yoru-aura-opacity', String(clamp(aura + mouth * 0.16, 0, 1)));
    root.style.setProperty('--yoru-speaking-energy', String(clamp(level * (speaking ? 1 : 0), 0, 1)));
    const filter = p.filter;
    if (filter !== lastFilter) { if (image && image.style) image.style.filter = filter; lastFilter = filter; }
    return { tilt: p.tilt * mix, pulse: 1 + (p.pulse - 1) * mix, mouth };
  }
  return { update, get emotion() { return current; } };
}
