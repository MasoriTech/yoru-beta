'use strict';
// Conexão automática com o OpenClaw: descobre o token certo em várias fontes, se reconecta sozinha no 401 e ao abrir o app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const D = require('../src/openclaw-detect');
const AIC = require('../src/ai-core');
const { createConnector } = require('../src/openclaw-connect');

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-con-')); return { d, file: path.join(d, 'openclaw.json') }; };
// gateway de mentira: só aceita o token `good`
const gw = (good, { onCall } = {}) => async (url, init) => {
  if (onCall) onCall(url, init);
  const h = (init && init.headers && init.headers.Authorization) || '';
  if (h !== `Bearer ${good}`) return { ok: false, status: 401, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ data: [{ id: 'openclaw/default' }] }) };
};
const cfgFile = (file, auth = {}, extra = {}) => fs.writeFileSync(file, JSON.stringify({ gateway: { port: 18789, auth, http: { endpoints: { chatCompletions: { enabled: true } } } }, ...extra }));

test('parseDotenv e parseCmdEnv', () => {
  assert.deepEqual(D.parseDotenv('# x\nexport OPENCLAW_GATEWAY_TOKEN="abc12345"\nB=2'), { OPENCLAW_GATEWAY_TOKEN: 'abc12345', B: '2' });
  assert.equal(D.parseCmdEnv('@echo off\r\nset "OPENCLAW_GATEWAY_TOKEN=tok-12345678"\r\nset OUTRA=1').OPENCLAW_GATEWAY_TOKEN, 'tok-12345678');
});

