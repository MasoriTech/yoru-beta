'use strict';
// O renderer.js só liga módulos: confere o tamanho dele, o que cada módulo novo faz sem o navegador e que nenhum voltou a duplicar lógica.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'src');
const rd = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const imp = (f) => import(pathToFileURL(path.join(SRC, f)).href);
const noComments = (s) => s.replace(/\/\/.*$/gm, '');

test('renderer.js ficou pequeno e importa cada módulo novo', () => {
  const r = rd('renderer.js');
  assert.ok(r.split('\n').length < 300, 'renderer.js passou de 300 linhas: mova a lógica nova para um módulo');
  for (const m of ['settings-defaults', 'stage', 'avatar', 'bubble-style', 'chat-box', 'sleep-props', 'emote-player', 'body-pose', 'face', 'frame-limit', 'debug-hooks']) {
    assert.match(r, new RegExp(`from '\\./${m}\\.js'`), m);
    assert.ok(fs.existsSync(path.join(SRC, m + '.js')), m + '.js existe');
  }
  // a lógica saiu de lá
  assert.doesNotMatch(r, /function (loadAvatar|unloadAvatar|setupGlb|cacheBones|playEmote|fadeOutEmote|emoteWeight|makeChair|toggleChat|applyBubbleStyle)\b/);
  assert.doesNotMatch(r, /expressionManager\.|em\.setValue|getByteTimeDomainData/, 'rosto e boca moram em face.js');
});

test('módulos sem navegador não tocam em DOM, janela nem THREE', () => {
  for (const f of ['emote-player.js', 'frame-limit.js', 'body-pose.js', 'face.js']) {
    const src = noComments(rd(f)).replace(/performance\.now\(\)/g, '');
    assert.doesNotMatch(src, /document\.|window\.|\bTHREE\b/, f);
  }
});

test('settings-defaults: balão desligado, lista de gestos e cópia segura', async () => {
  const { DEFAULT_SETTINGS: D } = await imp('settings-defaults.js');
  assert.equal(D.bubbleEnabled, false);
  assert.equal(D.followCursor, true);
  assert.ok(D.emoteList.includes('wave') && D.emoteList.includes('jump'));
});

test('frame-limit: o medidor só avisa a cada 2 s', async () => {
  const { createFpsReporter, effectiveFps } = await imp('frame-limit.js');
  assert.equal(effectiveFps({ fpsActive: 60, fpsIdle: 24 }, {}, true), 60);
  assert.equal(effectiveFps({ fpsActive: 60, fpsIdle: 24 }, {}, false), 24);
  const sent = [];
  const rep = createFpsReporter({ reportFps: (n) => sent.push(n) });
  for (let i = 0; i < 5; i++) rep.tick();
  assert.deepEqual(sent, [], 'ainda não passaram 2 s');
});

// tabela de gestos mínima para testar o player sem o emotes.js
function makePlayer(over = {}) {
  const calls = [];
  const EMOTES = {
    wave: { dur: 2, expr: 'happy', fn: (t, w) => calls.push(['wave', t, w]) },
    spin: { dur: 3, expr: 'happy', fn: () => {} },
    bed: { dur: 4, expr: 'relaxed', fn: () => {} },
    chair: { dur: 4, expr: 'neutral', fn: () => {} },
    land: { dur: 0.5, expr: 'neutral', fn: () => {} },
  };
  const S = { visible: true, emoteSpeed: 1, emotesEnabled: true, emoteMin: 1, emoteMax: 1, emoteList: ['wave', 'spin'], ...over.S };
  const state = { ready: true, carried: false, ...over.state };
  return { calls, EMOTES, S, state, load: async () => {
    const { createEmotePlayer } = await imp('emote-player.js');
    return createEmotePlayer({ S, getEmotes: () => EMOTES, canPlay: () => state.ready, isCarried: () => state.carried });
  } };
}

test('emote-player: toca, sobe e desce o peso, e acaba sozinho', async () => {
  const m = makePlayer(); const p = await m.load();
  assert.equal(p.active(), false);
  p.play('wave');
  assert.equal(p.id(), 'wave');
  const a = p.step(0.1, 'neutral');
  assert.equal(a.expr, 'happy');
  assert.ok(a.ew > 0 && a.ew < 1, 'peso começa baixo');
  const mid = p.step(0.9, 'neutral');
  assert.equal(mid.ew, 1, 'no meio o peso é cheio');
  const fim = p.step(1.5, 'neutral');
  assert.equal(p.active(), false, 'passou da duração');
  assert.equal(fim.expr, 'neutral');
});

