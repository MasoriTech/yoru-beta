'use strict';
// Troca de modelo do Whisper: thread real (stt-worker.js) com um "@huggingface/transformers" falso.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Stt } = require('../src/stt');

// monta uma pasta com o worker + node_modules falso (carga demorada por modelo, registro de dispose)
function fixture(delays) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-stt-'));
  fs.copyFileSync(path.join(__dirname, '../src/stt-worker.js'), path.join(dir, 'stt-worker.js'));
  const nm = path.join(dir, 'node_modules/@huggingface/transformers');
  fs.mkdirSync(nm, { recursive: true });
  fs.writeFileSync(path.join(nm, 'index.js'), `
    const { parentPort } = require('worker_threads');
    const delays = ${JSON.stringify(delays)};
    exports.env = {};
    let live = 0;
    exports.pipeline = async (task, repo, opts) => {
      const name = repo.split('/').pop().replace('whisper-', '');
      await new Promise((r) => setTimeout(r, delays[name] || 5));
      live++;
      let disposed = false;
      const p = async (audio) => {
        if (disposed) throw new Error('usou modelo ja liberado: ' + name);
        await new Promise((r) => setTimeout(r, 30));
        return { text: name + ':' + audio.length };
      };
      p.dispose = async () => { disposed = true; live--; };
      return p;
    };
    exports.live = () => live;
  `);
  return dir;
}
const audio = () => new Float32Array(16000);

test('trocas rápidas: a thread termina no modelo mais recente e não deixa dois na memória', async () => {
  const dir = fixture({ base: 80, small: 60, medium: 20 });
  const stt = new Stt({ cacheDir: dir, workerFile: path.join(dir, 'stt-worker.js') });
  const events = [];
  stt.on('ready', (m) => events.push(m.model));
  const a = stt.prepare('base');
  await new Promise((r) => setTimeout(r, 10));
  const b = stt.prepare('small');   // pedido no meio da carga do base
  const c = stt.prepare('medium');  // e outro logo depois
  await Promise.all([a, b, c]);
  assert.equal(events[events.length - 1], 'medium', 'o último "pronto" é o modelo mais recente');
  assert.ok(!events.includes('small'), 'o modelo do meio é pulado');
  const r = await stt.transcribe(audio(), 'medium');
  assert.match(r, /^medium:/);
  stt.dispose();
});

test('durante a carga do modelo novo, o atual continua transcrevendo e o antigo é liberado sem erro', async () => {
  const dir = fixture({ base: 5, small: 150 });
  const stt = new Stt({ cacheDir: dir, workerFile: path.join(dir, 'stt-worker.js') });
  await stt.prepare('base');
  const loading = stt.prepare('small');
  await new Promise((r) => setTimeout(r, 20));
  const t0 = Date.now();
  const txt = await stt.transcribe(audio(), 'small'); // pedido enquanto o small ainda carrega
  assert.match(txt, /^base:/, 'usa o modelo carregado em vez de esperar');
  assert.ok(Date.now() - t0 < 120, 'não esperou a carga');
  await loading;
  assert.match(await stt.transcribe(audio(), 'small'), /^small:/);
  stt.dispose();
});

test('transcrição em andamento não perde o modelo quando a troca termina', async () => {
  const dir = fixture({ base: 5, small: 20 });
  const stt = new Stt({ cacheDir: dir, workerFile: path.join(dir, 'stt-worker.js') });
  await stt.prepare('base');
  const t = stt.transcribe(audio(), 'base');  // dura 30 ms
  const p = stt.prepare('small');             // termina de carregar no meio da transcrição
  assert.match(await t, /^base:/);
  await p;
  stt.dispose();
});

test('dispose() seguido de uso imediato não mata a thread nova', async () => {
  const dir = fixture({ base: 5 });
  const stt = new Stt({ cacheDir: dir, workerFile: path.join(dir, 'stt-worker.js') });
  await stt.prepare('base');
  stt.dispose();
  await stt.prepare('base'); // antes: o 'exit' da thread antiga derrubava esta chamada
  await new Promise((r) => setTimeout(r, 100)); // dá tempo do 'exit' antigo chegar
  assert.ok(stt.worker, 'a thread nova continua registrada');
  assert.match(await stt.transcribe(audio(), 'base'), /^base:/);
  stt.dispose();
});

test('dispose() rejeita o que estava pendente em vez de deixar pendurado', async () => {
  const dir = fixture({ base: 300 });
  const stt = new Stt({ cacheDir: dir, workerFile: path.join(dir, 'stt-worker.js') });
  const p = stt.prepare('base');
  await new Promise((r) => setTimeout(r, 20));
  stt.dispose();
  await assert.rejects(p, /reiniciado/);
});
