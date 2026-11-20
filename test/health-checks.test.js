'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHealthChecks } = require('../src/health-checks');

test('central de saúde retorna resumo, verificações locais e não expõe segredos', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-health-'));
  try {
    const run = createHealthChecks({ app: { getName: () => 'Yoru', getVersion: () => '0.17.0', getPath: () => dir }, os, processRef: process, userDataDir: dir, rootDir: path.join(__dirname, '..', 'src') });
    const result = await run();
    assert.equal(result.app, 'Yoru');
    assert.equal(result.version, '0.17.0');
    assert.ok(['ok', 'warning', 'attention'].includes(result.summary));
    assert.ok(result.checks.some((x) => x.id === 'userdata' && x.status === 'ok'));
    assert.ok(result.checks.some((x) => x.id === 'runtime'));
    assert.ok(result.checks.some((x) => x.id === 'dep:three'));
    assert.equal(JSON.stringify(result).includes('apiKey'), false);
    assert.equal(result.counts.error, result.checks.filter((x) => x.status === 'error').length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('central de saúde sinaliza pasta de dados sem permissão', async () => {
  const run = createHealthChecks({ app: { getName: () => 'Yoru', getVersion: () => '0.17.0', getPath: () => '/path/does/not/exist' }, os, userDataDir: '/path/does/not/exist', rootDir: path.join(__dirname, '..', 'src') });
  const result = await run();
  assert.equal(result.checks.find((x) => x.id === 'userdata').status, 'error');
  assert.equal(result.summary, 'attention');
});

test('central de saúde verifica recursos essenciais e espaço em disco quando suportado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-health-extra-'));
  try {
    const root = path.join(__dirname, '..', 'src');
    const run = createHealthChecks({ app: { getName: () => 'Yoru', getVersion: () => '0.59.0', getPath: () => dir }, os, processRef: process, userDataDir: dir, rootDir: root });
    const result = await run();
    const ids = new Set(result.checks.map((item) => item.id));
    assert.ok(ids.has('memory-free'));
    assert.ok(ids.has('avatar-asset'));
    assert.ok(ids.has('tapo-bridge'));
    if (typeof fs.promises.statfs === 'function') assert.ok(ids.has('disk-space'));
    assert.equal(result.counts.error, result.checks.filter((item) => item.status === 'error').length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
