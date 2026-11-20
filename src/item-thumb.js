// Miniaturas dos itens (os embutidos e os .glb do usuário): desenha o objeto 3D num canvas pequeno, de 3/4, com fundo transparente.
// Só depende do THREE (recebido por parâmetro, como items.js). Quem pede e entrega é o renderer.js; o painel só mostra a imagem.

export function createItemThumbs(THREE, { size = 192, createCanvas = () => document.createElement('canvas') } = {}) {
  let renderer = null, scene = null, camera = null;

  function init() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ canvas: createCanvas(), alpha: true, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9a98a8, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.3); key.position.set(-1.5, 2, 2.5); scene.add(key);
    const rim = new THREE.DirectionalLight(0xffd9b0, 0.9); rim.position.set(2, 1, -2); scene.add(rim);
    camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
  }

  // obj: Object3D com tamanho qualquer; devolve um data URL PNG. Quem chamou continua dono do obj (e libera a memória dele).
  function render(obj, { yaw = -0.55, pitch = 0.22 } = {}) {
    init();
    const wrap = new THREE.Group();
    wrap.add(obj);
    wrap.rotation.set(pitch, yaw, 0);
    scene.add(wrap);
    try {
      wrap.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(wrap);
      if (box.isEmpty()) return null;
      const s = box.getSize(new THREE.Vector3());
      wrap.position.sub(box.getCenter(new THREE.Vector3())); // centra o objeto já girado
      wrap.updateMatrixWorld(true);
      // enquadra de verdade: afasta a câmera até os 8 cantos da caixa caberem na imagem (a perspectiva faz o que está perto parecer maior)
      const hx = s.x / 2, hy = s.y / 2, hz = s.z / 2;
      const corners = [];
      for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) corners.push(new THREE.Vector3(x, y, z));
      const tan = Math.tan((camera.fov * Math.PI) / 360);
      let dist = (Math.max(hx, hy, 1e-4) / tan) * 1.1 + hz;
      for (let i = 0; i < 4; i++) {
        camera.position.set(0, 0, dist);
        camera.near = 0.001; camera.far = dist + s.z * 2 + 10;
        camera.updateProjectionMatrix();
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld(true);
        let m = 0;
        for (const c of corners) { const q = c.clone().project(camera); m = Math.max(m, Math.abs(q.x), Math.abs(q.y)); }
        if (m > 0.9 || m < 0.8) dist *= Math.min(2, Math.max(0.5, m / 0.86)); // alvo: ocupa ~86% da imagem
        else break;
      }
      camera.position.set(0, 0, dist);
      camera.near = Math.max(0.001, dist - s.z * 2); camera.far = dist + s.z * 2 + 1;
      camera.updateProjectionMatrix();
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      return renderer.domElement.toDataURL('image/png');
    } finally {
      scene.remove(wrap);
      wrap.remove(obj);
    }
  }

  return { render, dispose() { if (renderer) { renderer.dispose(); renderer = null; } } };
}
