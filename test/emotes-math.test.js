'use strict';
// Roda cada animação de gesto sem o Electron e confere que os valores são finitos e razoáveis em todo o tempo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { pathToFileURL } = require('node:url');
const EMOTES_URL = pathToFileURL(path.join(__dirname, '..', 'src', 'emotes.js')).href;

// src/emotes.js sem o Electron: o que o renderer fornece (item na mão, tamanho...) entra como funções fixas
async function load(itemObj) {
  const { createEmotes } = await import(EMOTES_URL);
  const { EMOTES, P, resetPose } = createEmotes({
    getItemObj: () => itemObj, getLandK: () => 1, getSitDrop: () => 0.75, getChairDrop: () => 0.42,
    getFitScale: () => 1, getBaseHipsY: () => 0.9,
  });
  return { EMOTES, getP: () => P, reset: resetPose };
}

for (const withItem of [false, true]) {
  test(`gestos produzem poses válidas (item na mão: ${withItem})`, async () => {
    const { EMOTES, getP, reset } = await load(withItem ? {} : null);
    for (const [id, def] of Object.entries(EMOTES)) {
      for (let t = 0; t <= def.dur; t += 0.05) {
        for (const w of [0, 0.5, 1]) {
          reset();
          def.fn(t, w);
          for (const [bone, v] of Object.entries(getP())) {
            const vals = typeof v === 'number' ? [v] : [v.x, v.y, v.z];
            for (const n of vals) {
              assert.ok(Number.isFinite(n), `${id}.${bone} não é número em t=${t}`);
              assert.ok(Math.abs(n) < (bone === 'spinY' ? 7 : 3.2), `${id}.${bone}=${n} fora do limite em t=${t}`);
            }
          }
        }
      }
      assert.ok(['neutral', 'happy', 'relaxed', 'sad', 'angry', 'surprised'].includes(def.expr), `${id}: expressão inválida`);
    }
  });
}

test('pulo começa e termina no chão', async () => {
  const { EMOTES, getP, reset } = await load(null);
  for (const t of [0, 1.15]) { reset(); EMOTES.jump.fn(t, 1); assert.ok(Math.abs(getP().hipsY || 0) < 1e-9, `hipsY em t=${t}`); }
});
