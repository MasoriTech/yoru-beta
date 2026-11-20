'use strict';
// Detectar OpenClaw sozinha: lê o openclaw.json, testa o gateway, liga o endpoint (com backup) e não vaza o token ao painel.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../src/openclaw-detect');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-ocd-'));
const resp = (status, json) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
const nowait = async () => {};

test('lenientParse: JSON5 com comentários, vírgula sobrando e chaves sem aspas', () => {
  const r = D.lenientParse(`{ // meu gateway
    gateway: { port: 19000, /* porta */ auth: { mode: 'token', token: "a//b", }, },
  }`);
  assert.equal(r.strict, false);
  assert.equal(r.value.gateway.port, 19000);
  assert.equal(r.value.gateway.auth.token, 'a//b'); // "//" dentro de texto não é comentário
  assert.equal(D.lenientParse('{"a":1}').strict, true);
  assert.equal(D.lenientParse('isso não é json').value, null);
});

test('inspectConfig: porta, token, senha, variável de ambiente e SecretRef', () => {
  assert.deepEqual(
    (({ port, mode, secret, enabled }) => ({ port, mode, secret, enabled }))(D.inspectConfig({ gateway: { port: 19000, auth: { token: 'tk' } } })),
    { port: 19000, mode: 'token', secret: 'tk', enabled: false });
  assert.equal(D.inspectConfig({ gateway: { auth: { mode: 'password', password: 'pw', token: 'tk' } } }).secret, 'pw');
  assert.equal(D.inspectConfig({ gateway: {} }, { OPENCLAW_GATEWAY_TOKEN: 'envtok' }).secret, 'envtok');
  const ref = D.inspectConfig({ gateway: { auth: { token: { source: 'env', id: 'X' } } } });
  assert.equal(ref.secret, ''); assert.equal(ref.secretIsRef, true);
  assert.equal(D.inspectConfig({}).port, 18789);
  assert.equal(D.inspectConfig({ gateway: { port: 99999 } }).port, 18789);
});

test('probe: ok lista agentes; 401 = token; 404/405 = endpoint desligado; sem resposta = down', async () => {
  const mk = (r) => async () => (r instanceof Error ? Promise.reject(r) : r);
  const ok = await D.probe({ port: 1, secret: 's', fetch: mk(resp(200, { data: [{ id: 'openclaw' }, { id: 'openclaw/default' }, { id: 'openclaw/video' }] })) });
  assert.equal(ok.status, 'ok'); assert.deepEqual(ok.agents, ['openclaw', 'openclaw/default', 'openclaw/video']);
  assert.equal((await D.probe({ port: 1, fetch: mk(resp(401)) })).status, 'bad-token');
  assert.equal((await D.probe({ port: 1, fetch: mk(resp(404)) })).status, 'endpoint-off');
  assert.equal((await D.probe({ port: 1, fetch: mk(resp(405)) })).status, 'endpoint-off');
  assert.equal((await D.probe({ port: 1, fetch: mk(new TypeError('fetch failed')) })).status, 'down');
});

test('probe: manda o token e usa a porta pedida, sempre em 127.0.0.1', async () => {
  let seen;
  await D.probe({ port: 19000, secret: 'tk', fetch: async (u, o) => { seen = { u, h: o.headers }; return resp(200, { data: [] }); } });
  assert.equal(seen.u, 'http://127.0.0.1:19000/v1/models');
  assert.equal(seen.h.Authorization, 'Bearer tk');
});

