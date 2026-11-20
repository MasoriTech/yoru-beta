'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const T = require('../src/neural-tts');

// cliente de TTS falso: mesmo formato do msedge-tts, sem rede
function fakeLib({ audio = Buffer.alloc(500, 1), failFirst = 0, voices = [] } = {}) {
  const log = { created: 0, closed: 0, meta: [], calls: [], active: 0, maxActive: 0, fails: failFirst };
  class MsEdgeTTS {
    constructor() { log.created++; }
    async setMetadata(voice, fmt) { log.meta.push([voice, fmt]); }
    close() { log.closed++; }
    async getVoices() { if (voices === 'erro') throw new Error('sem rede'); return voices; }
    toStream(text, options) {
      log.calls.push({ text, options });
      const s = new EventEmitter();
      log.active++; log.maxActive = Math.max(log.maxActive, log.active);
      setImmediate(() => {
        log.active--;
        if (log.fails > 0) { log.fails--; s.emit('error', new Error('conexão caiu')); return; }
        s.emit('data', audio); s.emit('end');
      });
      return { audioStream: s };
    }
  }
  return { lib: { MsEdgeTTS, OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'mp3' } }, log };
}
const cfg = (o = {}) => ({ neuralVoice: 'pt-BR-FranciscaNeural', voiceRate: 1, voicePitch: 1, voiceEngine: 'neural', ...o });

test('montagem: escapa XML, limita o tamanho e converte ritmo/tom em porcentagem', () => {
  const s = T.buildSpeech('a < b & c > d', 1.25, 1.2);
  assert.equal(s.text, 'a &lt; b &amp; c &gt; d');
  assert.deepEqual(s.options, { rate: '+25%', pitch: '+10%' });
  assert.deepEqual(T.buildSpeech('x', 0.8, 0.8).options, { rate: '-20%', pitch: '-10%' });
  assert.deepEqual(T.buildSpeech('x', 1, 1).options, { rate: '+0%', pitch: '+0%' });
  assert.equal(T.buildSpeech('a'.repeat(3000), 1, 1).text.length, 1500);
  // cortar depois de escapar nunca deixaria "&am" pelo meio: o corte é antes
  assert.ok(!T.buildSpeech('&'.repeat(2000), 1, 1).text.endsWith('&am'));
});

test('chave do cache muda com voz, ritmo, tom e texto', () => {
  const k = T.cacheKey('v', 1, 1, 'oi');
  assert.notEqual(k, T.cacheKey('w', 1, 1, 'oi'));
  assert.notEqual(k, T.cacheKey('v', 1.1, 1, 'oi'));
  assert.notEqual(k, T.cacheKey('v', 1, 1.1, 'oi'));
  assert.notEqual(k, T.cacheKey('v', 1, 1, 'tchau'));
});

test('cache: a segunda fala igual não chama o serviço', async () => {
  const { lib, log } = fakeLib();
  const tts = T.createNeuralTts({ lib, settings: () => cfg() });
  const a = await tts.synth('Anotado!');
  assert.equal(tts.hasCached('Anotado!'), true);
  const b = await tts.synth('Anotado!');
  assert.equal(a, b);
  assert.equal(log.calls.length, 1);
  assert.equal(tts.cacheInfo().cacheItems, 1);
  tts.clearCache();
  assert.equal(tts.hasCached('Anotado!'), false);
  assert.deepEqual(tts.cacheInfo(), { cacheItems: 0, cacheKB: 0 });
});

test('cache: trocar ritmo ou voz não reaproveita o áudio antigo', async () => {
  const { lib, log } = fakeLib();
  let s = cfg();
  const tts = T.createNeuralTts({ lib, settings: () => s });
  await tts.synth('oi');
  s = cfg({ voiceRate: 1.3 });
  assert.equal(tts.hasCached('oi'), false);
  await tts.synth('oi');
  s = cfg({ neuralVoice: 'pt-BR-AntonioNeural' });
  await tts.synth('oi');
  assert.equal(log.calls.length, 3);
  assert.deepEqual(log.meta.map((m) => m[0]), ['pt-BR-FranciscaNeural', 'pt-BR-AntonioNeural']); // reconectou só ao mudar a voz
  assert.equal(log.calls[1].options.rate, '+30%');
});

test('cache: falas longas (> 400 caracteres) não entram', async () => {
  const { lib } = fakeLib();
  const tts = T.createNeuralTts({ lib, settings: () => cfg() });
  await tts.synth('a'.repeat(401));
  assert.equal(tts.hasCached('a'.repeat(401)), false);
  await tts.synth('a'.repeat(400));
  assert.equal(tts.hasCached('a'.repeat(400)), true);
});

test('cache: passou do limite descarta as mais antigas, e ler de novo renova', async () => {
  const { lib } = fakeLib({ audio: Buffer.alloc(400, 1) });
  const tts = T.createNeuralTts({ lib, settings: () => cfg(), cacheMaxBytes: 1000 }); // cabem 2 falas
  await tts.synth('um'); await tts.synth('dois');
  await tts.synth('um');                 // "um" fica como a mais recente
  await tts.synth('tres');               // estoura: sai a mais antiga ("dois")
  assert.equal(tts.hasCached('um'), true);
  assert.equal(tts.hasCached('dois'), false);
  assert.equal(tts.hasCached('tres'), true);
  assert.equal(tts.cacheInfo().cacheItems, 2);
});

