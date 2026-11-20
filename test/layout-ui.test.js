'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../src/panel.html'), 'utf8');
const core = fs.readFileSync(path.join(__dirname, '../src/panel-core.js'), 'utf8');
const settings = fs.readFileSync(path.join(__dirname, '../src/panel-settings.js'), 'utf8');

test('os três layouts possuem uma navegação completa e única', () => {
  const tabIds = [...html.matchAll(/class="tab(?: active)?"[^>]*data-tab="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(tabIds.length, 13);
  assert.equal(new Set(tabIds).size, tabIds.length);
  for (const id of tabIds) assert.ok(html.includes(`id="tab-${id}"`), `painel ausente: ${id}`);
  for (const id of ['floatdock', 'iconsidebar', 'discord']) assert.ok(html.includes(`data-layout="${id}"`));
});

test('Discord representa as quatro áreas e cada botão aponta para um grupo real', () => {
  const groups = ['pessoal', 'comunicacao', 'inteligencia', 'sistema'];
  for (const group of groups) {
    assert.match(html, new RegExp(`data-nav-group="${group}"`));
    assert.match(html, new RegExp(`data-group="${group}"`));
  }
  assert.equal([...html.matchAll(/class="server(?: active)?"[^>]*data-group=/g)].length, 4);
  assert.match(core, /setNavigationGroup\(group, true\)/);
  assert.match(core, /lastTabByGroup\.set\(group, t\.dataset\.tab\)/);
  assert.match(core, /lastTabByGroup\.get\(group\)/);
  assert.match(core, /group\.hidden = isDiscord && group\.dataset\.navGroup !== activeGroup/);
});

test('selecionar uma aba sincroniza grupo, ícone ativo e painel correspondente', () => {
  assert.match(core, /t\.closest\('\.nav-group'\)\?\.dataset\.navGroup/);
  assert.match(core, /p\.id === 'tab-' \+ t\.dataset\.tab/);
  assert.match(core, /aria-current/);
  assert.match(settings, /window\.applyNavigationLayout\(layout\)/);
});

test('Icon Sidebar não depende de tooltip pseudo-elemento que pode ser cortado', () => {
  assert.match(core, /t\.title = t\.dataset\.label/);
  assert.match(core, /t\.setAttribute\('aria-label', t\.dataset\.label\)/);
  assert.doesNotMatch(html, /body\[data-layout="iconsidebar"\] \.tab::after/);
});


test('Float Dock possui seletor de quatro bordas e botão de recolhimento sempre acessível', () => {
  for (const position of ['top', 'right', 'bottom', 'left']) {
    assert.match(html, new RegExp(`<option value="${position}">`));
    assert.match(html, new RegExp(`data-dock-position=\"${position}\"`));
  }
  assert.match(html, /id="dockSettings" hidden/);
  assert.match(html, /id="dockCollapse"[^>]*aria-expanded="true"/);
  assert.match(settings, /panelDockCollapsed: !state\.panelDockCollapsed/);
  assert.match(settings, /document\.body\.dataset\.dockCollapsed = String\(dockCollapsed\)/);
  assert.match(settings, /document\.body\.dataset\.dockPosition = dockPosition/);
  assert.match(html, /data-dock-collapsed="true"/);
});

test('Float Dock pode ser reposicionado pelo seletor e por arraste do símbolo Y', () => {
  assert.match(core, /Arraste o símbolo Y para mover o Float Dock/);
  assert.match(core, /\['top', y\], \['right', window\.innerWidth - x\]/);
  assert.match(core, /\['bottom', window\.innerHeight - y\], \['left', x\]/);
  assert.match(core, /panel\.set\(\{ panelDockPosition: edge \}\)/);
  assert.match(html, /data-key="panelDockPosition"/);
});

test('cada layout redefine o empilhamento móvel que conflita com o layout principal', () => {
  assert.match(html, /body\[data-layout="discord"\] \.app \{ display:grid;/);
  assert.match(html, /body\[data-layout="iconsidebar"\] \.app \{ display:grid;/);
  assert.match(html, /body\[data-layout="floatdock"\] \.app \{ display:block;/);
  assert.match(html, /body\[data-layout="discord"\] \.side \{[^}]*position:relative;/);
});


test('Float Dock tem acabamento visual premium e estados de interação para todas as orientações', () => {
  assert.match(html, /FLOAT DOCK v0\.60\.4/);
  assert.match(html, /backdrop-filter:blur\(30px\) saturate\(175%\)/);
  assert.match(html, /body\[data-layout="floatdock"\] \.tab:hover/);
  assert.match(html, /body\[data-layout="floatdock"\] \.tab\.active::after/);
  assert.match(html, /body\[data-layout="floatdock"\] \.dock-collapse:hover/);
  assert.match(html, /body\[data-layout="floatdock"\] \.brand:focus-visible/);
  assert.match(html, /body\[data-layout="floatdock"\] \.nav-group:last-child/);
  assert.match(html, /data-dock-position="left"\] \.tab.active::after/);
  assert.match(html, /data-dock-position="right"\] \.tab.active::after/);
});

test('Float Dock: botão de recolher continua absoluto dentro da barra e o recolhido volta a static', () => {
  assert.match(html, /body\[data-layout="floatdock"\] \.side > \.dock-collapse \{ position:absolute;/);
  assert.match(html, /\[data-dock-collapsed="true"\] \.side > \.dock-collapse \{ position:static; \}/);
  assert.match(html, /\.tabs \{ padding:7px 8px 9px; margin:-7px -8px -9px; \}/);
});

test('Float Dock mostra área de encaixe ao arrastar e Esc cancela', () => {
  assert.match(html, /class="dock-drop-hint" aria-hidden="true"/);
  assert.match(html, /data-dock-dragging="true"\] \.dock-drop-hint \{ display:block; \}/);
  for (const edge of ['top', 'right', 'bottom', 'left']) assert.match(html, new RegExp(`data-dock-target="${edge}"\\] \\.dock-drop-hint`));
  assert.match(core, /document\.body\.dataset\.dockTarget = nearestEdge\(event\)/);
  assert.match(core, /event\.key === 'Escape' && start/);
});

test('Float Dock tem navegação por setas e mantém a aba ativa visível', () => {
  assert.match(core, /ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1/);
  assert.match(core, /event\.key === 'Home'/);
  assert.match(core, /const revealActive = \(\) =>/);
  assert.match(core, /attributeFilter: \['class'\]/);
});

test('Icon Sidebar compacta em janelas baixas e esconde o texto do rodapé', () => {
  assert.match(html, /iconsidebar"\] \.side-foot > \* \{ display:none; \}/);
  assert.match(html, /@media \(max-height:880px\)/);
  assert.match(html, /@media \(max-height:700px\)/);
});


test('aba Perfil usa ícone de pessoa e Float Dock é o layout inicial padrão', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/panel.html'), 'utf8');
  const settings = require('../src/settings');
  assert.ok(html.includes('<button class="tab" data-tab="perfil"><i aria-hidden="true">👤</i>Perfil</button>'));
  assert.equal(settings.DEFAULTS.panelLayout, 'floatdock');
});
