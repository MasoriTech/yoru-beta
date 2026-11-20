'use strict';
// Cenário do avatar (src/props.js): banquinho, cama, barraca e "Z z z". Usa o three.js de src/vendor (pulado se não existir).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'src');
const THREE_FILE = path.join(SRC, 'vendor', 'three', 'three.module.js');
const have = fs.existsSync(THREE_FILE);
const load = async () => ({ THREE: await import(pathToFileURL(THREE_FILE).href), P: await import(pathToFileURL(path.join(SRC, 'props.js')).href) });
const skip = !have && 'src/vendor/three não encontrado (rode npm install)';

function allFinite(root) {
  let meshes = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    for (const n of o.geometry.attributes.position.array) assert.ok(Number.isFinite(n), 'vértice inválido');
    for (const n of [o.position.x, o.position.y, o.position.z]) assert.ok(Number.isFinite(n));
  });
  return meshes;
}

test('banquinho: assento + 4 pernas, escondido, na altura pedida', { skip }, async () => {
  const { THREE, P } = await load();
  for (const seatY of [0.3, 0.45, 0.6]) {
    const g = P.buildChair(THREE, seatY);
    assert.equal(g.visible, false);
    assert.equal(g.children.length, 5);
    assert.ok(Math.abs(g.children[0].position.y - (seatY - 0.02)) < 1e-9);
    assert.equal(allFinite(g), 5);
  }
});

test('cama e barraca nascem escondidas, com todas as peças e sem vértices inválidos', { skip }, async () => {
  const { THREE, P } = await load();
  const bed = P.buildBed(THREE), tent = P.buildTent(THREE);
  assert.equal(bed.visible, false); assert.equal(tent.visible, false);
  assert.equal(bed.children.length, 11, 'estrado, 4 pés, 2 cabeceiras, colchão, travesseiro, coberta e dobra');
  assert.ok(tent.children.length >= 15, 'barraca completa (paredes, mastro, piso, saco de dormir, lanterna, estacas e cordas)');
  assert.ok(allFinite(bed) >= 11 && allFinite(tent) >= 15);
});

test('cada chamada devolve objetos novos (o renderer pode refazer sem compartilhar estado)', { skip }, async () => {
  const { THREE, P } = await load();
  assert.notEqual(P.buildBed(THREE), P.buildBed(THREE));
  assert.notEqual(P.buildChair(THREE, 0.4).children[0].material, P.buildChair(THREE, 0.4).children[0].material);
});

test('"Z z z": 3 sprites invisíveis, criando um canvas só', { skip }, async () => {
  const { THREE, P } = await load();
  let canvases = 0;
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  const sprites = P.buildZzz(THREE, () => { canvases++; return { width: 0, height: 0, getContext: () => ctx }; });
  assert.equal(sprites.length, 3);
  assert.equal(canvases, 1);
  for (const sp of sprites) { assert.equal(sp.visible, false); assert.equal(sp.material.opacity, 0); }
  assert.equal(P.buildZzz(THREE, () => ({ width: 0, height: 0, getContext: () => ctx }), 5).length, 5);
});

test('o renderer usa o props.js em vez de montar o cenário ele mesmo', () => {
  const r = fs.readFileSync(path.join(SRC, 'sleep-props.js'), 'utf8'); // o cenário é montado em sleep-props.js (e o renderer só o usa)
  assert.match(fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf8'), /createSleepProps\(/);
  assert.match(r, /import \{ buildChair, buildBed, buildTent, buildZzz \} from '\.\/props\.js';/);
  assert.match(r, /chairObj = buildChair\(THREE, seatY\)/);
  assert.match(r, /bedObj = buildBed\(THREE\)/);
  assert.doesNotMatch(r, /new THREE\.CylinderGeometry\(0\.21, 0\.21, 0\.04/, 'a geometria do banquinho saiu do renderer');
  const p = fs.readFileSync(path.join(SRC, 'props.js'), 'utf8').replace(/\/\/.*$/gm, ''); // sem comentários
  assert.doesNotMatch(p, /\bscene\b|document\.|window\./, 'props.js não pode depender de cena nem de DOM');
});
