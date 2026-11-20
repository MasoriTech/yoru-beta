'use strict';
// Avatar 2D (pack Yoru Chibi): imagens, mapeamentos, máscara de clique e ligações no app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.join(__dirname, '..');
const imp = (f) => import(pathToFileURL(path.join(root, 'src', f)).href);
const { EMOTE_IDS } = require('../src/ai-stream.js');

test('2D: as 50 reações existem como arquivo e como dados (tamanho, âncora, máscara 32×32)', async () => {
  const { REACTIONS } = await imp('avatar2d-data.js');
  const ids = Object.keys(REACTIONS);
  assert.equal(ids.length, 50);
  for (const id of ids) {
    const f = path.join(root, 'assets', 'reactions', id + '.webp');
    assert.ok(fs.existsSync(f), 'falta ' + id + '.webp');
    assert.equal(fs.readFileSync(f).subarray(8, 12).toString(), 'WEBP');
    const [w, h, ax, mask] = REACTIONS[id];
    assert.ok(w > 100 && h > 100 && ax > 0 && ax < w, id);
    assert.equal(Buffer.from(mask, 'base64').length, 128, id + ': máscara 32×32 = 128 bytes');
  }
  assert.equal(fs.readdirSync(path.join(root, 'assets', 'reactions')).length, 50);
});

test('2D: toda emoção e todo gesto do app tem uma reação que existe', async () => {
  const { REACTIONS } = await imp('avatar2d-data.js');
  const { EMOTION_REACTION, EMOTE_REACTION } = await imp('avatar2d-logic.js');
  for (const e of ['neutral', 'happy', 'relaxed', 'sad', 'angry', 'surprised']) assert.ok(REACTIONS[EMOTION_REACTION[e]], 'emoção ' + e);
  for (const id of [...EMOTE_IDS, 'land']) {
    const d = EMOTE_REACTION[id];
    assert.ok(d, 'gesto sem reação: ' + id);
    assert.ok(REACTIONS[d.r], id + ' -> ' + d.r);
    assert.ok(d.d > 0, id);
  }
  assert.equal(EMOTE_REACTION.bed.d, Infinity); // dormir dura até "stand"
});

test('2D: prioridade da reação (nos braços > caindo > gesto > emoção)', async () => {
  const { pickReaction } = await imp('avatar2d-logic.js');
  assert.equal(pickReaction({ emotion: 'happy', emote: 'laugh', grabbed: true }), 'ops');
  assert.equal(pickReaction({ emotion: 'happy', emote: 'laugh', falling: true }), 'uau');
  assert.equal(pickReaction({ emotion: 'sad', emote: 'laugh' }), 'haha');
  assert.equal(pickReaction({ emotion: 'sad' }), 'triste');
  assert.equal(pickReaction({ emotion: 'qualquer-coisa' }), 'ola');
  assert.equal(pickReaction({ emotion: 'neutral', emote: 'gesto-que-nao-existe' }), 'ola');
});

test('2D: movimento zera sem peso e fica limitado', async () => {
  const { motionFor, EMOTE_REACTION } = await imp('avatar2d-logic.js');
  const fxs = new Set(Object.values(EMOTE_REACTION).map((d) => d.fx));
  for (const fx of fxs) {
    const z = motionFor(fx, 0.7, 0);
    assert.deepEqual([z.x, z.y, z.rot, z.sx, z.sy], [0, 0, 0, 1, 1], fx + ' com peso 0 não mexe');
    for (let t = 0; t < 8; t += 0.05) {
      const m = motionFor(fx, t, 1);
      assert.ok(Math.abs(m.x) <= 20 && Math.abs(m.y) <= 60 && Math.abs(m.rot) <= 10, fx + ' fora do limite em t=' + t);
      assert.ok(m.sy > 0.9 && m.sy < 1.2 && m.sx > 0 && m.sx <= 1.2, fx + ' escala horizontal deve permanecer positiva');
    }
  }
});

test('2D: máscara do clique: dentro do desenho é verdade, no canto vazio é falso', async () => {
  const { REACTIONS } = await imp('avatar2d-data.js');
  const { decodeMask, maskHit } = await imp('avatar2d-logic.js');
  for (const id of Object.keys(REACTIONS)) {
    const m = decodeMask(REACTIONS[id][3]);
    assert.ok(maskHit(m, 0.5, 0.6), id + ': centro do rosto');
    assert.ok(!maskHit(m, -0.1, 0.5) && !maskHit(m, 0.5, 1.2), id + ': fora do desenho');
    const filled = m.reduce((a, b) => a + b, 0);
    assert.ok(filled > 350 && filled < 1024, id + ': ocupação ' + filled);
  }
});

