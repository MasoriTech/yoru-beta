'use strict';

const net = require('net');
const asArray = (value) => Array.isArray(value) ? value : (value ? [value] : []);
const text = (value, max = 180) => String(value == null ? '' : value).trim().slice(0, max);
const numeric = (value) => value == null || value === '' ? null : (Number.isFinite(Number(value)) ? Number(value) : null);

function classifyNetworkAdapter(adapter = {}) {
  const name = text(adapter.Name || adapter.name, 100);
  const description = text(adapter.InterfaceDescription || adapter.Description || adapter.description, 180);
  const media = [adapter.MediaType, adapter.PhysicalMediaType, adapter.NdisPhysicalMedium].map(x => text(x, 60)).join(' ');
  const combined = `${name} ${description} ${media}`;
  if (/bluetooth/i.test(combined)) return 'bluetooth-network';
  if (/wi[ -]?fi|wireless|wlan|802\.11|native 802/i.test(combined)) return 'wifi';
  if (/ethernet|802\.3|gigabit|lan adapter/i.test(combined)) return 'ethernet';
  return 'other';
}

function normalizeAdapterInventory(raw = {}) {
  const rows = asArray(raw.networkAdapters || raw.adapters);
  const adapters = rows.map((item) => {
    const kind = classifyNetworkAdapter(item);
    return {
      name: text(item.Name || item.name || item.InterfaceAlias || 'Adaptador de rede', 100),
      description: text(item.InterfaceDescription || item.Description || item.description, 180),
      status: text(item.Status || item.status || 'Unknown', 40),
      kind,
      linkSpeed: text(item.LinkSpeed || item.linkSpeed, 40),
      macAddress: text(item.MacAddress || item.macAddress, 32),
      hardware: item.HardwareInterface === true || item.hardware === true,
      ifIndex: Number.isFinite(Number(item.ifIndex || item.InterfaceIndex)) ? Number(item.ifIndex || item.InterfaceIndex) : null
    };
  }).filter(x => x.name || x.description);
  const bluetoothDevices = asArray(raw.bluetoothDevices).map((item) => ({
    name: text(item.FriendlyName || item.name || 'Dispositivo Bluetooth', 140),
    status: text(item.Status || item.status || 'Unknown', 40),
    class: text(item.Class || 'Bluetooth', 40),
    instanceId: text(item.InstanceId || '', 240)
  }));
  const unrecognized = asArray(raw.unrecognizedNetworkDevices).map(item => ({ name:text(item.FriendlyName || item.name || 'Dispositivo de rede não reconhecido', 140), status:text(item.Status || item.status || 'Unknown', 40), class:text(item.Class || 'Unknown', 40) }));
  const service = text(raw.bluetoothService?.Status || raw.bluetoothService || 'Unknown', 40);
  const wifiAdapters = adapters.filter(x => x.kind === 'wifi');
  const btAdapters = adapters.filter(x => x.kind === 'bluetooth-network');
  return {
    ok: true,
    adapters,
    unrecognized,
    wifi: { count: wifiAdapters.length, connected: wifiAdapters.some(x => /^Up$/i.test(x.status)), adapters: wifiAdapters },
    bluetooth: { adapterCount: btAdapters.length, service, serviceRunning: /^Running$/i.test(service), devices: bluetoothDevices },
    note: 'O Yoru usa os drivers e as interfaces reconhecidos pelo Windows. Adaptadores sem driver ou não reconhecidos precisam do driver do fabricante.'
  };
}

function validateTapoConfig(input = {}) {
  const email = text(input.email, 254);
  const password = typeof input.password === 'string' ? input.password : '';
  const host = text(input.host, 64);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Informe o e-mail da conta TP-Link/Tapo.');
  if (password.length > 512) throw new Error('A senha excede o limite permitido.');
  if (host && net.isIP(host) === 0) throw new Error('Informe um endereço IP local válido para a lâmpada.');
  return { email, password, host };
}

