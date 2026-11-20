'use strict';
// Vida parada do avatar (src/idle-life.js): respiração, braços soltos e balanço de peso.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'src', 'idle-life.js')).href);
const FULL = { body: 1, head: 1, armL: 1, armR: 1, fingers: 1 };

function run(il, seconds, w = FULL, fps = 30) {
  const out = []; let t = 0;
  for (let i = 0; i < seconds * fps; i++) { t += 1 / fps; out.push(il.step(1 / fps, t, w)); }
  return out;
}

test('a respiração sobe e desce de verdade, com ciclo de alguns segundos', async () => {
  const { createIdleLife } = await load();
  const r = run(createIdleLife(), 30);
  const b = r.map((x) => x.breath);
  assert.ok(Math.max(...b) > 0.6 && Math.min(...b) < -0.6, 'amplitude pequena demais');
  let cross = 0; for (let i = 1; i < b.length; i++) if (b[i - 1] < 0 && b[i] >= 0) cross++;
  assert.ok(cross >= 5 && cross <= 11, `ciclos em 30 s: ${cross}`);   // ~3 a 6 s por respiração
});

test('o peito mexe bem mais do que antes (era ±0,01 rad)', async () => {
  const { createIdleLife } = await load();
  const cx = run(createIdleLife(), 20).map((x) => x.bones.chest.x);
  assert.ok(Math.max(...cx) - Math.min(...cx) > 0.05);
});

test('os braços ficam soltos: afastados, cotovelo dobrado, sempre em movimento', async () => {
  const { createIdleLife } = await load();
  const r = run(createIdleLife(), 20);
  const lz = r.map((x) => x.bones.leftUpperArm.z), rz = r.map((x) => x.bones.rightUpperArm.z);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(avg(lz) > 0.03, 'braço esquerdo deve afastar do corpo (+z)');
  assert.ok(avg(rz) < -0.03, 'braço direito deve afastar do corpo (-z)');
  assert.ok(avg(r.map((x) => x.bones.leftLowerArm.y)) < -0.1, 'antebraço esquerdo dobra em -y');
  assert.ok(avg(r.map((x) => x.bones.rightLowerArm.y)) > 0.1, 'antebraço direito dobra em +y');
  assert.ok(Math.max(...lz) - Math.min(...lz) > 0.03, 'braço parado demais');
});

test('os dois lados não se movem em espelho perfeito (menos robótico)', async () => {
  const { createIdleLife } = await load();
  const r = run(createIdleLife(), 20);
  const diff = r.map((x) => x.bones.leftUpperArm.x - x.bones.rightUpperArm.x);
  assert.ok(Math.max(...diff.map(Math.abs)) > 0.01);
});

test('nada exagera: rotações pequenas e finitas', async () => {
  const { createIdleLife } = await load();
  for (const x of run(createIdleLife(), 120)) {
    for (const [bone, d] of Object.entries(x.bones)) {
      const lim = /Index|Middle|Ring|Little|Thumb/.test(bone) ? 1.0 : /LowerArm/.test(bone) ? 0.65 : 0.5;   // dedos e cotovelo podem dobrar mais
      for (const v of [d.x, d.y, d.z]) { assert.ok(Number.isFinite(v), bone); assert.ok(Math.abs(v) < lim, `${bone} ${v}`); }
    }
    assert.ok(Math.abs(x.hipsY) < 0.01);
  }
});

test('peso 0 em uma parte deixa essa parte intacta', async () => {
  const { createIdleLife } = await load();
  const r = run(createIdleLife(), 5, { body: 0, head: 0, armL: 0, armR: 1 });
  for (const x of r) {
    assert.ok(x.bones.chest.x === 0);
    assert.ok(x.bones.head.x === 0);
    assert.equal(x.bones.leftUpperArm, undefined);
    assert.ok(x.hipsY === 0);
  }
  assert.ok(r.some((x) => x.bones.rightUpperArm.z !== 0));
});

