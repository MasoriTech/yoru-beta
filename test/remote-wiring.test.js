'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', ...p), 'utf8');
const CHANNELS = ['remote-status', 'remote-set', 'remote-new-pairing', 'remote-revoke', 'remote-revoke-all', 'remote-set-password', 'remote-clear-password'];

test('celular: main, preload e painel usam os mesmos canais IPC (e só o painel pode chamar)', () => {
  const main = src('main.js');
  const pre = src('panel-preload.js');
  assert.match(main, /require\('\.\/remote-server'\)/);
  for (const ch of CHANNELS) {
    assert.ok(new RegExp(`secureIpcMain\\.handle\\('${ch}', .*fromPanel\\(e\\)`).test(main) || main.includes(`'${ch}', async (e`), `main trata ${ch} só para o painel`);
    assert.ok(pre.includes(`'${ch}'`), `preload expõe ${ch}`);
  }
  assert.ok(pre.includes("ipcRenderer.on('remote-event'") && main.includes("broadcastPanels('remote-event'"));
  assert.match(src('ipc-security.js'), /'remote-set-password': \{ count: 6/);
  const handlerBlock = main.slice(main.indexOf("secureIpcMain.handle('remote-set'"), main.indexOf("secureIpcMain.handle('remote-new-pairing'"));
  assert.match(handlerBlock, /if \(!fromPanel\(e\)\) return DENIED/);
});

test('PWA: normaliza e valida código de pareamento de 8 dígitos', () => {
  const js = src('remote/app.js');
  assert.match(js, /String\(code \|\| ''\)\.replace\(\/\\D\/g, ''\)/);
  assert.match(js, /!\/\^\\d\{8\}\$\/\.test\(normalizedCode\)/);
});

test('celular: a senha só é definida no PC (nenhuma rota HTTP altera senha, porta ou aparelhos)', () => {
  const server = src('remote-server.js');
  const routes = [...server.matchAll(/p === '(\/api\/[\w/]+)'/g)].map((m) => m[1]);
  assert.ok(routes.length >= 8);
  for (const r of routes) assert.ok(!/password|senha|config|device|revoke|pair\/new/i.test(r.replace('/api/pair', '').replace('/api/control/unlock', '')), `rota suspeita: ${r}`);
  assert.ok(!/child_process|\beval\(|new Function|require\('node:vm'\)/.test(server), 'o servidor não executa comandos livres');
  const { ACTIONS_LIST } = require('../src/remote-server');
  const declared = [...server.slice(server.indexOf('const ACTIONS = {')).matchAll(/^    (\w+): async/gm)].map((m) => m[1]);
  assert.deepEqual(declared.sort(), [...ACTIONS_LIST].sort(), 'lista de ações pública = lista implementada');
});

test('celular: o painel tem a aba e todos os elementos que o script usa', () => {
  const html = src('panel.html');
  const js = src('panel-remote.js');
  assert.ok(html.includes('<script src="./panel-remote.js"></script>'));
  assert.ok(html.includes('data-tab="celular"') && html.includes('id="tab-celular"'), 'aba Celular no dock');
  for (const sub of ['conectar', 'controle', 'fora']) assert.ok(html.includes(`data-sub="${sub}" class="card span2"`), `cards de ${sub}`);
  const ids = new Set([...js.matchAll(/\$\('(rm\w+)'\)/g)].map((m) => m[1]));
  assert.ok(ids.size >= 15);
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `falta #${id} no panel.html`);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(js), 'painel monta tudo por DOM seguro');
});

test('celular: o PWA é compatível com CSP estrita (sem script/estilo inline, sem innerHTML, sem eval)', () => {
  const html = src('remote', 'index.html');
  assert.ok(!/<script(?![^>]*\bsrc=)/i.test(html), 'sem <script> inline');
  assert.ok(!/\sstyle=/i.test(html) && !/<style/i.test(html), 'sem estilo inline');
  assert.ok(!/\son\w+=/i.test(html), 'sem handlers inline');
  assert.match(html, /rel="manifest"/); assert.match(html, /apple-touch-icon/); assert.match(html, /viewport-fit=cover/);
  const app = src('remote', 'app.js');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(app), 'texto da IA/PC entra só por textContent');
  const sw = src('remote', 'sw.js');
  assert.match(sw, /pathname\.startsWith\('\/api\/'\)\) return/, 'o service worker nunca guarda a API');
  assert.match(sw, /__BUILD__/);
});

test('celular: manifesto e ícones são válidos', () => {
  const m = JSON.parse(src('remote', 'manifest.webmanifest'));
  assert.equal(m.display, 'standalone'); assert.equal(m.start_url, '/'); assert.ok(m.icons.some((i) => i.purpose === 'maskable'));
  const sizeOf = (f) => { const b = fs.readFileSync(path.join(__dirname, '..', 'src', 'remote', f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  for (const i of m.icons) { const [w, h] = sizeOf(i.src.slice(1)); assert.equal(`${w}x${h}`, i.sizes); }
  assert.deepEqual(sizeOf('apple-touch-icon.png'), [180, 180]);
});

test('celular: o backup nunca inclui remote.json (tokens e hash da senha)', () => {
  const backup = src('backup-manager.js');
  assert.ok(!backup.includes('remote.json'));
  assert.match(backup, /ALLOWED_ROOT_FILES = new Set\(\[/);
});

test('celular: o cartão Fora de casa guia o Tailscale (comando, detecção e endereço HTTPS só .ts.net)', () => {
  const html = src('panel.html');
  const js = src('panel-remote.js');
  for (const id of ['rmTsState', 'rmTsCmd', 'rmTsCopyCmd', 'rmTsLanOff', 'rmTsUrl', 'rmTsSave', 'rmTsPick', 'rmTsMsg']) assert.ok(html.includes(`id="${id}"`), `falta #${id}`);
  assert.ok(js.includes('tailscale serve --bg ${s.port}'), 'comando usa a porta configurada');
  const m = js.match(/const TS_RE = (\/.*\/i);/);
  assert.ok(m, 'validador do endereço HTTPS existe');
  const re = eval(m[1]); // eslint-disable-line no-eval -- regex literal lida do próprio código-fonte
  assert.ok(re.test('https://meu-pc.tail1234.ts.net'));
  for (const bad of ['http://meu-pc.tail1234.ts.net', 'https://evil.com', 'https://x.ts.net.evil.com', 'https://x.ts.net:8443', 'https://x.ts.net/abc', 'https://ts.net.evil.com']) assert.ok(!re.test(bad), bad);
});

test('celular: a tela de configurações tem todos os controles que o script usa e guarda só no aparelho', () => {
  const html = src('remote', 'index.html');
  const app = src('remote', 'app.js');
  for (const k of ['speak', 'auto', 'avatarPc', 'av3d', 'keepAwake', 'haptic', 'voice', 'rate', 'pitch', 'lang', 'quality', 'fs']) assert.ok(html.includes(`id="cfg-${k}"`), `falta #cfg-${k}`);
  for (const id of ['settings', 'btn-settings', 'set-close', 'set-test', 'set-reset', 'set-clear', 'set-logout']) assert.ok(html.includes(`id="${id}"`), `falta #${id}`);
  const ids = new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `app.js usa #${id}, que não existe no HTML`);
  assert.match(app, /const SET_KEY = 'yoru\.settings'/);
  assert.ok(!/password|token|senha/i.test(app.slice(app.indexOf('const DEF ='), app.indexOf('let cfg = DEF'))), 'configurações nunca guardam senha/token');
});
