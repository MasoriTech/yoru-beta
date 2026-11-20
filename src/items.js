// Itens embutidos que ela segura (celular, dados, caneca, livro, flor, balão e pirulito).
// Só constroem os objetos 3D; quem escolhe o item, o coloca na mão e o anima é o renderer.js.
// Recebem o THREE e uma função que cria <canvas> por parâmetro, então rodam também no `npm test`, sem navegador.

export function createItemMakers(THREE, createCanvas) {
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, ...extra });

  function makePhone() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.15, 0.008), std(0x1b1c22, { metalness: 0.4 })));
    const c = createCanvas();
    c.width = 150; c.height = 300;
    const x = c.getContext('2d');
    const clock = () => new Date().toTimeString().slice(0, 5);
    let shown = '';
    const draw = () => {
      shown = clock();
      const gr = x.createLinearGradient(0, 0, 150, 300);
      gr.addColorStop(0, '#ff7eb6'); gr.addColorStop(1, '#6a5cff');
      x.fillStyle = gr; x.fillRect(0, 0, 150, 300);
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = 'bold 44px sans-serif';
      x.fillText(shown, 75, 110);
    };
    draw();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.068, 0.142), new THREE.MeshBasicMaterial({ map: tex }));
    scr.position.z = 0.0042;
    g.add(scr);
    g.userData.tilt = -0.2;
    let acc = 0;
    g.userData.update = (dt) => { // o relógio da tela acompanha a hora de verdade
      acc += dt;
      if (acc < 1) return;
      acc = 0;
      if (clock() !== shown) { draw(); tex.needsUpdate = true; }
    };
    return g;
  }

  const DICE_FACES = [3, 4, 1, 6, 2, 5]; // ordem dos materiais do cubo: +x -x +y -y +z -z
  const DICE_ROT = { 2: [0, 0], 5: [0, Math.PI], 3: [0, -Math.PI / 2], 4: [0, Math.PI / 2], 1: [Math.PI / 2, 0], 6: [-Math.PI / 2, 0] };
  function diceFace(n) {
    const c = createCanvas();
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = n === 1 ? '#d62839' : '#222';
    const pips = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [2, 0], [0, 2], [2, 2]],
      5: [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]], 6: [[0, 0], [2, 0], [0, 1], [2, 1], [0, 2], [2, 2]] }[n];
    for (const [px, py] of pips) { g.beginPath(); g.arc(14 + px * 18, 14 + py * 18, 5.5, 0, 7); g.fill(); }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function setDice(itemObj, vals) {
    itemObj.userData.dice.forEach((d, i) => d.rotation.set(DICE_ROT[vals[i]][0], DICE_ROT[vals[i]][1], 0));
  }
  function makeDice() {
    const g = new THREE.Group();
    const mats = DICE_FACES.map((n) => new THREE.MeshStandardMaterial({ map: diceFace(n), roughness: 0.4 }));
    g.userData.dice = [-1, 1].map((sx) => {
      const d = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.05), mats);
      d.position.x = sx * 0.032;
      g.add(d);
      return d;
    });
    return g;
  }
  function makeMug() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.032, 0.085, 24), std(0xf2f2f2)));
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.031, 24), std(0x4b2e1e));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.04;
    g.add(top);
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 8, 16), std(0xf2f2f2));
    h.position.x = 0.04;
    g.add(h);
    return g;
  }
  function makeBook() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.21, 0.03), std(0x3b6ea5)));
    const pages = new THREE.Mesh(new THREE.BoxGeometry(0.142, 0.2, 0.026), std(0xf3ecd8));
    pages.position.x = 0.004;
    g.add(pages);
    g.userData.tilt = -0.15;
    return g;
  }
  function makeFlower() {
    const g = new THREE.Group();
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.2, 8), std(0x3f9b4b));
    stem.position.y = 0.05;
    g.add(stem);
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.02, 10, 6), std(0x4fb85c));
    leaf.scale.set(1, 0.35, 0.5); leaf.position.set(0.02, 0.03, 0); leaf.rotation.z = 0.5;
    g.add(leaf);
    const head = new THREE.Group();
    head.position.y = 0.155;
    const petal = std(0xff6fa5);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.017, 10, 8), petal);
      p.position.set(Math.cos(a) * 0.026, Math.sin(a) * 0.026, 0);
      p.scale.z = 0.5;
      head.add(p);
    }
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), std(0xffd24a)));
    g.add(head);
    g.userData.tilt = -0.15;
    g.userData.update = (dt, t) => { g.userData.sway = Math.sin(t * 1.4) * 0.05; };
    return g;
  }
  function makeBalloon() {
    const g = new THREE.Group();
    const col = std(0xff4f7b, { roughness: 0.25 });
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 16), col);
    b.scale.y = 1.2; b.position.y = 0.33;
    g.add(b);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.02, 8), col);
    knot.rotation.x = Math.PI; knot.position.y = 0.222;
    g.add(knot);
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.0013, 0.0013, 0.22, 4), std(0xeeeeee));
    str.position.y = 0.11;
    g.add(str);
    g.userData.update = (dt, t) => { g.userData.sway = Math.sin(t * 1.7) * 0.06; }; // balança de leve
    return g;
  }
  function makeLollipop() {
    const g = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 8), std(0xf5f5f5));
    stick.position.y = 0.04;
    g.add(stick);
    const candy = new THREE.Group();
    candy.position.y = 0.14;
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.012, 28), std(0xff7eb6, { roughness: 0.3 }));
    disc.rotation.x = Math.PI / 2;
    candy.add(disc);
    [[0.03, 0x6a5cff], [0.017, 0xffffff]].forEach(([r, col]) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0045, 8, 28), std(col));
      ring.position.z = 0.0075;
      candy.add(ring);
    });
    g.add(candy);
    g.userData.tilt = -0.15;
    return g;
  }
  const ITEM_MAKERS = { phone: makePhone, dice: makeDice, mug: makeMug, book: makeBook, flower: makeFlower, balloon: makeBalloon, lollipop: makeLollipop };
  return { ITEM_MAKERS, setDice };
}
