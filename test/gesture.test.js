'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const GL = require('../src/gesture-logic');
const { createGestureActions } = require('../src/gesture-actions');
const { sanitize, DEFAULTS } = require('../src/settings');
const AS = require('../src/ai-stream');
const panelSource = require('./helpers/panel-source');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');

// ----- mão sintética: mão aberta de pé, pulso embaixo (y cresce para baixo) -----
// ext: { thumb: 'out'|'up'|'down'|'in', index, middle, ring, pinky: true|false }
function hand(ext, { dx = 0, dy = 0, okTouch = false } = {}) {
  const lm = new Array(21);
  const set = (i, x, y) => { lm[i] = { x: x + dx, y: y + dy }; };
  set(0, 0.5, 0.8);
  const fx = { index: 0.46, middle: 0.5, ring: 0.54, pinky: 0.58 };
  const base = { index: 5, middle: 9, ring: 13, pinky: 17 };
  for (const f of Object.keys(fx)) {
    const b = base[f], x = fx[f];
    set(b, x, 0.6);
    if (ext[f]) { set(b + 1, x, 0.53); set(b + 2, x, 0.47); set(b + 3, x, 0.42); }
    else { set(b + 1, x, 0.54); set(b + 2, x, 0.56); set(b + 3, x, 0.62); }
  }
  set(1, 0.44, 0.76); set(2, 0.41, 0.71);
  const th = ext.thumb || 'in';
  if (th === 'out') { set(3, 0.35, 0.66); set(4, 0.29, 0.62); }
  else if (th === 'up') { set(3, 0.4, 0.62); set(4, 0.4, 0.47); }
  else if (th === 'down') { set(3, 0.4, 0.8); set(4, 0.4, 0.95); }
  else { set(3, 0.45, 0.67); set(4, 0.49, 0.65); }
  if (okTouch) { set(8, 0.47, 0.56); set(4, 0.47, 0.565); set(3, 0.45, 0.64); }
  return lm;
}
const F = { index: false, middle: false, ring: false, pinky: false };
const cases = {
  open_palm: { thumb: 'out', index: true, middle: true, ring: true, pinky: true },
  fist: { ...F },
  point: { ...F, index: true },
  victory: { ...F, index: true, middle: true },
  three: { ...F, index: true, middle: true, ring: true },
  thumbs_up: { ...F, thumb: 'up' },
  thumbs_down: { ...F, thumb: 'down' },
  rock: { ...F, index: true, pinky: true },
  shaka: { ...F, pinky: true, thumb: 'out' },
};

test('classify: reconhece cada gesto da lista', () => {
  for (const [id, ext] of Object.entries(cases)) assert.equal(GL.classify(hand(ext)), id, id);
  assert.equal(GL.classify(hand({ ...F, middle: true, ring: true, pinky: true }, { okTouch: true })), 'ok');
});

test('classify: serve com a mão deslocada e girada de lado (usa distâncias, não posição)', () => {
  assert.equal(GL.classify(hand(cases.victory, { dx: 0.2, dy: -0.15 })), 'victory');
  const rot = hand(cases.point).map((p) => ({ x: 0.5 + (p.y - 0.8) * -1 * 0.75, y: 0.5 + (p.x - 0.5) * 1.0 })); // gira 90°
  assert.equal(GL.classify(rot, 4 / 3), 'point');
});

test('classify: sem mão, mão incompleta ou minúscula devolvem null', () => {
  assert.equal(GL.classify(null), null);
  assert.equal(GL.classify([{ x: 0, y: 0 }]), null);
  assert.equal(GL.classify(hand(cases.fist).map(() => ({ x: 0.5, y: 0.5 }))), null);
});

function clock() { let t = 1000; return { now: () => t, tick: (ms) => { t += ms; } }; }
const hold = (eng, c, gesture, ms, step = 50) => { const ev = []; for (let e = 0; e < ms; e += step) { c.tick(step); ev.push(...eng.update({ gesture, x: 0.5, y: 0.5 })); } return ev; };