test('idleWeights: gesto, caminhada, colo e sono tiram a camada do caminho', async () => {
  const { idleWeights } = await load();
  assert.deepEqual(idleWeights({}), { body: 1, head: 1, armL: 1, armR: 1, fingers: 1 });
  const em = idleWeights({ em: 1 });
  assert.equal(em.armL, 0); assert.equal(em.armR, 0); assert.ok(Math.abs(em.head - 0.2) < 1e-9); assert.equal(em.body, 1);
  const w = idleWeights({ walk: 1 });
  assert.equal(w.armL, 0); assert.ok(w.body > 0 && w.body < 1);
  const h = idleWeights({ held: 1 });
  assert.equal(h.body, 0); assert.equal(h.head, 0); assert.equal(h.armL, 0);
  assert.equal(idleWeights({ sleep: 1 }).body, 0);
});

test('idleWeights: só o braço que segura o item sai da camada', async () => {
  const { idleWeights } = await load();
  const w = idleWeights({ item: 1, itemSide: 'right' });
  assert.equal(w.armR, 0); assert.equal(w.armL, 1);
  const l = idleWeights({ item: 0.5, itemSide: 'left' });
  assert.equal(l.armL, 0.5); assert.equal(l.armR, 1);
});

test('a cabeça vira de um lado para o outro, com ângulo bem visível', async () => {
  const { createIdleLife, seededRng } = await load();
  const r = run(createIdleLife({ rng: seededRng(3) }), 60);
  const hy = r.map((x) => x.bones.head.y);
  assert.ok(Math.max(...hy) > 0.12, `máximo ${Math.max(...hy)}`);          // olha para um lado...
  assert.ok(Math.min(...hy) < -0.12, `mínimo ${Math.min(...hy)}`);         // ...e para o outro
  let turns = 0; for (let i = 1; i < hy.length; i++) if (Math.sign(hy[i - 1]) !== Math.sign(hy[i]) && Math.abs(hy[i]) > 0.005) turns++;
  assert.ok(turns >= 4, `trocas de lado em 60 s: ${turns}`);
  assert.ok(Math.max(...hy.map(Math.abs)) < 0.45, 'virada exagerada');
});

test('com a mesma semente a cabeça faz sempre o mesmo caminho', async () => {
  const { createIdleLife, seededRng } = await load();
  const a = run(createIdleLife({ rng: seededRng(5) }), 10).map((x) => x.yaw);
  const b = run(createIdleLife({ rng: seededRng(5) }), 10).map((x) => x.yaw);
  assert.deepEqual(a, b);
});

test('os braços são moles: balançam sozinhos e a mão vem atrás do braço', async () => {
  const { createIdleLife, seededRng } = await load();
  const r = run(createIdleLife({ rng: seededRng(11) }), 60);
  const hx = r.map((x) => x.bones.leftHand.x), ux = r.map((x) => x.bones.leftUpperArm.x);
  const span = (a) => Math.max(...a) - Math.min(...a);
  assert.ok(span(ux) > 0.2, `balanço do braço ${span(ux)}`);
  assert.ok(span(hx) > 0.1, `balanço da mão ${span(hx)}`);
  // não fica balançando para sempre no mesmo lugar: a média volta para perto do repouso
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  assert.ok(Math.abs(avg(ux) + 0.07) < 0.1);
});

test('os dedos se mexem: fecham para a palma, cada um no seu ritmo, e o mindinho fecha mais', async () => {
  const { createIdleLife, seededRng } = await load();
  const r = run(createIdleLife({ rng: seededRng(2) }), 40);
  const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const span = (a) => Math.max(...a) - Math.min(...a);
  const idx = r.map((x) => x.bones.leftIndexProximal.z), lit = r.map((x) => x.bones.leftLittleProximal.z);
  assert.ok(avg(idx) < -0.1, 'esquerda fecha em -z');
  assert.ok(avg(r.map((x) => x.bones.rightIndexProximal.z)) > 0.1, 'direita fecha em +z');
  assert.ok(avg(lit) < avg(idx), 'mindinho mais fechado que o indicador');
  assert.ok(span(idx) > 0.1, 'dedo parado demais');
  const corr = avg(idx.map((v, i) => v * lit[i])) - avg(idx) * avg(lit);
  assert.ok(Math.abs(corr) < 0.9 * Math.sqrt(avg(idx.map((v) => v * v)) - avg(idx) ** 2) * Math.sqrt(avg(lit.map((v) => v * v)) - avg(lit) ** 2), 'dedos iguais demais');
  assert.ok(r[100].bones.leftThumbProximal && r[100].bones.rightThumbDistal, 'polegar também');
});

