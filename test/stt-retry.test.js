'use strict';
// Recuperação do download do modelo: nova tentativa em falha de rede, cache corrompido apagado e travamento detectado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Stt } = require('../src/stt');

function fixture(behavior) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-stt-retry-'));
  const cache = path.join(dir, 'cache');
  fs.copyFileSync(path.join(__dirname, '../src/stt-worker.js'), path.join(dir, 'stt-worker.js'));
  const nm = path.join(dir, 'node_modules/@huggingface/transformers');
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, 'index.js'), `
    const fs = require('fs'), path = require('path');
    exports.env = {};
    let calls = 0;
    exports.pipeline = async (task, repo, opts) => {
      calls++;
      ${behavior}
      const p = async () => ({ text: 'ok' });
      p.dispose = async () => {};
      return p;
    };
  `);
  return { dir, cache };
}
const mk = (f) => new Stt({ cacheDir: f.cache, workerFile: path.join(f.dir, 'stt-worker.js') });

test('falha de rede passageira: tenta de novo e carrega o modelo', async () => {
  process.env.YORU_STT_BACKOFF_MS = '10,10,10';
  const f = fixture(`if (calls < 3) throw new Error('fetch failed: ECONNRESET');`);
  const stt = mk(f); const retries = [];
  stt.on('retry', (m) => retries.push(m));
  await stt.prepare('base');
  assert.equal(retries.length, 2);
  assert.equal(stt.ready, true);
  stt.dispose();
});

test('internet fora de vez: desiste com mensagem clara depois das tentativas', async () => {
  process.env.YORU_STT_BACKOFF_MS = '10,10';
  const f = fixture(`throw new Error('getaddrinfo ENOTFOUND huggingface.co');`);
  const stt = mk(f);
  await assert.rejects(stt.prepare('base'), /Sem conexão estável.*3 tentativa/);
  stt.dispose();
});

test('arquivo do modelo corrompido: apaga o cache do modelo e baixa de novo', async () => {
  process.env.YORU_STT_BACKOFF_MS = '10';
  const f = fixture(`
    const bad = path.join(${JSON.stringify(path.join(os.tmpdir(), 'x'))}, 'x');
    const dir = path.join(${JSON.stringify('')} || process.env.__C, 'Xenova', 'whisper-base');
    if (fs.existsSync(path.join(dir, 'model.onnx'))) throw new Error('Protobuf parsing failed');
  `.replace("process.env.__C", JSON.stringify(path.join(os.tmpdir(), 'nada'))));
  // a pasta do cache é conhecida só depois de criar o fixture: reescreve o index com o caminho certo
  const idx = path.join(f.dir, 'node_modules/@huggingface/transformers/index.js');
  const src = fs.readFileSync(idx, 'utf8').replace(/const dir = .*\n/, `const dir = path.join(${JSON.stringify(f.cache)}, 'Xenova', 'whisper-base');\n`);
  fs.writeFileSync(idx, src);
  const model = path.join(f.cache, 'Xenova', 'whisper-base'); fs.mkdirSync(model, { recursive: true });
  fs.writeFileSync(path.join(model, 'model.onnx'), 'meio baixado');
  const stt = mk(f); const retries = [];
  stt.on('retry', (m) => retries.push(m));
  await stt.prepare('base');
  assert.equal(retries.length, 1);
  assert.match(retries[0].reason, /corrompido/);
  assert.equal(fs.existsSync(path.join(model, 'model.onnx')), false);
  stt.dispose();
});

test('download travado sem progresso: detecta e tenta de novo', async () => {
  process.env.YORU_STT_BACKOFF_MS = '10';
  process.env.YORU_STT_STALL_MS = '300';
  const f = fixture(`if (calls === 1) await new Promise(() => {});`);
  const stt = mk(f); const retries = [];
  stt.on('retry', (m) => retries.push(m));
  await stt.prepare('base');
  assert.equal(retries.length, 1);
  assert.match(retries[0].detail, /stalled/);
  stt.dispose();
  delete process.env.YORU_STT_STALL_MS;
});
