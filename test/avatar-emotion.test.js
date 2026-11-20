'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const imp = (f) => import(pathToFileURL(path.join(__dirname, '..', 'src', f)).href);

test('emotion engine: normaliza emoções, limita áudio e suaviza aura/boca', async () => {
  const { createEmotionEngine } = await imp('emotion-engine.js');
  const values = {};
  const root = { dataset: {}, style: { setProperty(k, v) { values[k] = Number(v); } } };
  const image = { style: {} };
  const engine = createEmotionEngine({ root, image });
  const first = engine.update(1, 1, { emotion: 'feliz', speaking: true, level: 8 });
  assert.equal(engine.emotion, 'happy');
  assert.equal(root.dataset.emotion, 'happy');
  assert.ok(first.mouth >= 0 && first.mouth <= 1);
  assert.ok(values['--yoru-aura-opacity'] >= 0 && values['--yoru-aura-opacity'] <= 1);
  assert.ok(values['--yoru-speaking-energy'] >= 0 && values['--yoru-speaking-energy'] <= 1);
  assert.match(image.style.filter, /saturate/);
  const idle = engine.update(0.05, 2, { emotion: 'neutro', speaking: false, level: NaN });
  assert.equal(engine.emotion, 'neutral');
  assert.ok(idle.mouth < first.mouth);
});

test('VRM face: protege frame delta, analisador ausente e suaviza o lip-sync', async () => {
  const { createFace } = await imp('face.js');
  const vals = new Map();
  const em = { getValue(k) { return vals.get(k) || 0; }, setValue(k, v) { vals.set(k, v); } };
  const face = createFace({ S: { blinking: true, blinkRate: 1, emotionStrength: 4, lipSync: true }, V: { audioEl: null, analyser: null, anaBuf: null, ttsLevel: 0 } });
  face.update(4, 1, { em, expr: 'happy', sleepW: 0, speaking: true });
  assert.ok(vals.get('happy') <= 1);
  assert.ok(Number.isFinite(vals.get('aa')));
  face.update(NaN, NaN, { em, expr: 'sad', sleepW: 0, speaking: false });
  assert.ok(Number.isFinite(vals.get('aa')));
});