test('motor: sem armar nada executa; palma aberta parada por 1 s arma; depois o gesto executa uma vez', () => {
  const c = clock(); const eng = GL.createEngine({ now: c.now });
  assert.deepEqual(hold(eng, c, 'fist', 2000), []);                              // desarmado: punho é ignorado
  assert.deepEqual(hold(eng, c, 'open_palm', 1200).map((e) => e.type), ['arm']);  // arma uma vez só
  eng.update(null);
  const ev = hold(eng, c, 'fist', 2000);
  assert.deepEqual(ev, [{ type: 'gesture', id: 'fist' }]);                        // não repete enquanto segura
  assert.equal(eng.status().armed, true);
});

test('motor: gesto curto demais não executa e o sistema desarma depois da janela', () => {
  const c = clock(); const eng = GL.createEngine({ now: c.now, armWindowMs: 3000 });
  hold(eng, c, 'open_palm', 1200); eng.update(null);
  assert.deepEqual(hold(eng, c, 'victory', 300), []);                             // < 0,6 s
  eng.update(null);
  c.tick(3500);
  assert.deepEqual(eng.update(null).map((e) => e.type), ['disarm']);
  assert.deepEqual(hold(eng, c, 'fist', 1500), []);
});

test('motor: respeita a pausa entre gestos e a troca de gesto reinicia a contagem', () => {
  const c = clock(); const eng = GL.createEngine({ now: c.now, cooldownMs: 2000 });
  hold(eng, c, 'open_palm', 1200); eng.update(null);
  assert.equal(hold(eng, c, 'fist', 700).length, 1);
  eng.update(null);
  assert.equal(hold(eng, c, 'point', 700).length, 0, 'ainda na pausa');
  assert.equal(hold(eng, c, 'point', 1500).length, 1, 'passou a pausa e continua segurando');
  const c2 = clock(); const e2 = GL.createEngine({ now: c2.now });
  hold(e2, c2, 'open_palm', 1200); e2.update(null);
  hold(e2, c2, 'fist', 400); hold(e2, c2, 'point', 400);
  assert.equal(hold(e2, c2, 'point', 300).length, 1, 'conta de novo a partir do gesto novo');
});

test('motor: com "exigir palma" desligado, o gesto executa direto', () => {
  const c = clock(); const eng = GL.createEngine({ now: c.now, arm: false });
  assert.deepEqual(hold(eng, c, 'thumbs_up', 800), [{ type: 'gesture', id: 'thumbs_up' }]);
});

test('motor: deslizar a palma aberta para o lado dispara swipe (direita = direita de quem usa, imagem espelhada)', () => {
  const run = (from, to) => {
    const c = clock(); const eng = GL.createEngine({ now: c.now, arm: false });
    const out = [];
    for (let i = 0; i <= 6; i++) { c.tick(50); out.push(...eng.update({ gesture: 'open_palm', x: from + ((to - from) * i) / 6, y: 0.5 })); }
    return out.filter((e) => e.type === 'gesture').map((e) => e.id);
  };
  assert.deepEqual(run(0.7, 0.3), ['swipe_right']); // na câmera (sem espelho) o x diminui quando a mão vai para a sua direita
  assert.deepEqual(run(0.3, 0.7), ['swipe_left']);
  assert.deepEqual(run(0.5, 0.55), []);             // mão quase parada
});

test('suavizador: ignora um quadro errado no meio e só troca de gesto com maioria', () => {
  const sm = GL.createSmoother({ size: 5, min: 3 });
  const out = ['fist', 'fist', 'point', 'fist', 'fist'].map((g) => sm.push(g));
  assert.deepEqual(out, [null, null, null, 'fist', 'fist']);  // só vale com 3 de 5 quadros
  assert.equal(sm.push('point'), 'fist');       // 1 quadro diferente não derruba (3 de 5 ainda são fist)
  assert.equal(sm.push('point'), 'point');      // agora point tem 3 de 5: troca
  sm.reset();
  assert.equal(sm.push('fist'), null);
});

