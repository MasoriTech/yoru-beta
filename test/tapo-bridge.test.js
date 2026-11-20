'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { normalizeTapoState } = require('../src/hub-universal');
const { createHubService } = require('../src/hub-service');

const bridge = fs.readFileSync(path.join(__dirname, '..', 'src', 'tapo-bridge.py'), 'utf8');

test('modo cor da lâmpada (temperatura 0) não vira 2500 K no painel', () => {
  assert.equal(normalizeTapoState({ ok: true, colorTemp: 0 }).colorTemp, null);
  assert.equal(normalizeTapoState({ ok: true, colorTemp: 2700 }).colorTemp, 2700);
});

test('ponte Tapo: descoberta em todas as interfaces, IP antigo com fallback, erros claros e desconexão', () => {
  assert.match(bridge, /async def discover_all/);
  assert.match(bridge, /broadcasts/);
  assert.match(bridge, /IP pode ter mudado/);
  assert.match(bridge, /def friendly_error/);
  assert.match(bridge, /recusou o e-mail\/senha/);
  assert.match(bridge, /await dev\.disconnect\(\)/);
  assert.match(bridge, /Credentials\(email, password\)/);
  assert.ok(!/light\.has_feature\(/.test(bridge.replace(/def has_light_feature[\s\S]*?def is_light/, '')), 'usar has_light_feature (compatível entre versões)');
});

test('ponte Tapo recebe os broadcasts das interfaces de rede e não grava a senha em argv', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-tapo-'));
  const calls = [];
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from('enc:' + t), decryptString: (b) => String(b).replace(/^enc:/, '') };
  const hub = createHubService({ userDataDir: dir, safeStorage, tapoBridgeRunner: async (payload, script) => { calls.push({ payload, script }); return { ok: true, host: '192.168.0.50', model: 'L530', isOn: true }; } });
  hub.tapoConfigSet({ email: 'a@b.co', password: 'segredo' });
  const state = await hub.tapoControl('state');
  assert.equal(state.ok, true);
  assert.ok(Array.isArray(calls[0].payload.broadcasts));
  assert.ok(calls[0].payload.broadcasts.every((b) => /^\d+\.\d+\.\d+\.\d+$/.test(b)));
  assert.equal(calls[0].payload.password, 'segredo');
  assert.equal(hub.tapoConfigGet().host, '192.168.0.50', 'guarda o IP encontrado');
});

test('ponte Python funciona de ponta a ponta quando python-kasa está instalado (verificação do runtime)', (t) => {
  const py = process.platform === 'win32' ? ['py', '-3'] : ['python3'];
  const probe = spawnSync(py[0], [...py.slice(1), '-c', 'import kasa'], { encoding: 'utf8' });
  if (probe.status !== 0) return t.skip('python-kasa não instalado neste ambiente');
  const r = spawnSync(py[0], [...py.slice(1), path.join(__dirname, '..', 'src', 'tapo-bridge.py')], { input: JSON.stringify({ action: 'check' }), encoding: 'utf8' });
  const out = JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
  assert.equal(out.ok, true);
  assert.equal(out.installed, true);
});
