'use strict';
// Guardas do repositório: pegam cedo o que costuma quebrar o CI ou vazar segredo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('.gitattributes força LF (CSP e testes dependem dos bytes exatos)', () => {
  assert.match(read('.gitattributes'), /^\* text=auto eol=lf$/m);
});

test('index.html e scripts do app estão com LF (sem CRLF)', () => {
  for (const f of ['src/index.html', 'src/panel.html', 'src/main.js']) {
    if (!fs.existsSync(path.join(root, f))) continue;
    assert.ok(!read(f).includes('\r\n'), `${f} está com CRLF; rode: git add --renormalize .`);
  }
});

test('package-lock.json tem a mesma versão do package.json', () => {
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
});

test('CHANGELOG cita a versão atual', () => {
  assert.match(read('CHANGELOG.md'), new RegExp('^## ' + pkg.version.replace(/\./g, '\\.') + '\\b', 'm'));
});

test('config.example.json não traz chaves reais', () => {
  const cfg = JSON.parse(read('config.example.json'));
  const bad = [];
  (function walk(o, trail) {
    for (const [k, v] of Object.entries(o)) {
      if (v && typeof v === 'object') walk(v, trail + k + '.');
      else if (/key|token|secret|password/i.test(k) && typeof v === 'string' && v && !/^COLE|SUA|EXEMPLO|^$/i.test(v)) bad.push(trail + k);
    }
  })(cfg, '');
  assert.deepEqual(bad, [], 'possível chave real em config.example.json: ' + bad.join(', '));
});

test('.gitignore protege config.json, .env, node_modules e dist', () => {
  const gi = read('.gitignore');
  for (const item of ['config.json', '.env', 'node_modules/', 'dist/', 'src/vendor/']) {
    assert.ok(gi.split(/\r?\n/).includes(item), `.gitignore deve conter ${item}`);
  }
});

test('workflows de CI e release baixam o código com LF', () => {
  for (const f of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
    assert.match(read(f), /git config --global core\.autocrlf false/, `${f} precisa desligar o autocrlf antes do checkout`);
  }
});