test('motor: segurar um gesto repetível (volume) repete; os outros disparam uma vez só', () => {
  const c = clock();
  const eng = GL.createEngine({ now: c.now, arm: false, repeatMs: 700, cooldownMs: 1500, repeat: (id) => id === 'thumbs_up' });
  const up = hold(eng, c, 'thumbs_up', 3000).filter((e) => e.type === 'gesture');
  assert.equal(up[0].repeat, undefined);
  assert.ok(up.length >= 3 && up.slice(1).every((e) => e.repeat), 'repete enquanto segura: ' + up.length);
  eng.update(null);
  assert.equal(hold(eng, c, 'fist', 3000).filter((e) => e.type === 'gesture').length, 1);
});

test('predefinições: completas e só com ações válidas; apresentação passa slides', async () => {
  for (const [nome, m] of Object.entries(GL.PRESETS)) {
    assert.deepEqual(Object.keys(m).sort(), [...GL.GESTURE_IDS].sort(), nome);
    for (const a of Object.values(m)) assert.ok(GL.isValidAction(a, AS.EMOTE_IDS), nome + ': ' + a);
  }
  assert.equal(GL.PRESETS.apresentacao.swipe_right, 'slide-next');
  const keys = [];
  const a = createGestureActions({ pc: { supported: true, arrow: async (d) => (keys.push(d), true) }, emoteIds: AS.EMOTE_IDS, stopSpeak() {}, openChat() {}, rollDice() {}, playEmote() {} });
  await a.run('slide-next'); await a.run('slide-prev');
  assert.deepEqual(keys, ['right', 'left']);
});

test('pc-control: seta esquerda/direita manda a tecla certa', async () => {
  const { createPc } = require('../src/pc-control');
  const envs = [];
  const pc = createPc({ platform: 'win32', exec: async (_f, _a, o) => (envs.push(o.env), { code: 0, out: 'OK', err: '' }) });
  assert.equal(await pc.arrow('right'), true);
  assert.equal(await pc.arrow('left'), true);
  assert.equal(await pc.arrow('up'), false);
  assert.deepEqual(envs.map((e) => e.YORU_VK), ['39', '37']);
});

test('mapa: só gestos e ações conhecidos passam (o painel não é de confiança)', () => {
  const ids = AS.EMOTE_IDS;
  const m = GL.sanitizeMap({ fist: 'media-playpause', point: 'rm -rf', hacker: 'dice', ok: 'emote:wave', victory: 'emote:inexistente', rock: 'shutdown' }, ids);
  assert.deepEqual(m, { fist: 'media-playpause', ok: 'emote:wave' });
  for (const a of ['shutdown', 'restart', 'lock', 'sleep']) assert.equal(GL.isValidAction(a, ids), false, a);
  for (const a of Object.values(GL.DEFAULT_MAP)) assert.ok(GL.isValidAction(a, ids), 'padrão inválido: ' + a);
});

test('configurações: valores dos gestos são validados e o mapa completa com o padrão', () => {
  const o = sanitize({ gestureHold: 99999, gestureCooldown: 1, gestureArm: 0, gestureCam: 'abc', gestureMap: { fist: 'dice', point: 'bad' } }, DEFAULTS);
  assert.equal(o.gestureHold, 2000);
  assert.equal(o.gestureCooldown, 500);
  assert.equal(o.gestureArm, false);
  assert.equal(o.gestureCam, 'abc');
  assert.equal(o.gestureMap.fist, 'dice');
  assert.equal(o.gestureMap.point, GL.DEFAULT_MAP.point);
  assert.equal(DEFAULTS.gestureAuto, false, 'a câmera nunca liga sozinha por padrão');
  assert.equal(DEFAULTS.gestureArm, true);
});

