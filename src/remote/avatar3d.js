// Avatar 3D (VRM) da Yoru no celular. Usa as mesmas bibliotecas do PC (servidas em /vendor) e o modelo que o PC está usando.
// Estados: idle · listening · thinking · speaking · error → mudam expressão, cabeça e boca. Sem innerHTML; nada inline (CSP estrita).
import * as THREE from '/vendor/three/three.module.js';
import { GLTFLoader } from '/vendor/three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '/vendor/three-vrm/three-vrm.module.js';

const EMOTIONS = ['happy', 'angry', 'sad', 'relaxed', 'surprised'];
const MOOD = { // expressão e postura da cabeça (x = olhar p/ cima/baixo, z = inclinação) por estado
  idle: { expr: 'relaxed', amt: 0.35, hx: 0, hz: 0 },
  listening: { expr: 'surprised', amt: 0.22, hx: -0.06, hz: 0.1 },
  thinking: { expr: 'relaxed', amt: 0.6, hx: -0.1, hz: -0.16 },
  speaking: { expr: 'happy', amt: 0.55, hx: 0, hz: 0 },
  error: { expr: 'sad', amt: 0.6, hx: 0.12, hz: 0.05 },
};
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Safari/iPhone: o carregador de imagens "ImageBitmap" do three.js entrega texturas em branco; <img> comum funciona em todos.
const APPLE = (() => {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1) || (/Safari/.test(ua) && !/Chrome|Chromium|Android/.test(ua));
})();

// reduz texturas grandes (menos memória de vídeo no celular); o MToon guarda as texturas em acessores da classe, por isso a cadeia de protótipos
function shrinkTextures(root, max) {
  const seen = new Set();
  const names = (m) => { const n = new Set(Object.keys(m)); for (let o = Object.getPrototypeOf(m); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) Object.getOwnPropertyNames(o).forEach((x) => n.add(x)); return [...n]; };
  let biggest = 0;
  root.traverse((o) => {
    for (const m of [].concat(o.material || [])) {
      for (const k of names(m)) {
        let t; try { t = m[k]; } catch (_) { continue; }
        if (!t || !t.isTexture || seen.has(t)) continue;
        seen.add(t);
        const img = t.image; if (!img) continue;
        const w = img.width || img.naturalWidth, h = img.height || img.naturalHeight;
        if (!w || !h) continue;
        biggest = Math.max(biggest, w, h);
        if (Math.max(w, h) <= max) continue;
        const r = max / Math.max(w, h);
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * r)); c.height = Math.max(1, Math.round(h * r));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        t.image = c; t.needsUpdate = true; if (img.close) img.close();
      }
    }
  });
  return { count: seen.size, biggest };
}

