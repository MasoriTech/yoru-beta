// Adereços da cena que aparecem com certas poses: banquinho (sentar), cama e barraca (dormir) e os "Z z z".
// As geometrias vêm de src/props.js; aqui ficam a cena, o crescer/encolher e os Z subindo.
// O renderer.js chama update() a cada quadro; makeChair() ao carregar o avatar e clearChair() ao descarregar.

import { buildChair, buildBed, buildTent, buildZzz } from './props.js';
import { disposeTree } from './textures.js';
import { PROP_SCALE } from './emotes.js';

export function createSleepProps({ THREE, scene, getFitScale }) {
  // banquinho para a pose "chair" (aparece quando ela senta e some quando levanta)
  let chairObj = null;
  let chairK = 0; // 0 = escondido, 1 = inteiro
  function makeChair(seatY) {
    if (chairObj) { scene.remove(chairObj); disposeTree(chairObj); }
    chairObj = buildChair(THREE, seatY);
    scene.add(chairObj);
  }
  function clearChair() {
    if (chairObj) { scene.remove(chairObj); disposeTree(chairObj); chairObj = null; }
    chairK = 0;
  }

  // cama e barraca para as poses "bed" e "tent" (aparecem quando ela deita e somem quando levanta)
  let bedObj = null, tentObj = null, zzzSprites = [];
  function makeSleepProps() {
    bedObj = buildBed(THREE); scene.add(bedObj);
    tentObj = buildTent(THREE); scene.add(tentObj);
    zzzSprites = buildZzz(THREE, () => document.createElement('canvas'));
    zzzSprites.forEach((sp) => scene.add(sp));
  }
  makeSleepProps();

  // wantChair: está sentada na cadeira; bedW/tentW: quanto está deitada (0..1). Devolve sleepW (0..1).
  function update(dt, t, { wantChair, bedW, tentW }) {
    // banquinho: cresce do chão quando ela senta na cadeira e encolhe quando ela levanta
    chairK += ((wantChair ? 1 : 0) - chairK) * Math.min(dt * 8, 1);
    if (chairObj) {
      chairObj.visible = chairK > 0.02;
      chairObj.scale.setScalar(Math.max(0.001, chairK) * getFitScale());
    }

    // cama / barraca: crescem do chão; Z z z sobem da cabeça
    const sleepW = Math.max(bedW, tentW);
    for (const [obj, k] of [[bedObj, bedW], [tentObj, tentW]]) {
      if (!obj) continue;
      obj.visible = k > 0.02;
      obj.scale.setScalar(Math.max(0.001, k) * PROP_SCALE);
    }
    zzzSprites.forEach((sp, i) => {
      const on = sleepW > 0.9;
      sp.visible = on;
      if (!on) return;
      const ph = ((t * 0.35) + i / 3) % 1;
      sp.position.set((-0.45 - ph * 0.12) * PROP_SCALE, (0.7 + ph * 0.45) * PROP_SCALE, 0.2);
      const sz = 0.09 + ph * 0.1; sp.scale.set(sz, sz, 1);
      sp.material.opacity = Math.sin(ph * Math.PI) * 0.95;
    });
    return sleepW;
  }

  return { makeChair, clearChair, update };
}
