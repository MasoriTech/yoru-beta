'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const W = require('../src/masori-workspace');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-masori-workspace-'));
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'README.md'), '# Projeto\nConteúdo de teste.');
  fs.writeFileSync(path.join(dir, 'src', 'main.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(dir, 'image.png'), Buffer.from([137, 80, 78, 71]));
  fs.writeFileSync(path.join(dir, 'secrets.txt'), 'do not expose');
  fs.writeFileSync(path.join(dir, '.env.local'), 'API_KEY=secret');
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules', 'secret.js'), 'não listar');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('workspace lista apenas pastas e arquivos de texto permitidos', (t) => {
  const dir = fixture(t); const result = W.list(dir);
  assert.ok(result.entries.some((e) => e.relativePath === 'src' && e.type === 'directory'));
  assert.ok(result.entries.some((e) => e.relativePath === 'README.md' && e.type === 'file'));
  assert.ok(!result.entries.some((e) => /image|node_modules|secrets|\.env/.test(e.relativePath)));
});

test('workspace lê arquivos de texto dentro da pasta escolhida', (t) => {
  const dir = fixture(t); const result = W.read(dir, 'src/main.js');
  assert.match(result.text, /console\.log/);
  assert.throws(() => W.read(dir, '../outside.txt'), /bloqueado|inválido/i);
  assert.throws(() => W.read(dir, 'image.png'), /tipo de arquivo/i);
  assert.throws(() => W.read(dir, 'secrets.txt'), /tipo de arquivo/i);
});

test('workspace impede traversal e bloqueia diretórios sensíveis', (t) => {
  const dir = fixture(t);
  assert.throws(() => W.list(dir, '..'), /bloqueado|inválido/i);
  assert.throws(() => W.list(dir, 'node_modules'), /bloqueado/i);
  assert.throws(() => W.read(dir, '/etc/passwd'), /inválido/i);
});

test('workspace recusa symlink mesmo quando aponta para dentro ou fora', (t) => {
  const dir = fixture(t);
  const outside = path.join(os.tmpdir(), `yoru-workspace-out-${Date.now()}.txt`);
  fs.writeFileSync(outside, 'privado');
  t.after(() => fs.rmSync(outside, { force: true }));
  try {
    fs.symlinkSync(outside, path.join(dir, 'linked.txt'));
    assert.throws(() => W.read(dir, 'linked.txt'));
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOTSUP') return;
    throw error;
  }
});

test('buildContext limita arquivos e conteúdo e retorna paths utilizados', (t) => {
  const dir = fixture(t);
  const result = W.buildContext(dir, ['README.md', 'src/main.js', 'README.md']);
  assert.deepEqual(result.files, ['README.md', 'src/main.js']);
  assert.match(result.text, /ARQUIVO: README.md/);
  assert.match(result.text, /console\.log/);
});

test('workspace pesquisa texto em arquivos do projeto sem entrar em pastas bloqueadas', (t) => {
  const dir = fixture(t);
  const result = W.search(dir, 'console.log');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].relativePath, 'src/main.js');
  assert.ok(result.scanned >= 1);
  assert.throws(() => W.search(dir, 'x'), /dois caracteres/i);
});