export async function createAvatar3D({ canvas, token, maxTex = 1024, onProgress = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 3 / 4, 0.05, 20);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(0.6, 1.2, 1.4);
  scene.add(sun, new THREE.AmbientLight(0xffffff, 0.9));

  const loader = new GLTFLoader();
  loader.setRequestHeader({ Authorization: `Bearer ${token}` });
  loader.register((parser) => new VRMLoaderPlugin(parser));
  if (APPLE) loader.register((parser) => { const tl = new THREE.TextureLoader(parser.options.manager); parser.textureLoader = tl; return { name: 'YoruImgTextures' }; });
  const gltf = await new Promise((resolve, reject) => {
    loader.load('/api/avatar-model', resolve, (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); }, reject);
  });
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('Arquivo não é um VRM.');
  if (VRMUtils.removeUnnecessaryVertices) VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => { o.frustumCulled = false; });
  const tex = shrinkTextures(vrm.scene, Math.min(maxTex, renderer.capabilities.maxTextureSize || maxTex));
  const info = `${renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'} · ${tex.count} texturas (maior ${tex.biggest}px, limite ${maxTex}px) · ${APPLE ? 'imagens <img>' : 'ImageBitmap'}`;
  scene.add(vrm.scene);

  const bone = (n) => vrm.humanoid.getNormalizedBoneNode(n);
  const rest = { lu: [0, 0, -1.3], ru: [0, 0, 1.3], ll: [0, 0, -0.12], rl: [0, 0, 0.12] };
  const set = (n, [x, y, z]) => { const b = bone(n); if (b) b.rotation.set(x, y, z); };
  const armsDown = () => { set('leftUpperArm', rest.lu); set('rightUpperArm', rest.ru); set('leftLowerArm', rest.ll); set('rightLowerArm', rest.rl); };
  armsDown();
  vrm.scene.updateMatrixWorld(true);

  // enquadra cabeça e busto
  const headPos = new THREE.Vector3(); (bone('head') || vrm.scene).getWorldPosition(headPos);
  const headY = Math.max(0.3, headPos.y);
  const viewH = headY * 0.62;
  const dist = (viewH / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(0, headY * 0.9, dist);
  camera.lookAt(0, headY * 0.9, 0);

  function resize() {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(canvas); resize();

  let state = 'idle', raf = 0, last = 0, t = 0, blinkT = 2, blinkP = -1, mouth = 0;
  let minDt = 0; // 0 = sem limite; "eco" limita a 30 fps
  function setQuality(q) {
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(q === 'eco' ? 1 : q === 'alta' ? Math.min(dpr, 3) : Math.min(dpr, 2));
    minDt = q === 'eco' ? 1000 / 30 - 2 : 0;
    resize();
  }
  const cur = { hx: 0, hz: 0, hy: 0 };
  const em = vrm.expressionManager;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (minDt && now - last < minDt) return;
    const dt = clamp((now - last) / 1000, 0, 0.1); last = now; t += dt;
    const m = MOOD[state] || MOOD.idle;
    const k = Math.min(dt * 5, 1);
    // cabeça: respiração, balanço lento e postura do estado (ouvindo acena de leve, falando balança)
    const nod = state === 'speaking' ? Math.sin(t * 3.2) * 0.035 : state === 'listening' ? Math.sin(t * 2) * 0.025 : 0;
    cur.hx += ((m.hx + nod) - cur.hx) * k;
    cur.hz += (m.hz - cur.hz) * k;
    cur.hy += (Math.sin(t * 0.5) * 0.07 - cur.hy) * k;
    const head = bone('head'), chest = bone('chest'), spine = bone('spine'), neck = bone('neck');
    if (head) head.rotation.set(cur.hx, cur.hy, cur.hz);
    if (neck) neck.rotation.set(cur.hx * 0.4, cur.hy * 0.5, cur.hz * 0.4);
    const br = Math.sin(t * 1.7) * 0.018;
    if (chest) chest.rotation.set(br, 0, 0);
    if (spine) spine.rotation.set(br * 0.5, Math.sin(t * 0.4) * 0.02, 0);
    armsDown();
    if (em) {
      blinkT -= dt;
      if (blinkT <= 0 && blinkP < 0) blinkP = 0;
      if (blinkP >= 0) { blinkP += dt / 0.15; em.setValue('blink', Math.sin(Math.min(blinkP, 1) * Math.PI)); if (blinkP >= 1) { blinkP = -1; blinkT = Math.random() < 0.18 ? 0.2 : 1.8 + Math.random() * 4; } }
      for (const name of EMOTIONS) { const target = name === m.expr ? m.amt : 0; const now2 = em.getValue(name) || 0; em.setValue(name, now2 + (target - now2) * Math.min(dt * 6, 1)); }
      const wantMouth = state === 'speaking' ? (0.25 + Math.abs(Math.sin(t * 13)) * 0.5) * (0.6 + 0.4 * Math.abs(Math.sin(t * 3.1))) : 0;
      mouth += (wantMouth - mouth) * Math.min(dt * 14, 1);
      em.setValue('aa', mouth);
    }
    vrm.update(dt);
    renderer.render(scene, camera);
  }

  const lost = new Promise((resolve) => canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); resolve(); }, { once: true }));
  return {
    lost, info,
    setQuality,
    setState(s) { state = MOOD[s] ? s : 'idle'; },
    start() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } },
    stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } },
    dispose() { this.stop(); ro.disconnect(); try { VRMUtils.deepDispose(vrm.scene); } catch (_) { /* já liberado */ } renderer.dispose(); },
  };
}
