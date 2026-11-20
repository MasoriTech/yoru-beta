'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRemoteServer, hashPassword, verifyPassword, sanitizeConfig, ACTIONS_LIST } = require('../src/remote-server');

const WEB = path.join(__dirname, '..', 'src', 'remote');
// hash rápido só nos testes (o scrypt de verdade tem teste próprio abaixo)
const fastHash = async (pw) => ({ salt: '00'.repeat(16), hash: Buffer.from(String(pw)).toString('hex').padEnd(128, '0'), N: 16, r: 1, p: 1, fake: true });
const fastVerify = async (pw, rec) => !!rec && rec.hash === Buffer.from(String(pw)).toString('hex').padEnd(128, '0');

function makePc(calls) {
  const rec = (name, ret = true) => async (...a) => { calls.push([name, ...a]); return ret; };
  return {
    supported: true, volume: rec('volume'), media: rec('media'), arrow: rec('arrow'), switchWindow: rec('switch'), desktop: rec('desktop'),
    window: async (...a) => { calls.push(['window', ...a]); return { ok: true, found: true, name: 'chrome' }; },
    list: async () => [{ proc: 'chrome', title: 'Google' }],
    launch: async (n) => { calls.push(['launch', n]); return { ok: true, name: n }; },
    screenshot: async () => ({ ok: true, file: 'x.png' }),
    lock: rec('lock'), sleep: rec('sleep'), shutdown: rec('shutdown'), restart: rec('restart'), cancelPower: rec('cancelPower'),
  };
}

