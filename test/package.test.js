'use strict';
// Garante que o pacote do programa está coerente (versão, ícone, e que segredos não entram no instalador).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mainSource = require('./helpers/main-source');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('versão no formato x.y.z e igual à do README', () => {
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(readme.startsWith(`# Yoru v${pkg.version}`), 'título do README deve citar a versão do package.json');
});

test('o arquivo principal e os ícones existem', () => {
  assert.ok(fs.existsSync(path.join(root, pkg.main)));
  assert.ok(fs.existsSync(path.join(root, pkg.build.win.icon)));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'tray.png')));
});

test('o instalador só leva o necessário (sem config.json, testes nem .userdata)', () => {
  const files = pkg.build.files;
  assert.ok(files.includes('src/**/*') && files.includes('assets/**/*') && files.includes('scripts/**/*'));
  for (const f of files.filter((x) => !x.startsWith('!'))) {
    assert.ok(!/config\.json$|test|userdata/.test(f.replace('config.example.json', '')), 'não deve empacotar: ' + f);
  }
});

test('electron-builder está configurado para Windows (instalador e portátil)', () => {
  const targets = pkg.build.win.target.map((t) => (typeof t === 'string' ? t : t.target));
  assert.deepEqual(targets.sort(), ['nsis', 'portable']);
  assert.equal(pkg.build.appId, 'com.yoru.app');
  assert.ok(pkg.devDependencies['electron-builder']);
});

test('app instalado grava dados e config fora da pasta do programa', () => {
  const main = mainSource();
  assert.match(main, /if \(app\.isPackaged\) \{[\s\S]*app\.getPath\('userData'\)/);
  assert.match(main, /CONFIG_FILE = app\.isPackaged \? path\.join\(app\.getPath\('userData'\), 'config\.json'\)/);
});

test('balão de fala vem desativado por padrão (no app e no avatar)', () => {
  const main = mainSource();
  const rend = fs.readFileSync(path.join(root, 'src', 'settings-defaults.js'), 'utf8'); // os padrões do avatar moram em settings-defaults.js
  assert.match(main, /^  bubbleEnabled: false,/m);
  assert.match(rend, /bubbleEnabled: false, typeAnimation/);
});

test('tela de primeiro lançamento e arquivos do instalador existem', () => {
  for (const f of ['src/welcome.html', 'src/welcome-preload.js', 'build/license.txt', 'build/installerSidebar.bmp', 'build/installerHeader.bmp']) {
    assert.ok(fs.existsSync(path.join(root, f)), 'falta ' + f);
  }
  const html = fs.readFileSync(path.join(root, 'src', 'welcome.html'), 'utf8');
  for (const tab of ['perfil', 'ia', 'voz', 'avatar']) assert.match(html, new RegExp(`data-tab="${tab}"`));
  assert.equal(pkg.build.nsis.license, 'build/license.txt');
  assert.equal(pkg.build.nsis.runAfterFinish, true);
});

test('o avatar usa src/vendor como caminho principal e node_modules como backup (electron-builder descarta "examples")', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'index.html'), 'utf8');
  const main = html.indexOf('./vendor/three/three.module.js');
  const backup = html.indexOf('../node_modules/three/build/three.module.js');
  assert.ok(main > 0 && backup > main, 'o principal (vendor) deve vir antes do backup (node_modules)');
  assert.ok(html.indexOf('type = \'importmap\'') > backup, 'o importmap é montado depois de escolher o caminho');
  assert.ok(html.indexOf('renderer.js') > html.indexOf('importmap'), 'renderer.js carrega depois do importmap');
  const vendor = fs.readFileSync(path.join(root, 'scripts', 'vendor.js'), 'utf8');
  for (const needed of ['GLTFLoader.js', 'three.core.js', 'three-vrm.module.js']) assert.match(vendor, new RegExp(needed.replace('.', '\\.')));
  assert.equal(pkg.scripts.postinstall, 'node scripts/vendor.js');
  for (const s of ['pack', 'dist', 'dist:setup', 'dist:portable']) assert.match(pkg.scripts[s], /scripts\/vendor\.js/, s + ' deve rodar o vendor antes do electron-builder');
});