test('ações: executa pela lista fixa e recusa o que não conhece', async () => {
  const calls = [];
  const pc = { supported: true, media: async (o) => (calls.push('media:' + o), true), volume: async (o, n) => (calls.push('vol:' + o + ':' + n), true),
    screenshot: async () => ({ ok: true, file: 'x.png' }), desktop: async () => true, switchWindow: async () => true, window: async () => ({ ok: true }) };
  const a = createGestureActions({ pc, emoteIds: AS.EMOTE_IDS, stopSpeak: () => calls.push('stop'), openChat: () => calls.push('chat'), rollDice: () => calls.push('dice'), playEmote: (id) => calls.push('emote:' + id) });
  assert.equal((await a.run('media-playpause')).ok, true);
  assert.equal((await a.run('volume-up')).ok, true);
  assert.equal((await a.run('emote:wave')).ok, true);
  assert.equal((await a.run('toggle-chat')).ok, true);
  assert.equal((await a.run('screenshot')).extra, 'x.png');
  assert.deepEqual(calls, ['media:playpause', 'vol:up:5', 'emote:wave', 'chat']);
  for (const bad of ['shutdown', 'emote:nao-existe', '', 'talk;calc']) assert.equal((await a.run(bad)).ok, false, bad);
  const off = createGestureActions({ pc: { supported: false }, emoteIds: AS.EMOTE_IDS, stopSpeak() {}, openChat() {}, rollDice() {}, playEmote() {} });
  assert.equal((await off.run('volume-up')).ok, false);
  assert.equal((await off.run('stop-speak')).ok, true, 'ações do próprio app funcionam fora do Windows');
});

