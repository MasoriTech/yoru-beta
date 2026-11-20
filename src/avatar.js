// Avatar na cena: carrega o modelo (.vrm com humanoide ou .glb simples), descarrega o antigo, guarda os ossos e aplica a pose do quadro.
// O estado do avatar mora no objeto devolvido (av.vrm, av.glb, av.fitScale...): os outros módulos leem sempre o valor atual.
// O renderer.js chama av.load() ao abrir e quando o arquivo do avatar muda, e av.applyPose()/applyGlbPose() a cada quadro.

import { FINGER_BONES } from './idle-life.js';
import { downscaleTextures, disposeTree } from './textures.js';
import { SLEEP_SCALE } from './emotes.js';

const VRM_PATH = '../assets/avatar.vrm';

const BONES = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'leftShoulder', 'rightShoulder',
  'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand', ...FINGER_BONES, // dedos: só entram na pose se o modelo tiver esses ossos
  'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg',
];
const BASE_POSE = { leftUpperArm: [0, 0, -1.3], rightUpperArm: [0, 0, 1.3] }; // braços para baixo
const ZERO_ARR = Object.freeze([0, 0, 0]);
const ZERO_POSE = Object.freeze({ x: 0, y: 0, z: 0 });

// proporção chibi (S.chibi: 0 = normal, 1 = chibi inteiro): tronco e pernas encolhem e a cabeça cresce.
// A escala do tronco leva junto os braços e a cabeça, então a cabeça recebe HEAD / TORSO para ficar com o tamanho final HEAD.
export const CHIBI = { torso: 0.40, legs: 0.55, head: 1.8 };   // quanto cada parte muda com chibi = 1
const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
export function chibiScales(k) {
  k = clamp01(k);
  const torso = 1 - CHIBI.torso * k, legs = 1 - CHIBI.legs * k, head = 1 + CHIBI.head * k;
  return { torso, legs, head, headBone: head / torso };
}
// altura do avatar chibi em relação à normal (o quadril fica em hipsY, a cabeça em headY, com ~1/6,5 da altura de cabeça)
export function chibiHeightRatio(k, hipsY, headY) {
  const s = chibiScales(k), headLen = headY / 6.5;
  return (s.legs * hipsY + s.torso * (headY - hipsY) + s.head * headLen) / (headY + headLen);
}

