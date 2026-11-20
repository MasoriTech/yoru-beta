'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CSP = require('../scripts/csp-hashes');

const SRC = path.join(__dirname, '..', 'src');
const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');
const HTMLS = ['index.html', 'panel.html', 'welcome.html', 'crack.html', 'hand.html'];
const policyOf = (html) => (html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1];
const directive = (pol, name) => (pol.split(';').map((s) => s.trim()).find((s) => s.startsWith(name + ' ')) || '');

test('toda janela do app carrega com Content-Security-Policy restritiva', () => {
  for (const f of HTMLS) {
    const pol = policyOf(read(f));
    assert.ok(pol, `${f} sem CSP`);
    assert.match(pol, /default-src 'none'/, f);
    assert.match(pol, /object-src 'none'/, f);
    assert.match(pol, /base-uri 'none'/, f);
    assert.doesNotMatch(directive(pol, 'script-src'), /unsafe-inline|'unsafe-eval'/, `${f}: script-src não pode ter unsafe-*`); // 'wasm-unsafe-eval' (só WebAssembly) é outra coisa
    assert.doesNotMatch(pol, /https?:|\*/, `${f}: a CSP não deve liberar origens remotas nem curinga`);
  }
});

test('painel, boas-vindas e vidro não têm script inline nem manipulador inline (onclick=...)', () => {
  for (const f of ['panel.html', 'welcome.html', 'crack.html', 'hand.html']) {
    const html = read(f);
    assert.deepEqual(CSP.inlineScripts(html), [], `${f} tem <script> inline`);
    assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, `${f} tem manipulador de evento inline`);
    for (const m of html.matchAll(/<script src="\.\/([\w.-]+)"/g)) assert.ok(fs.existsSync(path.join(SRC, m[1])), `${f}: falta ${m[1]}`);
  }
});

test('index.html: os hashes da CSP batem com os scripts inline e com o importmap (rode: node scripts/csp-hashes.js --write)', () => {
  const html = read('index.html');
  assert.equal(policyOf(html), CSP.policy(html));
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i);
  assert.equal(CSP.importMaps(CSP.inlineScripts(html).find((s) => s.includes('importmap'))).length, 2, 'um importmap por caminho (vendor e node_modules)');
});

test('o painel só precisa de blob: (AudioWorklet da voz) e wasm (MediaPipe dos gestos) em script-src e não fala com a internet', () => {
  const pol = policyOf(read('panel.html'));
  assert.equal(directive(pol, 'script-src'), "script-src 'self' blob: 'wasm-unsafe-eval'");
  assert.doesNotMatch(directive(pol, 'connect-src'), /https?:/);
  assert.match(read('voice-panel.js'), /createObjectURL\(new Blob\(\[WORKLET\]/);
});
