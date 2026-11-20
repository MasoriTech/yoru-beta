'use strict';
// Barra de título própria do painel (Windows): cores do tema para os botões do sistema e CSS da barra.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PANEL_THEMES, THEME_BAR } = require('../src/settings');

const html = fs.readFileSync(path.join(__dirname, '../src/panel.html'), 'utf8');
const boot = fs.readFileSync(path.join(__dirname, '../src/panel-boot.js'), 'utf8');

test('THEME_BAR tem todos os temas (menos "auto") e as cores batem com --side/--text do panel.html', () => {
  for (const t of PANEL_THEMES.filter((x) => x !== 'auto')) {
    const bar = THEME_BAR[t];
    assert.ok(bar, `tema ${t} sem cor de barra`);
    const rule = t === 'dark' ? html.match(/:root \{ --bg:#140f1c;[^}]*\}/)[0] : html.match(new RegExp(`:root\\[data-theme="${t}"\\] \\{[^}]*\\}`))[0];
    const side = rule.match(/--side:\s*(#[0-9a-f]{3,6})/i)[1];
    const expand = (c) => (c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c).toLowerCase();
    assert.equal(bar.color.toLowerCase(), expand(side), `${t}: fundo da barra deve ser o --side`);
    assert.match(bar.symbol, /^#[0-9a-f]{6}$/i);
  }
});

test('a classe do <html> não colide com a da barra (um ".tb" escondia a página inteira)', () => {
  assert.match(boot, /classList\.add\('has-tb'\)/);
  assert.match(html, /<div class="titlebar"/);
  assert.match(html, /:root\.has-tb \.titlebar \{ display:flex/);
  assert.doesNotMatch(html, /(^|\s)\.tb\s*\{/m);   // seletor ".tb" pegaria o próprio <html class="tb">
});

test('a altura do painel desconta a barra de título', () => {
  assert.match(html, /\.app \{[^}]*height:calc\(100vh - var\(--tbh\)\)/);
  assert.match(html, /#tab-chat\.active \{[^}]*calc\(100vh - 48px - var\(--tbh\)\)/);
});