// hair: src/hair.js · sleepProps: src/sleep-props.js · onReset: avatar descarregado (limpa gestos pendentes)
// onLoaded: um avatar VRM ficou pronto (reaplica as configurações) · say: balão de fala (para avisar erros)
// loadLibs(): devolve (uma vez) { GLTFLoader, VRMLoaderPlugin, VRMUtils }. Só é chamado quando um modelo 3D ou um item .glb
// precisa ser lido: no modo 2D (o padrão) esses ~1 MB de código nem chegam a ser baixados e interpretados.
export function createAvatar({ THREE, loadLibs, scene, S, api, say, hair, sleepProps, onReset, onLoaded }) {
  let real = null, VRMUtils = null;
  const ensureLoader = async () => {
    if (real) return real;
    const L = await loadLibs();
    VRMUtils = L.VRMUtils;
    const l = new L.GLTFLoader();
    l.register((parser) => new L.VRMLoaderPlugin(parser));
    return (real = l);
  };
  // mesmo formato do GLTFLoader (url, ok, progresso, erro): quem usa (avatar e item na mão) não percebe a diferença
  const loader = { load: (url, ok, prog, err) => { ensureLoader().then((l) => l.load(url, ok, prog, err), (e) => { if (err) err(e); else console.error(e); }); } };

  const av = {
    loader,
    vrm: null,
    glb: null,            // modelo .glb comum (sem esqueleto humanoide)
    mixer: null,          // animações embutidas do .glb
    springMgr: null,      // física do cabelo/roupa do VRM
    fitScale: 1,          // ajuste automático de altura de avatares muito altos ou baixos (já com a compensação do chibi)
    fitBase: 1,           // só o ajuste automático, sem o chibi
    baseRotationY: 0,
    baseHipsY: 0,         // altura do quadril do modelo (sem chibi)
    headY0: 0,            // altura da cabeça do modelo (sem chibi)
    chairDrop0: 0.42,     // quanto o quadril desce ao sentar numa cadeira (coxas na horizontal), calculado ao carregar
    hipsBase: () => av.baseHipsY * chibiScales(appliedK).legs,                 // altura do quadril com o chibi aplicado
    get sitDrop() { return Math.max(0.2, av.hipsBase() - 0.2); },              // quanto o quadril desce ao sentar no chão
    get chairDrop() { return av.chairDrop0 * chibiScales(appliedK).legs; },    // ... e numa cadeira
    hipsNode: null,
    boneNodes: new Map(), // osso -> nó (buscar por nome a cada quadro custa à toa)
    ready: () => !!(av.vrm || av.glb),
  };
  let loadSeq = 0;
  let appliedK = 0; // chibi já aplicado neste modelo

  function cacheBones() {
    av.boneNodes.clear();
    av.hipsNode = null;
    if (!av.vrm) return;
    for (const name of BONES) {
      const node = av.vrm.humanoid.getNormalizedBoneNode(name);
      if (node) av.boneNodes.set(name, node);
    }
    av.hipsNode = av.vrm.humanoid.getNormalizedBoneNode('hips');
  }

  function unload() {
    const old = av.vrm ? av.vrm.scene : av.glb;
    if (old) { scene.remove(old); disposeTree(old); }
    av.vrm = null; av.glb = null; av.springMgr = null; hair.clear(); av.mixer = null; onReset(); av.fitScale = 1; av.fitBase = 1; appliedK = 0;
    sleepProps.clearChair();
    av.boneNodes.clear();
    av.hipsNode = null;
  }

  // .glb sem humanoide: ajusta tamanho e apoia os pés no chão
  function setupGlb(gltf) {
    const root = gltf.scene;
    downscaleTextures(root, S.textureSize);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    root.position.set(-c.x, -box.min.y, -c.z);
    const wrap = new THREE.Group();
    wrap.add(root);
    wrap.scale.setScalar(Math.min(1.6 / (size.y || 1), 1.3 / (Math.max(size.x, size.z) || 1)));
    av.glb = wrap;
    scene.add(av.glb);
    if (gltf.animations && gltf.animations.length) {
      av.mixer = new THREE.AnimationMixer(root);
      av.mixer.clipAction(gltf.animations[0]).play();
    }
    console.log('[glb] carregado (sem humanoide: movimentos simples)');
  }

  async function load(forceDefault = false) {
    const my = ++loadSeq;
    let url = null;
    if (!forceDefault) {
      try { url = await api.libUrl('avatars', S.avatarFile || 'default'); } catch (_) { /* usa o padrão */ }
    }
    if (!url) url = new URL(VRM_PATH, location.href).href;
    loader.load(
      url,
      (gltf) => {
        if (my !== loadSeq) { disposeTree(gltf.scene); return; } // chegou outra troca no meio
        unload();
        const v = gltf.userData.vrm;
        if (!v) return setupGlb(gltf);
        if (VRMUtils.removeUnnecessaryVertices) VRMUtils.removeUnnecessaryVertices(gltf.scene);
        if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
        const vrm = av.vrm = v;
        VRMUtils.rotateVRM0(vrm);
        av.baseRotationY = vrm.scene.rotation.y;
        av.baseHipsY = vrm.humanoid.getNormalizedBoneNode('hips').position.y;
        downscaleTextures(vrm.scene, S.textureSize);
        av.springMgr = vrm.springBoneManager;
        hair.pick();
        // avatar muito alto ou baixo sairia cortado ou minúsculo: ajusta para a altura que a câmera enquadra
        vrm.scene.updateMatrixWorld(true);
        // alturas para sentar: no chão (quadril quase encostando) e na cadeira (coxas na horizontal, canela na vertical)
        const lf = vrm.humanoid.getNormalizedBoneNode('leftFoot');
        av.chairDrop0 = lf ? Math.max(0.15, av.baseHipsY - (lf.getWorldPosition(new THREE.Vector3()).y + Math.abs(lf.position.y))) : av.baseHipsY * 0.5;
        const headNode = vrm.humanoid.getNormalizedBoneNode('head');
        av.fitBase = 1;
        av.headY0 = 0;
        if (headNode) {
          av.headY0 = headNode.getWorldPosition(new THREE.Vector3()).y;
          const h = av.headY0 * 1.1; // altura aproximada
          if (h > 0.2 && (h < 1.3 || h > 1.85)) av.fitBase = 1.65 / h;
        }
        av.fitScale = av.fitBase;
        vrm.scene.scale.setScalar(av.fitScale);
        if (av.fitScale !== 1) console.log('[vrm] altura ajustada automaticamente (x' + av.fitScale.toFixed(2) + ')');
        cacheBones();
        scene.add(vrm.scene);
        applyChibi(false); // com chibi = 0 (o padrão) não muda nada
        sleepProps.makeChair(av.hipsBase() - av.chairDrop - 0.08);
        onLoaded();
        console.log('[vrm] carregado, bones:', Object.keys(vrm.humanoid.humanBones).length);
      },
      undefined,
      () => {
        if (my !== loadSeq) return;
        if (!forceDefault && S.avatarFile !== 'default') { // arquivo quebrado
          if (av.vrm || av.glb) { say('Não consegui abrir esse modelo. Mantive o avatar atual.', 8000); return; } // já tem um avatar na tela: não troca por outro
          say('Não consegui abrir esse modelo. Voltei ao avatar padrão.', 8000); // sem avatar na tela: usa o padrão
          load(true);
          return;
        }
        say(S.avatarFile === 'default' || forceDefault
          ? 'Não achei o modelo. Coloque seu arquivo em assets/avatar.vrm e reinicie.'
          : 'Não consegui abrir esse modelo. Tente outro arquivo (.vrm ou .glb).', 8000);
      }
    );
  }

  // chibi: escala os ossos (os crus, que deformam a malha, e os normalizados, que o resto do app usa para achar a cabeça)
  function scaleBones(names, x) {
    for (const n of names) {
      for (const node of [av.vrm.humanoid.getRawBoneNode && av.vrm.humanoid.getRawBoneNode(n), av.vrm.humanoid.getNormalizedBoneNode(n)]) {
        if (node && node.scale) node.scale.set(x, x, x);
      }
    }
  }
  // remakeChair: refaz o banquinho com a nova altura (false ao carregar, quando o load já o faz logo depois)
  function applyChibi(remakeChair = true) {
    const vrm = av.vrm;
    if (!vrm) return;
    const k = clamp01(S.chibi);
    if (k === appliedK) return;
    appliedK = k;
    const s = chibiScales(k);
    scaleBones(['spine'], s.torso);
    scaleBones(['leftUpperLeg', 'rightUpperLeg'], s.legs);
    scaleBones(['head'], s.headBone);
    // o chibi é mais baixo: cresce o modelo inteiro para ocupar a janela como os outros (no máximo 1,5x); o tamanho final continua no painel
    const ratio = av.headY0 > 0.2 ? chibiHeightRatio(k, av.baseHipsY, av.headY0) : 1;
    av.fitScale = av.fitBase * Math.min(1.5, 1 / Math.max(0.5, ratio));
    vrm.scene.scale.setScalar(av.fitScale);
    vrm.scene.updateMatrixWorld(true);
    if (av.springMgr && typeof av.springMgr.setInitState === 'function') av.springMgr.setInitState(); // cabelo e roupa medem os segmentos de novo
    if (remakeChair) sleepProps.makeChair(av.hipsBase() - av.chairDrop - 0.08);
  }

  // deitada, o avatar encolhe um pouco (sleepW: 0..1)
  function setSleepScale(sleepW) {
    if (av.vrm) av.vrm.scene.scale.setScalar(av.fitScale * (1 - (1 - SLEEP_SCALE) * sleepW * sleepW * (3 - 2 * sleepW)));
  }

  // aplica a pose do quadro (base + deslocamentos P) nos ossos do VRM
  function applyPose(P) {
    for (const [name, node] of av.boneNodes) {
      const b = BASE_POSE[name] || ZERO_ARR;
      const d = P[name] || ZERO_POSE;
      node.rotation.set(b[0] + d.x, b[1] + d.y, b[2] + d.z);
    }
    if (av.hipsNode) av.hipsNode.position.y = av.hipsBase() + (P.hipsY || 0);
    av.vrm.scene.rotation.y = av.baseRotationY + THREE.MathUtils.degToRad(S.rotation) + (P.spinY || 0);
  }

  // .glb comum: sem ossos, então o corpo todo se mexe. fx: { ew, swing, heldW, walk }
  function applyGlbPose(dt, t, P, { ew, swing, heldW, walk }) {
    const glb = av.glb;
    glb.position.y = Math.max(-0.06, (P.hipsY || 0) * 1.5) + Math.abs(Math.sin(t * 6)) * 0.025 * ew;
    glb.rotation.y = THREE.MathUtils.degToRad(S.rotation) + (P.spinY || 0);
    const pz = (k) => (P[k] ? P[k].z : 0), px = (k) => (P[k] ? P[k].x : 0);
    glb.rotation.z = pz('hips') + pz('spine') * 0.5 + pz('head') * 0.5 + Math.sin(t * 4) * 0.04 * ew - swing * 0.15 * heldW + Math.sin(walk.ph) * 0.06 * walk.w;
    glb.rotation.x = px('spine') * 0.8 + px('head') * 0.3 + (S.breathing ? Math.sin(t * 1.6) * 0.012 : 0);
    if (av.mixer) av.mixer.update(dt);
  }

  av.load = load;
  av.setSleepScale = setSleepScale;
  av.applyChibi = applyChibi;
  av.applyPose = applyPose;
  av.applyGlbPose = applyGlbPose;
  return av;
}
