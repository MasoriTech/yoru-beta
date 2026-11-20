'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel.html'), 'utf8');

test('layout 0.59.0 define proporções consistentes e breakpoints responsivos', () => {
  assert.match(html, /yoru-layout-v0-58-2/);
  assert.match(html, /grid-template-columns:\s*repeat\(12,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(html, /@media\s*\(max-width:\s*1040px\)/);
  assert.match(html, /@media\s*\(max-width:\s*640px\)/);
});

test('abas Tapo têm quatro destinos distintos e controles proporcionais', () => {
  for (const key of ['control', 'colors', 'voice', 'connection']) {
    assert.match(html, new RegExp('data-tapo-tab="' + key + '"'));
    assert.match(html, new RegExp('data-tapo-pane="' + key + '"'));
  }
  assert.match(html, /#tab-hub \.tapo-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(html, /#tab-hub \.tapo-tab\s*\{[^}]*min-height:\s*46px/s);
});
