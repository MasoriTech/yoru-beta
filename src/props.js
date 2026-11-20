// Objetos 3D de cenário do avatar: banquinho (pose "chair"), cama e barraca (poses "bed" e "tent") e os "Z z z" do sono.
// Só constroem e devolvem os objetos (escondidos); quem os coloca na cena e os anima é o renderer.js.
// Recebem o THREE por parâmetro (não importam nada), então rodam também no `npm test`, sem navegador.

export function buildChair(THREE, seatY) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x9a6b43, roughness: 0.7 });
  const seat = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.21, 0.04, 28), wood);
  seat.position.set(0, seatY - 0.02, -0.04);
  g.add(seat);
  for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.04], [0.12, 0.04]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.014, seatY - 0.04, 10), wood);
    leg.position.set(x, (seatY - 0.04) / 2, z);
    g.add(leg);
  }
  g.visible = false;
  return g;
}

export function buildBed(THREE) {
  const std = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
  // cama: estrado de madeira, colchão, travesseiro, cabeceira e coberta nas pernas (cabeça à esquerda)
  const bed = new THREE.Group();
  const wood = std(0x8a5a36, 0.7);
  bed.add(box(1.34, 0.1, 0.7, wood, 0, 0.17, 0));
  for (const x of [-0.62, 0.62]) for (const z of [-0.3, 0.3]) bed.add(box(0.07, 0.14, 0.07, wood, x, 0.07, z));
  bed.add(box(0.07, 0.62, 0.72, wood, -0.68, 0.43, 0));
  bed.add(box(0.05, 0.36, 0.72, wood, 0.68, 0.31, 0));
  bed.add(box(1.28, 0.08, 0.64, std(0xf1ece4, 0.95), 0, 0.26, 0));
  const pillow = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), std(0xffffff, 0.95));
  pillow.scale.set(1.1, 0.4, 1.35); pillow.position.set(-0.5, 0.35, 0); bed.add(pillow);
  bed.add(box(0.62, 0.15, 0.7, std(0x4c6fb5, 0.9), 0.3, 0.42, 0));      // coberta (cobre da cintura para baixo)
  bed.add(box(0.62, 0.02, 0.72, std(0xe7ecf7, 0.9), 0.0, 0.5, 0));       // dobra branca
  bed.visible = false;
  return bed;
}

export function buildTent(THREE) {
  const std = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const box = (w, h, d, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return m; };
  // barraca: corte aberto na frente (parede do fundo, ponta de cada lado, aba presa e mastro) + saco de dormir
  const tent = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: 0xe8702a, roughness: 0.9, side: THREE.DoubleSide });
  const cloth2 = new THREE.MeshStandardMaterial({ color: 0xd9772e, roughness: 0.9, side: THREE.DoubleSide });
  const tri = (pts, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  };
  const L = 0.68, Hh = 1.05, D = 0.55;
  const quad = (a, b, c, d2, mat) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d2], 3)); g.computeVertexNormals(); return new THREE.Mesh(g, mat); };
  tent.add(quad([-L, 0, -D], [L, 0, -D], [L, Hh, 0], [-L, Hh, 0], cloth2));            // fundo (inclinado)
  tent.add(tri([[-L, 0, D], [-L, 0, -D], [-L, Hh, 0]], cloth));                         // ponta esquerda
  tent.add(tri([[L, 0, D], [L, 0, -D], [L, Hh, 0]], cloth));                            // ponta direita
  tent.add(tri([[-L, 0, D], [-L + 0.34, 0, D], [-L, Hh, 0]], cloth));                   // abas da porta, presas nos cantos
  tent.add(tri([[L, 0, D], [L - 0.34, 0, D], [L, Hh, 0]], cloth));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2 * L + 0.1, 8), std(0x3a3a3a, 0.4));
  pole.rotation.z = Math.PI / 2; pole.position.set(0, Hh, 0); tent.add(pole);
  const floor = box(2 * L, 0.02, 2 * D, std(0x3b4a3a, 1), 0, 0.01, 0); tent.add(floor);
  const mat = box(1.2, 0.07, 0.5, std(0x5b7bd5, 0.9), 0, 0.055, 0.02); tent.add(mat);   // colchonete
  const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 6, 16), std(0x2f5d50, 0.95));
  bag.rotation.z = Math.PI / 2; bag.scale.set(1, 1, 1.1); bag.position.set(0.3, 0.2, 0.05); tent.add(bag); // saco de dormir (cobre da cintura para baixo)
  const pil = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 12), std(0xfaf5ea, 0.95));
  pil.scale.set(1.1, 0.4, 1.3); pil.position.set(-0.5, 0.15, 0.02); tent.add(pil);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffd98a }));
  lamp.position.set(0.5, Hh * 0.55, -0.3); tent.add(lamp);                              // lanterninha pendurada no fundo
  for (const [x, z, sx] of [[-L - 0.22, D + 0.1, -1], [L + 0.22, D + 0.1, 1]]) {        // estacas e cordas
    tent.add(box(0.025, 0.1, 0.025, std(0x8a5a36), x, 0.04, z));
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.5, 5), std(0xe2d4b0));
    rope.position.set(sx * (L + 0.1), Hh * 0.45, z * 0.62); rope.rotation.z = -sx * 0.9; rope.rotation.x = 0.2; tent.add(rope);
  }
  tent.visible = false;
  return tent;
}

// createCanvas: () => <canvas> (no navegador: document.createElement('canvas'))
export function buildZzz(THREE, createCanvas, count = 3) {
  // "Z z z" subindo da cabeça
  const cvs = createCanvas(); cvs.width = cvs.height = 64;
  const c2 = cvs.getContext('2d'); c2.font = 'bold 52px "Segoe UI", sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
  c2.lineWidth = 6; c2.strokeStyle = 'rgba(40,50,90,.9)'; c2.strokeText('Z', 32, 34); c2.fillStyle = '#fff'; c2.fillText('Z', 32, 34);
  const tex = new THREE.CanvasTexture(cvs);
  const sprites = [];
  for (let i = 0; i < count; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthTest: false }));
    sp.visible = false; sprites.push(sp);
  }
  return sprites;
}