async function setup(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-remote-'));
  const calls = [];
  const events = [];
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => { t += ms; } };
  const chats = [];
  const srv = createRemoteServer({
    userDataDir: dir, webDir: WEB, version: '9.9.9', now: clock.now, hashPw: fastHash, verifyPw: fastVerify,
    chat: async (text, opts) => { chats.push([text, opts]); return { ok: true, text: `eco: ${text}` }; },
    pc: makePc(calls), captureScreen: async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    setVisible: (v) => calls.push(['visible', v]), isVisible: () => true,
    onEvent: (e) => events.push(e), networkInterfaces: () => ({ Wi: [{ family: 'IPv4', internal: false, address: '192.168.0.10' }], Tailscale: [{ family: 'IPv4', internal: false, address: '100.101.1.2' }] }),
    ...extra,
  });
  await srv.configure({ enabled: true, port: 18787 + Math.floor(Math.random() * 3000), lan: false, controlEnabled: true });
  const port = srv.address().port;
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, url, { body, token, control, headers = {} } = {}) => {
    const h = { ...headers };
    if (token) h.Authorization = `Bearer ${token}`;
    if (control) h['X-Yoru-Control'] = control;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(base + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const type = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  };
  const pairDevice = async (name = 'Meu iPhone') => {
    const code = srv.newPairing().code;
    const r = await call('POST', '/api/pair', { body: { code, name } });
    assert.equal(r.status, 200);
    return r.data.token;
  };
  const cleanup = async () => { await srv.stop(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { srv, dir, calls, events, chats, clock, call, pairDevice, cleanup, base };
}

test('scrypt: senha certa passa, errada não, e o registro não guarda a senha', async () => {
  const rec = await hashPassword('minha-senha-boa');
  assert.ok(!JSON.stringify(rec).includes('minha-senha-boa'));
  assert.equal(await verifyPassword('minha-senha-boa', rec), true);
  assert.equal(await verifyPassword('minha-senha-errada', rec), false);
  assert.equal(await verifyPassword('x', null), false);
  assert.equal(await verifyPassword('x', { salt: 'zz', hash: 'zz', N: 1, r: 1, p: 1 }), false);
});

test('sanitizeConfig: porta, TTL e dispositivos inválidos voltam ao padrão', () => {
  const c = sanitizeConfig({ enabled: 1, port: 80, controlTtlMin: 9999, devices: [{ id: 'x', tokenHash: 'y' }, null], control: { salt: 'a' } });
  assert.equal(c.enabled, false); assert.equal(c.port, 8787); assert.equal(c.controlTtlMin, 240);
  assert.deepEqual(c.devices, []); assert.equal(c.control, null); assert.equal(c.lan, true);
});

test('desligado por padrão e só abre quando configurado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-remote-'));
  const srv = createRemoteServer({ userDataDir: dir, webDir: WEB, chat: async () => ({}) });
  assert.equal(srv.status().enabled, false); assert.equal(srv.status().running, false);
  assert.equal((await srv.autoStart()).running, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('serve o app com cabeçalhos de segurança e sem acesso fora da lista', async () => {
  const s = await setup();
  try {
    const home = await s.call('GET', '/');
    assert.equal(home.status, 200);
    assert.match(String(home.headers.get('content-security-policy')), /default-src 'none'/);
    assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    const sw = await s.call('GET', '/sw.js');
    assert.match(sw.data.toString(), /yoru-remote-9\.9\.9/);
    for (const bad of ['/../package.json', '/%2e%2e/package.json', '/remote.json', '/app.js/../../main.js', '/panel.html']) {
      const r = await s.call('GET', bad);
      assert.ok([404].includes(r.status), `${bad} -> ${r.status}`);
    }
    assert.equal((await s.call('GET', '/manifest.webmanifest')).status, 200);
  } finally { await s.cleanup(); }
});

test('Host estranho (DNS rebinding) e Origin de outro site são recusados', async () => {
  const s = await setup();
  try {
    // o fetch do Node não deixa trocar o Host; por isso usa http cru
    const http = require('node:http');
    const raw = (headers, method = 'GET', path2 = '/') => new Promise((resolve) => {
      const r = http.request({ host: '127.0.0.1', port: s.srv.address().port, path: path2, method, headers }, (res) => { res.resume(); resolve(res.statusCode); });
      r.on('error', () => resolve('ERR'));
      r.end(method === 'POST' ? '{}' : undefined);
    });
    assert.equal(await raw({ Host: 'evil.example.com' }), 421);
    assert.equal(await raw({ Host: 'pc-casa.tail1234.ts.net' }), 200);
    assert.equal(await raw({ Host: '192.168.0.10:8787' }), 200);
    assert.equal(await raw({ Host: 'localhost', Origin: 'http://evil.example.com', 'Content-Type': 'application/json' }, 'POST', '/api/pair'), 403);
    assert.equal(await raw({ Host: 'localhost' }, 'PUT', '/'), 405);
  } finally { await s.cleanup(); }
});

test('API exige aparelho pareado; token inválido é 401', async () => {
  const s = await setup();
  try {
    assert.equal((await s.call('GET', '/api/status')).status, 401);
    assert.equal((await s.call('POST', '/api/chat', { body: { text: 'oi' } })).status, 401);
    assert.equal((await s.call('GET', '/api/status', { token: 'a'.repeat(43) })).status, 401);
    assert.equal((await s.call('POST', '/api/control/action', { body: { action: 'lock' } })).status, 401);
  } finally { await s.cleanup(); }
});

test('pareamento: código certo funciona uma vez; token não vai para o disco', async () => {
  const s = await setup();
  try {
    const code = s.srv.newPairing().code;
    assert.match(code, /^\d{8}$/);
    const ok = await s.call('POST', '/api/pair', { body: { code, name: '<b>iPhone</b>' } });
    assert.equal(ok.status, 200);
    assert.match(ok.data.token, /^[\w-]{40,}$/);
    assert.equal(ok.data.device.name, 'biPhone/b');
    const again = await s.call('POST', '/api/pair', { body: { code, name: 'outro' } });
    assert.equal(again.status, 403); // código de uso único
    const disk = fs.readFileSync(path.join(s.dir, 'remote.json'), 'utf8');
    assert.ok(!disk.includes(ok.data.token), 'o token não pode estar no arquivo');
    const st = await s.call('GET', '/api/status', { token: ok.data.token });
    assert.equal(st.data.device.name, 'biPhone/b'); assert.equal(st.data.version, '9.9.9'); assert.equal(st.data.pcSupported, true);
    assert.ok(s.events.some((e) => e.type === 'paired'));
  } finally { await s.cleanup(); }
});

test('pareamento: código expira e 5 erros seguidos invalidam o código e bloqueiam', async () => {
  const s = await setup();
  try {
    const { code } = s.srv.newPairing();
    s.clock.advance(11 * 60 * 1000);
    assert.equal((await s.call('POST', '/api/pair', { body: { code } })).status, 403);
    const fresh = s.srv.newPairing().code;
    for (let i = 0; i < 5; i += 1) assert.equal((await s.call('POST', '/api/pair', { body: { code: i === 0 && fresh === '00000000' ? '11111111' : '00000001' } })).status, 403);
    const blocked = await s.call('POST', '/api/pair', { body: { code: fresh } });
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    assert.equal(s.srv.status().pairing, null);
  } finally { await s.cleanup(); }
});

test('chat: devolve a resposta, respeita limites e só o avatar do PC se pedido', async () => {
  const s = await setup();
  try {
    const tk = await s.pairDevice();
    const r = await s.call('POST', '/api/chat', { token: tk, body: { text: ' oi Yoru ' } });
    assert.equal(r.data.text, 'eco: oi Yoru');
    assert.deepEqual(s.chats[0][1], { avatar: false, device: 'Meu iPhone' });
    await s.call('POST', '/api/chat', { token: tk, body: { text: 'x', avatar: true } });
    assert.equal(s.chats[1][1].avatar, true);
    assert.equal((await s.call('POST', '/api/chat', { token: tk, body: { text: '   ' } })).status, 400);
    assert.equal((await s.call('POST', '/api/chat', { token: tk, body: { text: 'a'.repeat(4001) } })).status, 400);
    const noJson = await fetch(s.base + '/api/chat', { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'text/plain' }, body: 'oi' });
    assert.equal(noJson.status, 415);
    const huge = await fetch(s.base + '/api/chat', { method: 'POST', headers: { Authorization: `Bearer ${tk}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'a'.repeat(40000) }) }).then((x) => x.status).catch(() => 0);
    assert.ok(huge === 413 || huge === 0);
  } finally { await s.cleanup(); }
});

test('chat NÃO executa comandos de PC (o modo 1 só conversa)', async () => {
  const s = await setup();
  try {
    const tk = await s.pairDevice();
    await s.call('POST', '/api/chat', { token: tk, body: { text: 'desligar o computador agora' } });
    assert.deepEqual(s.calls, []);
  } finally { await s.cleanup(); }
});

test('modo 2: sem senha definida o controle fica indisponível', async () => {
  const s = await setup();
  try {
    const tk = await s.pairDevice();
    const st = await s.call('GET', '/api/status', { token: tk });
    assert.equal(st.data.control.available, false);
    assert.equal((await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'qualquer' } })).status, 403);
    assert.equal((await s.call('POST', '/api/control/action', { token: tk, body: { action: 'lock' } })).status, 403);
  } finally { await s.cleanup(); }
});

test('senha: mínimo de 8, confirmação, senhas fracas e persistência só do hash', async () => {
  const s = await setup();
  try {
    assert.equal((await s.srv.setPassword('curta', 'curta')).ok, false);
    assert.equal((await s.srv.setPassword('senhaboa123', 'outra-coisa')).ok, false);
    assert.equal((await s.srv.setPassword('12345678', '12345678')).ok, false);
    assert.equal((await s.srv.setPassword('aaaaaaaaaa', 'aaaaaaaaaa')).ok, false);
    assert.equal((await s.srv.setPassword('x'.repeat(129), 'x'.repeat(129))).ok, false);
    assert.equal((await s.srv.setPassword('senha-forte-9', 'senha-forte-9')).ok, true);
    assert.equal(s.srv.status().hasPassword, true);
    const disk = fs.readFileSync(path.join(s.dir, 'remote.json'), 'utf8');
    assert.ok(!disk.includes('senha-forte-9'));
    if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(s.dir, 'remote.json')).mode & 0o077, 0, 'arquivo só do dono');
  } finally { await s.cleanup(); }
});

async function unlocked(s) {
  await s.srv.setPassword('senha-forte-9', 'senha-forte-9');
  const tk = await s.pairDevice();
  const u = await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'senha-forte-9' } });
  assert.equal(u.status, 200);
  return { tk, ctl: u.data.control };
}

test('modo 2: libera com a senha, executa ações da lista e valida os argumentos', async () => {
  const s = await setup();
  try {
    const { tk, ctl } = await unlocked(s);
    const act = (action, args, extra = {}) => s.call('POST', '/api/control/action', { token: tk, control: ctl, body: { action, args, ...extra } });
    assert.equal((await act('volume', { op: 'set', n: 150 })).data.ok, true);
    assert.deepEqual(s.calls.at(-1), ['volume', 'set', 100]);
    await act('volume', { op: 'up', n: 99 }); assert.deepEqual(s.calls.at(-1), ['volume', 'up', 20]);
    assert.equal((await act('volume', { op: 'boom' })).data.ok, false);
    await act('media', { op: 'playpause' }); assert.deepEqual(s.calls.at(-1), ['media', 'playpause']);
    assert.equal((await act('media', { op: 'format' })).data.ok, false);
    await act('arrow', { dir: 'left' }); assert.deepEqual(s.calls.at(-1), ['arrow', 'left']);
    await act('window', { act: 'minimize', query: 'chrome' }); assert.deepEqual(s.calls.at(-1), ['window', 'minimize', 'chrome']);
    assert.equal((await act('window', { act: 'delete' })).data.ok, false);
    await act('launch', { name: 'Calculadora' }); assert.deepEqual(s.calls.at(-1), ['launch', 'Calculadora']);
    assert.equal((await act('launch', { name: '   ' })).data.ok, false);
    assert.deepEqual((await act('list', {})).data.windows, [{ proc: 'chrome', title: 'Google' }]);
    assert.equal((await act('rm -rf', {})).status, 400);
    assert.equal((await act('constructor', {})).status, 400);
    assert.equal((await act('__proto__', {})).status, 400);
    assert.ok(ACTIONS_LIST.includes('shutdown'));
  } finally { await s.cleanup(); }
});

test('modo 2: desligar, reiniciar e suspender exigem confirmação explícita', async () => {
  const s = await setup();
  try {
    const { tk, ctl } = await unlocked(s);
    const act = (action, extra = {}) => s.call('POST', '/api/control/action', { token: tk, control: ctl, body: { action, args: {}, ...extra } });
    for (const a of ['shutdown', 'restart', 'sleep']) {
      const r = await act(a);
      assert.equal(r.status, 400); assert.equal(r.data.code, 'confirm_required');
    }
    assert.deepEqual(s.calls.filter((c) => ['shutdown', 'restart', 'sleep'].includes(c[0])), []);
    assert.equal((await act('shutdown', { confirm: 'true' })).status, 400); // só o booleano true vale
    assert.equal((await act('shutdown', { confirm: true })).data.ok, true);
    assert.deepEqual(s.calls.at(-1), ['shutdown']);
    assert.equal((await act('cancelPower')).data.ok, true);
  } finally { await s.cleanup(); }
});

test('modo 2: sessão exige o aparelho certo, expira por inatividade e pode ser bloqueada', async () => {
  const s = await setup();
  try {
    const { tk, ctl } = await unlocked(s);
    const other = await s.pairDevice('Outro');
    const act = (token, control) => s.call('POST', '/api/control/action', { token, control, body: { action: 'desktop' } });
    assert.equal((await act(tk, ctl)).status, 200);
    assert.equal((await act(tk, undefined)).status, 403);
    assert.equal((await act(tk, 'z'.repeat(43))).status, 403);
    s.clock.advance(9 * 60 * 1000); assert.equal((await act(tk, ctl)).status, 200); // renova a cada uso
    s.clock.advance(9 * 60 * 1000); assert.equal((await act(tk, ctl)).status, 200);
    s.clock.advance(11 * 60 * 1000);
    const late = await act(tk, ctl);
    assert.equal(late.status, 403); assert.equal(late.data.code, 'control_locked');
    const again = await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'senha-forte-9' } });
    assert.equal((await act(tk, again.data.control)).status, 200);
    // token de controle usado por OUTRO aparelho: recusado e a sessão original é derrubada (falha segura)
    assert.equal((await act(other, again.data.control)).status, 403);
    assert.equal((await act(tk, again.data.control)).status, 403);
    const third = await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'senha-forte-9' } });
    assert.equal((await act(tk, third.data.control)).status, 200);
    again.data.control = third.data.control;
    await s.call('POST', '/api/control/lock', { token: tk, body: {} });
    assert.equal((await act(tk, again.data.control)).status, 403);
  } finally { await s.cleanup(); }
});

test('modo 2: 5 senhas erradas bloqueiam (inclusive a certa) e o bloqueio cresce', async () => {
  const s = await setup();
  try {
    await s.srv.setPassword('senha-forte-9', 'senha-forte-9');
    const tk = await s.pairDevice();
    const bad = () => s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'errada-123' } });
    for (let i = 0; i < 4; i += 1) { const r = await bad(); assert.equal(r.status, 403); assert.equal(r.data.code, 'bad_password'); }
    const fifth = await bad();
    assert.equal(fifth.status, 403); assert.ok(fifth.data.retryAfter >= 60);
    const locked = await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'senha-forte-9' } });
    assert.equal(locked.status, 429); assert.equal(locked.data.code, 'locked_out');
    s.clock.advance(61 * 1000);
    for (let i = 0; i < 5; i += 1) await bad();
    s.clock.advance(61 * 1000);
    assert.equal((await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'senha-forte-9' } })).status, 429, 'segunda rodada: bloqueio de 2 min');
    s.clock.advance(61 * 1000);
    assert.equal((await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'senha-forte-9' } })).status, 200);
    assert.ok(s.events.some((e) => e.type === 'unlock-failed'));
  } finally { await s.cleanup(); }
});

test('revogar aparelho, trocar senha, remover senha ou desativar o controle derrubam as sessões', async () => {
  const s = await setup();
  try {
    let { tk, ctl } = await unlocked(s);
    const act = () => s.call('POST', '/api/control/action', { token: tk, control: ctl, body: { action: 'desktop' } });
    assert.equal((await act()).status, 200);
    await s.srv.setPassword('outra-senha-77', 'outra-senha-77');
    assert.equal((await act()).status, 403);
    ({ ctl } = (await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'outra-senha-77' } })).data); ctl = (await s.call('POST', '/api/control/unlock', { token: tk, body: { password: 'outra-senha-77' } })).data.control;
    assert.equal((await act()).status, 200);
    await s.srv.configure({ controlEnabled: false });
    assert.equal((await act()).status, 403);
    await s.srv.configure({ controlEnabled: true });
    const id = s.srv.status().devices[0].id;
    assert.equal(s.srv.revoke(id).ok, true);
    assert.equal((await s.call('GET', '/api/status', { token: tk })).status, 401);
    assert.equal(s.srv.revoke(id).ok, false);
    assert.equal(s.srv.clearPassword().ok, true);
    assert.equal(s.srv.status().hasPassword, false); assert.equal(s.srv.status().controlEnabled, false);
  } finally { await s.cleanup(); }
});

test('ver tela: JPEG só com controle liberado; avatar do PC e logout funcionam', async () => {
  const s = await setup();
  try {
    const { tk, ctl } = await unlocked(s);
    assert.equal((await s.call('GET', '/api/control/screen', { token: tk })).status, 403);
    const img = await s.call('GET', '/api/control/screen', { token: tk, control: ctl });
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/jpeg'); assert.equal(img.headers.get('cache-control'), 'no-store');
    assert.equal((await s.call('POST', '/api/avatar', { token: tk, body: { visible: false } })).status, 200);
    assert.deepEqual(s.calls.at(-1), ['visible', false]);
    assert.equal((await s.call('POST', '/api/avatar', { token: tk, body: { visible: 'sim' } })).status, 400);
    assert.equal((await s.call('POST', '/api/logout', { token: tk, body: {} })).status, 200);
    assert.equal((await s.call('GET', '/api/status', { token: tk })).status, 401);
  } finally { await s.cleanup(); }
});

test('configuração persiste (aparelhos e senha) e o servidor sobe de novo sozinho', async () => {
  const s = await setup();
  try {
    await s.srv.setPassword('senha-forte-9', 'senha-forte-9');
    const tk = await s.pairDevice('Persistente');
    await s.srv.stop();
    const again = createRemoteServer({ userDataDir: s.dir, webDir: WEB, chat: async () => ({ ok: true, text: 'ok' }), hashPw: fastHash, verifyPw: fastVerify, pc: makePc([]) });
    const st = again.status();
    assert.equal(st.enabled, true); assert.equal(st.hasPassword, true); assert.equal(st.devices.length, 1);
    await again.autoStart();
    const port = again.address().port;
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, { headers: { Authorization: `Bearer ${tk}` } });
    assert.equal(r.status, 200);
    await again.stop();
  } finally { await s.cleanup(); }
});

test('porta ocupada gera mensagem clara e lan=false escuta só em 127.0.0.1', async () => {
  const s = await setup();
  try {
    assert.equal(s.srv.address().address, '127.0.0.1');
    const other = createRemoteServer({ userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-remote-')), webDir: WEB, chat: async () => ({}) });
    const st = await other.configure({ enabled: true, port: s.srv.address().port, lan: false });
    assert.equal(st.running, false); assert.match(st.error, /já está em uso/);
    const urls = s.srv.status().urls;
    assert.ok(urls.some((u) => u.tailscale && u.url.startsWith('http://100.101.1.2:')));
    assert.ok(urls.some((u) => u.url.startsWith('http://192.168.0.10:')));
  } finally { await s.cleanup(); }
});

test('avatar 3D: bibliotecas só da lista fechada (sem "three" solto) e o modelo VRM só para aparelho pareado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-vrm-'));
  const model = path.join(dir, 'a.vrm');
  fs.writeFileSync(model, Buffer.from('glTFfake'));
  const s = await setup({ avatarModel: async () => model, vendorDir: path.join(__dirname, '..', 'src', 'vendor') });
  try {
    const lib = await s.call('GET', '/vendor/three-vrm/three-vrm.module.js');
    assert.equal(lib.status, 200);
    assert.ok(!/from\s*["']three["']/.test(lib.data.toString('utf8')), 'import "three" reescrito');
    assert.match(lib.data.toString('utf8'), /from "\/vendor\/three\/three\.module\.js"/);
    assert.equal((await s.call('GET', '/vendor/three/addons/loaders/GLTFLoader.js')).status, 200);
    for (const bad of ['/vendor/../main.js', '/vendor/three/../../main.js', '/vendor/avatar.vrm', '/vendor/three/three.module.js/../../x']) assert.equal((await s.call('GET', bad)).status, 404, bad);
    assert.equal((await s.call('GET', '/avatar3d.js')).status, 200);
    assert.equal((await s.call('GET', '/api/avatar-model')).status, 401, 'sem pareamento não entrega o modelo');
    const token = await s.pairDevice();
    const r = await s.call('GET', '/api/avatar-model', { token });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(r.data.toString(), 'glTFfake');
    const again = await s.call('GET', '/api/avatar-model', { token, headers: { 'If-None-Match': r.headers.get('etag') } });
    assert.equal(again.status, 304);
  } finally { await s.cleanup(); fs.rmSync(dir, { recursive: true, force: true }); }
});
