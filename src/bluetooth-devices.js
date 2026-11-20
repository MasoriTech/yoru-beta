'use strict';

const clean = (value, max = 180) => String(value == null ? '' : value).trim().slice(0, max);

function addressFromInstanceId(instanceId) {
  const id = String(instanceId || '');
  const match = id.match(/(?:DEV_|DEV)([A-Fa-f0-9]{12})/i);
  return match ? match[1].toUpperCase() : '';
}

function isBluetoothController(item = {}) {
  const name = clean(item.FriendlyName || item.name, 180);
  const id = clean(item.InstanceId || item.instanceId, 500);
  return /(?:intel|realtek|qualcomm|mediatek|broadcom).*wireless bluetooth|bluetooth (?:radio|enumerator)|microsoft bluetooth (?:enumerator|le enumerator)|generic bluetooth adapter|rfcomm protocol tdi|protocol support module/i.test(name)
    || /^(?:USB|PCI)\\[^\\]+$/i.test(id) && /bluetooth radio|bluetooth adapter/i.test(name);
}

function inferBluetoothKind(name) {
  const n = String(name || '').toLowerCase();
  if (/speaker|alto.?falante|caixa de som|soundbar/.test(n)) return 'speaker';
  if (/headphone|headset|fone|earbud|airpod/.test(n)) return 'headphone';
  if (/phone|telefone|android|iphone|mobile/.test(n)) return 'phone';
  if (/keyboard|teclado|mouse|rato/.test(n)) return 'input';
  return 'device';
}

function normalizeBluetoothDevices({ windows = [], classic = [], nearby = [], limit = 12 } = {}) {
  const out = [];
  const seenIds = new Set();
  const seenAddresses = new Set();
  const seenNames = new Set();
  const add = (raw, source) => {
    if (!raw || typeof raw !== 'object' || isBluetoothController(raw)) return;
    const name = clean(raw.FriendlyName || raw.name || raw.Name || raw.localName, 140) || 'Dispositivo Bluetooth sem nome';
    const instanceId = clean(raw.InstanceId || raw.instanceId || raw.id, 500);
    const address = clean(raw.Address || raw.address || addressFromInstanceId(instanceId), 24).replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
    const isBle = source === 'BLE próximo' || instanceId.startsWith('BLE:') || !!raw.connectable;
    const id = instanceId || (address ? `BLE:${address}` : `${source}:${name}`);
    const keyId = id.toLowerCase();
    const keyAddress = address;
    const keyName = name.toLocaleLowerCase('pt-BR');
    if (seenIds.has(keyId) || (keyAddress && seenAddresses.has(keyAddress))) return;
    if (!instanceId && !address && seenNames.has(keyName)) return;
    seenIds.add(keyId);
    if (keyAddress) seenAddresses.add(keyAddress);
    seenNames.add(keyName);
    out.push({
      FriendlyName: name,
      Status: clean(raw.Status || raw.status || (isBle ? 'Anunciando' : source === 'Bluetooth próximo' ? (raw.paired === true ? 'Pareado' : 'Disponível para parear') : 'Reconhecido pelo Windows'), 60),
      Class: clean(raw.Class || raw.class || (isBle ? 'Bluetooth LE' : 'Bluetooth'), 60),
      InstanceId: id,
      Address: address,
      RSSI: Number.isFinite(Number(raw.RSSI ?? raw.rssi)) ? Number(raw.RSSI ?? raw.rssi) : null,
      Connectable: raw.Connectable === true || raw.connectable === true,
      Paired: typeof raw.Paired === 'boolean' ? raw.Paired : (typeof raw.paired === 'boolean' ? raw.paired : null),
      Source: clean(raw.Source || raw.source || source, 40),
      Kind: inferBluetoothKind(name)
    });
  };
  // Dispositivos já reconhecidos/instalados pelo Windows (inclui a maior parte dos Bluetooth clássicos).
  for (const item of (Array.isArray(windows) ? windows : [windows])) add(item, 'Windows');
  // Bluetooth clássico encontrado agora pelo Windows (inclui caixas/fones ainda NÃO pareados em modo de pareamento).
  for (const item of (Array.isArray(classic) ? classic : [classic])) add(item, 'Bluetooth próximo');
  // Dispositivos BLE que estão anunciando agora, inclusive os ainda não pareados.
  for (const item of (Array.isArray(nearby) ? nearby : [nearby])) add(item, 'BLE próximo');
  return out.slice(0, Math.max(1, Math.min(30, Number(limit) || 12)));
}

const NUMBER_WORDS = Object.freeze({
  primeiro:1, primeira:1, um:1, uma:1,
  segundo:2, segunda:2, dois:2, duas:2,
  terceiro:3, terceira:3, tres:3, terceira:3,
  quarto:4, quarta:4, quatro:4,
  quinto:5, quinta:5, cinco:5,
  sexto:6, sexta:6, seis:6,
  setimo:7, setima:7, sete:7,
  oitavo:8, oitava:8, oito:8,
  nono:9, nona:9, nove:9,
  decimo:10, decima:10, dez:10,
  onze:11, doze:12
});

function parseBluetoothIndex(text, count) {
  const value = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const direct = value.match(/\b(?:numero|opcao|dispositivo)?\s*(\d{1,2})\b/);
  let index = direct ? Number(direct[1]) : 0;
  if (!index) {
    const word = Object.keys(NUMBER_WORDS).sort((a, b) => b.length - a.length).find(key => new RegExp(`\\b${key}\\b`).test(value));
    if (word) index = NUMBER_WORDS[word];
  }
  return Number.isInteger(index) && index >= 1 && index <= Number(count) ? index - 1 : -1;
}

function findBluetoothDeviceByName(text, devices = []) {
  const query = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (query.length < 3) return null;
  const matches = devices.filter(device => {
    const name = String(device?.FriendlyName || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return name && (name.includes(query) || query.includes(name));
  });
  return matches.length === 1 ? matches[0] : null;
}

module.exports = { addressFromInstanceId, isBluetoothController, inferBluetoothKind, normalizeBluetoothDevices, parseBluetoothIndex, findBluetoothDeviceByName };
