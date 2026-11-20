'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  classifyNetworkAdapter, normalizeAdapterInventory, validateTapoConfig,
  normalizeTapoState, validateTapoAction
} = require('../src/hub-universal');
const { createHubService } = require('../src/hub-service');

test('classifica adaptadores Wi-Fi de fabricantes e nomes diferentes', () => {
  assert.equal(classifyNetworkAdapter({ Name:'Wi-Fi 2', InterfaceDescription:'Realtek 8821CE Wireless LAN 802.11ac PCI-E NIC' }), 'wifi');
  assert.equal(classifyNetworkAdapter({ Name:'WLAN', InterfaceDescription:'USB Wireless Adapter' }), 'wifi');
  assert.equal(classifyNetworkAdapter({ Name:'Ethernet', InterfaceDescription:'Intel Ethernet Connection' }), 'ethernet');
  assert.equal(classifyNetworkAdapter({ Name:'Bluetooth Network Connection', InterfaceDescription:'Bluetooth Device (Personal Area Network)' }), 'bluetooth-network');
  assert.equal(classifyNetworkAdapter({ Name:'vEthernet', InterfaceDescription:'Hyper-V Virtual Ethernet Adapter' }), 'ethernet');
});

test('normaliza inventário Windows com várias interfaces e conserva estado', () => {
  const result = normalizeAdapterInventory({
    networkAdapters:[
      { Name:'Wi-Fi', InterfaceDescription:'Generic USB 802.11ax Wireless Adapter', Status:'Up', LinkSpeed:'433 Mbps', HardwareInterface:true, ifIndex:12 },
      { Name:'Ethernet', InterfaceDescription:'Intel Ethernet', Status:'Disconnected' }
    ],
    bluetoothDevices:[{ FriendlyName:'Bluetooth Radio', Status:'OK', Class:'Bluetooth', InstanceId:'USB\\VID_1234' }],
    bluetoothService:'Running',
    unrecognizedNetworkDevices:[{ FriendlyName:'USB 802.11 Wireless Adapter', Status:'Error', Class:'Unknown' }]
  });
  assert.equal(result.wifi.count, 1);
  assert.equal(result.wifi.connected, true);
  assert.equal(result.adapters.length, 2);
  assert.equal(result.bluetooth.serviceRunning, true);
  assert.equal(result.bluetooth.devices[0].name, 'Bluetooth Radio');
  assert.equal(result.unrecognized[0].name, 'USB 802.11 Wireless Adapter');
});

test('valida credenciais Tapo e endereço IP local', () => {
  assert.deepEqual(validateTapoConfig({ email:'conta@example.com', password:'senha segura', host:'192.168.1.40' }), { email:'conta@example.com', password:'senha segura', host:'192.168.1.40' });
  assert.throws(() => validateTapoConfig({ email:'email-invalido', password:'senha' }), /e-mail/i);
  assert.throws(() => validateTapoConfig({ email:'a@b.com', password:'senha', host:'https://exemplo.com' }), /IP local/i);
});

test('normaliza estado da lâmpada e limita telemetria aos campos esperados', () => {
  const state = normalizeTapoState({ ok:true, host:'192.168.1.40', model:'L530E', alias:'Quarto', isOn:true, brightness:120, colorTemp:7000, hsv:{ hue:400, saturation:120, value:-2 }, rssi:-50, ssid:'RedeCasa' });
  assert.equal(state.model, 'L530E');
  assert.equal(state.isOn, true);
  assert.equal(state.brightness, 100);
  assert.equal(state.colorTemp, 6500);
  assert.deepEqual(state.hsv, { hue:360, saturation:100, value:0 });
  const unsupported = normalizeTapoState({ brightness:null, colorTemp:null, hsv:null, overheated:true, signalLevel:2, effects:['Off','Party'], presets:['Light preset 1'] });
  assert.equal(unsupported.brightness, null);
  assert.equal(unsupported.colorTemp, null);
  assert.equal(unsupported.overheated, true);
  assert.deepEqual(unsupported.effects, ['Off','Party']);
  assert.deepEqual(unsupported.presets, ['Light preset 1']);
});