test('emote-player: sem avatar, invisível ou nos braços não toca; "stand" cancela e "spin" termina a volta', async () => {
  let m = makePlayer({ state: { ready: false } }); let p = await m.load();
  p.play('wave'); assert.equal(p.active(), false);
  m = makePlayer({ S: { visible: false } }); p = await m.load();
  p.play('wave'); assert.equal(p.active(), false);
  m = makePlayer({ state: { carried: true } }); p = await m.load();
  p.play('wave'); assert.equal(p.active(), false, 'nos braços: sem gesto');
  m = makePlayer(); p = await m.load();
  p.play('wave'); p.step(0.1, 'neutral'); p.play('stand');
  assert.equal(p.active(), false, 'levantar cancela');
  p.play('spin'); p.step(0.2, 'neutral'); p.play('wave');
  assert.equal(p.id(), 'spin', 'a volta termina antes de trocar');
});

test('emote-player: pegar o avatar no meio do gesto o faz sair suave; reset limpa tudo', async () => {
  const m = makePlayer(); const p = await m.load();
  p.play('wave'); p.step(0.5, 'neutral');
  m.state.carried = true;
  const r = p.step(0.05, 'neutral');
  assert.equal(p.active(), false);
  assert.ok(r.ewOut > 0, 'o gesto antigo continua saindo, não some de uma vez');
  const later = p.step(0.1, 'neutral').ewOut;
  assert.ok(later > 0 && later < r.ewOut, 'e diminui a cada quadro');
  assert.equal(p.step(0.3, 'neutral').ewOut, 0, 'some em ~0,3 s');
  p.play('stand');
  m.state.carried = false;
  p.play('wave'); m.state.carried = true; p.step(0.05, 'neutral');
  p.reset();
  assert.equal(p.step(0.05, 'neutral').ewOut, 0, 'reset descarta o gesto que estava saindo');
});

test('emote-player: cama, cadeira, queda e sorteio', async () => {
  let m = makePlayer(); let p = await m.load();
  p.play('bed'); p.step(1, 'neutral');
  const r = p.step(0.5, 'neutral');
  assert.ok(r.bedW > 0 && r.tentW === 0);
  p.play('chair'); assert.equal(p.wantsChair(), true);
  m = makePlayer(); p = await m.load();
  assert.equal(p.landK, 1);
  p.land(900);
  assert.equal(p.landK, 0.5);
  assert.equal(p.id(), 'land');
  p.land(100000); assert.equal(p.landK, 1);
  p.land(1); assert.equal(p.landK, 0.35);
  m = makePlayer({ S: { emoteMin: 1, emoteMax: 1 } }); p = await m.load();
  p.reschedule();
  p.tickRandom(0.5, true); assert.equal(p.active(), false, 'ainda não deu o tempo');
  p.tickRandom(0.6, false); assert.equal(p.active(), false, 'não pode agora: não conta o tempo');
  p.tickRandom(0.6, true); assert.equal(p.active(), true, 'sorteou um gesto');
  assert.notEqual(p.id(), 'bed');
});

test('body-pose: carregada soma a pose e pede cara de surpresa; item dobra o braço escolhido', async () => {
  const { createBodyPose } = await imp('body-pose.js');
  const P = {};
  const add = (b, a, v) => ((P[b] ||= { x: 0, y: 0, z: 0 })[a] += v);
  const ptr = { grabbed: true, falling: false, lastMoveT: 0, dragVx: 0 };
  const held = { obj: null };
  const body = createBodyPose({ S: { itemHand: 'left', breathing: false }, P, add, idle: {}, held, walk: { w: 0 }, cur: { updateHead() {} }, V: { ttsLevel: 0 }, ptr, getVrm: () => ({}) });
  assert.equal(body.carriedPose(0), false, 'peso ainda zero');
  for (let i = 0; i < 40; i++) body.trackCarry(0.05);
  assert.ok(body.heldW > 0.99);
  assert.equal(body.carriedPose(0), true);
  assert.ok(P.leftUpperArm.z > 1.4 && P.rightUpperArm.z < -1.4, 'braços para cima');
  ptr.grabbed = false;
  for (let i = 0; i < 80; i++) body.trackCarry(0.05);
  assert.ok(body.heldW < 0.01);
  held.obj = {};
  for (const k of Object.keys(P)) delete P[k];
  for (let i = 0; i < 60; i++) body.itemPose(0.05, false);
  assert.ok(body.itemW > 0.99);
  assert.ok(P.leftUpperArm && !P.rightUpperArm, 'só o braço esquerdo segura');
  const before = body.itemW;
  body.itemPose(0.05, true);
  assert.ok(body.itemW < before, 'com gesto tocando, o item sai da pose');
});

