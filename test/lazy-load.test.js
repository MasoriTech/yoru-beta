'use strict';
// Abertura mais rápida: no 2D (padrão) o leitor de modelos 3D e o WebGL não são carregados; o avatar aparece antes do painel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'src');
const rd = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const imp = (f) => import(pathToFileURL(path.join(SRC, f)).href);

test('renderer.js não importa o leitor 3D de cara: só por import() quando precisa', () => {
  const r = rd('renderer.js');
  assert.doesNotMatch(r, /^import .*(GLTFLoader|three-vrm|@pixiv)/m, 'sem import estático do leitor de modelos');
  assert.match(r, /import\('three\/addons\/loaders\/GLTFLoader\.js'\)/);
  assert.match(r, /import\('@pixiv\/three-vrm'\)/);
  assert.match(r, /if \(!is2d\(\)\) loadLibs\(\)/, 'no 3D já começa a baixar na abertura');
});

test('avatar: o leitor só nasce no primeiro load e é reaproveitado', async () => {
  const { createAvatar } = await imp('avatar.js');
  let calls = 0, created = 0;
  class FakeLoader { constructor() { created++; } register() {} load(url, ok) { ok({ url }); } }
  const loadLibs = async () => { calls++; return { GLTFLoader: FakeLoader, VRMLoaderPlugin: class {}, VRMUtils: {} }; };
  const av = createAvatar({ THREE: {}, loadLibs, scene: {}, S: {}, api: {}, say() {}, hair: {}, sleepProps: {}, onReset() {}, onLoaded() {} });
  assert.equal(calls, 0, 'criar o avatar não baixa nada');
  const got = [];
  await new Promise((res) => av.loader.load('a.glb', (g) => { got.push(g.url); res(); }));
  await new Promise((res) => av.loader.load('b.glb', (g) => { got.push(g.url); res(); }));
  assert.deepEqual(got, ['a.glb', 'b.glb']);
  assert.equal(calls, 1);
  assert.equal(created, 1);
});

test('avatar: se a biblioteca falhar, o erro chega no callback de erro', async () => {
  const { createAvatar } = await imp('avatar.js');
  const av = createAvatar({ THREE: {}, loadLibs: async () => { throw new Error('sem arquivo'); }, scene: {}, S: {}, api: {}, say() {}, hair: {}, sleepProps: {}, onReset() {}, onLoaded() {} });
  const err = await new Promise((res) => av.loader.load('x.glb', () => res(null), null, res));
  assert.match(String(err.message), /sem arquivo/);
});

test('stage: o WebGL só é criado no primeiro desenho 3D', async () => {
  const { createStage } = await imp('stage.js');
  let made = 0, ratio = 0, sized = 0, drawn = 0;
  const THREE = {
    WebGLRenderer: class { constructor() { made++; } setPixelRatio() { ratio++; } setSize() { sized++; } setClearColor() {} render() { drawn++; } },
    Scene: class { add() {} }, PerspectiveCamera: class { constructor() { this.position = { set() {} }; } lookAt() {} updateMatrixWorld() {} updateProjectionMatrix() {} },
    DirectionalLight: class { constructor() { this.position = { set: () => ({ normalize() {} }) }; } }, AmbientLight: class {},
  };
  globalThis.window = { innerWidth: 400, innerHeight: 600, devicePixelRatio: 1 };
  try {
    const st = createStage({ THREE, canvas: {}, S: { quality: 'medium' }, api: {} });
    assert.equal(made, 0, 'criar o palco não cria o WebGL');
    st.applyPixelRatio(); st.resize();
    assert.equal(made, 0, 'ajustar tamanho e resolução antes do 3D também não');
    st.render(); st.render();
    assert.equal(made, 1);
    assert.equal(drawn, 2);
    assert.ok(ratio >= 1 && sized >= 1);
    assert.equal('renderer' in st, false, 'o renderizador não vaza para fora do palco');
  } finally { delete globalThis.window; }
});

test('stage: se o WebGL falhar, reinicia em modo software uma vez só', async () => {
  const { createStage } = await imp('stage.js');
  let relaunch = 0;
  const THREE = {
    WebGLRenderer: class { constructor() { throw new Error('sem GPU'); } },
    Scene: class { add() {} }, PerspectiveCamera: class { constructor() { this.position = { set() {} }; } lookAt() {} updateMatrixWorld() {} },
    DirectionalLight: class { constructor() { this.position = { set: () => ({ normalize() {} }) }; } }, AmbientLight: class {},
  };
  globalThis.window = { innerWidth: 400, innerHeight: 600, devicePixelRatio: 1, showErr() {} };
  try {
    const st = createStage({ THREE, canvas: {}, S: {}, api: { relaunchNoGpu: () => relaunch++ } });
    assert.throws(() => st.render(), /sem GPU/);
    st.render(); st.render(); // depois da falha não tenta de novo a cada quadro
    assert.equal(relaunch, 1);
  } finally { delete globalThis.window; }
});

test('main: o avatar abre antes do painel, com limite de tempo e sem painel duplicado', () => {
  const m = rd('main.js');
  assert.match(m, /const makePanel = \(\) => \{ if \(!panel\) createPanel\(/);
  assert.match(m, /win\.webContents\.once\('did-finish-load', \(\) => setTimeout\(makePanel, 50\)\)/);
  assert.match(m, /setTimeout\(makePanel, 3000\)/);
  assert.ok(m.indexOf('createWindow();') < m.indexOf('const makePanel'), 'o avatar é criado primeiro');
});
