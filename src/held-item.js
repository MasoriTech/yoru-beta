// Item na mão do avatar (celular, dados, caneca, livro, flor, balão, pirulito ou .glb próprio): criar, posicionar, rolar os dados
// e gerar as miniaturas do painel. Os desenhos dos itens vêm de src/items.js.
// O renderer.js lê o item atual em `held.obj` e chama updateItem(dt, t) a cada quadro.
import { createItemMakers } from './items.js';
import { createItemThumbs } from './item-thumb.js';
import { downscaleTextures, disposeTree } from './textures.js';

export function createHeldItem({ THREE, scene, loader, S, say, typeSay, speak, getVrm, getGlb, getFitScale }) {
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  let itemObj = null;
  let itemKey = 'none';
  let itemSeq = 0;
  let diceRoll = null; // { t, vals }
  const _hand = new THREE.Vector3();
  const _off = new THREE.Vector3();
  const { ITEM_MAKERS, setDice } = createItemMakers(THREE, () => document.createElement('canvas'));

  function placeItem(obj) {
    if (itemObj) { scene.remove(itemObj); disposeTree(itemObj); }
    itemObj = obj;
    if (obj) scene.add(obj);
  }

  function setItem(key) {
    key = key || 'none';
    if (key === itemKey) return;
    itemKey = key;
    const my = ++itemSeq;
    diceRoll = null;
    if (key === 'none') return placeItem(null);
    if (ITEM_MAKERS[key]) return placeItem(ITEM_MAKERS[key]());
    if (key.startsWith('custom:')) {
      window.api.libUrl('items', key.slice(7)).then((url) => {
        if (!url) { if (my === itemSeq) placeItem(null); return; } // arquivo sumiu: não deixa o item antigo na mão
        loader.load(url, (gltf) => {
          if (my !== itemSeq) { disposeTree(gltf.scene); return; }
          const root = gltf.scene;
          downscaleTextures(root, S.textureSize);
          const box = new THREE.Box3().setFromObject(root);
          const size = box.getSize(new THREE.Vector3());
          const c = box.getCenter(new THREE.Vector3());
          root.position.sub(c);
          const wrap = new THREE.Group();
          wrap.add(root);
          wrap.userData.base = 0.15 / (Math.max(size.x, size.y, size.z) || 1); // tamanho que cabe na mão
          placeItem(wrap);
        }, undefined, () => { if (my === itemSeq) placeItem(null); say('Não consegui abrir esse item (.glb).', 5000); });
      }).catch(() => { if (my === itemSeq) placeItem(null); });
    }
  }

  function rollDice(forceSpeak) {
    if (!itemObj || itemKey !== 'dice' || diceRoll) return;
    diceRoll = { t: 0, speak: !!forceSpeak, vals: [1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)] };
  }
  window.api.onItemRoll(rollDice);

  function updateItem(dt, t) {
    if (!itemObj) return;
    const vrm = getVrm(), glb = getGlb();
    if (itemObj.userData.update) itemObj.userData.update(dt, t);
    const yaw = vrm ? vrm.scene.rotation.y : glb ? glb.rotation.y : 0;
    const fit = vrm ? getFitScale() : 1;
    const hand = vrm ? vrm.humanoid.getNormalizedBoneNode(S.itemHand === 'left' ? 'leftHand' : 'rightHand') : null;
    if (hand) {
      hand.updateWorldMatrix(true, false); // só a cadeia do braço (antes atualizava a cena inteira a cada quadro)
      hand.getWorldPosition(_hand);
      _off.set(0, 0.04 * fit, 0.07 * fit).applyAxisAngle(Y_AXIS, yaw);
      itemObj.position.copy(_hand).add(_off);
    } else {
      // sem mãos (.glb comum, ou VRM sem o osso da mão): o item flutua ao lado do modelo
      _off.set((S.itemHand === 'left' ? -0.42 : 0.42) * fit, (0.85 + Math.sin(t * 1.8) * 0.02) * fit, 0.2 * fit).applyAxisAngle(Y_AXIS, yaw);
      itemObj.position.copy(_off);
    }
    itemObj.rotation.set(itemObj.userData.tilt || 0, yaw, itemObj.userData.sway || 0);
    itemObj.scale.setScalar((itemObj.userData.base || 1) * S.itemScale * fit);
    if (itemKey === 'dice' && diceRoll) {
      const [d1, d2] = itemObj.userData.dice;
      diceRoll.t += dt;
      const p = diceRoll.t / 1.2;
      if (p < 1) {
        d1.rotation.x += dt * 17; d1.rotation.y += dt * 13;
        d2.rotation.x += dt * 11; d2.rotation.z += dt * 19;
        itemObj.position.y += Math.sin(p * Math.PI) * 0.18 * S.itemScale;
      } else {
        setDice(itemObj, diceRoll.vals);
        const [a, b] = diceRoll.vals;
        const forceSpeak = diceRoll.speak;
        diceRoll = null;
        const txt = `🎲 Tirei ${a} e ${b}! Total: ${a + b}.`;
        typeSay(txt);
        speak(txt, forceSpeak);
      }
    }
  }

  // miniaturas dos itens para o painel (um pedido por vez, com um segundo renderer pequeno)
  const itemThumbs = createItemThumbs(THREE, { size: 192 });
  let thumbQueue = Promise.resolve();
  async function makeItemThumb(key) {
    let obj = null;
    try {
      if (ITEM_MAKERS[key]) obj = ITEM_MAKERS[key]();
      else if (key.startsWith('custom:')) {
        const url = await window.api.libUrl('items', key.slice(7));
        if (!url) return null;
        obj = (await new Promise((res, rej) => loader.load(url, res, undefined, rej))).scene;
        downscaleTextures(obj, 512);
      }
      return obj ? itemThumbs.render(obj) : null;
    } catch (_) { return null; } finally { if (obj) disposeTree(obj); }
  }
  window.api.onItemThumb((id, key) => {
    thumbQueue = thumbQueue.then(() => makeItemThumb(String(key))).then((url) => window.api.itemThumbDone(id, url), () => window.api.itemThumbDone(id, null));
  });

  return { get obj() { return itemObj; }, setItem, updateItem, rollDice };
}