test('fila: pedidos em paralelo são atendidos um por vez', async () => {
  const { lib, log } = fakeLib();
  const tts = T.createNeuralTts({ lib, settings: () => cfg() });
  await Promise.all(['a', 'b', 'c', 'd'].map((t) => tts.synth(t)));
  assert.equal(log.calls.length, 4);
  assert.equal(log.maxActive, 1);
  assert.deepEqual(log.calls.map((c) => c.text), ['a', 'b', 'c', 'd']);
  assert.equal(log.created, 1);          // uma só conexão para todas
});

test('nova tentativa: se a conexão caiu uma vez, refaz e dá certo (com conexão nova)', async () => {
  const { lib, log } = fakeLib({ failFirst: 1 });
  const tts = T.createNeuralTts({ lib, settings: () => cfg() });
  const buf = await tts.synth('oi');
  assert.ok(buf.length >= 200);
  assert.equal(log.calls.length, 2);
  assert.equal(log.created, 2);
  assert.ok(log.closed >= 1);
});

test('falhas seguidas rejeitam, não gravam no cache e a fila continua andando', async () => {
  const { lib, log } = fakeLib({ failFirst: 2 });
  const tts = T.createNeuralTts({ lib, settings: () => cfg() });
  await assert.rejects(tts.synth('x'), /conexão caiu/);
  assert.equal(tts.hasCached('x'), false);
  assert.ok((await tts.synth('y')).length >= 200);   // a próxima fala funciona
  assert.equal(log.calls.length, 3);
});

test('áudio vazio (< 200 bytes) é erro, não vira cache', async () => {
  const { lib } = fakeLib({ audio: Buffer.alloc(50) });
  const tts = T.createNeuralTts({ lib, settings: () => cfg() });
  await assert.rejects(tts.synth('oi'), /áudio vazio/);
  assert.equal(tts.hasCached('oi'), false);
});

test('sem o pacote msedge-tts: erro claro e available=false', async () => {
  const tts = T.createNeuralTts({ lib: {}, settings: () => cfg() });
  assert.equal(tts.available, false);
  await assert.rejects(tts.synth('oi'), /msedge-tts/);
  tts.warm();                                          // não pode lançar
  assert.deepEqual(await tts.voices(), T.NEURAL_FALLBACK);
});

test('warm: só conecta com o motor neural ligado, e uma conexão por vez', async () => {
  const off = fakeLib();
  T.createNeuralTts({ lib: off.lib, settings: () => cfg({ voiceEngine: 'system' }) }).warm();
  assert.equal(off.log.created, 0);
  const on = fakeLib();
  const tts = T.createNeuralTts({ lib: on.lib, settings: () => cfg() });
  tts.warm(); tts.warm(); tts.warm();
  await tts.synth('oi');
  assert.equal(on.log.created, 1);
});

test('vozes: formata, põe português primeiro e ignora entradas ruins', async () => {
  const { lib } = fakeLib({ voices: [
    { ShortName: 'en-US-JennyNeural', Locale: 'en-US', Gender: 'Female' },
    { ShortName: 'pt-BR-AntonioNeural', Locale: 'pt-BR', Gender: 'Male' },
    { ShortName: 'pt-BR-ThalitaMultilingualNeural', Locale: 'pt-BR', Gender: 'Female' },
    { ShortName: 'lixo', Locale: 'xx' },
    null,
  ] });
  const tts = T.createNeuralTts({ lib, settings: () => cfg(), regionName: (l) => l.split('-')[1] });
  const list = await tts.voices();
  assert.deepEqual(list.map((v) => v.id), ['pt-BR-AntonioNeural', 'pt-BR-ThalitaMultilingualNeural', 'en-US-JennyNeural']);
  assert.equal(list[0].label, 'Antonio (masculino, BR)');
  assert.equal(list[1].multi, true);
  assert.equal(list[1].label, 'Thalita (feminina, BR)');
});

test('vozes: sem rede, ou sem nenhuma voz em português, usa a lista fixa', async () => {
  const a = T.createNeuralTts({ lib: fakeLib({ voices: 'erro' }).lib, settings: () => cfg() });
  assert.deepEqual(await a.voices(), T.NEURAL_FALLBACK);
  const b = T.createNeuralTts({ lib: fakeLib({ voices: [{ ShortName: 'en-US-JennyNeural', Locale: 'en-US', Gender: 'Female' }] }).lib, settings: () => cfg() });
  assert.deepEqual(await b.voices(), T.NEURAL_FALLBACK);
});

test('vozes: a lista boa fica guardada (não pergunta de novo)', async () => {
  let n = 0;
  const { lib } = fakeLib({ voices: [{ ShortName: 'pt-BR-AntonioNeural', Locale: 'pt-BR', Gender: 'Male' }] });
  const orig = lib.MsEdgeTTS.prototype.getVoices;
  lib.MsEdgeTTS.prototype.getVoices = function () { n++; return orig.call(this); };
  const tts = T.createNeuralTts({ lib, settings: () => cfg() });
  await tts.voices(); await tts.voices();
  assert.equal(n, 1);
});
