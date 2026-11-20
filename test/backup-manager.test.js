'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBackup, restoreBackup } = require('../src/backup-manager');

test('backup exporta dados permitidos e restaura arquivos sem cache/modelos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-'));
  const out = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-out-'));
  const cfg = path.join(root, 'config.json');
  await fs.mkdir(path.join(root, 'avatars'), { recursive: true });
  await fs.mkdir(path.join(root, 'models'), { recursive: true });
  await fs.writeFile(path.join(root, 'settings.json'), '{"visible":true}');
  await fs.writeFile(path.join(root, 'avatars', 'a.vrm'), Buffer.from('glTF-avatar'));
  await fs.writeFile(path.join(root, 'models', 'large.bin'), 'não incluir');
  await fs.writeFile(cfg, '{"provider":"ollama"}');
  const backup = await createBackup({ userDataDir: root, configFile: cfg });
  const doc = JSON.parse(backup.toString());
  assert.ok(doc.files.some((f) => f.path === 'settings.json'));
  assert.ok(doc.files.some((f) => f.path === 'avatars/a.vrm'));
  assert.ok(doc.files.some((f) => f.path === 'config.json'));
  assert.ok(!doc.files.some((f) => f.path.includes('models')));
  await fs.writeFile(path.join(root, 'settings.json'), 'alterado');
  const result = await restoreBackup({ buffer: backup, userDataDir: root, configFile: cfg });
  assert.ok(result.restored >= 3);
  assert.equal(await fs.readFile(path.join(root, 'settings.json'), 'utf8'), '{"visible":true}');
  assert.equal(await fs.readFile(cfg, 'utf8'), '{"provider":"ollama"}');
});

test('backup rejeita formato inválido e ignora caminhos fora da lista permitida', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-safe-'));
  await assert.rejects(() => restoreBackup({ buffer: Buffer.from('{}'), userDataDir: root }), /Formato/);
  const evil = Buffer.from(JSON.stringify({ format: 'YORU_BACKUP', version: 1, files: [{ path: '../../escape.txt', data: Buffer.from('x').toString('base64') }] }));
  await assert.rejects(() => restoreBackup({ buffer: evil, userDataDir: root }), /tentativa de sair|Nenhum arquivo válido/);
});

test('restauração não segue links simbólicos para fora da pasta de dados', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-link-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-outside-'));
  try { await fs.symlink(outside, path.join(root, 'avatars'), 'junction'); }
  catch (e) { t.skip('links simbólicos indisponíveis neste ambiente'); return; }
  const payload = Buffer.from(JSON.stringify({ format: 'YORU_BACKUP', version: 1, files: [{ path: 'avatars/evil.vrm', data: Buffer.from('glTF').toString('base64') }] }));
  await assert.rejects(() => restoreBackup({ buffer: payload, userDataDir: root }), /simbólico/);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('restauração reverte os arquivos anteriores quando uma etapa de gravação falha', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-rollback-'));
  const originalRename = fs.rename;
  try {
    await fs.writeFile(path.join(root, 'settings.json'), 'configuração atual');
    await fs.writeFile(path.join(root, 'profile.json'), 'perfil atual');
    const payload = Buffer.from(JSON.stringify({
      format: 'YORU_BACKUP', version: 1, createdAt: '2026-11-15T00:00:00.000Z',
      files: [
        { path: 'settings.json', data: Buffer.from('configuração do backup').toString('base64') },
        { path: 'profile.json', data: Buffer.from('perfil do backup').toString('base64') },
      ],
    }));
    let failed = false;
    fs.rename = async (from, to) => {
      if (!failed && String(from).includes('.yoru-stage-') && String(to).endsWith('profile.json')) {
        failed = true;
        const error = new Error('Falha simulada de disco'); error.code = 'EIO'; throw error;
      }
      return originalRename(from, to);
    };
    await assert.rejects(() => restoreBackup({ buffer: payload, userDataDir: root }), /Falha simulada/);
    assert.equal(await fs.readFile(path.join(root, 'settings.json'), 'utf8'), 'configuração atual');
    assert.equal(await fs.readFile(path.join(root, 'profile.json'), 'utf8'), 'perfil atual');
    assert.equal((await fs.readdir(root)).some((name) => /yoru-(?:stage|rollback)-/.test(name)), false);
  } finally {
    fs.rename = originalRename;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('backup recusa caminhos com traversal mesmo quando misturados a arquivos válidos', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-path-'));
  try {
    const payload = Buffer.from(JSON.stringify({ format: 'YORU_BACKUP', version: 1, files: [
      { path: 'settings.json', data: Buffer.from('{}').toString('base64') },
      { path: 'avatars/../../escape.json', data: Buffer.from('x').toString('base64') },
    ] }));
    await assert.rejects(() => restoreBackup({ buffer: payload, userDataDir: root }), /sair da pasta/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('backup não segue diretórios simbólicos que apontem para fora da pasta de dados', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-root-link-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-root-out-'));
  try {
    await fs.writeFile(path.join(outside, 'private.vrm'), 'não incluir');
    try { await fs.symlink(outside, path.join(root, 'avatars'), 'junction'); }
    catch (error) { t.skip(`links simbólicos indisponíveis: ${error.message}`); return; }
    const backup = await createBackup({ userDataDir: root });
    const doc = JSON.parse(backup.toString());
    assert.equal(doc.files.some((item) => item.path.startsWith('avatars/')), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test('backup rejeita nomes reservados ou inválidos no Windows', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yoru-backup-name-'));
  try {
    const payload = Buffer.from(JSON.stringify({ format: 'YORU_BACKUP', version: 1, files: [
      { path: 'avatars/CON.vrm', data: Buffer.from('x').toString('base64') },
    ] }));
    await assert.rejects(() => restoreBackup({ buffer: payload, userDataDir: root }), /nome de arquivo inválido/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