test('ligação: aba, scripts, preload e main combinam; CSP só ganha wasm; câmera só no painel principal', () => {
  const html = read('src', 'panel.html');
  assert.match(html, /data-tab="gestos"/);
  assert.match(html, /id="tab-gestos"/);
  assert.ok(panelSource.scripts().includes('gesture-logic.js') && panelSource.scripts().includes('panel-gestos.js'));
  const sc = panelSource.scripts();
  assert.ok(sc.indexOf('gesture-logic.js') < sc.indexOf('panel-gestos.js') && sc.indexOf('panel-gestos.js') < sc.indexOf('panel-start.js'), 'panel-start.js continua sendo o último');
  assert.match(html, /script-src 'self' blob: 'wasm-unsafe-eval';/);
  assert.match(read('src', 'panel-preload.js'), /gestureAction: .*'gesture-action'/);
  const main = read('src', 'main.js');
  assert.match(main, /secureIpcMain\.handle\('gesture-action', \(e, action\) => \(isPanelSender\(e\.sender\)/);
  assert.match(read('src', 'panel-core.js'), /t\.dataset\.tab === 'conversa' \\|\\| t\.dataset\.tab === 'gestos'/);
  assert.match(read('src', 'windows.js'), /gestos: 'Gestos'/, 'a aba Gestos tem rota de janela própria no Float Dock');
  // cada id usado pelo painel existe no HTML
  const js = read('src', 'panel-gestos.js');
  for (const id of new Set([...js.matchAll(/g\('(\w+)'\)/g)].map((m) => m[1]))) assert.match(html, new RegExp(`id="${id}"`), 'falta #' + id);
  for (const id of ['convTalk', 'convToggle', 'gFps']) assert.match(html, new RegExp(`id="${id}"`));
  // empacotamento
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['@mediapipe/tasks-vision']);
  assert.match(read('scripts', 'vendor.js'), /hand_landmarker\.task/);
  assert.match(read('scripts', 'vendor.js'), /vision_bundle\.mjs/);
});

// ----- mouse no ar -----
test('ponteiro: indicador vira posição na tela (espelhada) e a pinça faz clique com histerese', () => {
  const t = clock();
  const ptr = GL.createPointer({ now: t.now, sens: 3 });
  const r = ptr.update(hand(cases.point));                 // ponta do indicador em x=.46, y=.42
  assert.ok(Math.abs(r.x - 0.5625) < 0.01 && Math.abs(r.y - 0.375) < 0.01, `${r.x} ${r.y}`);
  const right = ptr.update(hand(cases.point, { dx: -0.2 })); // mão para a esquerda da câmera = direita de quem usa
  assert.ok(right.x > r.x, 'mover para a direita aumenta x');
  const pinch = hand({ ...F, middle: true, ring: true, pinky: true }, { okTouch: true });
  assert.deepEqual(ptr.update(pinch).events, ['down']);
  assert.deepEqual(ptr.update(pinch).events, [], 'não repete enquanto segura');
  assert.deepEqual(ptr.update(hand(cases.point)).events, ['up']);
  assert.deepEqual(ptr.release(), [], 'nada preso');
  ptr.update(pinch);
  assert.deepEqual(ptr.release(), ['up'], 'ao sair com a pinça fechada, solta o botão');
});

test('ponteiro: o cursor fica parado enquanto os dedos fecham a pinça (clique cai no alvo)', () => {
  const ptr = GL.createPointer({ now: clock().now, sens: 3 });
  const a = ptr.update(hand(cases.point));
  const closing = hand(cases.point, { dx: -0.1 });
  closing[4] = { x: closing[8].x, y: closing[8].y + 0.1 };   // polegar a ~0,5 da palma do indicador: quase pinça, sem clicar
  const b = ptr.update(closing);
  assert.deepEqual(b.events, []);
  assert.deepEqual([b.x, b.y], [a.x, a.y]);
});

test('ponteiro: polegar+médio dá clique direito uma vez; sensibilidade maior alcança mais com menos movimento', () => {
  const ptr = GL.createPointer({ now: clock().now });
  const rc = hand({ ...F, middle: true, ring: true, pinky: true });
  rc[4] = { x: rc[12].x, y: rc[12].y + 0.005 };
  assert.deepEqual(ptr.update(rc).events, ['right']);
  assert.deepEqual(ptr.update(rc).events, []);
  const fist = GL.createPointer({ now: clock().now });
  assert.deepEqual(fist.update(hand(cases.fist)).events, [], 'punho fechado não clica');
  assert.deepEqual(fist.update(hand(cases.point)).events, [], 'apontar com o polegar apoiado no médio dobrado não dá clique direito');
  const lo = GL.createPointer({ now: clock().now, sens: 1 }), hi = GL.createPointer({ now: clock().now, sens: 5 });
  const h = hand(cases.point, { dx: -0.1 });
  assert.ok(Math.abs(hi.update(h).x - 0.5) > Math.abs(lo.update(h).x - 0.5));
});

test('mouse no ar (main): só aceita comandos curtos e números; solta o botão ao parar', () => {
  const { createAirMouse } = require('../src/air-mouse');
  const lines = []; let ended = false, killed = false;
  const fake = () => ({ stdin: { write: (l) => lines.push(l), end: () => { ended = true; }, on() {} }, on() {}, kill: () => { killed = true; } });
  const am = createAirMouse({ platform: 'win32', spawnFn: fake });
  assert.equal(am.handle({ t: 'm', x: 0.25, y: 1.7 }), true);
  assert.equal(am.handle({ t: 'd' }), true);
  for (const bad of [{ t: 'm', x: 'a', y: 1 }, { t: 'rm -rf' }, { t: 'm; calc', x: 0, y: 0 }, null, 'm 1 1', { x: 1 }]) assert.equal(am.handle(bad), false, JSON.stringify(bad));
  am.handle({ t: 'off' });
  assert.deepEqual(lines, ['m 0.2500 1.0000\n', 'd\n', 'u\n', 'q\n']);
  assert.equal(ended, true);
  const off = createAirMouse({ platform: 'linux', spawnFn: () => { throw new Error('não deveria abrir'); } });
  assert.equal(off.handle({ t: 'm', x: 0, y: 0 }), false);
  assert.equal(off.supported, false);
});

test('mouse no ar: ligação painel, preload e main; tecla de saída existe', () => {
  assert.match(read('src', 'panel-preload.js'), /airMouse: \(msg\) => ipcRenderer\.send\('air-mouse', msg\)/);
  assert.match(read('src', 'main.js'), /secureIpcMain\.on\('air-mouse', \(e, msg\) => \{ if \(isPanelSender\(e\.sender\)\)/);
  assert.match(read('src', 'main.js'), /will-quit', \(\) => airMouse\.stop\(\)/);
  assert.ok(GL.UI_ACTIONS.includes('air-mouse') && GL.isValidAction('air-mouse'));
  assert.equal(DEFAULTS.gestureMouseSens, 3);
  assert.equal(sanitize({ gestureMouseSens: 99 }, DEFAULTS).gestureMouseSens, 5);
});

test('arquivos do MediaPipe: o painel não usa fetch(file://) e o main só entrega .task/.wasm por nome simples', () => {
  const js = read('src', 'panel-gestos.js');
  assert.doesNotMatch(js, /\bfetch\(/, 'fetch de file:// falha no navegador: use panel.gestureFile');
  assert.match(js, /panel\.gestureFile\('hand_landmarker\.task'\)/);
  const main = read('src', 'main.js');
  assert.match(main, /secureIpcMain\.handle\('gesture-file', \(e, name\) => \{\s*if \(!isPanelSender\(e\.sender\)/);
  assert.match(main, /\/\^\[\\w\.-\]\{1,80\}\$\/\.test\(name\)/);
  assert.match(read('src', 'panel-preload.js'), /gestureFile: \(name\) => ipcRenderer\.invoke\('gesture-file', name\)/);
});

test('sensibilidade da detecção: três níveis, normal é o padrão e valor desconhecido cai no normal', () => {
  assert.deepEqual(GL.DETECT_IDS, ['strict', 'normal', 'sensitive']);
  const n = GL.detectConfig('normal');
  assert.deepEqual(n, { minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5 }); // os valores de antes
  assert.deepEqual(GL.detectConfig('inexistente'), n);
  assert.deepEqual(GL.detectConfig(undefined), n);
  const s = GL.detectConfig('strict'), v = GL.detectConfig('sensitive');
  for (const k of Object.keys(n)) assert.ok(s[k] > n[k] && n[k] > v[k], `${k}: rigorosa > normal > sensível`);
});

test('desligar a câmera sozinha: só depois do tempo escolhido, e 0 significa nunca', () => {
  assert.equal(GL.idleExpired(10 * 60000, 0), false);
  assert.equal(GL.idleExpired(10 ** 9, 0), false);
  assert.equal(GL.idleExpired(4 * 60000, 5), false);
  assert.equal(GL.idleExpired(5 * 60000, 5), true);
  assert.equal(GL.idleExpired(61 * 60000, 60), true);
  assert.equal(GL.idleExpired(1000, undefined), false);
  assert.equal(GL.idleExpired(1000, 'abc'), false);
});

test('configurações: sensibilidade e desligar sozinha são validadas; o padrão não muda o comportamento antigo', () => {
  assert.equal(DEFAULTS.gestureDetect, 'normal');
  assert.equal(DEFAULTS.gestureIdleOff, 0, 'a câmera não desliga sozinha por padrão');
  assert.equal(sanitize({ gestureDetect: 'strict' }, DEFAULTS).gestureDetect, 'strict');
  assert.equal(sanitize({ gestureDetect: 'sensitive' }, DEFAULTS).gestureDetect, 'sensitive');
  assert.ok(!('gestureDetect' in sanitize({ gestureDetect: 'hacker' }, DEFAULTS)), 'valor inválido é ignorado');
  assert.equal(sanitize({ gestureIdleOff: 12 }, DEFAULTS).gestureIdleOff, 10);
  assert.equal(sanitize({ gestureIdleOff: 999 }, DEFAULTS).gestureIdleOff, 60);
  assert.equal(sanitize({ gestureIdleOff: -4 }, DEFAULTS).gestureIdleOff, 0);
});
