// Hit-test barato: cápsulas ao longo dos ossos, projetadas na tela.
// (O raycast contra a malha inteira recalcula todos os vértices do modelo a cada movimento do mouse.)
const CAPS = [
  ['hips', 'spine', 0.16], ['spine', 'chest', 0.17], ['chest', 'neck', 0.17], ['neck', 'head', 0.07],
  ['leftShoulder', 'leftUpperArm', 0.08], ['rightShoulder', 'rightUpperArm', 0.08],
  ['leftUpperArm', 'leftLowerArm', 0.075], ['leftLowerArm', 'leftHand', 0.065],
  ['rightUpperArm', 'rightLowerArm', 0.075], ['rightLowerArm', 'rightHand', 0.065],
  ['hips', 'leftUpperLeg', 0.10], ['hips', 'rightUpperLeg', 0.10],
  ['leftUpperLeg', 'leftLowerLeg', 0.11], ['leftLowerLeg', 'leftFoot', 0.085],
  ['rightUpperLeg', 'rightLowerLeg', 0.11], ['rightLowerLeg', 'rightFoot', 0.085],
  ['leftFoot', 'leftToes', 0.075], ['rightFoot', 'rightToes', 0.075],
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// recebe o que muda no renderer por funções (getVrm, getGlb...), para sempre ler o valor atual
export function createHitTest(THREE, { camera, getVrm, getGlb, isVisible, getFrame }) {
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _box = new THREE.Box3();
  const _c = new THREE.Vector3();
  let segs = [];
  let segsFrame = -1;

  function toScreen(v, out) {
    const dist = camera.position.distanceTo(v);
    v.project(camera);
    out.x = (v.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    out.px = window.innerHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist); // pixels por metro
  }

  function buildSegments() {
    segs = [];
    const hum = getVrm().humanoid;
    const pos = (name, v) => {
      const n = hum.getNormalizedBoneNode(name);
      if (!n) return false;
      v.setFromMatrixPosition(n.matrixWorld);
      return true;
    };
    const A = {}, B = {};
    const push = (ax, ay, bx, by, r) => segs.push({ ax, ay, bx, by, r });
    for (const [na, nb, r] of CAPS) {
      if (!pos(na, _a) || !pos(nb, _b)) continue;
      toScreen(_a, A);
      toScreen(_b, B);
      push(A.x, A.y, B.x, B.y, r * (A.px + B.px) / 2);
    }
    // cabeça (esfera acima do osso) e cabelo comprido caindo pelas costas
    if (pos('head', _a)) {
      _b.copy(_a);
      _a.y += 0.1;
      toScreen(_a, A);
      toScreen(_b, B);
      push(A.x, A.y, A.x, A.y, 0.16 * A.px);
      if (pos('hips', _b)) {
        toScreen(_b, B);
        push(A.x, A.y, B.x, B.y, 0.15 * (A.px + B.px) / 2);
      }
    }
  }

  function overGlb(x, y) {
    _box.setFromObject(getGlb());
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (let i = 0; i < 8; i++) {
      _c.set(i & 1 ? _box.max.x : _box.min.x, i & 2 ? _box.max.y : _box.min.y, i & 4 ? _box.max.z : _box.min.z).project(camera);
      const sx = (_c.x * 0.5 + 0.5) * window.innerWidth, sy = (-_c.y * 0.5 + 0.5) * window.innerHeight;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return x >= x0 - 6 && x <= x1 + 6 && y >= y0 - 6 && y <= y1 + 6;
  }
  function overAvatar(x, y) {
    if (!isVisible()) return false;
    if (getGlb()) return overGlb(x, y);
    if (!getVrm()) return false;
    const f = getFrame();
    if (segsFrame !== f) { buildSegments(); segsFrame = f; }
    const pad = 6;
    for (const s of segs) {
      const dx = s.bx - s.ax, dy = s.by - s.ay;
      const l2 = dx * dx + dy * dy;
      const u = l2 ? clamp(((x - s.ax) * dx + (y - s.ay) * dy) / l2, 0, 1) : 0;
      const ex = x - (s.ax + u * dx), ey = y - (s.ay + u * dy);
      const r = s.r + pad;
      if (ex * ex + ey * ey <= r * r) return true;
    }
    return false;
  }

  return { overAvatar };
}