test('detect: o token do arquivo está velho; acha o certo no .env / gateway.cmd / variável / SecretRef', async () => {
  for (const where of ['dotenv', 'cmd', 'env', 'ref', 'vars']) {
    const { d, file } = tmp();
    cfgFile(file, where === 'ref' ? { mode: 'token', token: { source: 'env', id: 'MEU_TOKEN' } } : { mode: 'token', token: 'velho-velho-velho' },
      where === 'vars' ? { env: { vars: { OPENCLAW_GATEWAY_TOKEN: 'certo-12345678' } } } : {});
    let env = {};
    if (where === 'dotenv') fs.writeFileSync(path.join(d, '.env'), 'OPENCLAW_GATEWAY_TOKEN=certo-12345678\n');
    if (where === 'cmd') fs.writeFileSync(path.join(d, 'gateway.cmd'), '@echo off\r\nset "OPENCLAW_GATEWAY_TOKEN=certo-12345678"\r\n');
    if (where === 'env') env = { OPENCLAW_GATEWAY_TOKEN: 'certo-12345678' };
    if (where === 'ref') env = { MEU_TOKEN: 'certo-12345678' };
    const r = await D.detect({ file, env, fetch: gw('certo-12345678') });
    assert.equal(r.status, 'ok', where); assert.equal(r.token, 'certo-12345678', where);
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('detect: aceita a senha quando o modo declarado é token (e vice-versa); por último pergunta ao CLI', async () => {
  const a = tmp();
  cfgFile(a.file, { mode: 'token', token: 'velho-velho-velho', password: 'senha-12345678' });
  assert.equal((await D.detect({ file: a.file, env: {}, fetch: gw('senha-12345678') })).token, 'senha-12345678');
  const b = tmp();
  cfgFile(b.file, { mode: 'token', token: { source: 'exec' } }); // SecretRef que só o CLI resolve
  const exec = async (args) => (args[2] === 'gateway.auth.token' ? { code: 0, out: 'OpenClaw 2026.11.5 — frase\n|\no\ncerto-do-cli-123\n', err: '' } : { code: 1, out: '', err: '' });
  const r = await D.detect({ file: b.file, env: {}, fetch: gw('certo-do-cli-123'), exec });
  assert.equal(r.status, 'ok'); assert.equal(r.token, 'certo-do-cli-123');
  // nenhum serve: bad-token, e o painel nunca recebe os candidatos
  const c = await D.detect({ file: a.file, env: {}, fetch: gw('outro-12345678'), exec: async () => ({ code: 1, out: '', err: '' }) });
  assert.equal(c.status, 'bad-token');
  for (const x of [a, b]) fs.rmSync(x.d, { recursive: true, force: true });
});

test('connector.reconnect: acha o token novo, salva, e junta chamadas simultâneas', async () => {
  const { d, file } = tmp();
  cfgFile(file, { mode: 'token', token: 'novo-novo-novo' });
  let conf = AIC.normalizeConfig({ provider: 'openclaw', openclaw: { apiKey: 'antigo-antigo' } });
  let hits = 0;
  const detect = (o) => D.detect({ ...o, file, env: {}, fetch: gw('novo-novo-novo', { onCall: () => hits++ }) });
  const c = createConnector({ detect, exec: async () => ({ code: 0, out: '', err: '' }), loadConfig: () => conf, saveConfig: (x) => { conf = x; }, wait: async () => {} });
  const [a, b] = await Promise.all([c.reconnect(), c.reconnect()]);
  assert.ok(a.ok && a.changed); assert.strictEqual(a, b); // uma tentativa só
  assert.equal(conf.openclaw.apiKey, 'novo-novo-novo');
  fs.rmSync(d, { recursive: true, force: true });
});

test('connector: gateway parado -> inicia; token preso na memória -> reinicia; falha tem espera antes de insistir', async () => {
  const { d, file } = tmp();
  cfgFile(file, { mode: 'token', token: 'tok-12345678' });
  let conf = AIC.normalizeConfig({ provider: 'openclaw', openclaw: { apiKey: 'tok-12345678' } });
  const cmds = []; let started = false;
  const exec = async (a) => { cmds.push(a.join(' ')); if (a[1] === 'start') started = true; return { code: 0, out: '', err: '' }; };
  const fetch = async (u, i) => { if (!started) throw new Error('ECONNREFUSED'); return gw('tok-12345678')(u, i); };
  const detect = (o) => D.detect({ ...o, file, env: {}, fetch });
  const c = createConnector({ detect, exec, loadConfig: () => conf, saveConfig: (x) => { conf = x; }, wait: async () => {} });
  const r = await c.reconnect();
  assert.ok(r.ok); assert.ok(cmds.includes('gateway start'));
  // sempre recusado: tenta reiniciar, falha, e a segunda chamada logo em seguida nem tenta de novo
  let t = 1000; cmds.length = 0;
  const bad = createConnector({ detect: (o) => D.detect({ ...o, file, env: {}, fetch: gw('outro-12345678') }), exec, loadConfig: () => conf, saveConfig() {}, wait: async () => {}, now: () => t });
  assert.equal((await bad.reconnect()).ok, false); assert.ok(cmds.includes('gateway restart'));
  const n = cmds.length; await bad.reconnect(); assert.equal(cmds.length, n, 'cooldown');
  t += 60000; await bad.reconnect(); assert.ok(cmds.length > n, 'depois da espera tenta de novo');
  fs.rmSync(d, { recursive: true, force: true });
});

test('ai-core: 401 do OpenClaw -> reconecta e repete UMA vez com o token novo (resposta normal e em fluxo)', async () => {
  const cfg = AIC.normalizeConfig({ provider: 'openclaw', openclaw: { url: 'http://127.0.0.1:18789/v1', apiKey: 'velho-velho' } });
  const seen = []; let healed = 0;
  const fetch = async (url, init) => {
    seen.push(init.headers.Authorization);
    if (init.headers.Authorization !== 'Bearer novo-novo-novo') return { ok: false, status: 401, text: async () => '{}' };
    const sse = 'data: {"choices":[{"delta":{"content":"oi"}}]}\n\ndata: [DONE]\n\n';
    return init.body.includes('"stream":true') ? { ok: true, status: 200, body: (async function* () { yield sse; })() } : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'oi' } }] }) };
  };
  const mk = (reconnect) => AIC.createAI({ getSettings: () => ({ historyLimit: 20, maxTokens: 400 }), loadConfig: () => cfg, buildSystem: () => 'S', fetch, reconnectOpenclaw: reconnect });
  const ai = mk(async () => { healed++; return { ok: true, apiKey: 'novo-novo-novo', url: 'http://127.0.0.1:18789/v1' }; });
  assert.equal(await ai.callModel([{ role: 'user', content: 'x' }], cfg, 'S'), 'oi');
  assert.deepEqual(seen, ['Bearer velho-velho', 'Bearer novo-novo-novo']); assert.equal(healed, 1);
  // sem conseguir reconectar: o erro volta com a dica do botão Reparar, sem repetir o pedido
  seen.length = 0;
  const ai2 = mk(async () => ({ ok: false }));
  await assert.rejects(() => ai2.callModel([{ role: 'user', content: 'x' }], cfg, 'S'), /Abrir e deixar pronto/);
  assert.equal(seen.length, 1);
  // mesmo token de volta: não adianta repetir
  seen.length = 0;
  const ai3 = mk(async () => ({ ok: true, apiKey: 'velho-velho' }));
  await assert.rejects(() => ai3.callModel([{ role: 'user', content: 'x' }], cfg, 'S'), /401/);
  assert.equal(seen.length, 1);
});

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
test('fiação: main cria o conector, liga no ai-core, no IPC e confere ao abrir', () => {
  const m = read('main.js');
  assert.match(m, /reconnectOpenclaw: \(\) => ocConnector\.reconnect\(\)/);
  assert.match(m, /registerIaIpc\(\{\s*ocConnector,/);
  assert.match(m, /ocConnector\.ensure\(\)/);
  assert.match(read('ipc-ia.js'), /ocConnector\.saveDetected\(r\)/);
});

test('connector: se a leitura leve falha com token recusado, escala para o reparo completo (uma vez por janela)', async () => {
  const { d, file } = tmp();
  cfgFile(file, { mode: 'token', token: 'velho-velho-velho' });
  let conf = AIC.normalizeConfig({ provider: 'openclaw', openclaw: { apiKey: 'velho-velho-velho' } });
  let deepRuns = 0, t = 0;
  const deep = async ({ save }) => { deepRuns++; save({ url: 'http://127.0.0.1:18789/v1', token: 'token-novo-12345678', agents: ['openclaw/default'], model: 'openclaw/default' }); return { ok: true }; };
  const c = createConnector({ detect: (o) => D.detect({ ...o, file, env: {}, fetch: gw('outro-12345678') }), exec: async () => ({ code: 0, out: '', err: '' }), deep,
    loadConfig: () => conf, saveConfig: (x) => { conf = x; }, wait: async () => {}, now: () => t });
  const r = await c.reconnect();
  assert.ok(r.ok && r.deep); assert.equal(r.apiKey, 'token-novo-12345678'); assert.equal(conf.openclaw.apiKey, 'token-novo-12345678'); assert.equal(deepRuns, 1);
  t += 40000; const again = await c.reconnect(); // falhou? não: o detect leve ainda recusa, mas o reparo completo só roda de novo depois da janela
  assert.equal(deepRuns, 1); assert.equal(again.ok, false);
  fs.rmSync(d, { recursive: true, force: true });
});
