'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerLibraryIpc, BUILTIN_ITEMS } = require('../src/ipc-library');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

function setup(render) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-it-'));
  fs.writeFileSync(path.join(dir, 'meu.glb'), Buffer.from('glTF0000000000000000'));
  const handlers = {};
  const ipcMain = { handle: (n, f) => { handlers[n] = f; } };
  registerLibraryIpc({
    ipcMain, dialog: {}, shell: {}, BrowserWindow: {}, nativeImage: {}, assetsDir: dir,
    lib: { libDir: () => dir, libAll: () => ({ avatars: [], items: [] }), libPath: (kind, id) => (kind === 'items' && id === 'meu.glb' ? path.join(dir, 'meu.glb') : null) },
    getSettings: () => ({}), commit() {}, renderItemThumb: render,
  });
  return { thumb: (kind, id) => handlers['lib-thumb']({}, kind, id), dir };
}

test('miniaturas de itens: embutido e .glb próprio pedem ao desenhista e ficam em cache', async () => {
  const asked = [];
  const { thumb } = setup(async (k) => (asked.push(k), PNG));
  assert.equal(await thumb('items', 'mug'), PNG);
  assert.equal(await thumb('items', 'mug'), PNG);
  assert.equal(await thumb('items', 'meu.glb'), PNG);
  assert.equal(await thumb('items', 'meu.glb'), PNG);
  assert.deepEqual(asked, ['mug', 'custom:meu.glb'], 'um pedido por item, não por clique');
});

test('miniaturas de itens: id desconhecido ou arquivo sumido não chega a pedir nada', async () => {
  const asked = [];
  const { thumb } = setup(async (k) => (asked.push(k), PNG));
  for (const bad of ['../../etc/passwd', 'nao-existe.glb', '', 'custom:meu.glb', undefined]) assert.equal(await thumb('items', bad), null, String(bad));
  assert.deepEqual(asked, []);
});

test('miniaturas de itens: falha não fica guardada (o painel tenta de novo) e erro vira null', async () => {
  let n = 0;
  const { thumb } = setup(async () => { n++; if (n === 1) return null; if (n === 2) throw new Error('boom'); return PNG; });
  assert.equal(await thumb('items', 'dice'), null);
  assert.equal(await thumb('items', 'dice'), null);
  assert.equal(await thumb('items', 'dice'), PNG);
  assert.equal(n, 3);
});

test('miniaturas: a lista de embutidos bate com items.js e com o painel', () => {
  const items = read('src', 'items.js');
  const makers = [...items.match(/const ITEM_MAKERS = \{([^}]*)\}/)[1].matchAll(/(\w+):/g)].map((m) => m[1]);
  assert.deepEqual([...BUILTIN_ITEMS].sort(), [...makers].sort());
});

test('miniaturas: ligação renderer, preload e main; só PNG volta e só da janela do avatar', () => {
  const r = read('src', 'renderer.js') + read('src', 'held-item.js'); // as miniaturas moram em held-item.js
  assert.match(r, /createItemThumbs\(THREE/);
  assert.match(r, /window\.api\.onItemThumb\(/);
  assert.match(r, /window\.api\.itemThumbDone\(id, url\)/);
  const pre = read('src', 'preload.js');
  assert.match(pre, /onItemThumb: .*'item-thumb'/);
  assert.match(pre, /itemThumbDone: .*'item-thumb-done'/);
  const m = read('src', 'main.js');
  assert.match(m, /secureIpcMain\.on\('item-thumb-done', \(e, id, url\) => \{\s*if \(!win \|\| win\.isDestroyed\(\) \|\| e\.sender !== win\.webContents\) return;/);
  assert.match(m, /\^data:image\\\/png;base64,/);
  assert.match(m, /registerLibraryIpc\(\{\s*renderItemThumb,/);
});

test('painel: itens em cartões com miniatura, detalhe e sub-abas; sem os cartões de emoji antigos', () => {
  const html = read('src', 'panel.html');
  const pane = html.slice(html.indexOf('id="tab-itens"'), html.indexOf('<!-- ABA EMOTES -->'));
  assert.match(pane, /<nav class="subtabs"/);
  for (const id of ['itemGrid', 'itemList', 'itemDetail', 'itemBuiltinCount', 'itemCount', 'itemAdd', 'itemFolder', 'itemStatus', 'itemAdjust', 'itemAdjHint', 'v-itemScale']) assert.match(pane, new RegExp(`id="${id}"`), id);
  assert.doesNotMatch(pane, /id="itemNow"/);
  const js = read('src', 'panel-library.js');
  assert.match(js, /panel\.libThumb\('items', id\)/);
  assert.doesNotMatch(js, /function itemTile/);
  for (const id of [...js.matchAll(/\$\('#(\w+)'\)/g)].map((x) => x[1])) assert.match(html, new RegExp(`id="${id}"`), 'falta #' + id);
});