test('FINGER_BONES lista 30 ossos (15 por mão) sem repetir', async () => {
  const { FINGER_BONES } = await load();
  assert.equal(FINGER_BONES.length, 30);
  assert.equal(new Set(FINGER_BONES).size, 30);
  assert.ok(FINGER_BONES.includes('leftThumbMetacarpal') && FINGER_BONES.includes('rightLittleDistal'));
});

test('dedos: peso 0 deixa a mão intacta', async () => {
  const { createIdleLife } = await load();
  for (const x of run(createIdleLife(), 3, { body: 1, head: 1, armL: 1, armR: 1, fingers: 0 })) {
    assert.equal(x.bones.leftIndexProximal, undefined);
  }
});

test('o renderer usa a camada e os ossos das mãos', () => {
  const rd = (f) => require('node:fs').readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const r = rd('renderer.js'), body = rd('body-pose.js'), avatar = rd('avatar.js');   // a camada roda em body-pose.js; os ossos ficam em avatar.js
  assert.match(r, /from '\.\/idle-life\.js'/);
  assert.match(r, /createBodyPose\(/);
  assert.match(body, /from '\.\/idle-life\.js'/);
  assert.match(body, /idle\.step\(/);
  assert.match(avatar, /'leftHand', 'rightHand', \.\.\.FINGER_BONES/);
});

test('Comportamento mora dentro da aba Avatar, como sub-aba, com as 4 seções dentro', () => {
  const fs = require('node:fs');
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel.html'), 'utf8');
  assert.ok(!/data-tab="comportamento"/.test(panel), 'não existe mais aba própria na barra lateral');
  assert.ok(!/id="tab-comportamento"/.test(panel), 'não existe mais o painel próprio');
  const avatar = panel.slice(panel.indexOf('id="tab-avatar"'), panel.indexOf('id="tab-perfil"'));
  assert.match(avatar, /<button class="subtab" role="tab" data-sub="comportamento">/);
  for (const g of ['mov', 'emo', 'corpo', 'fala']) {
    assert.match(avatar, new RegExp(`<button class="subtab2" role="tab" data-sub2="${g}">`), g);
    assert.match(avatar, new RegExp(`<div data-sub="comportamento" data-sub2="${g}"`), `cards de ${g}`);
  }
  // tudo o que existia continua lá (os controles não se perderam na mudança)
  for (const k of ['walkEnabled', 'walkSpeed', 'convChatter', 'chatterMin']) assert.match(avatar, new RegExp(`data-key="${k}"`), k);
  assert.equal((avatar.match(/data-sub2="[a-z]+"/g) || []).length, 4 + 13);   // 4 botões + 13 cards
});

test('joelhos soltos: as pernas nunca ficam travadas e o peso muda de perna', async () => {
  const { createIdleLife } = await load();
  const r = run(createIdleLife(), 30);
  const knees = r.map((x) => [x.bones.leftLowerLeg.x, x.bones.rightLowerLeg.x]);
  assert.ok(knees.every(([l, rt]) => l >= 0.04 && rt >= 0.04 && l < 0.12 && rt < 0.12), 'joelho sempre um pouco dobrado, sem exagero');
  assert.ok(Math.max(...knees.map(([l]) => l)) - Math.min(...knees.map(([l]) => l)) > 0.02, 'o joelho cede e estica com a troca de peso');
  const off = run(createIdleLife(), 2, { ...FULL, body: 0 });
  assert.ok(off.every((x) => !x.bones.leftLowerLeg || x.bones.leftLowerLeg.x === 0), 'sem peso do corpo, as pernas não mexem');
});
