'use strict';
// "Reparar OpenClaw": identifica e resolve sozinha config inválida, gateway parado e token recusado.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../src/openclaw-repair');

const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-rep-')); return { d, file: path.join(d, 'openclaw.json') }; };
const OUT = [
  'Config needs correction: ~\\.openclaw\\openclaw.json',
  '  - openclaw.json:447 — meta: Unrecognized key: "lastTouchedAt"',
  '  - openclaw.json:57 — gateway.controlUi: Unrecognized key: "allowInsecureAuth"',
  '  - openclaw.json:53 — gateway.tailscale: Unrecognized key: "resetOnExit"',
  '  - openclaw.json:60 — gateway.nodes: Unrecognized key: "denyCommands"',
].join('\n');

test('parseUnrecognized lê as linhas do config validate (com cor, vários nomes, raiz)', () => {
  const l = R.parseUnrecognized('\x1b[31m' + OUT + '\x1b[0m\n  - <root>: Unrecognized keys: "a", "b"\n  - x: Invalid input');
  assert.deepEqual(l.map((i) => [...i.path, i.key].join('.')), ['meta.lastTouchedAt', 'gateway.controlUi.allowInsecureAuth', 'gateway.tailscale.resetOnExit', 'gateway.nodes.denyCommands', 'a', 'b']);
  assert.deepEqual(R.parseUnrecognized('  - gateway.x: Unrecognized key: "../../evil"'), []); // nome estranho é ignorado
});

test('fixConfig: tira só as chaves apontadas, migra env solta, faz backup e termina válido', async () => {
  const { d, file } = tmp();
  const cfg = { meta: { lastTouchedAt: 'x', keep: 1 }, env: { OPENROUTER_API_KEY: 'sk-or-v1-abcdefghijk' }, gateway: { mode: 'local', controlUi: { allowInsecureAuth: true }, tailscale: { resetOnExit: false }, nodes: { denyCommands: ['a'] } } };
  fs.writeFileSync(file, JSON.stringify(cfg));
  let calls = 0;
  const exec = async () => { calls++; const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j.meta.lastTouchedAt !== undefined ? { code: 1, out: OUT, err: '' } : { code: 0, out: 'Config valid', err: '' }; };
  const r = await R.fixConfig({ file, exec });
  assert.ok(r.ok && r.valid);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.env.vars.OPENROUTER_API_KEY, 'sk-or-v1-abcdefghijk'); assert.ok(!('OPENROUTER_API_KEY' in j.env));
  assert.equal(j.meta.keep, 1); assert.equal(j.gateway.mode, 'local');
  assert.ok(!('allowInsecureAuth' in j.gateway.controlUi) && !('denyCommands' in j.gateway.nodes));
  assert.deepEqual(JSON.parse(fs.readFileSync(r.backup, 'utf8')), cfg); // a cópia é do arquivo ANTES de mexer
  assert.ok(calls >= 2);
  fs.rmSync(d, { recursive: true, force: true });
});

test('fixConfig: arquivo ilegível volta para o .last-good e guarda o quebrado', async () => {
  const { d, file } = tmp();
  fs.writeFileSync(file, '{ "nodes": { "camera.snap", "camera.clip" } }');
  fs.writeFileSync(file + '.last-good', JSON.stringify({ gateway: { mode: 'local' } }));
  const r = await R.fixConfig({ file, exec: async () => ({ code: 0, out: 'ok', err: '' }) });
  assert.ok(r.ok && r.valid);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).gateway.mode, 'local');
  assert.match(fs.readFileSync(r.backup, 'utf8'), /camera\.snap/);
  fs.rmSync(d, { recursive: true, force: true });
});

test('fixConfig: JSON5 com comentários não é reescrito; sem last-good avisa; sem arquivo avisa', async () => {
  const a = tmp();
  const j5 = '{ // meu\n gateway: { mode: "local", }, }';
  fs.writeFileSync(a.file, j5);
  const r = await R.fixConfig({ file: a.file, exec: async () => { throw new Error('não devia validar'); } });
  assert.equal(r.reason, 'json5'); assert.equal(fs.readFileSync(a.file, 'utf8'), j5);
  fs.writeFileSync(a.file, '{ "a": ,, }');
  assert.equal((await R.fixConfig({ file: a.file, exec: async () => ({ code: 0, out: '', err: '' }) })).reason, 'broken');
  assert.equal((await R.fixConfig({ file: path.join(a.d, 'nao-existe.json'), exec: async () => ({}) })).reason, 'no-file');
  fs.rmSync(a.d, { recursive: true, force: true });
});

