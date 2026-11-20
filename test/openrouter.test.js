'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AIC = require('../src/ai-core');
const AS = require('../src/ai-stream');
const OR = require('../src/openrouter');
const A = require('../src/attachments');
const { registerIaIpc } = require('../src/ipc-ia');

// ---------- ajudantes ----------
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (t) => sse({ choices: [{ delta: { content: t } }] });
const body = (parts) => (async function* () { for (const p of parts) yield p; })();
const okStream = (parts) => ({ ok: true, status: 200, body: body(parts) });
const okJson = (j) => ({ ok: true, status: 200, json: async () => j });
const orJson = (t) => okJson({ choices: [{ message: { content: t } }] });
const httpErr = (status, message, extra = {}, headers = {}) => ({
  ok: false, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => JSON.stringify({ error: { message, ...extra } }),
});
const cfgOr = (o = {}) => AIC.normalizeConfig({ provider: 'openrouter', openrouter: { apiKey: 'k', ...o } });

function make({ cfg = cfgOr(), fetch, stream = true } = {}) {
  const calls = [], waits = [], events = [];
  const ai = AIC.createAI({
    getSettings: () => ({ historyLimit: 20, maxTokens: 400, streamReplies: stream, convSpeak: false }),
    loadConfig: () => cfg,
    buildSystem: () => 'SYS',
    canStream: () => stream,
    emitStream: (e) => events.push(e),
    fetch: async (url, init) => { calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null }); return fetch(calls.at(-1), calls.length); },
    wait: async (ms) => { waits.push(ms); },
  });
  return { ai, calls, waits, events };
}

// ---------- pedido ----------
test('cabeçalhos de atribuição: chat e imagem identificam o app como Yoru', () => {
  const h = OR.headers('abc');
  assert.equal(h.Authorization, 'Bearer abc');
  assert.equal(h['X-Title'], 'Yoru');
  assert.ok(h['HTTP-Referer'].startsWith('https://'));
  const req = AIC.buildRequest(cfgOr(), [{ role: 'user', content: 'oi' }], 'SYS', true, 100);
  assert.equal(req.headers['X-Title'], 'Yoru');
  assert.equal(req.url, 'https://openrouter.ai/api/v1/chat/completions');
  const svc = fs.readFileSync(path.join(__dirname, '..', 'src', 'criacao-service.js'), 'utf8');
  assert.match(svc, /OR\.headers\(key\)/, 'a geração de imagem também manda os cabeçalhos');
});

test('modelos reserva: usa "models" (até 2 reservas, sem repetir o principal); sem reservas usa "model"', () => {
  const msgs = [{ role: 'user', content: 'oi' }];
  const a = AIC.buildRequest(cfgOr({ model: 'a/x', fallbacks: 'b/y, a/x, c/z, d/w' }), msgs, 'S', false, 50).body;
  assert.deepEqual(a.models, ['a/x', 'b/y', 'c/z']);
  assert.equal(a.model, undefined);
  const b = AIC.buildRequest(cfgOr({ model: 'a/x' }), msgs, 'S', false, 50).body;
  assert.equal(b.model, 'a/x');
  assert.equal(b.models, undefined);
  assert.deepEqual(OR.parseFallbacks('x/a\ny/b;x/a'), ['x/a', 'y/b']);
});

test('ordem do provedor só entra se válida; valores inválidos voltam ao padrão', () => {
  const msgs = [{ role: 'user', content: 'oi' }];
  assert.deepEqual(AIC.buildRequest(cfgOr({ sort: 'latency' }), msgs, 'S', false, 50).body.provider, { sort: 'latency' });
  assert.equal(AIC.buildRequest(cfgOr({ sort: '' }), msgs, 'S', false, 50).body.provider, undefined);
  const c = AIC.normalizeConfig({ openrouter: { sort: 'xyz', thinking: 'abc', fallbacks: ' a/b ,, c/d ' } });
  assert.equal(c.openrouter.sort, '');
  assert.equal(c.openrouter.thinking, 'fast');
  assert.equal(c.openrouter.fallbacks, 'a/b, c/d');
});

test('raciocínio: curto e oculto por padrão; "model" respeita o modelo, menos na voz', () => {
  const msgs = [{ role: 'user', content: 'oi' }];
  assert.deepEqual(AIC.buildRequest(cfgOr(), msgs, 'S', true, 50).body.reasoning, { effort: 'low', exclude: true });
  assert.equal(AIC.buildRequest(cfgOr({ thinking: 'model' }), msgs, 'S', true, 50).body.reasoning, undefined);
  assert.deepEqual(AIC.buildRequest(cfgOr({ thinking: 'model' }), msgs, 'S', true, 50, '', { voice: true }).body.reasoning, { effort: 'low', exclude: true });
  assert.equal(AIC.buildRequest(cfgOr({ thinking: 'model' }), msgs, 'S', true, 50).ms, 120000);
  assert.equal(AIC.buildRequest(cfgOr(), msgs, 'S', true, 50).ms, 60000);
});