test('detect: tudo certo — acha porta e token e escolhe openclaw/default', async () => {
  const dir = tmp(); const file = path.join(dir, 'openclaw.json');
  fs.writeFileSync(file, JSON.stringify({ gateway: { port: 19000, auth: { token: 'tok-1234567890' }, http: { endpoints: { chatCompletions: { enabled: true } } } } }));
  const calls = [];
  const r = await D.detect({ file, env: {}, fetch: async (u, o) => { calls.push({ u, o }); return resp(200, { data: [{ id: 'openclaw/video' }, { id: 'openclaw/default' }] }); } });
  assert.equal(r.status, 'ok'); assert.equal(r.url, 'http://127.0.0.1:19000/v1');
  assert.equal(r.token, 'tok-1234567890'); assert.equal(r.model, 'openclaw/default');
  assert.equal(r.enabledNow, false);
  assert.ok(!r.tokenHint.includes('1234567'), 'dica do token é mascarada');
  assert.match(D.describe(r), /openclaw\/video/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detect: endpoint desligado — sem enable só avisa; com enable liga, faz backup e confirma', async () => {
  const dir = tmp(); const file = path.join(dir, 'openclaw.json');
  const original = JSON.stringify({ gateway: { auth: { token: 'tok-1234567890' } }, outro: 1 });
  fs.writeFileSync(file, original);
  let on = false; // o "gateway" só passa a responder depois que o arquivo foi alterado
  const fetch = async () => (on ? resp(200, { data: [{ id: 'openclaw/default' }] }) : resp(404));
  const a = await D.detect({ file, env: {}, fetch });
  assert.equal(a.status, 'endpoint-off'); assert.equal(a.canEnable, true);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'sem enable nada é gravado');
  assert.match(D.describe(a), /desligado/);

  let waits = 0;
  const b = await D.detect({ file, env: {}, enable: true, fetch, wait: async () => { waits++; on = true; } });
  assert.equal(b.status, 'ok'); assert.equal(b.enabledNow, true); assert.ok(waits >= 1, 'espera o gateway recarregar');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.gateway.http.endpoints.chatCompletions.enabled, true);
  assert.equal(saved.outro, 1); assert.equal(saved.gateway.auth.token, 'tok-1234567890');
  assert.equal(fs.readFileSync(b.backup, 'utf8'), original);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detect: JSON5 não é reescrito (mas é lido); mostra o trecho para colar', async () => {
  const dir = tmp(); const file = path.join(dir, 'openclaw.json');
  const json5 = '{ // comentário\n gateway: { port: 19001, auth: { token: "t-123456789" }, }, }';
  fs.writeFileSync(file, json5);
  const down = async () => resp(404);
  const a = await D.detect({ file, env: {}, fetch: down });
  assert.equal(a.url, 'http://127.0.0.1:19001/v1'); assert.equal(a.canEnable, false);
  const b = await D.detect({ file, env: {}, enable: true, fetch: down });
  assert.equal(b.status, 'not-json'); assert.match(D.describe(b), /chatCompletions/);
  assert.equal(fs.readFileSync(file, 'utf8'), json5);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detect: sem arquivo e sem gateway = no-config; gateway fora do ar = down; token errado = bad-token', async () => {
  const dir = tmp(); const none = path.join(dir, 'nao-existe.json');
  const refuse = async () => { throw new TypeError('fetch failed'); };
  assert.equal((await D.detect({ file: none, env: {}, fetch: refuse })).status, 'no-config');
  const file = path.join(dir, 'openclaw.json');
  fs.writeFileSync(file, JSON.stringify({ gateway: { auth: { token: 'abcdefghij' } } }));
  assert.equal((await D.detect({ file, env: {}, fetch: refuse })).status, 'down');
  assert.equal((await D.detect({ file, env: {}, fetch: async () => resp(401) })).status, 'bad-token');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('detect: modo "none" não exige token (usa um texto qualquer no campo)', async () => {
  const dir = tmp(); const file = path.join(dir, 'openclaw.json');
  fs.writeFileSync(file, JSON.stringify({ gateway: { auth: { mode: 'none' } } }));
  let auth = 'x';
  const r = await D.detect({ file, env: {}, fetch: async (u, o) => { auth = o.headers.Authorization; return resp(200, { data: [{ id: 'openclaw' }] }); } });
  assert.equal(r.status, 'ok'); assert.equal(auth, undefined); assert.equal(r.token, 'sem-token');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- fiação: IPC, preload e painel ----------
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
test('IPC: o token fica no processo principal e só o painel autorizado chama', () => {
  const ipc = read('ipc-ia.js');
  const det = ipc.slice(ipc.indexOf("'openclaw-detect'"), ipc.indexOf("'openclaw-skills'"));
  assert.match(det, /panelOnly\(e\)/);
  assert.match(det, /saveConfig\(c\)/);
  const ret = det.slice(det.indexOf('return { ok: r.status'));
  assert.ok(!/token\b(?!Hint)/.test(ret.split('\n')[0]), 'o retorno ao painel não leva o token');
  assert.match(ipc.slice(ipc.indexOf("'openclaw-skills'")), /panelOnly\(e\)/);
});
test('preload e painel: botões ligados aos canais certos', () => {
  assert.match(read('panel-preload.js'), /openclawDetect:[^\n]*'openclaw-detect'/);
  assert.match(read('panel-preload.js'), /openclawSkills:[^\n]*'openclaw-skills'/);
  const html = read('panel.html'), js = read('panel-ia.js');
  for (const id of ['ocDetect', 'ocSkills', 'ocStatus', 'ocSkillList', 'openclawTools']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /id="openclawTools"[^>]*hidden/);
  assert.match(js, /openclawTools'\)\.hidden = p !== 'openclaw'/);
  assert.match(js, /panel\.openclawDetect/); assert.match(js, /panel\.openclawSkills/);
  assert.match(js, /confirm\(/); // pede permissão antes de mexer no arquivo do OpenClaw
});
test('limite de chamadas para os canais novos', () => {
  const sec = read('ipc-security.js');
  assert.match(sec, /'openclaw-detect':/); assert.match(sec, /'openclaw-skills':/);
});
