'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Segmenter, normalize, SR } = require('../src/vad');

// tom de 220 Hz (parece voz para o detector de energia)
function tone(sec, amp) {
  const a = new Float32Array(Math.round(sec * SR));
  for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(2 * Math.PI * 220 * i / SR);
  return a;
}
const silence = (sec) => new Float32Array(Math.round(sec * SR));

test('vad: corta uma frase e guarda um respiro antes do início (não perde o começo do nome)', () => {
  const got = [];
  const seg = new Segmenter({ sensitivity: 3, onSegment: (a) => got.push(a) });
  seg.push(silence(1));
  seg.push(tone(1, 0.2));
  seg.push(silence(1));
  assert.equal(got.length, 1);
  const secs = got[0].length / SR;
  assert.ok(secs > 1.3 && secs < 1.9, 'duração ' + secs); // 1 s de voz + ~0,3 s antes + respiro no fim
});

test('vad: ignora estalo curto', () => {
  const got = [];
  const seg = new Segmenter({ sensitivity: 3, onSegment: (a) => got.push(a) });
  seg.push(silence(1)); seg.push(tone(0.08, 0.5)); seg.push(silence(1));
  assert.equal(got.length, 0);
});

test('vad: ruído constante alto não prende o microfone para sempre', () => {
  const got = [];
  const seg = new Segmenter({ sensitivity: 3, onSegment: (a) => got.push(a) });
  seg.push(silence(0.5));
  seg.push(tone(60, 0.02)); // 60 s de "ventilador" bem acima do piso inicial
  seg.push(silence(1));
  seg.push(tone(1, 0.3));   // e depois a voz de verdade
  seg.push(silence(1));
  assert.ok(got.length >= 1);
  assert.ok(got[got.length - 1].length / SR < 20);
});

test('normalize: amplifica voz baixa mesmo com um pico isolado, sem passar de 8x nem estourar', () => {
  const a = tone(1, 0.02);
  a[100] = 0.2; // estalo
  const peak0 = 0.2;
  normalize(a);
  let peak = 0; for (const v of a) peak = Math.max(peak, Math.abs(v));
  assert.ok(peak > peak0 * 1.5 && peak <= 0.9 + 1e-6, 'pico ' + peak);
  const q = tone(1, 0.5); const before = q[1000];
  normalize(q);
  assert.equal(q[1000], before); // já está alta: não mexe
});

// ----- palmas -----
function clapBurst(len = 480, amp = 0.5) { // 30 ms de ruído que decai (batida seca)
  const a = new Float32Array(len);
  for (let i = 0; i < len; i++) a[i] = (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 4));
  return a;
}
function feed(seg, parts) { for (const p of parts) for (let i = 0; i < p.length; i += 640) seg.push(p.subarray(i, Math.min(p.length, i + 640))); }
const quiet = (ms) => { const a = new Float32Array(16 * ms); for (let i = 0; i < a.length; i++) a[i] = (Math.random() - 0.5) * 0.004; return a; };

test('duas palmas disparam; uma só, não', () => {
  const { Segmenter } = require('../src/vad');
  let claps = 0;
  const s = new Segmenter({ onClap: () => claps++ });
  feed(s, [quiet(500), clapBurst(), quiet(1500)]);
  assert.equal(claps, 0, 'uma palma não basta');
  feed(s, [quiet(500), clapBurst(), quiet(400), clapBurst(), quiet(500)]);
  assert.equal(claps, 1, 'duas palmas disparam uma vez');
  feed(s, [clapBurst(), quiet(300), clapBurst(), quiet(300)]);
  assert.equal(claps, 1, 'respeita a pausa depois de disparar');
});

test('voz alta e batidas muito próximas/distantes não contam como palmas', () => {
  const { Segmenter } = require('../src/vad');
  let claps = 0;
  const s = new Segmenter({ onClap: () => claps++ });
  const voice = new Float32Array(16000);
  for (let i = 0; i < voice.length; i++) voice[i] = 0.3 * Math.sin(2 * Math.PI * 180 * i / 16000) * (0.6 + 0.4 * Math.sin(i / 900));
  feed(s, [quiet(500), voice, quiet(500), voice, quiet(500)]);
  assert.equal(claps, 0, 'voz não é palma');
  feed(s, [quiet(300), clapBurst(), quiet(2000), clapBurst(), quiet(300)]);
  assert.equal(claps, 0, 'batidas com mais de 0,9 s entre elas');
});

test('palmas desligadas (clap:false) não disparam', () => {
  const { Segmenter } = require('../src/vad');
  let claps = 0;
  const s = new Segmenter({ clap: false, onClap: () => claps++ });
  feed(s, [quiet(500), clapBurst(), quiet(400), clapBurst(), quiet(300)]);
  assert.equal(claps, 0);
});

// ----- estalos de dedo e digitação -----
let snapSeed = 12345; // ruído repetível: com Math.random este teste falhava de vez em quando
const snapRand = () => { snapSeed = (snapSeed * 1664525 + 1013904223) >>> 0; return snapSeed / 4294967296; };
function snapBurst(amp = 0.2) { // 8 ms, mais fraco e agudo que a palma
  const a = new Float32Array(128);
  for (let i = 0; i < 128; i++) a[i] = (snapRand() * 2 - 1) * amp * Math.exp(-i / 32);
  return a;
}
test('dois estalos de dedo disparam; digitação (várias batidas seguidas) não', () => {
  const { Segmenter } = require('../src/vad');
  let hits = 0;
  const s = new Segmenter({ onClap: () => hits++ });
  feed(s, [quiet(600), snapBurst(), quiet(350), snapBurst(), quiet(700)]);
  assert.equal(hits, 1, 'par de estalos');
  // digitação: batidas fracas a cada 150-250 ms
  feed(s, [quiet(2000)]);
  const keys = [];
  for (let i = 0; i < 8; i++) keys.push(snapBurst(0.2), quiet(180 + (i % 3) * 30));
  feed(s, keys);
  feed(s, [quiet(800)]);
  assert.equal(hits, 1, 'digitação não acorda');
  // um estalo só
  feed(s, [quiet(2000), snapBurst(), quiet(1500)]);
  assert.equal(hits, 1, 'um estalo só não basta');
});