test('boas-vindas: ícones em SVG (emoji some em alguns Windows) e todos os atalhos continuam', () => {
  const html = fs.readFileSync(path.join(root, 'src', 'welcome.html'), 'utf8');
  const cards = [...html.matchAll(/<button class="card"[^>]*>([\s\S]*?)<\/button>/g)];
  assert.equal(cards.length, 4);
  for (const c of cards) assert.match(c[1], /<svg/, 'cada cartão tem ícone SVG');
  assert.match(html, /id="go"/);
  assert.match(html, /Francisca/);
});

test('main.js: nenhum pedido do painel usa a janela do avatar sem checar se ela ainda existe ("Object has been destroyed")', () => {
  const src = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(src, /const alive = \(\) =>/);
  assert.match(src, /const toAvatar = /);
  // estes pedidos vêm do painel e podem chegar com o avatar já fechado
  for (const bad of [
    /secureIpcMain\.on\('panel-action'[\s\S]{0,700}?\n\s*if \(name === '(emote|speak-test|stop-speak)'\) win\.webContents/,
    /secureIpcMain\.on\('set-ignore', \(_e, ignore\) =>\s*\n\s*win\./,
    /secureIpcMain\.handle\('get-pos', \(\) => win\./,
    /click: \(\) => win\.webContents\.send/,
  ]) assert.doesNotMatch(src, bad);
  assert.match(src, /uncaughtException/);
});

test('main.js/movement.js: redimensionar com a janela do avatar fechada não derruba o app e não sobram nomes não usados', () => {
  const mv = fs.readFileSync(path.join(root, 'src', 'movement.js'), 'utf8');
  assert.match(mv, /function applyScale\(scale\) \{[\s\S]{0,160}if \(!win \|\| win\.isDestroyed\(\)\) return;/);
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.doesNotMatch(main, /THEME_BG|\{ PROVIDERS, realKey \}/);
});

test('main.js: segunda instância não cria janelas, arquivos importantes não se perdem e dados funcionam no 2D', () => {
  const m = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  assert.match(m, /const gotLock = app\.requestSingleInstanceLock\(\)/);
  assert.match(m, /app\.whenReady\(\)\.then\(\(\) => \{\n\s*if \(!gotLock\) return;/);
  assert.match(m, /settingsFile\(\) \+ '\.bad'/, 'settings ilegível ganha cópia .bad');
  assert.match(m, /STORE\.writeAtomic\(CONFIG_FILE/, 'config.json (chave da IA) gravado de forma atômica');
  assert.doesNotMatch(m, /fs\.writeFileSync\(CONFIG_FILE/);
  assert.match(m, /settings\.avatarMode === '2d'[\s\S]{0,200}voice\.say\(/, 'dados no 2D falam o resultado');
  assert.match(m, /firstRunDone: settings\.firstRunDone/, 'restaurar padrões não reabre a tela de boas-vindas');
  assert.match(m, /avatarMode: settings\.avatarMode/, 'restaurar padrões mantém 2D/3D');
  assert.match(m, /unhandledRejection/);
  // todo envio ao avatar passa por toAvatar (ou é o envio protegido do próprio helper)
  const sends = m.split('\n').filter((l) => /win\.webContents\.send\(/.test(l) && !/const toAvatar/.test(l));
  for (const l of sends) if (!/'(toggle-chat|item-thumb|cursor-pos)'/.test(l)) assert.match(l, /alive\(\)|isDestroyed\(\)|!win \|\|/, 'envio sem proteção: ' + l.trim()); // toggle-chat, item-thumb e cursor-pos: a checagem está na linha de cima
});


test('mega upgrade inclui logger local, exportação pelo painel e diagnóstico ampliado', () => {
  assert.ok(fs.existsSync(path.join(root, 'src', 'logger.js')));
  const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'src', 'panel-preload.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'src', 'panel.html'), 'utf8');
  assert.match(main, /createLogger\(/);
  assert.match(main, /app-logs-export/);
  assert.match(preload, /appLogsExport/);
  assert.match(html, /id="healthLogs"/);
  assert.match(html, /id="healthLogsStatus"/);
  assert.equal(pkg.engines.node, '>=20');
});
