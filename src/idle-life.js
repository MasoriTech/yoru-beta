// "Vida parada" do avatar: respiração, olhar de um lado para o outro, braços moles e dedos soltos.
// Só matemática: entra o tempo e quanto cada parte pode se mexer agora (0..1), sai quanto cada osso gira.
// O renderer.js soma o resultado na pose (add) e reduz os pesos quando um gesto, a caminhada ou o item
// já estão controlando o corpo — assim a camada nunca briga com eles. Testes em test/idle-life.test.js.
//
// Eixos dos ossos normalizados do VRM (os mesmos usados nos gestos do renderer):
//   braço esquerdo para cima = +z, direito para cima = -z (por isso `sg`: esquerda +1, direita -1);
//   x negativo = para a frente nos braços e para trás no tronco; antebraço dobra em y (esq. -, dir. +);
//   dedos fecham em z (esq. -, dir. +); o polegar se recolhe em y (esq. -, dir. +); cabeça vira em y.

const sin = Math.sin;
const cos = Math.cos;

const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];
const JOINTS = ['Proximal', 'Intermediate', 'Distal'];
const THUMB = ['Metacarpal', 'Proximal', 'Distal'];

// todos os ossos dos dedos que a camada mexe (o renderer guarda os nós deles, se o modelo tiver)
export const FINGER_BONES = ['left', 'right'].flatMap((s) => [
  ...FINGERS.flatMap((f) => JOINTS.map((j) => `${s}${f}${j}`)),
  ...THUMB.map((j) => `${s}Thumb${j}`),
]);

