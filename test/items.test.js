'use strict';
// Itens que ela segura (src/items.js). Usa o three.js de src/vendor (pulado se não existir).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'src');
const THREE_FILE = path.join(SRC, 'vendor', 'three', 'three.module.js');
const skip = !fs.existsSync(THREE_FILE) && 'src/vendor/three não encontrado (rode npm install)';
const ctx = () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }) }, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
const fakeCanvas = () => ({ width: 0, height: 0, getContext: ctx });

async function make() {
  const THREE = await import(pathToFileURL(THREE_FILE).href);
  const { createItemMakers } = await import(pathToFileURL(path.join(SRC, 'items.js')).href);
  let canvases = 0;
  const m = createItemMakers(THREE, () => { canvases++; return fakeCanvas(); });
  return { THREE, ...m, canvases: () => canvases };
}
const IDS = ['phone', 'dice', 'mug', 'book', 'flower', 'balloon', 'lollipop'];

test('todos os itens embutidos existem e são construídos sem vértices inválidos', { skip }, async () => {
  const { ITEM_MAKERS } = await make();
  assert.deepEqual(Object.keys(ITEM_MAKERS).sort(), [...IDS].sort());
  for (const id of IDS) {
    const g = ITEM_MAKERS[id]();
    let meshes = 0;
    g.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      for (const n of o.geometry.attributes.position.array) assert.ok(Number.isFinite(n), `${id}: vértice inválido`);
    });
    assert.ok(meshes >= 1, id);
    for (const k of ['tilt', 'base', 'sway']) if (g.userData[k] !== undefined) assert.ok(Number.isFinite(g.userData[k]), `${id}.${k}`);
  }
});

test('cada chamada devolve um objeto novo (o renderer pode refazer o item)', { skip }, async () => {
  const { ITEM_MAKERS } = await make();
  for (const id of IDS) assert.notEqual(ITEM_MAKERS[id](), ITEM_MAKERS[id]());
});

test('celular: a tela usa canvas e o relógio atualiza sem erro', { skip }, async () => {
  const { ITEM_MAKERS, canvases } = await make();
  const phone = ITEM_MAKERS.phone();
  assert.equal(canvases(), 1);
  assert.equal(typeof phone.userData.update, 'function');
  for (let i = 0; i < 5; i++) phone.userData.update(0.6, i);
});

test('dados: dois cubos de 6 faces e setDice gira cada um para o número sorteado', { skip }, async () => {
  const { ITEM_MAKERS, setDice, canvases } = await make();
  const dice = ITEM_MAKERS.dice();
  assert.equal(canvases(), 6, 'um canvas por face');
  assert.equal(dice.userData.dice.length, 2);
  setDice(dice, [1, 6]);
  assert.deepEqual([dice.userData.dice[0].rotation.x, dice.userData.dice[0].rotation.y], [Math.PI / 2, 0]);
  assert.deepEqual([dice.userData.dice[1].rotation.x, dice.userData.dice[1].rotation.y], [-Math.PI / 2, 0]);
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) setDice(dice, [a, b]); // todas as combinações são válidas
});

test('flor e balão balançam de leve, de forma finita', { skip }, async () => {
  const { ITEM_MAKERS } = await make();
  for (const id of ['flower', 'balloon']) {
    const g = ITEM_MAKERS[id]();
    for (let t = 0; t < 10; t += 0.37) { g.userData.update(0.016, t); assert.ok(Math.abs(g.userData.sway) <= 0.07, id); }
  }
});

test('o renderer usa o items.js e o items.js não depende de cena nem de DOM', () => {
  const r = fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf8') + fs.readFileSync(path.join(SRC, 'held-item.js'), 'utf8'); // o item na mão mora em held-item.js
  assert.match(r, /import \{ createItemMakers \} from '\.\/items\.js';/);
  assert.match(r, /createItemMakers\(THREE, \(\) => document\.createElement\('canvas'\)\)/);
  assert.match(r, /setDice\(itemObj, diceRoll\.vals\)/);
  assert.doesNotMatch(r, /function make(Phone|Dice|Mug|Book|Flower|Balloon|Lollipop)\b/, 'os construtores saíram do renderer');
  const i = fs.readFileSync(path.join(SRC, 'items.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(i, /\bscene\b|document\.|window\./);
});