test('cache de prompt nos modelos Claude: trecho fixo em cache e hora fora dele', () => {
  const msgs = [{ role: 'user', content: 'oi' }];
  const m = AIC.buildRequest(cfgOr({ model: 'anthropic/claude-sonnet-5-5' }), msgs, 'FIXO', true, 50, '\n\nAgora são 10:00.').body.messages[0];
  assert.equal(m.role, 'system');
  assert.deepEqual(m.content[0], { type: 'text', text: 'FIXO', cache_control: { type: 'ephemeral' } });
  assert.equal(m.content[1].cache_control, undefined);
  const other = AIC.buildRequest(cfgOr({ model: 'google/gemma-4-31b-it:free' }), msgs, 'FIXO', true, 50, '!').body.messages[0];
  assert.equal(other.content, 'FIXO!', 'outros modelos recebem texto simples');
});

// ---------- PDF ----------
test('PDF: aceito no OpenRouter, vai como parte "file" e liga o leitor gratuito', () => {
  const pdf = { name: 'r.pdf', mime: 'application/pdf', b64: Buffer.from('%PDF-1.4').toString('base64') };
  const prep = A.prepare([pdf], 'openrouter');
  assert.equal(prep.errors.length, 0);
  assert.equal(prep.media[0].kind, 'pdf');
  const msg = A.mediaMessage('openrouter', 'resuma', prep.media);
  assert.equal(msg.content[1].type, 'file');
  assert.match(msg.content[1].file.file_data, /^data:application\/pdf;base64,/);
  const body = AIC.buildRequest(cfgOr(), [msg], 'S', false, 50).body;
  assert.deepEqual(body.plugins, [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }]);
  assert.equal(AIC.buildRequest(cfgOr(), [{ role: 'user', content: 'oi' }], 'S', false, 50).body.plugins, undefined);
  assert.match(A.prepare([pdf], 'ollama').errors[0], /OpenRouter/);
});

// ---------- erros ----------
test('mensagens de erro específicas da OpenRouter', async () => {
  const msg = async (status, m, extra, headers) => (await AIC.httpFail('OpenRouter', httpErr(status, m, extra, headers))).message;
  assert.match(await msg(401, 'No auth credentials found'), /openrouter\.ai\/keys/);
  assert.match(await msg(402, 'Insufficient credits'), /openrouter\.ai\/credits/);
  assert.match(await msg(404, 'No endpoints found matching your data policy'), /settings\/privacy/);
  assert.match(await msg(404, 'No endpoints found'), /Buscar/);
  assert.match(await msg(403, 'flagged', { metadata: { reasons: ['violence'] } }), /moderação.*violence/);
  assert.match(await msg(429, 'Rate limit exceeded: free-models-per-day'), /limite diário/);
  assert.match(await msg(429, 'Provider returned error', { metadata: { provider_name: 'Chutes', raw: '{"message":"slow down"}' } }), /\[Chutes\] slow down/);
  assert.match(await msg(503, 'x'), /reserva/);
  // outros provedores mantêm o texto de antes
  assert.match((await AIC.httpFail('Anthropic', httpErr(402, 'x'))).message, /sem créditos/);
});

test('erro dentro de uma resposta 200 vira mensagem clara (e não "resposta vazia")', async () => {
  const { ai } = make({ stream: false, fetch: async () => okJson({ error: { code: 402, message: 'Insufficient credits' } }) });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, false);
  assert.match(r.text, /openrouter\.ai\/credits/);
  const { ai: ai2 } = make({ stream: false, fetch: async () => okJson({ choices: [{ error: { code: 502, message: 'Provider returned error' }, message: { content: '' } }] }) });
  assert.match((await ai2.askAI('oi')).text, /fora do ar/);
});

test('erro no meio do streaming, antes de qualquer texto, mostra a causa', async () => {
  const { ai } = make({ fetch: async () => okStream([sse({ error: { code: 402, message: 'Insufficient credits' }, choices: [{ finish_reason: 'error', delta: { content: '' } }] })]) });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, false);
  assert.match(r.text, /créditos/);
});

test('modelo que gastou todos os tokens pensando: aviso claro, sem repetir o pedido', async () => {
  const { ai, calls } = make({ fetch: async () => okStream([sse({ choices: [{ delta: { reasoning: 'hmm' }, finish_reason: 'length' }] })]) });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, false);
  assert.match(r.text, /pensando/);
  assert.equal(calls.length, 1, 'não faz o pedido de novo em modo normal');
  const { ai: ai2 } = make({ stream: false, fetch: async () => okJson({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }) });
  assert.match((await ai2.askAI('oi')).text, /pensando/);
});