test('face: piscar, expressão suave e boca; dormindo fecha os olhos', async () => {
  const { createFace } = await imp('face.js');
  const vals = {};
  const em = { setValue: (n, v) => { vals[n] = v; }, getValue: (n) => vals[n] };
  const S = { blinking: true, blinkRate: 1, lipSync: true, emotionStrength: 1 };
  const face = createFace({ S, V: { audioEl: null, analyser: null, ttsLevel: 0 } });
  for (let i = 0; i < 30; i++) face.update(0.05, i * 0.05, { em, expr: 'happy', sleepW: 0, speaking: false });
  assert.ok(vals.happy > 0.9, 'a expressão chegou perto do alvo');
  assert.equal(vals.angry, 0);
  assert.equal(vals.aa, 0, 'calada: boca fechada');
  face.update(0.05, 1, { em, expr: 'happy', sleepW: 1, speaking: true });
  assert.equal(vals.blink, 1, 'dormindo: olhos fechados');
  assert.ok(vals.aa > 0, 'falando sem áudio: boca balança');
  S.lipSync = false;
  face.update(0.05, 1.1, { em, expr: 'happy', sleepW: 0, speaking: true });
  assert.equal(vals.aa, 0, 'lip-sync desligado');
});

test('chibi: proporções, altura final e ligação do controle (padrão desligado)', async () => {
  const { chibiScales, chibiHeightRatio, CHIBI } = await imp('avatar.js');
  const n = chibiScales(0);
  assert.deepEqual([n.torso, n.legs, n.head, n.headBone], [1, 1, 1, 1], 'chibi 0 não muda nada');
  const c = chibiScales(1);
  assert.ok(c.torso < 1 && c.legs < c.torso && c.head > 1.5, 'tronco e pernas encolhem (pernas mais) e a cabeça cresce');
  assert.ok(Math.abs(c.headBone * c.torso - c.head) < 1e-9, 'a cabeça herda a escala do tronco e é compensada');
  assert.deepEqual(chibiScales(5), c, 'valor acima de 1 vale 1');
  assert.deepEqual(chibiScales(-1), n, 'valor negativo vale 0');
  assert.deepEqual(chibiScales('x'), n, 'lixo vale 0');
  assert.equal(chibiHeightRatio(0, 0.9, 1.4), 1);
  const r = chibiHeightRatio(1, 0.9, 1.4);
  assert.ok(r > 0.6 && r < 0.9, 'o chibi fica mais baixo, mas não minúsculo: ' + r);
  assert.ok(CHIBI.legs > CHIBI.torso);
  // referência (design/yoru-chibi-pack-reacoes.png): a cabeça ocupa perto de metade da altura do avatar chibi
  const s1 = chibiScales(1), hips = 0.9, headY = 1.4, headLen = headY / 6.5;
  const share = (s1.head * headLen) / (s1.legs * hips + s1.torso * (headY - hips) + s1.head * headLen);
  assert.ok(share > 0.42 && share < 0.55, 'cabeça ~46% da altura: ' + share);
  // ligação: padrão, validação, painel e renderer
  assert.equal((await imp('settings-defaults.js')).DEFAULT_SETTINGS.chibi, 0);
  assert.match(rd('settings.js'), /^  chibi: 0,/m);
  assert.match(rd('settings.js'), /o\.chibi = clamp\(p\.chibi, 0, 1, 0\)/);
  assert.match(rd('panel.html'), /data-key="chibi"/);
  assert.match(rd('panel.html'), /id="v-chibi"/);
  assert.match(rd('renderer.js'), /S\.chibi !== prev\.chibi\) av\.applyChibi\(\)/);
});

test('settings-defaults: a voz neural padrão do avatar é a Francisca', async () => {
  assert.equal((await imp('settings-defaults.js')).DEFAULT_SETTINGS.neuralVoice, 'pt-BR-FranciscaNeural');
});
