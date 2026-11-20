'use strict';
// GPU no Whisper: pede 'dml' com as opções certas e, se a placa falhar (ao carregar ou no meio de uma fala), volta para a CPU.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Stt } = require('../src/stt');

// worker real + "@huggingface/transformers" falso. `mode`: 'ok' | 'load-fails' | 'run-fails' (só na GPU)
function fixture(mode) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-gpu-'));
  fs.copyFileSync(path.join(__dirname, '../src/stt-worker.js'), path.join(dir, 'stt-worker.js'));
  const nm = path.join(dir, 'node_modules/@huggingface/transformers');
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, 'index.js'), `
    exports.env = {};
    exports.calls = [];
    exports.pipeline = async (task, repo, opts) => {
      const gpu = opts.device === 'dml';
      if (gpu) {
        if (!opts.session_options || opts.session_options.enableMemPattern !== false || opts.session_options.executionMode !== 'sequential') throw new Error('opcoes do DirectML erradas');
        if (!opts.dtype || opts.dtype.encoder_model !== 'fp32') throw new Error('dtype da GPU errado');
        if (${JSON.stringify(mode)} === 'load-fails') throw new Error('sem DirectML');
      }
      const p = async (audio, o) => {
        if (gpu && ${JSON.stringify(mode)} === 'run-fails' && o.max_new_tokens > 4) throw new Error('GPU perdeu o contexto');
        return { text: (gpu ? 'gpu' : 'cpu') + ':' + audio.length };
      };
      p.dispose = async () => {};
      return p;
    };
  `);
  return dir;
}
const audio = () => new Float32Array(16000);

async function run(mode, device) {
  process.env.YORU_TEST_GPU = '1';
  const dir = fixture(mode);
  const stt = new Stt({ cacheDir: dir, workerFile: path.join(dir, 'stt-worker.js'), device: () => device });
  const events = [];
  stt.on('device', (m) => events.push(m));
  const ready = new Promise((res) => stt.once('ready', res));
  try {
    await stt.prepare('base');
    const r = await ready;
    const text = await stt.transcribe(audio(), 'base');
    return { ready: r, text, events };
  } finally { stt.dispose(); delete process.env.YORU_TEST_GPU; }
}

test('na GPU: usa dml com as opções do DirectML', async () => {
  const r = await run('ok', 'gpu');
  assert.equal(r.ready.device, 'gpu');
  assert.match(r.text, /^gpu:/);
  assert.equal(r.events.length, 0);
});

test('GPU que não carrega: volta para a CPU e avisa', async () => {
  const r = await run('load-fails', 'gpu');
  assert.equal(r.ready.device, 'cpu');
  assert.match(r.text, /^cpu:/);
  assert.equal(r.events.length, 1);
  assert.match(r.events[0].reason, /sem DirectML/);
});

test('GPU que falha no meio de uma fala: refaz essa fala na CPU', async () => {
  const r = await run('run-fails', 'gpu');
  assert.match(r.text, /^cpu:/);
  assert.ok(r.events.some((e) => /GPU falhou/.test(e.reason)));
});

test('CPU continua sendo o padrão (nunca pede dml)', async () => {
  const r = await run('load-fails', 'cpu');
  assert.equal(r.ready.device, 'cpu');
  assert.equal(r.events.length, 0);
});
