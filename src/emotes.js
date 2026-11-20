// Gestos (emotes) do avatar: cada um tem duração, expressão do rosto e uma função que soma deslocamentos à pose do quadro (P).
// O renderer.js decide quando tocar, calcula o peso suave (w) e aplica P nos ossos.
// O que muda no renderer (item na mão, tamanho, queda...) chega por funções, para sempre ler o valor atual.

// 0→1→0 em 'a' segundos
export const pulse = (t, a) => Math.max(0, Math.sin(Math.min(t, a) / a * Math.PI));

// poses do robô: [braço dir. (z), antebraço dir., braço esq. (z), antebraço esq., cabeça (y), tronco (y)]
export const ROBOT = [
  [0.0, 0.0, 0.0, 0.0, 0.5, 0.15],
  [-1.3, -1.5, 0.0, 0.0, -0.5, -0.15],
  [0.0, 0.0, 1.3, 1.5, 0.5, 0.15],
  [-1.3, -1.5, 1.3, 1.5, 0.0, 0.0],
];

export const PUNCH = { uz: 1.5, uy: 2.0, ly: 1.6 }; // ajuste fino do soco
export const PROP_SCALE = 0.8;    // cama e barraca são desenhadas em tamanho natural e encolhidas para caber na largura da janela
export const SLEEP_SCALE = 0.56;  // deitada, ela encolhe junto
const BED_TOP = 0.3, TENT_TOP = 0.12; // altura do colchão / do colchonete

