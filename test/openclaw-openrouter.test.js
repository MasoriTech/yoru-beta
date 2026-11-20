'use strict';
// Colar a chave do OpenRouter no Yoru -> vai para o OpenClaw (env.vars.OPENROUTER_API_KEY) e o agente usa um modelo gratuito.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const AIC = require('../src/ai-core');
const D = require('../src/openclaw-detect');
const { registerIaIpc } = require('../src/ipc-ia');

const KEY = 'sk-or-v1-abcdef0123456789abcdef';
const MODELS = [
  { id: 'openrouter/auto', context_length: 2000000, pricing: { prompt: '-1', completion: '-1' } },
  { id: 'google/gemma-free-notools:free', context_length: 900000, supported_parameters: ['temperature'] },
  { id: 'qwen/qwen3-big:free', context_length: 262144, supported_parameters: ['tools', 'temperature'] },
  { id: 'vendor/zero-price', context_length: 32000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
  { id: 'anthropic/claude-sonnet', context_length: 200000, pricing: { prompt: '0.003', completion: '0.015' }, supported_parameters: ['tools'] },
  { id: 'vendor/image:free', context_length: 8000, architecture: { output_modalities: ['image'] }, supported_parameters: ['tools'] },
];

test('freeModels/pickFreeModel: só gratuitos, só texto, só com ferramentas; maior contexto primeiro', () => {
  assert.deepEqual(D.freeModels(MODELS), ['qwen/qwen3-big:free', 'vendor/zero-price']);
  assert.equal(D.pickFreeModel(MODELS), 'qwen/qwen3-big:free');
  assert.equal(D.pickFreeModel([...MODELS, { id: D.FALLBACK_FREE, context_length: 128000 }]), D.FALLBACK_FREE, 'prefere o da documentação se existir');
  assert.equal(D.pickFreeModel([]), D.FALLBACK_FREE); // lista vazia/offline: cai no padrão
});

test('backendModelRef: completa o prefixo openrouter/', () => {
  assert.equal(D.backendModelRef('meta-llama/x:free'), 'openrouter/meta-llama/x:free');
  assert.equal(D.backendModelRef('openrouter/a/b:free'), 'openrouter/a/b:free');
  assert.equal(D.backendModelRef('  '), '');
});

test('setOpenRouterKey: grava em env, preserva o resto, faz backup SEM a chave; JSON5 e chave ruim são recusados', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-ort-')); const file = path.join(dir, 'openclaw.json');
  const original = JSON.stringify({ gateway: { auth: { token: 'tok' } }, env: { OUTRA: '1' } });
  fs.writeFileSync(file, original);
  const r = D.setOpenRouterKey(file, KEY);
  assert.equal(r.ok, true); assert.equal(r.changed, true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.env.vars.OPENROUTER_API_KEY, KEY); assert.equal(saved.env.OUTRA, '1'); assert.ok(!('OPENROUTER_API_KEY' in saved.env)); assert.equal(saved.gateway.auth.token, 'tok');
  assert.equal(fs.readFileSync(r.backup, 'utf8'), original); assert.ok(!fs.readFileSync(r.backup, 'utf8').includes(KEY));
  assert.deepEqual(D.setOpenRouterKey(file, KEY), { ok: true, changed: false }); // já estava: nada a fazer, sem novo backup
  assert.equal(D.setOpenRouterKey(file, 'chave-qualquer').reason, 'bad-key');
  fs.writeFileSync(file, '{ // x\n env: {}, }');
  assert.equal(D.setOpenRouterKey(file, KEY).reason, 'not-json');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('buildRequest: x-openclaw-model só vai quando há modelo de backend', () => {
  const msgs = [{ role: 'user', content: 'oi' }];
  const off = AIC.buildRequest(AIC.normalizeConfig({ provider: 'openclaw', openclaw: { apiKey: 'k' } }), msgs, 'S', false, 1);
  assert.ok(!('x-openclaw-model' in off.headers));
  const on = AIC.buildRequest(AIC.normalizeConfig({ provider: 'openclaw', openclaw: { apiKey: 'k', backendModel: ' openrouter/qwen/q:free ' } }), msgs, 'S', false, 1);
  assert.equal(on.headers['x-openclaw-model'], 'openrouter/qwen/q:free');
  assert.equal(on.body.model, 'openclaw/default', 'o campo model continua apontando o agente');
});

// ---------- o handler de verdade, com arquivo e rede de mentira ----------
function setup(t, { json, saved = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-ort-ipc-')); const file = path.join(dir, 'openclaw.json');
  if (json !== undefined) fs.writeFileSync(file, json);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const handlers = new Map(); let cfg = AIC.normalizeConfig({ provider: 'openclaw', openclaw: { apiKey: 'tok' }, ...saved });
  const urls = [];
  registerIaIpc({
    ipcMain: { handle: (n, f) => handlers.set(n, f) }, askAI: async () => ({}), callModel: async () => 'x',
    loadConfig: () => structuredClone(cfg), saveConfig: (c) => { cfg = structuredClone(c); }, logToPanel() {}, isPanelSender: () => true,
    getWin: () => null, broadcastPanels() {}, dialog: {}, state: { memory: () => [], memChanged() {}, profile: () => ({}), setProfile() {}, profileFile: () => '', masoriFile: () => path.join(dir, 'm.json') },
    openclawConfigPath: () => file,
    fetchImpl: async (u) => { urls.push(u); return { ok: true, json: async () => ({ data: MODELS }) }; },
  });
  const call = (p) => handlers.get('openclaw-openrouter')({ sender: {} }, p);
  return { call, file, cfg: () => cfg, urls };
}

test('handler: chave colada vai para o openclaw.json, modelo :free é escolhido e a chave não volta para o painel', async (t) => {
  const s = setup(t, { json: JSON.stringify({ gateway: { auth: { token: 'tok' } } }) });
  const r = await s.call({ key: KEY });
  assert.equal(r.ok, true); assert.equal(r.model, 'openrouter/qwen/qwen3-big:free');
  assert.ok(!JSON.stringify(r).includes(KEY), 'a resposta ao painel não leva a chave');
  assert.equal(JSON.parse(fs.readFileSync(s.file, 'utf8')).env.vars.OPENROUTER_API_KEY, KEY);
  assert.equal(s.cfg().openclaw.backendModel, 'openrouter/qwen/qwen3-big:free');
  assert.equal(s.cfg().openrouter.apiKey, KEY, 'fica salva também no provedor OpenRouter do Yoru');
  assert.match(r.text, /Reinicie o gateway/);
  assert.match(s.urls[0], /openrouter\.ai\/api\/v1\/models$/);
});

test('handler: campo vazio usa a chave já salva no Yoru; modelo escolhido à mão vale', async (t) => {
  const s = setup(t, { json: '{}', saved: { openrouter: { apiKey: KEY } } });
  const r = await s.call({ key: '', model: 'meta-llama/llama-3.3-70b-instruct:free' });
  assert.equal(r.ok, true); assert.equal(r.model, 'openrouter/meta-llama/llama-3.3-70b-instruct:free');
  assert.equal(s.urls.length, 0, 'modelo informado: nem precisa consultar a lista');
  assert.equal(JSON.parse(fs.readFileSync(s.file, 'utf8')).env.vars.OPENROUTER_API_KEY, KEY);
});

test('handler: modelo pago é aceito, mas avisa do custo', async (t) => {
  const s = setup(t, { json: '{}' });
  const r = await s.call({ key: KEY, model: 'anthropic/claude-sonnet' });
  assert.match(r.text, /não é :free/);
});

test('handler: sem chave válida, sem arquivo ou JSON5 = explica e não grava nada', async (t) => {
  assert.match((await setup(t, { json: '{}' }).call({ key: 'abc' })).text, /sk-or-/);
  assert.match((await setup(t).call({ key: KEY })).text, /Não achei/);
  const j5 = '{ // c\n env: {}, }'; const s = setup(t, { json: j5 });
  const r = await s.call({ key: KEY });
  assert.equal(r.ok, false); assert.match(r.text, /onboard/); assert.ok(!r.text.includes(KEY));
  assert.equal(fs.readFileSync(s.file, 'utf8'), j5); assert.equal(s.cfg().openclaw.backendModel, '');
});

test('handler: "voltar ao modelo do OpenClaw" limpa o modelo forçado', async (t) => {
  const s = setup(t, { json: '{}', saved: { openclaw: { apiKey: 'tok', backendModel: 'openrouter/x/y:free' } } });
  const r = await s.call({ clear: true });
  assert.equal(r.ok, true); assert.equal(s.cfg().openclaw.backendModel, '');
});

test('painel: campos, botões, confirmação e canal protegido', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const html = read('panel.html'), js = read('panel-ia.js');
  for (const id of ['ocOrKey', 'ocBackendModel', 'ocFree', 'ocFreeOff']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /id="ocOrKey"[^>]*type="password"|type="password"[^>]*id="ocOrKey"/);
  assert.match(js, /panel\.openclawOpenRouter/); assert.match(js, /confirm\(/);
  assert.match(read('panel-preload.js'), /openclawOpenRouter:[^\n]*'openclaw-openrouter'/);
  assert.match(read('ipc-security.js'), /'openclaw-openrouter':/);
});

test('migra a chave gravada do jeito antigo (env.OPENROUTER_API_KEY) para env.vars', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-ort-')); const file = path.join(dir, 'openclaw.json');
  fs.writeFileSync(file, JSON.stringify({ env: { OPENROUTER_API_KEY: KEY }, gateway: { port: 1 } }));
  const r = D.setOpenRouterKey(file, KEY);
  assert.ok(r.ok && r.changed);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.env.vars.OPENROUTER_API_KEY, KEY); assert.ok(!('OPENROUTER_API_KEY' in j.env)); assert.equal(j.gateway.port, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
