// Pose do corpo que não é gesto: ser carregada/cair (braços para cima, pernas balançando), vida parada (respiração, braços soltos),
// gestos ao falar e o braço dobrado que segura o item. Tudo soma deslocamentos na pose do quadro (add) e muda de peso com suavidade.
// O renderer.js chama os passos nesta ordem a cada quadro: trackCarry, carriedPose, idleLayer, speechGestures, itemPose.

import { idleWeights } from './idle-life.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// idle: src/idle-life.js · held: item na mão (src/held-item.js) · walk: src/walk.js · cur: src/cursor-follow.js
// ptr: estado do mouse (src/pointer.js) · V: estado da voz (src/voice.js) · getVrm: avatar VRM atual (ou null)
export function createBodyPose({ S, P, add, idle, held, walk, cur, V, ptr, getVrm }) {
  const idleSm = { body: 1, head: 1, armL: 1, armR: 1, fingers: 1 }; // pesos suavizados: a camada entra e sai sem estalo
  let heldW = 0;   // peso da pose "carregada" (0..1)
  let swing = 0;   // balanço do corpo conforme a velocidade do arraste
  let itemW = 0;   // peso da pose de segurar (0..1)
  let speakGW = 0; // peso dos gestos ao falar (0..1, suavizado)
  const gest = { side: 'right', t: 0, dur: 0, next: 1.2, w: { left: 0, right: 0 } }; // gesto de ênfase: um braço sobe, abre a mão e volta
  let armLv = 0;   // volume da voz bem suavizado: os braços não podem tremer a cada sílaba

  // pesos de "carregada" e de balanço (antes de tudo no quadro)
  function trackCarry(dt) {
    heldW += (((ptr.grabbed || ptr.falling) ? 1 : 0) - heldW) * Math.min(dt * 10, 1);
    const swingTarget = performance.now() - ptr.lastMoveT < 90 ? clamp(ptr.dragVx / 1800, -1, 1) : 0;
    swing += (swingTarget - swing) * Math.min(dt * 8, 1);
  }

  // pose de quem está sendo carregada / caindo: braços para cima, pernas balançando. Devolve true se deve parecer surpresa.
  function carriedPose(t) {
    if (heldW <= 0.001) return false;
    const w = heldW;
    const flail = ptr.falling ? Math.sin(t * 16) * 0.25 : Math.sin(t * 5) * 0.06;
    add('leftUpperArm', 'z', (1.55 + flail) * w);
    add('rightUpperArm', 'z', -(1.55 - flail) * w);
    add('leftLowerArm', 'z', 0.15 * w);
    add('rightLowerArm', 'z', -0.15 * w);
    add('spine', 'z', -swing * 0.22 * w);
    add('hips', 'z', swing * 0.10 * w);
    add('head', 'z', -swing * 0.18 * w);
    add('leftUpperLeg', 'x', (-0.08 + Math.sin(t * (ptr.falling ? 14 : 3)) * (ptr.falling ? 0.28 : 0.1)) * w);
    add('rightUpperLeg', 'x', (-0.08 + Math.sin(t * (ptr.falling ? 14 : 3) + 1.6) * (ptr.falling ? 0.28 : 0.1)) * w);
    add('leftLowerLeg', 'x', (0.3 + Math.sin(t * 3 + 0.8) * 0.12) * w);
    add('rightLowerLeg', 'x', (0.3 + Math.sin(t * 3 + 2.2) * 0.12) * w);
    return w > 0.5;
  }

  // vida parada: respiração com ritmo próprio, braços soltos e balanço de peso.
  // Os pesos caem quando um gesto, a caminhada, o item na mão ou o colo já mandam no corpo.
  function idleLayer(dt, t, { ew, ewOut, sleepW }) {
    if (!S.breathing) return;
    const vrm = getVrm();
    const tw = idleWeights({ em: Math.max(ew, ewOut), walk: walk.w, held: heldW, sleep: sleepW, item: itemW, itemSide: held.obj && vrm ? (S.itemHand === 'left' ? 'left' : 'right') : null });
    const k = Math.min(dt * 6, 1);
    for (const n of ['body', 'head', 'armL', 'armR', 'fingers']) idleSm[n] += (tw[n] - idleSm[n]) * k;
    const il = idle.step(dt, t, idleSm);
    const ia = S.idleAmount ?? 1; // intensidade escolhida no painel
    for (const bone in il.bones) { const d = il.bones[bone]; add(bone, 'x', d.x * ia); add(bone, 'y', d.y * ia); add(bone, 'z', d.z * ia); }
    P.hipsY = (P.hipsY || 0) + il.hipsY * ia;
  }

  // gestos ao falar: a cabeça balança no ritmo da fala, o tronco acompanha e a mão livre acena junto.
  // Também move a cabeça para o cursor (seguir o mouse), com o mesmo peso de "corpo livre".
  function speechGestures(dt, t, { ew, ewOut, sleepW, speaking }) {
    speakGW += ((speaking && S.speakGestures !== false ? 1 : 0) - speakGW) * Math.min(dt * 4, 1);
    const free = 1 - Math.max(ew, ewOut, heldW, sleepW, walk.w);
    const sgw = speakGW * (S.speakGestureAmount ?? 1) * free;
    // seguir o cursor: a cabeça vira na direção do mouse enquanto ele se mexe e volta ao centro depois de alguns segundos parado
    cur.updateHead(dt, add, free);
    armLv += (Math.min(1, V.ttsLevel * 4) - armLv) * Math.min(dt * 2.5, 1);
    if (sgw <= 0.01) return;
    const lv = Math.min(1, V.ttsLevel * 4);
    // vários ritmos que não se alinham (sem repetir de forma óbvia) + o volume da voz empurrando de leve
    const nod = Math.sin(t * 2.3) * 0.045 + Math.sin(t * 3.7 + 0.8) * 0.02 + lv * 0.05;
    add('head', 'x', nod * sgw);
    add('neck', 'x', nod * 0.4 * sgw);
    add('head', 'y', (Math.sin(t * 1.7 + 1) * 0.07 + Math.sin(t * 0.9 + 2) * 0.035) * sgw);
    add('head', 'z', (Math.sin(t * 1.3) * 0.035 + Math.sin(t * 2.9 + 1.4) * 0.012) * sgw);
    add('chest', 'x', lv * 0.03 * sgw);
    add('chest', 'y', Math.sin(t * 1.1 + 0.5) * 0.03 * sgw);
    add('spine', 'y', Math.sin(t * 1.1) * 0.03 * sgw);
    add('spine', 'z', Math.sin(t * 0.8 + 1) * 0.015 * sgw);          // o tronco se inclina de leve enquanto fala
    add('leftShoulder', 'z', (0.015 + 0.02 * armLv) * sgw);             // ombros sobem um pouco nas ênfases
    add('rightShoulder', 'z', -(0.015 + 0.02 * armLv) * sgw);
    // ênfase: de vez em quando um braço (quase sempre alternando) sobe à frente, abre e volta, em ~1,6 a 2,4 s
    gest.next -= dt;
    if (gest.dur === 0 && gest.next <= 0) {
      gest.side = gest.side === 'right' ? 'left' : 'right';
      if (Math.random() < 0.25) gest.side = Math.random() < 0.5 ? 'left' : 'right';
      gest.dur = 1.6 + Math.random() * 0.8; gest.t = 0; gest.amp = 0.7 + Math.random() * 0.3;
    }
    if (gest.dur > 0) { gest.t += dt; if (gest.t >= gest.dur) { gest.dur = 0; gest.next = 0.8 + Math.random() * 2.2; } }
    const x = gest.dur > 0 ? gest.t / gest.dur : 0;
    const bell = gest.dur > 0 ? Math.pow(Math.sin(Math.PI * x), 2) : 0;                 // sobe e desce sem estalo
    const pulse = 1 + 0.18 * Math.sin(t * 4.3) * armLv;                                  // pequeno ritmo da fala enquanto o braço está erguido
    for (const side of ['left', 'right']) {
      const target = gest.side === side ? bell * (gest.amp || 1) * pulse : 0;
      gest.w[side] += (target - gest.w[side]) * Math.min(dt * 14, 1);                    // mais um filtro: nada de tranco
    }
    const calm = 0.12 + 0.08 * Math.sin(t * 1.9) * (0.4 + armLv);                       // braço de repouso: cotovelo solto
    if (!(held.obj && S.itemHand === 'left')) {
      const g = gest.w.left;
      add('leftLowerArm', 'y', -(calm + 0.75 * g) * sgw);
      add('leftUpperArm', 'x', -(0.04 + 0.4 * g) * sgw);
      add('leftUpperArm', 'z', 0.1 * g * sgw);
      add('leftHand', 'z', 0.15 * g * sgw);
    }
    if (!(held.obj && S.itemHand !== 'left')) {
      const g = gest.w.right;
      add('rightLowerArm', 'y', (calm + 0.75 * g) * sgw);
      add('rightUpperArm', 'x', -(0.04 + 0.4 * g) * sgw);
      add('rightUpperArm', 'z', -0.1 * g * sgw);
      add('rightHand', 'z', -0.15 * g * sgw);
    }
  }

  // pose de segurar o item: braço dobrado à frente do corpo (hasEmote: há um gesto tocando)
  function itemPose(dt, hasEmote) {
    itemW += (((held.obj && getVrm() && !hasEmote && heldW < 0.01) ? 1 : 0) - itemW) * Math.min(dt * 5, 1);
    if (itemW <= 0.001) return;
    const side = S.itemHand === 'left' ? 'left' : 'right';
    const sg = side === 'left' ? -1 : 1;
    add(side + 'UpperArm', 'z', -0.5 * sg * itemW);
    add(side + 'UpperArm', 'x', -0.55 * itemW);
    add(side + 'LowerArm', 'y', 1.5 * sg * itemW);
  }

  return {
    trackCarry, carriedPose, idleLayer, speechGestures, itemPose,
    get heldW() { return heldW; },
    get itemW() { return itemW; },
    get swing() { return swing; },
  };
}
