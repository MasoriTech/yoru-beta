// Seguir o cursor: o processo principal manda a posição do mouse relativa à janela; os olhos vão para lá e a cabeça
// acompanha um pouco. Também cuida do carinho (mão livre ou mouse passando em vai e vem sobre a cabeça) e avisa onde está a cabeça.
// O renderer.js chama updateHead(dt, add, damp) e aimEyes(sleepW) a cada quadro e lê cur.k (0..1, quanto ela está seguindo).

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createCursorFollow({ THREE, S, scene, camera, api, getVrm, getHeadNode, getHipsNode, playEmote, isBusy }) {
  const cur = { k: 0 };
  let curX = 0, curY = 0, curT = -1e9, curHave = false, curYaw = 0, curPitch = 0;
  const cursorTarget = new THREE.Object3D();
  scene.add(cursorTarget);
  const _curDir = new THREE.Vector3(), _headP = new THREE.Vector3();

  // posição da cabeça na janela, em pixels
  function headScreenPx() {
    const head = getHeadNode();
    if (!head) return null;
    head.getWorldPosition(_headP).project(camera);
    return { x: (_headP.x * 0.5 + 0.5) * window.innerWidth, y: (-_headP.y * 0.5 + 0.5) * window.innerHeight };
  }

  // Mão livre: passar a mão (ou o mouse) em vai e vem sobre a cabeça é um carinho: ela gosta.
  let patAcc = 0, patPrev = null, patCool = 0;
  function patCheck(c) {
    if (!S.handFree || !S.clickReact || !getVrm() || !S.visible || isBusy()) { patAcc = 0; patPrev = null; return; }
    const h = headScreenPx();
    if (!h) return;
    const R = Math.max(40, window.innerHeight * 0.09), now = performance.now();
    const inside = Math.abs(c.x - h.x) < R * 1.3 && c.y > h.y - R * 1.3 && c.y < h.y + R * 0.8;
    if (!inside) { patAcc = 0; patPrev = null; return; }
    if (patPrev) patAcc += Math.hypot(c.x - patPrev.x, c.y - patPrev.y);
    patPrev = { x: c.x, y: c.y };
    if (patAcc > 520 && now > patCool) { patCool = now + 9000; patAcc = 0; playEmote(Math.random() < 0.6 ? 'happy' : 'shy'); }
  }
  api.onCursor((c) => {
    if (!c) return;
    if (c.x !== curX || c.y !== curY) curT = performance.now();
    curX = c.x; curY = c.y; curHave = true;
    patCheck(c);
  });
  // onde está a cabeça (para a mão virtual ir lá fazer carinho sozinha)
  setInterval(() => {
    if (!S.handFree || !S.visible || !getVrm()) return;
    const h = headScreenPx();
    if (h) api.reportHead(h.x, h.y, Math.max(40, window.innerHeight * 0.09));
  }, 400);

  // a cabeça vira na direção do mouse enquanto ele se mexe e volta ao centro depois de alguns segundos parado.
  // `damp` (0..1) reduz o efeito quando outra pose (gesto, carregada, dormindo, andando) está mandando.
  cur.updateHead = (dt, add, damp) => {
    const followOn = !!(S.followCursor && curHave && getVrm());
    cur.k += (((followOn && performance.now() - curT < 6000) ? 1 : 0) - cur.k) * Math.min(dt * 3, 1);
    if (cur.k > 0.01) {
      const hp = headScreenPx();
      if (hp) {
        const depth = Math.max(300, window.innerHeight * 0.9);
        const faceSign = Math.cos(THREE.MathUtils.degToRad(S.rotation)) >= 0 ? 1 : -1; // de costas, o lado inverte
        const ty = clamp(Math.atan2(curX - hp.x, depth) * faceSign, -0.6, 0.6);
        const tp = clamp(Math.atan2(curY - hp.y, depth), -0.35, 0.45);
        const kk = Math.min(dt * 6, 1);
        curYaw += (ty - curYaw) * kk; curPitch += (tp - curPitch) * kk;
      }
      const fw = cur.k * (S.followCursorHead ?? 0.6) * damp;
      add('head', 'y', curYaw * fw * 0.7); add('head', 'x', curPitch * fw * 0.7);
      add('neck', 'y', curYaw * fw * 0.3); add('neck', 'x', curPitch * fw * 0.3);
    }
  };

  // olhos: seguem o cursor enquanto ele se mexe; senão olham para a tela (se a opção estiver ligada)
  cur.aimEyes = (sleepW) => {
    const vrm = getVrm();
    if (cur.k > 0.05 && !sleepW) {
      const nx = clamp(curX / window.innerWidth * 2 - 1, -2.5, 2.5), ny = clamp(-(curY / window.innerHeight * 2 - 1), -2.5, 2.5);
      _curDir.set(nx, ny, 0.5).unproject(camera).sub(camera.position).normalize();
      const hips = getHipsNode();
      const hz = (hips ? hips.getWorldPosition(_headP).z : 0) + 0.8;
      cursorTarget.position.copy(camera.position).addScaledVector(_curDir, (hz - camera.position.z) / _curDir.z);
      vrm.lookAt.target = cursorTarget;
    } else vrm.lookAt.target = S.lookAtCamera ? camera : null;
  };

  return cur;
}