export function createEmotes({ getItemObj, getLandK, getSitDrop, getChairDrop, getFitScale, getBaseHipsY }) {
  const P = {}; // deslocamentos da pose neste frame (o mesmo objeto o tempo todo; resetPose() o esvazia)
  const resetPose = () => { for (const k in P) delete P[k]; };
  const add = (bone, axis, v) => ((P[bone] ||= { x: 0, y: 0, z: 0 })[axis] += v);

  function lieDown(t, w, tent) {
    const d = w * w * (3 - 2 * w);
    const sc = getFitScale() * SLEEP_SCALE;
    P.hipsY = (P.hipsY || 0) + (((tent ? TENT_TOP : BED_TOP) + 0.1) * PROP_SCALE / sc - getBaseHipsY()) * d; // quadril apoiado no colchão
    add('hips', 'x', -Math.PI / 2 * d);                                                     // deita de barriga para cima
    P.spinY = (P.spinY || 0) + Math.PI / 2 * d;                                             // e de perfil, a cabeça à esquerda
    const br = Math.sin(t * 1.5);
    add('chest', 'x', 0.025 * br * w);
    add('head', 'z', 0.12 * w);
    add('leftUpperArm', 'z', 0.15 * w);
    add('rightUpperArm', 'z', -0.15 * w);
    if (tent) { add('rightUpperLeg', 'x', -0.55 * w); add('rightLowerLeg', 'x', 0.9 * w); }  // joelho dobrado no saco de dormir
  }
  // Cada emote: duração (s), expressão do rosto e função que adiciona deslocamentos
  // t = tempo desde o início, w = peso suave (0→1→0)
  const EMOTES = {
    wave: { dur: 3.4, expr: 'happy', fn: (t, w) => {
      add('rightUpperArm', 'z', -2.2 * w);
      add('rightLowerArm', 'z', (-0.3 + Math.sin(t * 9) * 0.45) * w);
      add('head', 'z', 0.08 * w);
    } },
    happy: { dur: 2.6, expr: 'happy', fn: (t, w) => {
      P.hipsY = (P.hipsY || 0) + Math.abs(Math.sin(t * 6)) * 0.03 * w;
      add('head', 'z', Math.sin(t * 3) * 0.08 * w);
      add('leftUpperArm', 'z', 0.25 * w + Math.sin(t * 6) * 0.08 * w);
      add('rightUpperArm', 'z', -0.25 * w - Math.sin(t * 6) * 0.08 * w);
    } },
    nod: { dur: 2.2, expr: 'relaxed', fn: (t, w) => {
      add('head', 'x', Math.sin(t * 7) * 0.2 * w);
      add('neck', 'x', Math.sin(t * 7) * 0.08 * w);
    } },
    shake: { dur: 2.2, expr: 'sad', fn: (t, w) => {
      add('head', 'y', Math.sin(t * 8) * 0.35 * w);
      add('neck', 'y', Math.sin(t * 8) * 0.1 * w);
    } },
    surprised: { dur: 2.6, expr: 'surprised', fn: (t, w) => {
      add('spine', 'x', -0.12 * w);
      add('head', 'x', -0.08 * w);
      P.hipsY = (P.hipsY || 0) + pulse(t, 0.4) * 0.05;
      add('leftUpperArm', 'z', 0.55 * w);
      add('rightUpperArm', 'z', -0.55 * w);
    } },
    stretch: { dur: 3.8, expr: 'relaxed', fn: (t, w) => {
      add('leftUpperArm', 'z', 2.4 * w);
      add('rightUpperArm', 'z', -2.4 * w);
      add('spine', 'x', -0.14 * w + Math.sin(t * 2) * 0.03 * w);
      add('head', 'x', -0.15 * w);
    } },
    dance: { dur: 5.5, expr: 'happy', fn: (t, w) => {
      const b = Math.sin(t * 5);
      P.hipsY = (P.hipsY || 0) + Math.abs(b) * 0.03 * w;
      add('hips', 'z', b * 0.1 * w);
      add('spine', 'z', -b * 0.08 * w);
      add('head', 'z', b * 0.1 * w);
      add('leftUpperArm', 'z', (1.8 + Math.sin(t * 5) * 0.5) * w);
      add('rightUpperArm', 'z', -(1.8 + Math.sin(t * 5 + Math.PI) * 0.5) * w);
    } },
    bow: { dur: 2.8, expr: 'relaxed', fn: (t, w) => {
      add('spine', 'x', 0.5 * w);
      add('head', 'x', 0.2 * w);
    } },
    spin: { dur: 1.9, expr: 'happy', fn: (t, w) => {
      const p = Math.min(1, t / 1.9);
      P.spinY = (p * p * (3 - 2 * p)) * Math.PI * 2;
      add('leftUpperArm', 'z', 0.6 * w);
      add('rightUpperArm', 'z', -0.6 * w);
    } },
    cheer: { dur: 3.2, expr: 'happy', fn: (t, w) => {
      P.hipsY = (P.hipsY || 0) + Math.abs(Math.sin(t * 6)) * 0.05 * w;
      add('leftUpperArm', 'z', (2.5 + Math.sin(t * 12) * 0.12) * w);
      add('rightUpperArm', 'z', -(2.5 + Math.sin(t * 12 + 1) * 0.12) * w);
      add('head', 'x', -0.12 * w);
      add('spine', 'x', -0.05 * w);
    } },
    laugh: { dur: 2.8, expr: 'happy', fn: (t, w) => {
      const s = Math.sin(t * 17);
      add('spine', 'x', (-0.1 + s * 0.035) * w);
      add('chest', 'x', s * 0.025 * w);
      add('head', 'x', (-0.22 + s * 0.05) * w);
      P.hipsY = (P.hipsY || 0) + Math.abs(s) * 0.012 * w;
      add('leftUpperArm', 'z', 0.2 * w);
      add('rightUpperArm', 'z', -0.2 * w);
    } },
    sad: { dur: 3.8, expr: 'sad', fn: (t, w) => {
      add('head', 'x', 0.38 * w);
      add('neck', 'x', 0.12 * w);
      add('spine', 'x', (0.14 + Math.sin(t * 1.4) * 0.012) * w);
      add('leftUpperArm', 'z', 0.05 * w);
      add('rightUpperArm', 'z', -0.05 * w);
    } },
    angry: { dur: 2.8, expr: 'angry', fn: (t, w) => {
      add('head', 'x', (0.12 + Math.sin(t * 14) * 0.02) * w);
      add('head', 'y', Math.sin(t * 5) * 0.08 * w);
      add('spine', 'x', 0.08 * w);
      add('leftUpperArm', 'z', 0.4 * w);
      add('rightUpperArm', 'z', -0.4 * w);
      P.hipsY = (P.hipsY || 0) + Math.pow(Math.max(0, Math.sin(t * 9)), 2) * 0.012 * w; // batidinhas de pé
    } },
    sleepy: { dur: 4.5, expr: 'relaxed', fn: (t, w) => {
      const d = (Math.sin(t * 1.6) + 1) / 2; // cabeceia devagar
      add('head', 'x', (0.12 + d * 0.3) * w);
      add('neck', 'x', d * 0.1 * w);
      add('spine', 'x', (0.05 + d * 0.06) * w);
      add('head', 'z', Math.sin(t * 0.8) * 0.05 * w);
    } },
    think: { dur: 3.6, expr: 'relaxed', fn: (t, w) => {
      add('head', 'z', 0.14 * w);
      add('head', 'x', -0.1 * w);
      add('head', 'y', Math.sin(t * 1.2) * 0.08 * w);
      add('spine', 'z', -0.03 * w);
      if (!getItemObj()) { // mão à frente do corpo (a mesma pose usada para segurar itens)
        add('rightUpperArm', 'z', -0.5 * w);
        add('rightUpperArm', 'x', -0.55 * w);
        add('rightLowerArm', 'y', 1.5 * w);
      }
    } },
    jump: { dur: 1.7, ramp: 0.05, expr: 'happy', fn: (t) => {
      const crouch = pulse(t, 0.35);                       // agacha para pegar impulso
      const air = t > 0.35 ? pulse(t - 0.35, 0.8) : 0;     // e salta
      P.hipsY = (P.hipsY || 0) - 0.07 * crouch + 0.2 * air;
      add('leftUpperLeg', 'x', -0.45 * crouch - 0.3 * air);
      add('rightUpperLeg', 'x', -0.45 * crouch - 0.3 * air);
      add('leftLowerLeg', 'x', 0.8 * crouch + 0.5 * air);
      add('rightLowerLeg', 'x', 0.8 * crouch + 0.5 * air);
      add('spine', 'x', 0.15 * crouch);
      add('leftUpperArm', 'z', 0.3 * crouch + 2.0 * air);
      add('rightUpperArm', 'z', -(0.3 * crouch + 2.0 * air));
    } },
    // soco na tela (interno: só a fala "smash" usa; não entra na lista de gestos do painel nem da IA)
    punch: { dur: 2.3, ramp: 0.2, expr: 'angry', fn: (t, w) => {
      const sm = (a, b, x) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
      const cock = sm(0.05, 0.45, t) * (1 - sm(0.45, 0.6, t));     // recua o punho
      const hit = sm(0.45, 0.6, t) * (1 - sm(1.25, 1.95, t));      // soca (o vidro racha em ~0,64 s) e depois recolhe
      const a = Math.min(1, 0.2 * cock + hit);                      // 0 = braço caído, 1 = braço esticado à frente
      P.hipsY = (P.hipsY || 0) - 0.02 * cock;
      add('spine', 'x', (0.1 * cock + 0.2 * hit) * w);
      add('head', 'x', (0.1 * cock + 0.12 * hit) * w);
      add('rightUpperArm', 'y', PUNCH.uy * Math.sqrt(a) * w);      // primeiro vai para a frente...
      add('rightUpperArm', 'z', -PUNCH.uz * a * a * w);            // ...e só depois sobe até a altura do rosto
      add('rightLowerArm', 'y', PUNCH.ly * cock * w);              // cotovelo dobrado enquanto recua o punho
      add('leftUpperArm', 'z', 0.25 * w);
      const shake = hit > 0.9 ? Math.sin(t * 60) * 0.015 * Math.max(0, 1 - (t - 0.6) / 0.35) : 0; // tremida do impacto
      add('rightUpperArm', 'y', shake * w);
    } },
    // dormir deitada (cama ou barraca): a janela é estreita, então ela fica de lado, menor, com a cabeça à esquerda
    bed: { dur: 3600, ramp: 1.4, expr: 'relaxed', fn: (t, w) => lieDown(t, w, false) },
    tent: { dur: 3600, ramp: 1.4, expr: 'relaxed', fn: (t, w) => lieDown(t, w, true) },
    // ----- danças -----
    disco: { dur: 7, expr: 'happy', fn: (t, w) => {
      const beat = Math.sin(t * 5.2), s = Math.sin(t * 2.6);
      const up = (v) => Math.max(0, v);
      add('rightUpperArm', 'z', -(0.2 + 2.0 * up(s)) * w);        // um braço aponta para o alto na diagonal...
      add('rightUpperArm', 'x', -0.3 * up(s) * w);
      add('leftUpperArm', 'z', (0.2 + 2.0 * up(-s)) * w);         // ...e depois troca
      add('leftUpperArm', 'x', -0.3 * up(-s) * w);
      add('hips', 'z', beat * 0.09 * w);
      add('spine', 'z', -beat * 0.07 * w);
      add('head', 'z', beat * 0.08 * w);
      P.hipsY = (P.hipsY || 0) + Math.abs(beat) * 0.018 * w;
      add('leftUpperLeg', 'x', -0.2 * up(beat) * w);
      add('leftLowerLeg', 'x', 0.35 * up(beat) * w);
      add('rightUpperLeg', 'x', -0.2 * up(-beat) * w);
      add('rightLowerLeg', 'x', 0.35 * up(-beat) * w);
    } },
    robot: { dur: 7, expr: 'neutral', fn: (t, w) => {
      const k = t * 2.4, i = Math.floor(k), f = k - i;
      const e = Math.min(1, f * 7), ease = e * e * (3 - 2 * e);     // move rápido e trava, como um robô
      const A = ROBOT[i % 4], B = ROBOT[(i + 1) % 4];
      const v = (n) => (A[n] + (B[n] - A[n]) * ease) * w;
      add('rightUpperArm', 'z', v(0));
      add('rightLowerArm', 'z', v(1));
      add('leftUpperArm', 'z', v(2));
      add('leftLowerArm', 'z', v(3));
      add('head', 'y', v(4));
      add('spine', 'y', v(5));
      P.hipsY = (P.hipsY || 0) - 0.012 * w;
    } },
    samba: { dur: 7, expr: 'happy', fn: (t, w) => {
      const a = Math.sin(t * 8), b = Math.cos(t * 8);
      add('hips', 'z', a * 0.15 * w);
      add('hips', 'y', b * 0.2 * w);
      add('spine', 'z', -a * 0.1 * w);
      add('spine', 'y', -b * 0.12 * w);
      add('head', 'z', a * 0.06 * w);
      P.hipsY = (P.hipsY || 0) + (-0.015 + Math.abs(a) * 0.02) * w;
      add('leftUpperLeg', 'x', (-0.1 - 0.25 * Math.max(0, a)) * w);
      add('leftLowerLeg', 'x', (0.2 + 0.4 * Math.max(0, a)) * w);
      add('rightUpperLeg', 'x', (-0.1 - 0.25 * Math.max(0, -a)) * w);
      add('rightLowerLeg', 'x', (0.2 + 0.4 * Math.max(0, -a)) * w);
      add('leftUpperArm', 'z', (0.9 + 0.35 * b) * w);
      add('rightUpperArm', 'z', -(0.9 - 0.35 * b) * w);
      add('leftUpperArm', 'x', -0.3 * a * w);
      add('rightUpperArm', 'x', 0.3 * a * w);
    } },
    ballet: { dur: 7, ramp: 0.7, expr: 'relaxed', fn: (t, w) => {
      const p = Math.min(1, Math.max(0, (t - 1.3) / 3.4));          // uma pirueta entre 1,3 s e 4,7 s
      P.spinY = p * p * (3 - 2 * p) * Math.PI * 2;
      const lift = p > 0 && p < 1 ? Math.sin(p * Math.PI) : 0;      // perna dobrada (passé) durante o giro
      add('leftUpperArm', 'z', (1.75 + Math.sin(t * 1.5) * 0.1) * w);   // braços arredondados acima da cabeça
      add('rightUpperArm', 'z', -(1.75 + Math.sin(t * 1.5) * 0.1) * w);
      add('leftLowerArm', 'z', 0.5 * w);
      add('rightLowerArm', 'z', -0.5 * w);
      add('head', 'z', Math.sin(t * 1.5) * 0.08 * w);
      add('spine', 'x', -0.04 * w);
      P.hipsY = (P.hipsY || 0) + 0.03 * w;                          // na ponta dos pés
      add('rightUpperLeg', 'x', -1.1 * lift);
      add('rightUpperLeg', 'z', -0.8 * lift);
      add('rightLowerLeg', 'x', 2.0 * lift);
    } },
    hiphop: { dur: 7, expr: 'happy', fn: (t, w) => {
      const dn = (1 - Math.cos(t * 6.5)) / 2;                       // desce no tempo da batida
      P.hipsY = (P.hipsY || 0) - 0.045 * dn * w;
      add('leftUpperLeg', 'x', -0.3 * dn * w);
      add('rightUpperLeg', 'x', -0.3 * dn * w);
      add('leftLowerLeg', 'x', 0.55 * dn * w);
      add('rightLowerLeg', 'x', 0.55 * dn * w);
      add('spine', 'x', 0.12 * dn * w);
      add('head', 'x', (0.08 + 0.1 * dn) * w);
      add('spine', 'y', Math.sin(t * 3.25) * 0.18 * w);
      add('hips', 'y', -Math.sin(t * 3.25) * 0.1 * w);
      const pr = (1 + Math.sin(t * 3.25)) / 2, pl = 1 - pr;          // os braços "bombeiam" alternados
      add('rightUpperArm', 'z', -(0.35 + 0.35 * pr) * w);
      add('rightLowerArm', 'z', -(1.0 + 0.7 * pr) * w);
      add('leftUpperArm', 'z', (0.35 + 0.35 * pl) * w);
      add('leftLowerArm', 'z', (1.0 + 0.7 * pl) * w);
    } },
    duck: { dur: 3.2, expr: 'surprised', fn: (t, w) => { // abaixa o corpo sem sentar
      const dip = Math.sin(Math.min(1, t / 0.38) * Math.PI / 2);
      P.hipsY = (P.hipsY || 0) - 0.16 * dip * w;
      add('leftUpperLeg', 'x', -0.42 * w);
      add('rightUpperLeg', 'x', -0.42 * w);
      add('leftLowerLeg', 'x', 0.78 * w);
      add('rightLowerLeg', 'x', 0.78 * w);
      add('spine', 'x', 0.22 * w);
      add('head', 'x', 0.08 * w);
      add('leftUpperArm', 'z', 0.18 * w);
      add('rightUpperArm', 'z', -0.18 * w);
    } },
    // ----- gestos sociais e reações curtas -----
    thumbs_up: { dur: 2.8, expr: 'happy', fn: (t, w) => { // joinha firme e um pequeno aceno do braço
      const bob = Math.sin(t * 5) * 0.05;
      add('rightUpperArm', 'z', (-1.55 + bob) * w);
      add('rightUpperArm', 'x', -0.28 * w);
      add('rightLowerArm', 'y', 1.32 * w);
      add('rightLowerArm', 'z', -0.18 * w);
      add('head', 'z', Math.sin(t * 2.4) * 0.045 * w);
    } },
    heart: { dur: 3.4, expr: 'happy', fn: (t, w) => { // aproxima as mãos do centro do peito
      const beat = 1 + Math.max(0, Math.sin(t * 5)) * 0.045;
      add('leftUpperArm', 'z', 0.82 * w);
      add('leftUpperArm', 'x', -0.18 * w);
      add('leftLowerArm', 'y', -1.05 * beat * w);
      add('leftLowerArm', 'x', -0.42 * w);
      add('rightUpperArm', 'z', -0.82 * w);
      add('rightUpperArm', 'x', -0.18 * w);
      add('rightLowerArm', 'y', 1.05 * beat * w);
      add('rightLowerArm', 'x', -0.42 * w);
      add('head', 'z', Math.sin(t * 2) * 0.04 * w);
    } },
    blow_kiss: { dur: 3.1, expr: 'happy', fn: (t, w) => { // leva a mão à boca e a estende para enviar o beijo
      const send = Math.max(0, Math.min(1, (t - 0.9) / 0.55));
      const smooth = send * send * (3 - 2 * send);
      add('rightUpperArm', 'z', (-0.62 - 0.36 * smooth) * w);
      add('rightUpperArm', 'x', (-0.35 - 0.18 * smooth) * w);
      add('rightLowerArm', 'y', (1.12 + 0.38 * (1 - smooth)) * w);
      add('rightLowerArm', 'z', -0.32 * (1 - smooth) * w);
      add('head', 'x', -0.10 * w);
      add('head', 'z', 0.06 * w);
      P.hipsY = (P.hipsY || 0) + Math.sin(t * 3) * 0.008 * w;
    } },
    point: { dur: 2.7, expr: 'happy', fn: (t, w) => { // aponta para a frente com o braço direito
      const hold = 0.9 + Math.sin(t * 3) * 0.04;
      add('rightUpperArm', 'y', 1.45 * hold * w);
      add('rightUpperArm', 'z', -0.30 * w);
      add('rightLowerArm', 'y', 0.22 * w);
      add('rightLowerArm', 'z', -0.08 * w);
      add('head', 'y', Math.sin(t * 2.5) * 0.08 * w);
    } },
    shrug: { dur: 3.0, expr: 'relaxed', fn: (t, w) => { // ombros erguidos e braços abertos: "não sei"
      const lift = 1 + Math.sin(t * 2.2) * 0.06;
      add('leftUpperArm', 'z', 1.05 * lift * w);
      add('leftUpperArm', 'x', 0.22 * w);
      add('leftLowerArm', 'y', -1.18 * w);
      add('leftLowerArm', 'z', 0.24 * w);
      add('rightUpperArm', 'z', -1.05 * lift * w);
      add('rightUpperArm', 'x', 0.22 * w);
      add('rightLowerArm', 'y', 1.18 * w);
      add('rightLowerArm', 'z', -0.24 * w);
      add('head', 'z', 0.12 * w);
      add('head', 'y', Math.sin(t * 1.8) * 0.08 * w);
    } },
    facepalm: { dur: 3.0, expr: 'relaxed', fn: (t, w) => { // mão direita na testa, reação de vergonha alheia
      const press = 0.92 + Math.sin(t * 4) * 0.035;
      add('rightUpperArm', 'z', -0.86 * w);
      add('rightUpperArm', 'x', -0.42 * w);
      add('rightLowerArm', 'y', 1.48 * press * w);
      add('rightLowerArm', 'z', -0.34 * w);
      add('head', 'x', 0.20 * w);
      add('head', 'z', -0.08 * w);
      add('spine', 'x', 0.06 * w);
    } },
    // ----- poses -----
    clap: { dur: 4, expr: 'happy', fn: (t, w) => {
      const c = Math.abs(Math.sin(t * 8));                          // 1 = as mãos se encontram
      const z = 0.45 - 0.3 * (1 - c);
      add('rightUpperArm', 'z', z * w);
      add('rightUpperArm', 'x', -0.8 * w);
      add('rightLowerArm', 'y', 1.3 * w);
      add('rightLowerArm', 'z', (0.1 + 0.2 * c) * w);
      add('leftUpperArm', 'z', -z * w);
      add('leftUpperArm', 'x', -0.8 * w);
      add('leftLowerArm', 'y', -1.3 * w);
      add('leftLowerArm', 'z', -(0.1 + 0.2 * c) * w);
      add('head', 'x', -0.05 * w);
      P.hipsY = (P.hipsY || 0) + c * 0.008 * w;
    } },
    pose: { dur: 5, expr: 'happy', fn: (t, w) => {                 // mãos na cintura, pose de confiança
      add('leftUpperArm', 'z', 0.6 * w);
      add('leftUpperArm', 'x', 0.15 * w);
      add('leftLowerArm', 'y', -1.1 * w);
      add('leftLowerArm', 'z', -0.5 * w);
      add('rightUpperArm', 'z', -0.6 * w);
      add('rightUpperArm', 'x', 0.15 * w);
      add('rightLowerArm', 'y', 1.1 * w);
      add('rightLowerArm', 'z', 0.5 * w);
      add('hips', 'z', 0.05 * w + Math.sin(t * 1.4) * 0.015 * w);
      add('spine', 'z', -0.05 * w);
      add('head', 'z', -0.07 * w);
      add('head', 'x', -0.05 * w);
      add('rightUpperLeg', 'z', -0.1 * w);
    } },
    salute: { dur: 3, expr: 'happy', fn: (t, w) => {              // continência
      add('rightUpperArm', 'z', -1.55 * w);
      add('rightUpperArm', 'x', -0.3 * w);
      add('rightLowerArm', 'z', -2.0 * w);
      add('head', 'x', -0.06 * w);
      add('spine', 'x', -0.04 * w);
    } },
    sit: { dur: 30, ramp: 1.1, expr: 'relaxed', fn: (t, w) => {    // sentada no chão
      const d = w * w * w;                                          // as pernas dobram antes de o quadril descer
      P.hipsY = (P.hipsY || 0) - getSitDrop() * d;
      add('leftUpperLeg', 'x', -1.25 * w);
      add('leftUpperLeg', 'z', 0.7 * w);
      add('leftLowerLeg', 'x', 2.3 * w);
      add('rightUpperLeg', 'x', -1.25 * w);
      add('rightUpperLeg', 'z', -0.7 * w);
      add('rightLowerLeg', 'x', 2.3 * w);
      add('spine', 'x', 0.05 * w);
      add('leftUpperArm', 'z', 0.15 * w);
      add('rightUpperArm', 'z', -0.15 * w);
      add('head', 'z', Math.sin(t * 0.7) * 0.05 * w);
    } },
    chair: { dur: 30, ramp: 1.1, expr: 'relaxed', fn: (t, w) => {   // sentada numa cadeira (ela traz um banquinho)
      const d = w * w * w;
      P.hipsY = (P.hipsY || 0) - getChairDrop() * d;
      const kick = Math.sin(t * 1.8) * 0.12;                        // balança os pés de leve
      add('leftUpperLeg', 'x', -1.5 * w);
      add('rightUpperLeg', 'x', -1.5 * w);
      add('leftLowerLeg', 'x', (1.5 + kick) * w);
      add('rightLowerLeg', 'x', (1.5 - kick) * w);
      add('leftUpperLeg', 'z', 0.06 * w);
      add('rightUpperLeg', 'z', -0.06 * w);
      add('spine', 'x', 0.04 * w);
      add('leftUpperArm', 'z', 0.12 * w);
      add('leftUpperArm', 'x', -0.35 * w);
      add('leftLowerArm', 'y', -0.9 * w);
      add('rightUpperArm', 'z', -0.12 * w);
      add('rightUpperArm', 'x', -0.35 * w);
      add('rightLowerArm', 'y', 0.9 * w);
      add('head', 'z', Math.sin(t * 0.6) * 0.05 * w);
    } },
    // pouso depois de cair (interno, não entra no sorteio)
    land: { dur: 0.95, expr: 'surprised', fn: (t, w) => {
      const d = pulse(t, 0.4) * getLandK();            // agacha ao encostar no chão e volta
      P.hipsY = (P.hipsY || 0) - 0.09 * d;
      add('spine', 'x', 0.22 * d);
      add('leftUpperLeg', 'x', -0.55 * d);  add('rightUpperLeg', 'x', -0.55 * d);
      add('leftLowerLeg', 'x', 0.95 * d);   add('rightLowerLeg', 'x', 0.95 * d);
      add('leftUpperArm', 'z', 0.55 * d);   add('rightUpperArm', 'z', -0.55 * d);
    } },
    shy: { dur: 3.2, expr: 'relaxed', fn: (t, w) => {
      add('head', 'z', 0.16 * w);
      add('head', 'x', 0.2 * w);
      add('spine', 'x', 0.06 * w);
      add('spine', 'z', Math.sin(t * 2) * 0.04 * w);
      add('leftUpperArm', 'z', 0.2 * w);
      add('rightUpperArm', 'z', -0.2 * w);
    } },
  };

  return { EMOTES, P, add, resetPose };
}