function normalizeTapoState(raw = {}) {
  const model = text(raw.model || 'Tapo', 60);
  const hsv = raw.hsv && typeof raw.hsv === 'object' ? raw.hsv : {};
  return {
    ok: raw.ok !== false,
    host: text(raw.host, 64),
    alias: text(raw.alias || model, 100),
    model,
    isOn: Boolean(raw.isOn),
    brightness: numeric(raw.brightness) == null ? null : Math.max(0, Math.min(100, numeric(raw.brightness))),
    colorTemp: numeric(raw.colorTemp) == null || numeric(raw.colorTemp) <= 0 ? null : Math.max(2500, Math.min(6500, numeric(raw.colorTemp))),
    hsv: {
      hue: numeric(hsv.hue) == null ? 0 : Math.max(0, Math.min(360, numeric(hsv.hue))),
      saturation: numeric(hsv.saturation) == null ? 0 : Math.max(0, Math.min(100, numeric(hsv.saturation))),
      value: numeric(hsv.value) == null ? 0 : Math.max(0, Math.min(100, numeric(hsv.value)))
    },
    rssi: numeric(raw.rssi),
    ssid: text(raw.ssid, 64),
    features: Array.isArray(raw.features) ? raw.features.map(x => text(x, 60)).slice(0, 40) : [],
    effects: Array.isArray(raw.effects) ? raw.effects.map(x => text(x, 40)).slice(0, 20) : [],
    effect: text(raw.effect, 40),
    presets: Array.isArray(raw.presets) ? raw.presets.map(x => text(x, 60)).slice(0, 12) : [],
    preset: text(raw.preset, 60),
    smoothTransitionOn: numeric(raw.smoothTransitionOn),
    smoothTransitionOff: numeric(raw.smoothTransitionOff),
    autoWhiteModes: Array.isArray(raw.autoWhiteModes) ? raw.autoWhiteModes.map(x => text(x, 40)).slice(0, 8) : [],
    overheated: typeof raw.overheated === 'boolean' ? raw.overheated : null,
    signalLevel: numeric(raw.signalLevel)
  };
}

function validateTapoAction(action, args = {}) {
  const allowed = new Set(['state', 'on', 'off', 'brightness', 'temperature', 'color', 'scene', 'effect', 'preset', 'transition-on', 'transition-off', 'auto-white']);
  const name = text(action, 24).toLowerCase();
  if (!allowed.has(name)) throw new Error('Ação Tapo não permitida.');
  const number = (key, min, max) => {
    const n = Number(args[key]);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Valor inválido para ${key}.`);
    return Math.round(n);
  };
  if (name === 'brightness') return { action: name, brightness: number('brightness', 1, 100) };
  if (name === 'temperature') return { action: name, colorTemp: number('colorTemp', 2500, 6500) };
  if (name === 'color') return { action: name, hue: number('hue', 0, 360), saturation: number('saturation', 0, 100), brightness: number('brightness', 1, 100) };
  if (name === 'effect') {
    const effect = text(args.effect, 24);
    if (!['Off', 'Party', 'Relax'].includes(effect)) throw new Error('Efeito de iluminação não permitido.');
    const result = { action:name, effect };
    if (args.brightness != null) result.brightness = number('brightness', 1, 100);
    return result;
  }
  if (name === 'preset') return { action:name, preset:number('preset', 1, 7) };
  if (name === 'transition-on' || name === 'transition-off') return { action:name, seconds:number('seconds', 0, 60) };
  if (name === 'auto-white') {
    const mode = text(args.mode, 20).toLowerCase();
    if (!['match', 'compensate'].includes(mode)) throw new Error('Modo de branco automático inválido.');
    return { action:name, mode };
  }
  if (name === 'scene') {
    const scene = text(args.scene, 24).toLowerCase();
    if (!['relax', 'focus', 'night', 'warm', 'daylight', 'reading', 'movie', 'romantic', 'party', 'gaming', 'morning'].includes(scene)) throw new Error('Cena não reconhecida.');
    return { action: name, scene };
  }
  return { action: name };
}

module.exports = { classifyNetworkAdapter, normalizeAdapterInventory, validateTapoConfig, normalizeTapoState, validateTapoAction };