test('repairAll: gateway parado -> instala e inicia, relê o token e salva', async () => {
  const { d, file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ gateway: { mode: 'local' } }));
  const cmds = []; let up = false; const saved = []; const seen = [];
  const exec = async (args) => { cmds.push(args.join(' ')); if (args[1] === 'start') up = true; return { code: 0, out: 'Config valid', err: '' }; };
  const detect = async () => (up ? { status: 'ok', url: 'http://127.0.0.1:18789/v1', token: 'novo', agents: ['openclaw/default'], model: 'openclaw/default', notes: [] } : { status: 'down', notes: [], agents: [] });
  const r = await R.repairAll({ file, exec, detect, save: (x) => saved.push(x), report: (t) => seen.push(t), wait: async () => {} });
  assert.ok(r.ok);
  assert.ok(cmds.includes('gateway install') && cmds.includes('gateway start'));
  assert.equal(saved[0].token, 'novo');
  assert.ok(seen.some((t) => /parado/.test(t)));
  fs.rmSync(d, { recursive: true, force: true });
});

test('repairAll: token recusado -> reinicia o gateway e tenta de novo; falha vira mensagem', async () => {
  const { d, file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ gateway: { mode: 'local' } }));
  const cmds = []; let restarted = false;
  const exec = async (args) => { cmds.push(args.join(' ')); if (args[1] === 'restart') restarted = true; return { code: 0, out: 'Config valid', err: '' }; };
  const detect = async () => (restarted ? { status: 'ok', url: 'u', token: 't', agents: [], model: 'm', notes: [] } : { status: 'bad-token', notes: [], agents: [] });
  assert.ok((await R.repairAll({ file, exec, detect, save() {}, wait: async () => {} })).ok);
  assert.ok(cmds.includes('gateway restart'));
  const bad = await R.repairAll({ file, exec: async () => ({ code: 0, out: 'ok', err: '' }), detect: async () => ({ status: 'bad-token', notes: [], agents: [] }), save() {}, wait: async () => {} });
  assert.equal(bad.ok, false); assert.match(bad.text, /✖/);
  fs.rmSync(d, { recursive: true, force: true });
});

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
test('fiação: IPC só do painel, limite, preload e botão', () => {
  const ipc = read('ipc-ia.js');
  assert.match(ipc.slice(ipc.indexOf("'openclaw-repair'")), /panelOnly\(e\)/);
  assert.match(read('ipc-security.js'), /'openclaw-repair':/);
  assert.match(read('panel-preload.js'), /openclawRepair:[^\n]*'openclaw-repair'/);
  assert.ok(read('panel.html').includes('id="ocRepair"'));
  assert.match(read('panel-ia.js'), /panel\.openclawRepair/);
  assert.match(read('panel-ia.js').slice(read('panel-ia.js').indexOf('async function ocRepair')), /confirm\(/);
});

// ---------- "ponto de bala": define o token, cria a config, sobe o gateway ----------
const D = require('../src/openclaw-detect');
const gwFake = (file) => async (url, init) => { // gateway de mentira: aceita o token que está no arquivo SE já foi "reiniciado"
  const want = global.__served;
  const h = (init && init.headers && init.headers.Authorization) || '';
  if (!want) throw new Error('ECONNREFUSED');
  if (h !== `Bearer ${want}`) return { ok: false, status: 401, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ data: [{ id: 'openclaw/default' }] }) };
};

