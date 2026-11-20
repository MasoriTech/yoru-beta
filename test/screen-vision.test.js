'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createScreenVision, cleanQuestion, cleanSourceName, sourceType, MAX_IMAGE_BYTES } = require('../src/screen-vision');

function fixture(overrides = {}) {
  let time = 1000;
  let calls = [];
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 1920, height: 1080 }),
    resize: () => image,
    toJPEG: (quality) => Buffer.from(`jpeg-${quality}`),
  };
  const desktopCapturer = {
    getSources: async (options) => {
      calls.push(options);
      if (options.thumbnailSize.width === 0) return [{ id: 'window:45:0', name: 'Visual Studio Code — app.js' }, { id: 'screen:1:0', name: 'Screen 1' }];
      return [{ id: 'window:45:0', name: 'Visual Studio Code — app.js', thumbnail: image }, { id: 'screen:1:0', name: 'Screen 1', thumbnail: image }];
    },
  };
  const modelCalls = [];
  const service = createScreenVision({
    desktopCapturer,
    callModel: async (...args) => { modelCalls.push(args); return 'Análise visual concluída.'; },
    mediaMessage: (provider, content, media) => ({ role: 'user', provider, content, media }),
    getVisionConfig: async () => ({ enabled: true, cfg: { provider: 'ollama', ollama: { model: 'qwen-vl' } } }),
    now: () => time,
    makeId: (() => { let id = 0; return () => `id-${++id}`; })(),
    ...overrides,
  });
  return { service, calls, modelCalls, setTime: (v) => { time = v; }, image, desktopCapturer };
}

test('lista janelas/telas sem expor IDs nativos nem capturar thumbnails', async () => {
  const f = fixture();
  const result = await f.service.listSources();
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].type, 'window');
  assert.equal(result.items[1].type, 'screen');
  assert.ok(!JSON.stringify(result.items).includes('window:45:0'));
  assert.equal(f.calls[0].thumbnailSize.width, 0);
  assert.equal(f.calls[0].thumbnailSize.height, 0);
});

test('captura só ocorre depois do token listado e cria prévia temporária', async () => {
  const f = fixture();
  await f.service.listSources();
  const result = await f.service.captureSource('id-1');
  assert.equal(result.ok, true);
  assert.equal(result.sourceName, 'Visual Studio Code — app.js');
  assert.match(result.previewUrl, /^data:image\/jpeg;base64,/);
  assert.equal(f.service.pendingCaptures(), 1);
  assert.equal(f.calls[1].thumbnailSize.width, 1600);
  await assert.rejects(() => f.service.captureSource('window:45:0'), /Selecione/);
});

test('análise envia a imagem ao modelo configurado para Masori-Vision e usa captura uma única vez', async () => {
  const f = fixture();
  await f.service.listSources();
  const captured = await f.service.captureSource('id-1');
  const result = await f.service.analyzeCapture(captured.captureId, 'Leia o erro na tela.');
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'ollama');
  assert.equal(result.model, 'qwen-vl');
  assert.equal(result.text, 'Análise visual concluída.');
  assert.equal(f.modelCalls.length, 1);
  const [messages, cfg, system, maxTokens, _tail, extra] = f.modelCalls[0];
  assert.equal(cfg.provider, 'ollama');
  assert.equal(messages[0].media[0].mime, 'image/jpeg');
  assert.match(messages[0].content, /Visual Studio Code/);
  assert.match(messages[0].content, /Leia o erro na tela/);
  assert.match(system, /não invente texto/i);
  assert.ok(maxTokens >= 1000);
  assert.equal(extra.masoriAgent, 'masori-vision');
  assert.equal(f.service.pendingCaptures(), 0);
  await assert.rejects(() => f.service.analyzeCapture(captured.captureId, 'analisar'), /expirou ou já foi usada/);
});

test('captura expira e só pode ser descartada enquanto está pendente', async () => {
  const f = fixture();
  await f.service.listSources();
  const captured = await f.service.captureSource('id-1');
  assert.equal(f.service.discardCapture(captured.captureId), true);
  assert.equal(f.service.discardCapture(captured.captureId), false);
  await f.service.listSources();
  const another = await f.service.captureSource('id-4');
  f.setTime(another.captureId ? 1000 + 181000 : 181000);
  await assert.rejects(() => f.service.analyzeCapture(another.captureId, ''), /expirou ou já foi usada/);
});

test('não analisa quando Masori-Vision está desativado e descarta a imagem', async () => {
  const f = fixture({ getVisionConfig: async () => ({ enabled: false, cfg: { provider: 'ollama' } }) });
  await f.service.listSources();
  const captured = await f.service.captureSource('id-1');
  await assert.rejects(() => f.service.analyzeCapture(captured.captureId, 'verificar'), /está desativado/);
  assert.equal(f.service.pendingCaptures(), 0);
});

test('normaliza pergunta/título e identifica tipo de fonte', () => {
  assert.equal(cleanQuestion('  Olhe a tela  '), 'Olhe a tela');
  assert.equal(cleanQuestion('x'.repeat(2000)).length, 1800);
  assert.equal(cleanSourceName('App\n  — janela\0'), 'App — janela');
  assert.equal(sourceType({ id: 'screen:2:0' }), 'screen');
  assert.equal(sourceType({ id: 'window:1:0' }), 'window');
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
});

test('limpa a imagem da memória automaticamente ao vencer o prazo', async () => {
  let expiry;
  const f = fixture({
    setTimer: (callback, delay) => { assert.equal(delay, 180000); expiry = callback; return { unref() {} }; },
    clearTimer: () => {},
  });
  await f.service.listSources();
  const captured = await f.service.captureSource('id-1');
  assert.equal(f.service.pendingCaptures(), 1);
  expiry();
  assert.equal(f.service.pendingCaptures(), 0);
  await assert.rejects(() => f.service.analyzeCapture(captured.captureId, 'analisar'), /expirou ou já foi usada/);
});