test('2D: o desenho cabe na janela e a cabeça não muda de tamanho entre reações', async () => {
  const { REACTIONS } = await imp('avatar2d-data.js');
  const { layout } = await imp('avatar2d-logic.js');
  const W = 420, H = 640;
  const ks = new Set();
  for (const id of Object.keys(REACTIONS)) {
    const L = layout(W, H, REACTIONS[id]);
    ks.add(L.k.toFixed(6));
    assert.ok(L.left >= 0 && L.left + L.w <= W + 0.5, id + ' sai pela lateral');
    assert.ok(Math.abs(L.top + L.h - H) < 0.5, id + ' encosta embaixo');
    assert.ok(L.top >= H * 0.3, id + ' invade a área do balão');
  }
  assert.equal(ks.size, 1, 'mesma escala para todas');
});

test('2D: modo padrão é 2D, aceita só 2d/3d, e está ligado no renderer, no painel e no HTML', async () => {
  const S = require('../src/settings.js');
  assert.equal(S.DEFAULTS.avatarMode, '3d');
  assert.equal(S.migrateSettings({}).avatarMode, '3d');
  assert.equal(S.sanitize({ avatarMode: '3d' }, {}).avatarMode, '3d');
  assert.equal(S.sanitize({ avatarMode: 'xyz' }, {}).avatarMode, undefined);
  assert.equal((await imp('settings-defaults.js')).DEFAULT_SETTINGS.avatarMode, '3d');
  const r = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
  assert.match(r, /createAvatar2d/);
  assert.match(r, /a2d\.update\(/);
  assert.doesNotMatch(r, /playEmote: \(id\) => player\.play\(id\)/, 'gestos passam pelo playEmote (2D ou 3D)');
  assert.ok(r.split('\n').length <= 300, 'renderer.js passou de 300 linhas');
  assert.match(fs.readFileSync(path.join(root, 'src', 'panel.html'), 'utf8'), /data-key="avatarMode"/);
  assert.match(fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8'), /id="a2dImg"/);
});

test('renderer.js: no 2D o peso do passeio não fica preso e as imagens só carregam quando o 2D é usado', () => {
  const r = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
  assert.match(r, /walk\.w \+= \(\(walk\.on \? 1 : 0\) - walk\.w\)/);
  const a = fs.readFileSync(path.join(root, 'src', 'avatar2d.js'), 'utf8');
  assert.match(a, /if \(!cache\.size\) preload\(\)/);
  assert.doesNotMatch(a, /^preload\(\);/m, 'sem pré-carga no import');
});

test('padrão é o VRM (3D): arquivo antigo muda uma única vez e depois vale a escolha da pessoa', () => {
  const S = require('../src/settings.js');
  const old = S.migrateSettings({ avatarMode: '2d' });           // salvo quando o padrão ainda era 2D
  assert.equal(old.avatarMode, '3d');
  assert.equal(old.avatarVer, 2);
  const chose2d = S.migrateSettings({ avatarMode: '2d', avatarVer: 2 }); // a pessoa escolheu 2D depois da migração
  assert.equal(chose2d.avatarMode, '2d');
  assert.equal(S.migrateSettings({ avatarMode: '3d', avatarVer: 2 }).avatarMode, '3d');
  assert.equal(S.migrateSettings(null).avatarMode, '3d');
});


test('2D: giro nunca espelha o sprite nem produz escala horizontal zero', async () => {
  const { motionFor } = await imp('avatar2d-logic.js');
  for (let t = 0; t < 20; t += 0.005) {
    const m = motionFor('spin', t, 1);
    assert.ok(m.sx >= 0.089 && m.sx <= 1, 'escala inválida em t=' + t);
  }
});

test('2D: tamanho do Yoru Chibi é ajustável, progressivo e permanece dentro da janela', async () => {
  const { REACTIONS } = await imp('avatar2d-data.js');
  const { layout } = await imp('avatar2d-logic.js');
  const sample = REACTIONS.ola;
  const small = layout(1280, 800, sample, 0.75);
  const normal = layout(1280, 800, sample, 1.12);
  const large = layout(1280, 800, sample, 1.45);
  assert.ok(small.h < normal.h && normal.h < large.h, 'o controle deve alterar o tamanho visível');
  for (const [W,H] of [[1280,800],[420,640],[320,480],[1920,1080]]) {
    for (const id of Object.keys(REACTIONS)) {
      const L = layout(W,H,REACTIONS[id],1.45);
      assert.ok(L.left >= -0.5 && L.left + L.w <= W + 0.5, id + ' saiu da largura em '+W+'x'+H);
      assert.ok(L.top >= -0.5 && L.top + L.h <= H + 0.5, id + ' saiu da altura em '+W+'x'+H);
    }
  }
});

test('2D: configuração de tamanho do Chibi tem padrão e limites próprios', () => {
  const S = require('../src/settings.js');
  assert.equal(S.DEFAULTS.chibi2dScale, 1.12);
  assert.equal(S.sanitize({chibi2dScale: 1.4}, {}).chibi2dScale, 1.4);
  assert.equal(S.sanitize({chibi2dScale: 9}, {}).chibi2dScale, 1.5);
  assert.equal(S.sanitize({chibi2dScale: 0.1}, {}).chibi2dScale, 0.65);
});
