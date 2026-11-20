// Avatar 2D (pack "Yoru Chibi"): no lugar do modelo 3D, mostra a reação certa para cada emoção e gesto, com um pouco de
// movimento (respirar, balançar ao falar, andar, pular). O renderer.js chama update() a cada quadro; a lógica pura está em avatar2d-logic.js.
import { REACTIONS } from './avatar2d-data.js';
import { EMOTE_REACTION, pickReaction, motionFor, decodeMask, maskHit, layout } from './avatar2d-logic.js';
import { createEmotionEngine } from './emotion-engine.js';

const rand = (a, b) => a + Math.random() * (b - a);

export function createAvatar2d({ S }) {
  const root = document.getElementById('a2d');
  const img = document.getElementById('a2dImg');
  const orbEl = document.getElementById('orb');
  // Camada decorativa leve: aura, brilho e partículas dão vida sem exigir novas artes.
  let fx = root.querySelector('.a2d-fx');
  if (!fx) { fx = document.createElement('div'); fx.className = 'a2d-fx'; fx.innerHTML = '<i class="a2d-aura"></i><i class="a2d-spark s1"></i><i class="a2d-spark s2"></i><i class="a2d-spark s3"></i>'; root.appendChild(fx); }
  const masks = new Map();
  const emotionEngine = createEmotionEngine({ root, image: img });
  let current = null, shownId = null;
  let emote = null;               // { id, t, def }
  let landT = 0, nextRandom = rand(4, 10);
  let box = { left: 0, top: 0, w: 0, h: 0 };
  let sway = 0;                   // inclinação ao andar (suavizada)
  let idlePhase = rand(0, Math.PI * 2), idleLook = 0, nextLook = rand(3, 7);
  let blink = 0, nextBlink = rand(2.8, 5.8);

  // as 50 imagens vão para o cache só quando o 2D é usado de verdade (no modo 3D nada é carregado), para a troca de reação ser instantânea
  const cache = new Map();
  function preload() {
    for (const id of Object.keys(REACTIONS)) { const i = new Image(); i.src = `../assets/reactions/${id}.webp`; cache.set(id, i); }
  }
  const style = { w: '', h: '', l: '', t: '', tr: '' };   // só escreve no DOM o que mudou (evita refazer o layout todo quadro)

  function show(id) {
    if (!REACTIONS[id] || id === shownId) return;
    shownId = id;
    img.onerror = () => {
      // Um asset ausente/corrompido não pode deixar o avatar invisível.
      img.onerror = null;
      shownId = 'ola';
      img.src = '../assets/reactions/ola.webp';
      root.dataset.assetFallback = id;
    };
    img.src = `../assets/reactions/${id}.webp`;
  }

  function react(id) {
    if (!S.visible) return;
    if (id === 'stand') { emote = null; return; }
    if (id === 'random') {
      const pool = (S.emoteList || []).filter((e) => EMOTE_REACTION[e] && e !== 'bed' && e !== 'tent' && e !== 'land');
      if (!pool.length) return;
      id = pool[Math.floor(Math.random() * pool.length)];
    }
    const def = EMOTE_REACTION[id];
    if (!def) return;
    emote = { id, t: 0, def };
  }

  function update(dt, t, { emotion, speaking, level, grabbed, falling, walking, walkDir } = {}) {
    // Protege o loop visual de pausas longas, valores não finitos e níveis de áudio fora da faixa.
    dt = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0;
    t = Number.isFinite(t) ? t : 0;
    level = Number.isFinite(level) ? Math.max(0, Math.min(1, level)) : 0;
    speaking = !!speaking; grabbed = !!grabbed; falling = !!falling; walking = !!walking;
    if (!cache.size) preload();
    if (landT > 0) landT -= dt;
    if (emote) {
      emote.t += dt * (S.emoteSpeed || 1);
      if (emote.t >= emote.def.d) emote = null;
    }
    // gesto aleatório de tempos em tempos (mesmas opções do painel)
    if (S.emotesEnabled && S.visible && !emote && !speaking && !grabbed && !falling && !walking) {
      nextRandom -= dt;
      if (nextRandom <= 0) { react('random'); nextRandom = rand(S.emoteMin || 8, S.emoteMax || 25); }
    }
    const id = pickReaction({ emotion, emote: emote && emote.id, grabbed, falling });
    const expression = emotionEngine.update(dt, t, { emotion, speaking, level });
    show(id);
    // Pequenos comportamentos contínuos: respiração, olhar, piscada e antecipação.
    idlePhase += dt; nextLook -= dt; nextBlink -= dt;
    if (nextLook <= 0) { idleLook = rand(-1, 1); nextLook = rand(3.5, 8); }
    if (nextBlink <= 0) { blink = 1; nextBlink = rand(2.6, 5.6); }
    blink = Math.max(0, blink - dt * 9);
    root.dataset.emotion = emotionEngine.emotion;
    root.dataset.speaking = speaking ? 'true' : 'false';
    current = id;

    // movimento
    const W = Math.max(1, window.innerWidth || 1), H = Math.max(1, window.innerHeight || 1);
    const L = layout(W, H, REACTIONS[id], S.chibi2dScale);
    let m = { x: 0, y: 0, rot: 0, sx: 1, sy: 1 };
    if (emote && !grabbed && !falling) {
      const k = Math.max(0, Math.min(1, emote.t / 0.25, (emote.def.d - emote.t) / 0.25));
      m = motionFor(emote.def.fx, emote.t, emote.def.d === Infinity ? Math.min(1, emote.t / 0.6) : k);
    }
    const br = id === 'dormindo' ? 0.018 : 0.012;
    m.sy *= 1 + Math.sin(idlePhase * 1.9) * br;                             // respiração
    if (!emote && !grabbed && !falling && !walking) {
      m.rot += Math.sin(idlePhase * 0.72) * 1.05 + idleLook * 0.65;         // olhar/pose viva
      m.x += Math.sin(idlePhase * 0.48) * 1.8;
      m.y += Math.sin(idlePhase * 1.9) * 1.6;
    }
    // Piscada curta e sutil (squash de 2D inteiro; não finge rig facial inexistente).
    if (blink > 0 && !speaking && !emote) m.sy *= 1 - Math.sin(Math.min(1, blink) * Math.PI) * 0.035;
    if (speaking) { m.y -= (level || 0.35) * 7 + Math.abs(Math.sin(t * 11)) * 2.5; m.sy *= 1 + (level || 0.3) * 0.02; }
    m.rot += expression.tilt; m.sx *= expression.pulse; m.sy *= expression.pulse; // falar
    if (grabbed) { m.rot += Math.sin(t * 9) * 3; m.y += 6; }
    sway += ((walking ? (walkDir || 1) : 0) - sway) * Math.min(dt * 6, 1);
    if (Math.abs(sway) > 0.01) { m.rot += sway * 3 + Math.sin(t * 9) * 1.2 * Math.abs(sway); m.y -= Math.abs(Math.sin(t * 9)) * 6 * Math.abs(sway); }

    const w = `${L.w.toFixed(1)}px`, h = `${L.h.toFixed(1)}px`, l = `${L.left.toFixed(1)}px`, tp = `${L.top.toFixed(1)}px`;
    if (w !== style.w) img.style.width = style.w = w;
    if (h !== style.h) img.style.height = style.h = h;
    if (l !== style.l) img.style.left = style.l = l;
    if (tp !== style.t) img.style.top = style.t = tp;
    img.style.transform = `translate(${m.x.toFixed(2)}px, ${m.y.toFixed(2)}px) rotate(${m.rot.toFixed(2)}deg) scale(${m.sx.toFixed(4)}, ${m.sy.toFixed(4)})`;
    // Aura e brilhos acompanham a posição real do sprite.
    fx.style.left = `${L.left + L.w * 0.08}px`; fx.style.top = `${L.top + L.h * 0.06}px`;
    fx.style.width = `${L.w * 0.84}px`; fx.style.height = `${L.h * 0.9}px`;
    fx.style.setProperty('--fx-energy', String(Math.max(0.18, Math.min(1, (level || 0.25) + (speaking ? 0.3 : 0.05)))));
    fx.classList.toggle('active', !!S.visible);
    // caixa para o clique (ignora rotação: a diferença é de poucos pixels)
    const hitScaleX = Math.max(0.01, Math.abs(m.sx)), hitScaleY = Math.max(0.01, Math.abs(m.sy));
    box = { left: L.left + m.x + (L.w - L.w * hitScaleX) / 2, top: L.top + m.y + (L.h - L.h * hitScaleY), w: L.w * hitScaleX, h: L.h * hitScaleY };
  }

  // o ponto (x, y) da janela está em cima do desenho?
  function over(x, y) {
    if (!current || !S.visible || !box.w) return false;
    let mk = masks.get(current);
    if (!mk) { mk = decodeMask(REACTIONS[current][3]); masks.set(current, mk); }
    return maskHit(mk, (x - box.left) / box.w, (y - box.top) / box.h);
  }

  // a bolinha de escuta fica ao lado da cabeça (lado esquerdo da tela)
  function placeOrb() {
    if (!orbEl || !orbEl.classList.contains('on') || !box.w) return;
    orbEl.style.left = `${Math.max(4, box.left + box.w * 0.04)}px`;
    orbEl.style.top = `${Math.max(4, box.top + box.h * 0.12)}px`;
  }

  function setVisible(on, opacity) { root.style.opacity = on ? String(opacity) : '0'; }

  return { react, update, over, placeOrb, setVisible, active: () => !!emote, reset() { emote = null; }, land() { emote = { id: 'land', t: 0, def: EMOTE_REACTION.land }; } };
}
