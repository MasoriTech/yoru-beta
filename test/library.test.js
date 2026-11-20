'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const L = require('../src/library');

function env() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-lib-'));
  const userData = path.join(root, 'user'), assets = path.join(root, 'assets');
  fs.mkdirSync(path.join(assets, 'library', 'avatars'), { recursive: true });
  fs.mkdirSync(path.join(assets, 'library', 'items'), { recursive: true });
  const lib = L.createLibrary({ userDataDir: () => userData, assetsDir: assets });
  return { root, userData, assets, lib };
}

test('regras de nome: só nomes simples, sem barras nem pontos de subida', () => {
  for (const ok of ['Noelle.vrm', 'meu avatar (2).glb', 'a_b-c.d.vrm']) assert.ok(L.LIB_NAME.test(ok), ok);
  for (const bad of ['../x.vrm', 'a/b.vrm', 'a\\b.vrm', '', 'x'.repeat(121), 'a:b.vrm']) assert.equal(L.LIB_NAME.test(bad), false, bad);
  assert.ok(L.LIB.avatars.ext.test('A.VRM') && L.LIB.avatars.ext.test('b.glb') && !L.LIB.avatars.ext.test('c.png'));
  assert.ok(L.LIB.items.ext.test('k.glb') && !L.LIB.items.ext.test('k.vrm'));
});

test('libList lista só as extensões da pasta, com nome legível e ordem alfabética', () => {
  const { lib, userData } = env();
  lib.libDir('avatars');
  fs.writeFileSync(path.join(userData, 'avatars', 'zeta_um.vrm'), 'x');
  fs.writeFileSync(path.join(userData, 'avatars', 'Alfa.glb'), 'xx');
  fs.writeFileSync(path.join(userData, 'avatars', 'nota.txt'), 'x');
  const l = lib.libList('avatars');
  assert.deepEqual(l.map((a) => a.name), ['Alfa', 'zeta um']);
  assert.deepEqual(l.map((a) => a.ext), ['glb', 'vrm']);
  assert.deepEqual(lib.libList('items'), []);
});

test('libPath só devolve arquivo que existe e nome válido (sem escapar da pasta)', () => {
  const { lib, userData } = env();
  fs.mkdirSync(path.join(userData, 'avatars'), { recursive: true });
  fs.writeFileSync(path.join(userData, 'avatars', 'ok.vrm'), 'x');
  assert.equal(lib.libPath('avatars', 'ok.vrm'), path.join(userData, 'avatars', 'ok.vrm'));
  assert.equal(lib.libPath('avatars', 'falta.vrm'), null);
  assert.equal(lib.libPath('avatars', '../ok.vrm'), null);
  assert.equal(lib.libPath('avatars', 'ok.png'), null);
  assert.equal(lib.libPath('nada', 'ok.vrm'), null);
  assert.equal(lib.libPath('avatars', 5), null);
});

test('libSeed copia os modelos do projeto uma vez e não traz de volta o que o usuário apagou', () => {
  const { lib, userData, assets } = env();
  fs.writeFileSync(path.join(assets, 'library', 'avatars', 'Noelle.vrm'), 'A');
  fs.writeFileSync(path.join(assets, 'library', 'items', 'Katana.glb'), 'K');
  fs.writeFileSync(path.join(assets, 'library', 'items', 'ruim.png'), 'x');
  lib.libSeed();
  assert.deepEqual(lib.libAll().avatars.map((a) => a.id), ['Noelle.vrm']);
  assert.deepEqual(lib.libAll().items.map((a) => a.id), ['Katana.glb']);
  fs.unlinkSync(path.join(userData, 'avatars', 'Noelle.vrm')); // o usuário apagou
  lib.libSeed();
  assert.deepEqual(lib.libAll().avatars, []);
});

test('libSeed sem a pasta de assets não dá erro', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-lib-'));
  const lib = L.createLibrary({ userDataDir: () => path.join(root, 'u'), assetsDir: path.join(root, 'nao-existe') });
  assert.doesNotThrow(() => lib.libSeed());
  assert.deepEqual(lib.libAll(), { avatars: [], items: [] });
});

test('uniqueName limpa o nome e numera quando já existe', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-un-'));
  assert.equal(L.uniqueName(dir, 'Meu Modelo.VRM'), 'Meu Modelo.vrm');
  fs.writeFileSync(path.join(dir, 'Meu Modelo.vrm'), 'x');
  assert.equal(L.uniqueName(dir, 'Meu Modelo.vrm'), 'Meu Modelo (2).vrm');
  fs.writeFileSync(path.join(dir, 'Meu Modelo (2).vrm'), 'x');
  assert.equal(L.uniqueName(dir, 'Meu Modelo.vrm'), 'Meu Modelo (3).vrm');
  assert.equal(L.uniqueName(dir, 'a/b:c*.glb'), 'a_b_c_.glb');
});