// ---------- novas tentativas ----------
test('429 passageiro: tenta de novo e responde (não-streaming)', async () => {
  const { ai, calls, waits } = make({ stream: false, fetch: async (_r, n) => (n < 3 ? httpErr(429, 'Provider returned error') : orJson('[happy] oi!')) });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, true);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [800, 2000]);
});

test('streaming: 503 antes do primeiro texto é repetido, e o texto não duplica', async () => {
  const { ai, calls } = make({ fetch: async (_r, n) => (n === 1 ? httpErr(503, 'down') : okStream([delta('[happy] Olá, tudo bem? '), delta('Estou aqui.')])) });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(r.text, 'Olá, tudo bem? Estou aqui.');
});

test('respeita o Retry-After, mas não espera mais de 8 s', async () => {
  const a = make({ stream: false, fetch: async (_r, n) => (n === 1 ? httpErr(429, 'x', {}, { 'retry-after': '3' }) : orJson('ok')) });
  await a.ai.askAI('oi');
  assert.deepEqual(a.waits, [3000]);
  const b = make({ stream: false, fetch: async () => httpErr(429, 'x', {}, { 'retry-after': '60' }) });
  const r = await b.ai.askAI('oi');
  assert.equal(b.calls.length, 1);
  assert.equal(r.ok, false);
});

test('não repete o que não adianta: chave inválida, sem créditos e limite diário', async () => {
  for (const [status, m] of [[401, 'bad key'], [402, 'credits'], [429, 'Rate limit exceeded: free-models-per-day']]) {
    const { ai, calls } = make({ stream: false, fetch: async () => httpErr(status, m) });
    assert.equal((await ai.askAI('oi')).ok, false);
    assert.equal(calls.length, 1, `${status} não deve repetir`);
  }
});

test('na conversa por voz só há uma nova tentativa', async () => {
  const { ai, calls } = make({ stream: false, fetch: async () => httpErr(503, 'down') });
  assert.equal((await ai.askAI('oi', { voice: true })).ok, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.reasoning.effort, 'low');
});

test('falha de rede também é repetida; outros provedores não repetem', async () => {
  const net = make({ stream: false, fetch: async (_r, n) => { if (n === 1) throw new TypeError('fetch failed'); return orJson('ok'); } });
  assert.equal((await net.ai.askAI('oi')).ok, true);
  assert.equal(net.calls.length, 2);
  const local = make({ cfg: AIC.normalizeConfig({ provider: 'custom', custom: { url: 'http://l/v1', model: 'm' } }), stream: false, fetch: async () => httpErr(503, 'x') });
  assert.equal((await local.ai.askAI('oi')).ok, false);
  assert.equal(local.calls.length, 1);
});

// ---------- <think> ----------
test('filtro de <think>: some com o raciocínio mesmo com a tag partida entre pedaços', () => {
  let out = '';
  const f = AS.createThinkFilter((t) => { out += t; });
  for (const c of ['[happy] Oi <th', 'ink>pensando...</thi', 'nk>  tudo bem', '? <', 'b>']) f.push(c);
  f.end();
  assert.equal(out, '[happy] Oi tudo bem? <b>');
  let o2 = ''; const g = AS.createThinkFilter((t) => { o2 += t; });
  g.push('<think>nunca fecha'); g.end();
  assert.equal(o2, '');
});

test('o raciocínio entre <think> não aparece na resposta (streaming e modo normal)', async () => {
  const s = make({ fetch: async () => okStream([delta('<thi'), delta('nk>vou pensar</think>[happy] Oi'), delta('!')]) });
  const r = await s.ai.askAI('oi');
  assert.equal(r.text, 'Oi!');
  const n = make({ stream: false, fetch: async () => orJson('<think>hm</think>\n[happy] Oi!') });
  assert.equal((await n.ai.askAI('oi')).text, 'Oi!');
});

