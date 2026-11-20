'use strict';
// Os botões de ação da Conectividade são controles HTML nativos e não devem submeter formulários.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('botões criados dinamicamente no painel Hub declaram type=button', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel-hub.js'), 'utf8');
  assert.equal((js.match(/document\.createElement\(['"]button['"]\)/g) || []).length, (js.match(/Object\.assign\(document\.createElement\(['"]button['"]\)/g) || []).length);
  assert.match(js, /Object\.assign\(document\.createElement\(['"]button['"]\),\s*\{\s*type:\s*['"]button['"]\s*\}\)/);
});

test('ações do gerador QR declaram type=button no HTML', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel.html'), 'utf8');
  for (const id of ['hubQrPng', 'hubQrSvg', 'hubQrCopy']) {
    assert.match(html, new RegExp(`<button\\s+type="button"[^>]*id="${id}"`));
  }
});
