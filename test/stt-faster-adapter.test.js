'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FasterWhisper } = require('../src/stt-faster');

test('Faster-Whisper detect retorna uma Promise e não usa spawnSync', async () => {
  const result = FasterWhisper.detect({ timeout: 1200 });
  assert.equal(typeof result.then, 'function');
  const found = await result;
  assert.ok(found === null || (typeof found.cmd === 'string' && Array.isArray(found.args)));
});

test('Faster-Whisper rejeita buffers inválidos ou acima do limite antes de iniciar Python', async () => {
  const fw = new FasterWhisper({ cacheDir: '/tmp/yoru-test-cache' });
  await assert.rejects(fw.transcribe(new Float32Array(100)), /Áudio inválido/);
  await assert.rejects(fw.transcribe(new Float32Array(16000 * 91)), /90 segundos/);
  fw.dispose();
});