test('repairAll: nenhum token serve -> define um token novo no arquivo, reinicia e conecta', async () => {
  const { d, file } = tmp();
  fs.writeFileSync(file, JSON.stringify({ gateway: { mode: 'local', auth: { mode: 'token', token: 'velho-velho-velho' }, http: { endpoints: { chatCompletions: { enabled: true } } } } }));
  global.__served = 'token-que-o-gateway-tem-na-memoria'; // o gateway só aceita este, que não está em lugar nenhum
  const cmds = []; const saved = [];
  const exec = async (args) => {
    cmds.push(args.join(' '));
    if (args[1] === 'restart') { const ft = JSON.parse(fs.readFileSync(file, 'utf8')).gateway.auth.token; if (ft !== 'velho-velho-velho') global.__served = ft; } // o token velho está preso em outro lugar (ex.: serviço): só um token novo no arquivo passa a valer
    return { code: 0, out: 'Config valid', err: '' };
  };
  const detect = (o) => D.detect({ ...o, file, env: {}, fetch: gwFake(file), wait: async () => {} });
  const r = await R.repairAll({ file, exec, detect, save: (x) => saved.push(x), wait: async () => {} });
  assert.ok(r.ok, r.text);
  const t = JSON.parse(fs.readFileSync(file, 'utf8')).gateway.auth.token;
  assert.match(t, /^[0-9a-f]{48}$/); assert.equal(saved[0].token, t);
  assert.ok(cmds.filter((c) => c === 'gateway restart').length >= 2); // um restart leve e o do token novo
  assert.ok(fs.readdirSync(d).some((f) => f.includes('.yoru-bak-')));
  fs.rmSync(d, { recursive: true, force: true }); delete global.__served;
});

test('repairAll: sem openclaw.json -> cria config mínima válida, instala/inicia o gateway e conecta', async () => {
  const { d, file } = tmp();
  global.__served = ''; const cmds = [];
  const exec = async (args) => { cmds.push(args.join(' ')); if (args[1] === 'start') global.__served = JSON.parse(fs.readFileSync(file, 'utf8')).gateway.auth.token; return { code: 0, out: 'Config valid', err: '' }; };
  const detect = (o) => D.detect({ ...o, file, env: {}, fetch: gwFake(file), wait: async () => {} });
  const saved = [];
  const r = await R.repairAll({ file, exec, detect, save: (x) => saved.push(x), wait: async () => {} });
  assert.ok(r.ok, r.text);
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(j.gateway.mode, 'local'); assert.equal(j.gateway.bind, 'loopback'); assert.equal(j.gateway.http.endpoints.chatCompletions.enabled, true);
  assert.ok(cmds.includes('gateway install') && cmds.includes('gateway start'));
  fs.rmSync(d, { recursive: true, force: true }); delete global.__served;
});

test('repairAll: arquivo quebrado sem .last-good -> guarda o quebrado e cria um novo', async () => {
  const { d, file } = tmp();
  fs.writeFileSync(file, '{ "nodes": { "camera.snap" } }');
  global.__served = '';
  const exec = async (args) => { if (args[1] === 'start') global.__served = JSON.parse(fs.readFileSync(file, 'utf8')).gateway.auth.token; return { code: 0, out: 'Config valid', err: '' }; };
  const detect = (o) => D.detect({ ...o, file, env: {}, fetch: gwFake(file), wait: async () => {} });
  assert.ok((await R.repairAll({ file, exec, detect, save() {}, wait: async () => {} })).ok);
  assert.ok(fs.readdirSync(d).some((f) => f.includes('.yoru-quebrado-')));
  fs.rmSync(d, { recursive: true, force: true }); delete global.__served;
});

test('setGatewayToken: JSON5 usa o comando do OpenClaw (config set), sem reescrever o arquivo', async () => {
  const { d, file } = tmp();
  const j5 = '{ // meu\n gateway: { mode: "local", }, }'; fs.writeFileSync(file, j5);
  const cmds = [];
  const r = await R.setGatewayToken({ file, token: 'abcdef0123456789abcdef', exec: async (a) => { cmds.push(a.join(' ')); return { code: 0, out: '', err: '' }; } });
  assert.ok(r.ok); assert.equal(r.via, 'cli'); assert.equal(fs.readFileSync(file, 'utf8'), j5);
  assert.deepEqual(cmds, ['config set gateway.auth.mode token', 'config set gateway.auth.token abcdef0123456789abcdef']);
  fs.rmSync(d, { recursive: true, force: true });
});
