// Palco 3D: renderizador WebGL transparente, cena, câmera e luzes.
// O renderer.js lê { scene, camera } daqui, chama resize() quando a janela muda e render() a cada quadro.

export function createStage({ THREE, canvas, S, api }) {
  const pixelRatio = () => {
    const d = window.devicePixelRatio || 1;
    if (S.renderRes) return Math.min(3, Math.max(0.5, d * S.renderRes)); // resolução escolhida no painel
    return S.quality === 'low' ? 1 : S.quality === 'high' ? Math.min(d, 2) : Math.min(d, 1.5);
  };
  // O renderizador WebGL (e o contexto da placa de vídeo) só nasce quando o 3D é desenhado pela primeira vez:
  // no modo 2D (o padrão) a abertura não paga por isso. Se a GPU falhar, tenta de novo em modo software uma vez só.
  let renderer = null, dead = false;
  function ensure() {
    if (renderer || dead) return renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: S.antialias === 'on' ? true : S.antialias === 'off' ? false : S.quality !== 'low', powerPreference: 'low-power' });
    } catch (err) {
      dead = true;
      api.relaunchNoGpu();
      window.showErr('WebGL indisponível (' + err.message + '). Reiniciando em modo software...');
      throw err;
    }
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    return renderer;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, window.innerWidth / window.innerHeight, 0.1, 20);
  camera.position.set(0, 1.0, 3.8); // afastada para caber braços levantados
  camera.lookAt(0, 1.0, 0);
  camera.updateMatrixWorld(true);

  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  light.position.set(1, 1, 1).normalize();
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));

  return {
    scene, camera,
    applyPixelRatio: () => { if (renderer) renderer.setPixelRatio(pixelRatio()); },
    resize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      if (renderer) renderer.setSize(window.innerWidth, window.innerHeight);
    },
    render() { const r = ensure(); if (r) r.render(scene, camera); },
  };
}
