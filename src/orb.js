// Bolinha que mostra se ela está ouvindo (o estado vem do painel, onde fica o microfone):
// off | listening | hearing | busy | muted. Fica ao lado da cabeça do avatar e a segue em qualquer pose.
// O renderer.js chama placeOrb() a cada quadro e paintOrb() quando as configurações mudam.

export function createOrb({ THREE, camera, S, getVrm, getGlb, getHeadNode }) {
  const orbEl = document.getElementById('orb');
  let orbState = 'off';
  function paintOrb() {
    if (!orbEl) return;
    const show = S.convOrb !== false && S.visible !== false && orbState !== 'off';
    orbEl.className = show ? 'on ' + orbState : '';
    if (show) {
      orbEl.title = { listening: 'Ouvindo', hearing: 'Ouvindo você', busy: 'Pensando', muted: 'Falando (microfone mudo)' }[orbState] || '';
      placeOrb(); // já nasce ao lado da cabeça (sem esperar o próximo quadro, que a deixava piscar no canto da janela)
    }
  }
  window.api.onVoiceOrb((st) => { orbState = st; paintOrb(); });

  // posiciona a bolinha de escuta ao lado direito da cabeça DO AVATAR (esquerda da TELA), seguindo-a em qualquer pose, emote ou passeio.
  // O osso 'head' fica na base do crânio; sobe-se até o meio da cabeça e afasta-se para o lado (em metros do modelo, vezes a escala dele).
  const ORB_SIDE = -0.17, ORB_UP = 0.1; // negativo = esquerda da tela = direita do avatar
  const ORB_FOLLOW = 22;                // rapidez do acompanhamento (maior = mais colada); suaviza os quadros espaçados do modo econômico
  const _orbV = new THREE.Vector3(), _orbR = new THREE.Vector3(), _orbU = new THREE.Vector3(), _orbBox = new THREE.Box3();
  let orbX = 0, orbY = 0, orbT = 0, orbPlaced = false; // posição atual e instante da última atualização
  function placeOrb() {
    if (!orbEl || !orbEl.classList.contains('on')) { orbPlaced = false; return; }
    const vrm = getVrm(), glb = getGlb();
    const head = getHeadNode();
    const W = window.innerWidth, H = window.innerHeight;
    let x = W - 26, y = H - 26; // sem avatar: canto, como antes
    if (head) {
      const k = vrm.scene.scale.x || 1;
      camera.updateMatrixWorld();
      head.updateWorldMatrix(true, false);
      head.getWorldPosition(_orbV);
      _orbR.setFromMatrixColumn(camera.matrixWorld, 0); // eixo para a direita da tela
      _orbU.setFromMatrixColumn(camera.matrixWorld, 1); // cima da tela
      _orbV.addScaledVector(_orbR, ORB_SIDE * k).addScaledVector(_orbU, ORB_UP * k);
      _orbV.project(camera);
      x = (_orbV.x * 0.5 + 0.5) * W - 7;
      y = (-_orbV.y * 0.5 + 0.5) * H - 7;
    } else if (glb) { // .glb comum (sem ossos): canto de cima, do lado direito do modelo (esquerda da tela)
      camera.updateMatrixWorld();
      _orbBox.setFromObject(glb);
      if (!_orbBox.isEmpty()) {
        _orbV.set(_orbBox.min.x, _orbBox.max.y, (_orbBox.min.z + _orbBox.max.z) / 2).project(camera);
        x = (_orbV.x * 0.5 + 0.5) * W - 18;
        y = (-_orbV.y * 0.5 + 0.5) * H - 7;
      }
    }
    x = Math.min(Math.max(x, 4), W - 24);
    y = Math.min(Math.max(y, 4), H - 24);
    const nowT = performance.now();
    const dt = Math.min((nowT - orbT) / 1000, 0.25);
    // primeira vez (ou depois de um salto grande, como ao trocar de avatar): vai direto; senão, desliza até a cabeça
    if (!orbPlaced || Math.hypot(x - orbX, y - orbY) > 160) { orbX = x; orbY = y; }
    else { const a = 1 - Math.exp(-ORB_FOLLOW * dt); orbX += (x - orbX) * a; orbY += (y - orbY) * a; }
    orbT = nowT; orbPlaced = true;
    orbEl.style.left = orbX.toFixed(1) + 'px';
    orbEl.style.top = orbY.toFixed(1) + 'px';
  }

  return { paintOrb, placeOrb };
}
