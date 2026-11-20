// Caminhada: o processo principal move a janela; aqui só a animação (pernas e braços em oposição, quadril balançando,
// corpo girado para o lado do passeio). O renderer.js lê walk.on / walk.w / walk.ph e chama update(dt) a cada quadro.
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createWalk({ THREE, S, P, add, armHold }) {
  const walk = {
    on: false,   // o processo principal está movendo a janela
    w: 0,        // peso suave da pose de andar (0..1)
    ph: 0,       // fase do passo
  };
  let walkDir = 1;    // 1 = para a direita da tela, -1 = para a esquerda
  let walkSpd = 110;  // px/s (define o ritmo dos passos)
  let faceK = 0;      // giro do corpo para o lado em que anda (-1..1)
  window.api.onWalk((on, dir, speed) => {
    walk.on = !!on;
    if (on) { walkDir = dir < 0 ? -1 : 1; walkSpd = speed || 110; walk.dir = walkDir; }
  });

  walk.update = (dt) => {
    walk.w += ((walk.on ? 1 : 0) - walk.w) * Math.min(dt * 7, 1);
    faceK += ((walk.on ? walkDir : 0) - faceK) * Math.min(dt * 5, 1);
    if (walk.w > 0.001 || Math.abs(faceK) > 0.001) {
      const w = walk.w;
      walk.ph += dt * clamp(walkSpd / 18, 5, 9.5);
      const sn = Math.sin(walk.ph), cs = Math.cos(walk.ph);
      add('leftUpperLeg', 'x', -0.42 * sn * w);
      add('rightUpperLeg', 'x', 0.42 * sn * w);
      add('leftLowerLeg', 'x', (0.12 + 0.5 * Math.max(0, cs)) * w);   // joelho dobra quando a perna vai para a frente
      add('rightLowerLeg', 'x', (0.12 + 0.5 * Math.max(0, -cs)) * w);
      add('leftUpperArm', 'x', 0.32 * sn * w * armHold('left'));
      add('rightUpperArm', 'x', -0.32 * sn * w * armHold('right'));
      P.hipsY = (P.hipsY || 0) + Math.abs(cs) * 0.014 * w;             // sobe e desce a cada passo
      add('hips', 'z', sn * 0.03 * w);
      add('spine', 'z', -sn * 0.03 * w);
      add('hips', 'y', sn * 0.07 * w);
      add('spine', 'y', -sn * 0.07 * w);
      add('spine', 'x', 0.04 * w);
      // soltura: cotovelo dobra mais quando o braço vai para a frente, ombros e cabeça acompanham em contrapeso
      const s2 = Math.sin(2 * walk.ph + 0.6);                          // 2º harmônico: o passo deixa de ser uma senoide perfeita
      add('leftLowerArm', 'y', -(0.2 + 0.16 * Math.max(0, -sn)) * w * armHold('left'));
      add('rightLowerArm', 'y', (0.2 + 0.16 * Math.max(0, sn)) * w * armHold('right'));
      add('leftHand', 'x', 0.1 * cs * w * armHold('left'));
      add('rightHand', 'x', -0.1 * cs * w * armHold('right'));
      add('chest', 'y', sn * 0.05 * w);
      add('chest', 'z', sn * 0.02 * w);
      add('head', 'y', sn * 0.09 * w);                                 // a cabeça contrabalança o giro do tronco e olha para frente
      add('neck', 'y', sn * 0.03 * w);
      add('head', 'x', (0.012 * s2 - 0.01) * w);                       // leve balanço vertical a cada passo
      add('head', 'z', -sn * 0.025 * w);
      add('leftUpperLeg', 'x', 0.04 * s2 * w);                         // passo com um pouco de irregularidade
      add('rightUpperLeg', 'x', -0.04 * s2 * w);
      const faceSign = Math.cos(THREE.MathUtils.degToRad(S.rotation)) >= 0 ? 1 : -1; // de costas, o lado inverte
      P.spinY = (P.spinY || 0) + faceK * 0.95 * faceSign;
    }
  };
  return walk;
}
