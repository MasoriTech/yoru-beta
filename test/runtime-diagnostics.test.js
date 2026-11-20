'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshot } = require('../src/runtime-diagnostics');

test('diagnóstico expõe versões e memória sem dados sensíveis', () => {
  const d = snapshot({ app: { getName: () => 'Yoru', getVersion: () => '0.11.0', isPackaged: false }, os: { cpus: () => [{ model: 'CPU Teste' }], totalmem: () => 8 * 1024 ** 3, freemem: () => 4 * 1024 ** 3 }, processRef: { memoryUsage: () => ({ rss: 10 * 1024 ** 2, heapUsed: 5 * 1024 ** 2, heapTotal: 8 * 1024 ** 2, external: 2 * 1024 ** 2 }), getSystemMemoryInfo: () => ({ total: 8 * 1024 ** 3 / 1024, free: 4 * 1024 ** 3 / 1024 }), platform: 'win32', arch: 'x64', versions: { electron: '45', node: '24', chrome: '140' }, uptime: () => 60 }, now: () => 0 });
  assert.equal(d.app.name, 'Yoru'); assert.equal(d.app.version, '0.11.0');
  assert.equal(d.system.cpuModel, 'CPU Teste'); assert.ok(d.process.rssMB >= 10);
  assert.equal(JSON.stringify(d).includes('apiKey'), false);
});