// ---------- modelos e chave ----------
test('lista de modelos: só texto, auto primeiro, gratuitos depois, com contexto e preço', async () => {
  const data = [
    { id: 'z/pago', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, architecture: { output_modalities: ['text'] } },
    { id: 'a/img', context_length: 32000, pricing: { prompt: '0.000001', completion: '0.000002' }, architecture: { output_modalities: ['image', 'text'] } },
    { id: 'm/livre:free', context_length: 131072, pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } },
    { id: 'openrouter/auto', context_length: 2000000, pricing: { prompt: '-1', completion: '-1' }, architecture: { output_modalities: ['text'] } },
  ];
  const d = await AIC.listModelsDetailed({ provider: 'openrouter' }, AIC.normalizeConfig({}), async () => okJson({ data }));
  assert.deepEqual(d.ids, ['openrouter/auto', 'm/livre:free', 'z/pago']);
  assert.equal(d.labels['m/livre:free'], '131k · grátis');
  assert.equal(d.labels['z/pago'], '200k · US$ 3/15 por 1M');
  assert.equal(d.labels['openrouter/auto'], '2000k · preço varia');
  assert.deepEqual(await AIC.listModels({ provider: 'openrouter' }, AIC.normalizeConfig({}), async () => okJson({ data })), d.ids);
});

test('saldo da chave: frase curta e falha silenciosa', async () => {
  assert.equal(OR.describeKey({ limit_remaining: 4.2, is_free_tier: false }), 'saldo da chave: US$ 4.20');
  assert.match(OR.describeKey({ usage: 0, limit_remaining: null, is_free_tier: true }), /já gasto: US\$ 0\.00 · conta sem créditos.*50/);
  assert.equal(OR.describeKey(null), '');
  assert.equal(await OR.keyInfo('k', async () => { throw new Error('rede'); }), null);
  const { ai } = make({ fetch: async (req) => (/\/key$/.test(req.url) ? okJson({ data: { limit_remaining: 1.5 } }) : orJson('ok')) });
  assert.equal(await ai.keyInfo(), 'saldo da chave: US$ 1.50');
  const local = make({ cfg: AIC.normalizeConfig({ provider: 'ollama' }), fetch: async () => { throw new Error('não deve chamar'); } });
  assert.equal(await local.ai.keyInfo(), '');
});

// ---------- IPC e painel ----------
function fakeIpc(overrides = {}) {
  const handlers = {};
  let cfg = AIC.normalizeConfig({ provider: 'openrouter', openrouter: { apiKey: 'sk-or-1234' } });
  registerIaIpc({
    ipcMain: { handle: (n, f) => { handlers[n] = f; } },
    ai: { listModels: async () => ['x'], ...overrides.ai }, askAI: async () => ({}), callModel: async () => 'ok',
    loadConfig: () => structuredClone(cfg), saveConfig: (c) => { cfg = AIC.normalizeConfig(c); },
    logToPanel() {}, isPanelSender: () => true, getWin: () => ({}), broadcastPanels() {},
    state: { memory: () => [] },
  });
  return { handlers, cfg: () => cfg };
}

test('IPC: salva e devolve as opções extras da OpenRouter (a chave nunca volta)', async () => {
  const { handlers, cfg } = fakeIpc();
  await handlers['set-config']({}, { provider: 'openrouter', model: 'a/b', fallbacks: 'c/d, e/f', sort: 'latency', thinking: 'model' });
  assert.equal(cfg().openrouter.fallbacks, 'c/d, e/f');
  const got = handlers['get-config']({ sender: {} }).providers.openrouter;
  assert.deepEqual([got.fallbacks, got.sort, got.thinking, got.hasKey, got.keyHint], ['c/d, e/f', 'latency', 'model', true, '…1234']);
  assert.equal(JSON.stringify(got).includes('sk-or-1234'), false);
  await handlers['set-config']({}, { provider: 'openrouter', sort: 'invalido' });
  assert.equal(cfg().openrouter.sort, '');
});

test('IPC: Buscar devolve rótulos e Testar acrescenta o saldo; sem isso, funciona como antes', async () => {
  const a = fakeIpc({ ai: { listModelsDetailed: async () => ({ ids: ['x'], labels: { x: '8k · grátis' } }), keyInfo: async () => 'saldo da chave: US$ 2.00' } });
  assert.deepEqual(await a.handlers['list-models']({}, {}), { ok: true, ids: ['x'], labels: { x: '8k · grátis' } });
  assert.equal((await a.handlers['test-config']({ sender: {} })).text, 'ok · saldo da chave: US$ 2.00');
  const b = fakeIpc();
  assert.deepEqual(await b.handlers['list-models']({}, {}), { ok: true, ids: ['x'] });
  assert.equal((await b.handlers['test-config']({ sender: {} })).text, 'ok');
});

test('painel: os campos existem, só aparecem no OpenRouter e entram no que é salvo', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel-ia.js'), 'utf8');
  for (const id of ['orExtra', 'orFallbacks', 'orSort', 'orThinking']) {
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} único`);
    assert.ok(js.includes(`#${id}`), `${id} usado em panel-ia.js`);
  }
  assert.match(js, /hidden = !i\.extras/);
  assert.match(js, /provider'\)\.value === 'openrouter' \? \{ fallbacks/);
});