// sorteio com semente, para os testes saírem sempre iguais
export function seededRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createIdleLife({ rng = Math.random } = {}) {
  let breathPhase = 0;

  // ---- olhar: a cabeça vira para um lado, para, vira para o outro (mola um pouco folgada) ----
  const look = { yaw: 0, vy: 0, pitch: 0, vp: 0, ty: 0, tp: 0, next: 0.8 };
  function pickLook() {
    const side = rng() < 0.85 ? (look.ty > 0 ? -1 : 1) : (rng() < 0.5 ? -1 : 1); // quase sempre vai para o lado oposto
    look.ty = side * (0.2 + rng() * 0.26);
    if (rng() < 0.2) look.ty *= 0.2;                       // às vezes só volta para o meio
    look.tp = (rng() - 0.4) * 0.16;
    look.next = 1.5 + rng() * 2.8;                         // segura o olhar por 1,5 a 4,3 s
  }

  // ---- braços moles: cada braço é um pêndulo frouxo; a mão vem atrás do braço ----
  const mkArm = () => ({ x: 0, vx: 0, z: 0, vz: 0, hx: 0, hv: 0, flop: 1 + rng() * 2.5 });
  const arm = { left: mkArm(), right: mkArm() };

  // dedos: cada um com seu ritmo
  const fingerPh = Array.from({ length: 10 }, () => rng() * 6.28);

  let prevT = null, prevShift = 0;

  // dt: segundos; t: tempo total; w: { body, head, armL, armR, fingers } pesos 0..1
  // Retorna { bones: { nome: {x,y,z} }, hipsY, breath, yaw } (breath: -1..1, + = inspirando; yaw: virada da cabeça)
  function step(dt, t, w) {
    const body = clamp01(w.body), head = clamp01(w.head), fing = clamp01(w.fingers ?? w.body);
    const arms = { left: clamp01(w.armL), right: clamp01(w.armR) };
    const bones = {};
    const add = (bone, axis, v) => { (bones[bone] ||= { x: 0, y: 0, z: 0 })[axis] += v; };
    const h = Math.min(dt, 0.05);

    // ritmo que muda sozinho (~3,5 a 4,5 s por respiração); inspira mais rápido do que solta
    breathPhase += dt * (1.5 + 0.28 * sin(t * 0.21) + 0.12 * sin(t * 0.47 + 1));
    const b = sin(breathPhase + 0.45 * sin(breathPhase));
    const depth = 0.85 + 0.3 * sin(t * 0.31 + 1);          // às vezes respira mais fundo
    const bd = b * depth;

    // balanço de peso: troca de perna devagar (~9 s) com uma segunda onda para não repetir
    const shift = 0.55 * sin(t * 0.7) + 0.45 * sin(t * 0.37 + 2);
    const shiftVel = prevT === null ? 0 : (shift - prevShift) / Math.max(dt, 1e-3);
    prevT = t; prevShift = shift;

    // olhar: a mola corre sempre (mesmo com peso 0), só a saída é multiplicada pelo peso
    look.next -= dt;
    if (look.next <= 0) pickLook();
    look.vy += ((look.ty - look.yaw) * 22 - look.vy * 7.5) * h;
    look.yaw += look.vy * h;
    look.vp += ((look.tp - look.pitch) * 22 - look.vp * 7.5) * h;
    look.pitch += look.vp * h;

    // ---- tronco: o peito abre e fecha, os ombros sobem, o quadril acompanha ----
    add('chest', 'x', -0.035 * bd * body);
    add('spine', 'x', -0.014 * bd * body);
    add('chest', 'z', -0.012 * shift * body);
    add('spine', 'z', -0.018 * shift * body);
    add('hips', 'z', 0.022 * shift * body);
    add('spine', 'y', 0.07 * look.yaw * body);              // o tronco acompanha um pouco a virada
    add('chest', 'y', 0.1 * look.yaw * body);
    add('leftShoulder', 'z', 0.03 * bd * body);
    add('rightShoulder', 'z', -0.03 * bd * body);
    const hipsY = 0.003 * bd * body;
    // joelhos soltos: a perna que carrega o peso fica reta, a outra cede um pouco (antes ficavam travados, o que dá o ar duro)
    const knee = 0.05;
    add('leftLowerLeg', 'x', (knee + 0.035 * Math.max(0, shift)) * body);
    add('rightLowerLeg', 'x', (knee + 0.035 * Math.max(0, -shift)) * body);
    add('leftUpperLeg', 'x', -0.018 * (1 + Math.max(0, shift)) * body);
    add('rightUpperLeg', 'x', -0.018 * (1 + Math.max(0, -shift)) * body);
    add('leftUpperLeg', 'z', -0.012 * shift * body);                 // o quadril acompanha a troca de peso
    add('rightUpperLeg', 'z', -0.012 * shift * body);

    // ---- cabeça: vira de lado a lado, inclina junto e ainda contrabalança a respiração ----
    add('head', 'y', (0.62 * look.yaw + 0.02 * sin(t * 0.91 + 2)) * head);
    add('neck', 'y', 0.3 * look.yaw * head);
    add('head', 'x', (0.012 * bd + look.pitch + 0.02 * sin(t * 0.53) + 0.01 * sin(t * 1.3 + 0.7)) * head);
    add('neck', 'x', (0.4 * look.pitch + 0.008 * sin(t * 0.53 - 0.4)) * head);
    add('head', 'z', (-0.16 * look.yaw + 0.026 * sin(t * 0.29 + 1) + 0.016 * shift) * head);

    // ---- braços moles: pêndulos frouxos empurrados pelo corpo, com atraso e sobra ----
    for (const [side, sg, ph, fi] of [['left', 1, 0, 0], ['right', -1, 1.7, 5]]) {
      const a = arm[side];
      const k = arms[side];
      // o que empurra o braço: troca de peso, virada da cabeça/tronco e a respiração
      const drive = -0.9 * shiftVel * sg + 0.5 * look.vy * sg + 0.4 * cos(breathPhase) * 0.2;
      // soltinho de vez em quando: o braço balança sozinho, sem motivo, como braço mole
      a.flop -= dt;
      if (a.flop <= 0) { a.vx += (rng() - 0.5) * 1.7; a.vz += (rng() - 0.5) * 0.9; a.flop = 2 + rng() * 4.5; }
      // x = para frente/atrás; z = abrir/fechar. Pouca mola e pouco amortecimento = balança e demora a parar
      a.vx += (-a.x * 7 - a.vx * 1.5 + drive * 1.2 + 0.18 * sin(t * 0.6 + ph)) * h;
      a.x = clampN(a.x + a.vx * h, 0.26);
      a.vz += (-a.z * 8 - a.vz * 1.8 - shiftVel * 0.7 * sg + 0.25 * look.vy) * h;
      a.z = clampN(a.z + a.vz * h, 0.2);
      // a mão segue o braço com mais atraso ainda (mola mais frouxa)
      a.hv += ((a.x - a.hx) * 26 - a.hv * 3.2) * h;
      a.hx = clampN(a.hx + a.hv * h, 0.4);

      if (k > 0) {
        add(side + 'Shoulder', 'z', -sg * 0.025 * k);       // ombro caído, sem tensão
        add(side + 'UpperArm', 'z', sg * (0.045 + 0.02 * bd + 0.02 * sin(t * 0.8 + ph) + 0.55 * a.z) * k);
        add(side + 'UpperArm', 'x', (-0.07 + 0.03 * sin(t * 0.6 + ph + 1) + 0.9 * a.x) * k);
        add(side + 'UpperArm', 'y', (0.03 * sin(t * 0.5 + ph) + 0.35 * a.x) * k);
        // o cotovelo cede quando o braço balança para trás e estica quando vem para frente
        add(side + 'LowerArm', 'y', -sg * (0.28 + 0.07 * sin(t * 0.9 + ph + 0.5) + 0.02 * bd - 0.8 * a.x) * k);
        add(side + 'LowerArm', 'x', 0.15 * a.x * k);
        const dh = clampN(a.hx - a.x, 0.25);                  // quanto a mão ficou para trás do braço
        add(side + 'Hand', 'z', (0.05 * sin(t * 1.1 + ph + 2) - 0.7 * dh) * k);
        add(side + 'Hand', 'x', (0.07 * sin(t * 0.7 + ph) + 0.8 * dh) * k);
        add(side + 'Hand', 'y', 0.12 * a.hx * sg * k);
      }

      // ---- dedos: meio fechados, cada um no seu ritmo, balançando com a mão ----
      if (fing > 0) {
        const swing = clampN(a.hx - a.x, 0.3);              // a mão balança: os dedos cedem um pouco
        FINGERS.forEach((f, i) => {
          const ph2 = fingerPh[fi + i];
          const base = 0.2 + 0.09 * i;                        // indicador mais aberto, mindinho mais fechado
          const move = 0.1 * sin(t * (0.55 + 0.11 * i) + ph2) + 0.05 * sin(t * (1.3 + 0.17 * i) + ph2 * 2);
          const c = base + move + 0.22 * swing * sg - 0.03 * bd;
          add(`${side}${f}Proximal`, 'z', -sg * c * fing);
          add(`${side}${f}Intermediate`, 'z', -sg * c * 1.15 * fing);
          add(`${side}${f}Distal`, 'z', -sg * c * 0.7 * fing);
        });
        const th = 0.12 + 0.07 * sin(t * 0.45 + fingerPh[fi + 4]);
        add(`${side}ThumbMetacarpal`, 'y', -sg * th * 0.7 * fing);
        add(`${side}ThumbProximal`, 'y', -sg * th * fing);
        add(`${side}ThumbDistal`, 'y', -sg * th * 0.8 * fing);
      }
    }
    return { bones, hipsY, breath: bd, yaw: look.yaw };
  }

  return { step };
}

// Pesos da camada a partir do estado do avatar (tudo 0..1). Fica aqui, fora do renderer, para poder testar.
// em: quanto um gesto está mandando; walk: caminhada; held: carregada/caindo; sleep: deitada;
// itemSide: 'left' | 'right' | null e item: quanto o item está na mão.
export function idleWeights({ em = 0, walk = 0, held = 0, sleep = 0, item = 0, itemSide = null }) {
  const calm = (1 - clamp01(held)) * (1 - clamp01(sleep));
  const arm = calm * (1 - clamp01(em)) * (1 - clamp01(walk));
  const side = (s) => arm * (itemSide === s ? 1 - clamp01(item) : 1);
  return {
    body: calm * (1 - 0.5 * clamp01(walk)),
    head: calm * (1 - 0.8 * clamp01(em)) * (1 - 0.6 * clamp01(walk)),
    armL: side('left'),
    armR: side('right'),
    fingers: calm * (1 - 0.5 * clamp01(em)),
  };
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function clampN(v, m) { return Math.max(-m, Math.min(m, v)); }