test('valida ações da Tapo, faixas de controle e cenas conhecidas', () => {
  assert.deepEqual(validateTapoAction('brightness', { brightness:75 }), { action:'brightness', brightness:75 });
  assert.deepEqual(validateTapoAction('temperature', { colorTemp:4000 }), { action:'temperature', colorTemp:4000 });
  assert.deepEqual(validateTapoAction('color', { hue:210, saturation:80, brightness:60 }), { action:'color', hue:210, saturation:80, brightness:60 });
  assert.deepEqual(validateTapoAction('scene', { scene:'night' }), { action:'scene', scene:'night' });
  assert.deepEqual(validateTapoAction('scene', { scene:'party' }), { action:'scene', scene:'party' });
  assert.deepEqual(validateTapoAction('scene', { scene:'reading' }), { action:'scene', scene:'reading' });
  assert.deepEqual(validateTapoAction('effect', { effect:'Party', brightness:35 }), { action:'effect', effect:'Party', brightness:35 });
  assert.deepEqual(validateTapoAction('preset', { preset:7 }), { action:'preset', preset:7 });
  assert.deepEqual(validateTapoAction('transition-off', { seconds:12 }), { action:'transition-off', seconds:12 });
  assert.deepEqual(validateTapoAction('auto-white', { mode:'compensate' }), { action:'auto-white', mode:'compensate' });
  assert.throws(() => validateTapoAction('effect', { effect:'shell' }), /não permitido/i);
  assert.throws(() => validateTapoAction('brightness', { brightness:200 }), /inválido/i);
  assert.throws(() => validateTapoAction('shell', {}), /não permitida/i);
  assert.throws(() => validateTapoAction('scene', { scene:'unknown' }), /Cena não reconhecida/i);
});

test('credenciais Tapo ficam criptografadas e nunca são retornadas ao renderer', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-tapo-safe-'));
  const fakeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from('test-encrypted:' + value, 'utf8'),
    decryptString: (value) => String(value).replace(/^test-encrypted:/, '')
  };
  const calls = [];
  const hub = createHubService({ userDataDir:dir, safeStorage:fakeStorage, tapoBridgeRunner:async payload => {
    calls.push(payload);
    if (payload.action === 'discover') return { ok:true, items:[{ok:true,host:'192.168.1.40',model:'L530E',alias:'Quarto',isOn:true,brightness:65,colorTemp:3000}] };
    return { ok:true,host:payload.host || '192.168.1.40',model:'L530E',alias:'Quarto',isOn:true,brightness:65,colorTemp:3000 };
  }});
  t.after(async () => { await hub.stop(); fs.rmSync(dir, { recursive:true, force:true }); });
  const saved = hub.tapoConfigSet({ email:'conta@example.com', password:'senha-super-secreta', host:'192.168.1.40' });
  assert.equal(saved.configured, true);
  assert.equal(saved.email, 'conta@example.com');
  assert.equal(Object.hasOwn(saved, 'password'), false);
  const configText = fs.readFileSync(path.join(dir, 'YoruSmartHome', 'tapo.json'), 'utf8');
  assert.equal(configText.includes('senha-super-secreta'), false);
  const discovered = await hub.tapoDiscover();
  assert.equal(discovered.items[0].host, '192.168.1.40');
  const state = await hub.tapoControl('brightness', { brightness:80 });
  assert.equal(state.brightness, 65);
  assert.equal(calls.at(-1).password, 'senha-super-secreta');
  assert.equal(hub.tapoSelectHost('192.168.1.41').host, '192.168.1.41');
  assert.equal(hub.tapoConfigClear().configured, false);
});

test('não permite salvar senha Tapo sem armazenamento criptografado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-tapo-no-crypto-'));
  const hub = createHubService({ userDataDir:dir, safeStorage:{ isEncryptionAvailable:() => false } });
  try { assert.throws(() => hub.tapoConfigSet({ email:'a@b.com', password:'senha' }), /criptografia segura/i); }
  finally { fs.rmSync(dir, { recursive:true, force:true }); }
});
