'use strict';
const http = require('http');
const dgram = require('dgram');
const os = require('os');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { normalizeAdapterInventory, validateTapoConfig, normalizeTapoState, validateTapoAction } = require('./hub-universal');
const { normalizeBluetoothDevices } = require('./bluetooth-devices');

function runPowerShell(script) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve([]);
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, timeout: 12000, maxBuffer: 1024 * 1024 }, (_err, stdout) => {
      try { resolve(JSON.parse(String(stdout || '[]').trim() || '[]')); } catch (_) { resolve([]); }
    });
  });
}
const MAX_TRANSFER_BYTES = 100 * 1024 * 1024;
function resolveInside(root, relative, { allowMissing = false } = {}) {
  const base = fs.realpathSync(root);
  const candidate = path.resolve(base, String(relative || ''));
  if (candidate !== base && !candidate.startsWith(base + path.sep)) throw new Error('Caminho fora da pasta autorizada.');
  let probe = candidate, resolved;
  while (true) {
    try { resolved = fs.realpathSync(probe); break; }
    catch (error) { if (!allowMissing || error.code !== 'ENOENT') throw error; const parent = path.dirname(probe); if (parent === probe) throw error; probe = parent; }
  }
  if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error('Atalho ou link simbólico fora da pasta autorizada.');
  return candidate;
}
function normalizeDiscoveredAgents(rawItems) {
  const seen = new Set();
  return (Array.isArray(rawItems) ? rawItems : []).filter(x => x && x.service === 'yoru-hub-agent' && Number.isInteger(Number(x.port)) && Number(x.port) > 0 && Number(x.port) <= 65535)
    .map(x => { const address=String(x.address || '').trim(); const protocol=x.protocol === 'https' ? 'https' : 'http'; return { name:String(x.name || 'Computador Yoru').slice(0,80), platform:String(x.platform || 'unknown').slice(0,40), address, port:Number(x.port), protocol, url:`${protocol}://${address}:${Number(x.port)}` }; })
    .filter(x => { const octets=x.address.split('.').map(Number); const valid=octets.length===4 && octets.every(n=>Number.isInteger(n)&&n>=0&&n<=255); const local= /^(?:10\.|127\.|192\.168\.|172\.(?:1[6-9]|2[0-9]|3[01])\.|169\.254\.)/.test(x.address); return valid && local && !seen.has(x.url) && seen.add(x.url); });
}

function normalizeBleScanResult(parsed, durationSeconds = 8) {
  if (!parsed || parsed.ok !== true) return { ok:false, available:false, items:[], error:String(parsed?.error || 'Descoberta BLE indisponível.'), guidance:parsed?.guidance || '' };
  const raw = Array.isArray(parsed.items) ? parsed.items : (parsed.items ? [parsed.items] : []);
  const seen = new Set();
  const items = raw.filter(x => x && /^[A-Fa-f0-9]{12}$/.test(String(x.address || '')))
    .map(x => ({ address:String(x.address).toUpperCase(), name:String(x.name || '').trim(), rssi:Number(x.rssi), connectable:!!x.connectable, source:'BLE próximo' }))
    .filter(x => { if (seen.has(x.address)) return false; seen.add(x.address); return true; })
    .sort((a,b) => (Number.isFinite(b.rssi)?b.rssi:-999) - (Number.isFinite(a.rssi)?a.rssi:-999));
  return { ok:true, available:true, items, durationSeconds, message:items.length ? `${items.length} dispositivo(s) BLE encontrado(s) nas proximidades.` : 'Nenhum anúncio BLE foi detectado durante a busca.' };
}

const GATT_UUID_NAMES = Object.freeze({
  '00001800-0000-1000-8000-00805f9b34fb':'Generic Access',
  '00001801-0000-1000-8000-00805f9b34fb':'Generic Attribute',
  '0000180a-0000-1000-8000-00805f9b34fb':'Device Information',
  '0000180f-0000-1000-8000-00805f9b34fb':'Battery Service',
  '00001812-0000-1000-8000-00805f9b34fb':'Human Interface Device (HID)',
  '0000180d-0000-1000-8000-00805f9b34fb':'Heart Rate',
  '00001816-0000-1000-8000-00805f9b34fb':'Cycling Speed and Cadence',
  '00001805-0000-1000-8000-00805f9b34fb':'Current Time',
  '00002a19-0000-1000-8000-00805f9b34fb':'Battery Level',
  '00002a29-0000-1000-8000-00805f9b34fb':'Manufacturer Name String',
  '00002a24-0000-1000-8000-00805f9b34fb':'Model Number String',
  '00002a25-0000-1000-8000-00805f9b34fb':'Serial Number String',
  '00002a26-0000-1000-8000-00805f9b34fb':'Firmware Revision String',
  '00002a27-0000-1000-8000-00805f9b34fb':'Hardware Revision String',
  '00002a28-0000-1000-8000-00805f9b34fb':'Software Revision String'
});
function gattUuidLabel(uuid) {
  const key=String(uuid||'').toLowerCase();
  return GATT_UUID_NAMES[key] || '';
}

function normalizeGattInspection(parsed, address) {
    const services = (Array.isArray(parsed?.services) ? parsed.services : []).map(service => ({
      uuid:String(service?.uuid || ''),
      label:gattUuidLabel(service?.uuid),
      characteristics:(Array.isArray(service?.characteristics) ? service.characteristics : []).map(ch => ({
        uuid:String(ch?.uuid || ''),
        label:gattUuidLabel(ch?.uuid),
        properties:(Array.isArray(ch?.properties) ? ch.properties.map(String) : []),
        canRead:!!ch?.canRead, canWrite:!!ch?.canWrite, canNotify:!!ch?.canNotify
      })),
      characteristicsStatus:String(service?.characteristicsStatus || '')
    }));
    return {
      ok:!!parsed?.ok, address:String(parsed?.address || address), name:String(parsed?.name || ''),
      status:String(parsed?.status || ''), services,
      serviceCount:services.length,
      characteristicCount:services.reduce((sum,x)=>sum+x.characteristics.length,0),
      error:String(parsed?.error || '')
    };
  }

const safeName = (name) => path.basename(String(name || '').replace(/[\\/]/g, '_').replace(/[<>:"|?*\x00-\x1f]/g, '_')).replace(/\.\./g, '_').replace(/^\.+/, '').slice(0, 160) || 'arquivo.bin';
// Endereços de broadcast de cada interface IPv4 ativa: a descoberta Tapo precisa sair por todas elas
// (VPN, WSL, Hyper-V e VirtualBox fazem o broadcast padrão sair pela placa errada).
function lanBroadcasts() {
  const out = new Set();
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const nic of list || []) {
        if (nic.family !== 'IPv4' || nic.internal || !nic.address || nic.address.startsWith('169.254.')) continue;
        const ip = nic.address.split('.').map(Number), mask = String(nic.netmask || '255.255.255.0').split('.').map(Number);
        if (ip.length !== 4 || mask.length !== 4 || ip.some(Number.isNaN) || mask.some(Number.isNaN)) continue;
        out.add(ip.map((octet, i) => (octet & mask[i]) | (~mask[i] & 255)).join('.'));
      }
    }
  } catch (_) { /* usa só o broadcast padrão */ }
  return [...out].slice(0, 8);
}
// Sub-redes IPv4 locais (CIDR) para a varredura direta quando o broadcast não encontra a lâmpada.
function lanSubnets() {
  const out = [];
  try {
    for (const list of Object.values(os.networkInterfaces())) {
      for (const nic of list || []) {
        if (nic.family !== 'IPv4' || nic.internal || !nic.address || nic.address.startsWith('169.254.')) continue;
        const bits = String(nic.netmask || '255.255.255.0').split('.').map(Number).reduce((n, o) => n + (o >>> 0).toString(2).replace(/0/g, '').length, 0);
        if (bits >= 16 && bits <= 30) out.push(`${nic.address}/${bits}`);
      }
    }
  } catch (_) { /* sem varredura direta */ }
  return out.slice(0, 4);
}
function runTapoBridge(payload, scriptPath) {
  const candidates = process.platform === 'win32'
    ? [{ command: 'py.exe', args: ['-3', scriptPath] }, { command: 'python.exe', args: [scriptPath] }]
    : [{ command: 'python3', args: [scriptPath] }, { command: 'python', args: [scriptPath] }];
  return new Promise((resolve) => {
    let index = 0;
    const attempt = () => {
      if (index >= candidates.length) return resolve({ ok: false, needsPython: true, error: 'Python 3 não encontrado. Instale Python 3 e habilite o comando py ou python no PATH.' });
      const candidate = candidates[index++];
      let child;
      try { child = spawn(candidate.command, candidate.args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch (error) { if (error.code === 'ENOENT') return attempt(); return resolve({ ok: false, error: error.message }); }
      let stdout = '', stderr = '', settled = false;
      const finish = (result) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); resolve(result); };
      // Timeout padrão evita processo Python infinito; pode ser ajustado por variável de ambiente.
      const tapoTimeoutMs = Math.max(10000, Math.min(120000, Number(process.env.YORU_TAPO_TIMEOUT_MS) || 60000));
      const timer = tapoTimeoutMs > 0
        ? setTimeout(() => { try { child.kill(); } catch (_) {} finish({ ok: false, error: 'A comunicação com a lâmpada excedeu o tempo limite.' }); }, tapoTimeoutMs)
        : null;
      const killOnExit = () => { try { child.kill(); } catch (_) {} };
      process.once('exit', killOnExit);
      child.once('close', () => process.removeListener('exit', killOnExit));
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 1024 * 1024) { try { child.kill(); } catch (_) {} finish({ ok: false, error: 'Resposta do conector Tapo excedeu o limite.' }); } });
      child.stderr.on('data', chunk => { if (stderr.length < 6000) stderr += chunk; });
      child.on('error', error => { if (!settled && error.code === 'ENOENT') { clearTimeout(timer); settled = true; attempt(); } else finish({ ok: false, error: error.message || 'Falha ao iniciar o conector Tapo.' }); });
      child.on('close', code => {
        if (settled) return;
        const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop();
        if (line) { try { return finish(JSON.parse(line)); } catch (_) {} }
        if (code !== 0 && /not found|n[aã]o foi poss[ií]vel encontrar|cannot find|no suitable python|microsoft store|python was not/i.test(stderr) && index < candidates.length) { clearTimeout(timer); settled = true; return attempt(); }
        finish({ ok: false, error: (stderr || `Conector Tapo encerrou com código ${code}.`).trim().slice(0, 600) });
      });
      try { child.stdin.end(JSON.stringify(payload || {})); } catch (error) { finish({ ok: false, error: error.message }); }
    };
    attempt();
  });
}

function createHubService({ userDataDir, safeStorage, tapoBridgeRunner = runTapoBridge }) {
  let server = null, session = null, agent = null, localFolder = null, scrcpyProcess = null, scrcpySerial = null, airplayProcess = null, airplayExecutable = null;
  let sharedFiles = [];
  const DISCOVERY_GROUP = '239.255.77.77', DISCOVERY_PORT = 47777;
  async function discoverAgents(durationMs = 2600) {
    if (process.platform !== 'win32' && process.platform !== 'linux' && process.platform !== 'darwin') return { ok:false, items:[], message:'Descoberta de rede indisponível nesta plataforma.' };
    return new Promise(resolve => {
      const socket = dgram.createSocket({ type:'udp4', reuseAddr:true }); const found = new Map(); let done=false;
      const finish = () => { if(done)return; done=true; try{socket.close();}catch(_){} resolve({ok:true,items:[...found.values()],message:found.size?`${found.size} agente(s) Yoru encontrado(s).`:'Nenhum agente Yoru anunciado na rede local.'}); };
      socket.on('error', finish);
      socket.on('message', msg => { try { const item=JSON.parse(msg.toString('utf8')); const normalized=normalizeDiscoveredAgents([item])[0]; if(normalized) found.set(normalized.url,normalized); } catch(_){} });
      socket.bind(DISCOVERY_PORT, '0.0.0.0', () => { try { socket.addMembership(DISCOVERY_GROUP); } catch(_){} });
      const timer=setTimeout(finish, Math.max(500,Math.min(8000,Number(durationMs)||2600)));
      const original=finish; // timer is cleared by close callback below
      socket.once('close',()=>clearTimeout(timer));
    });
  }
  function setSharedFiles(paths) { sharedFiles = (Array.isArray(paths) ? paths : []).filter(p => typeof p === 'string' && fs.existsSync(p) && fs.statSync(p).isFile()).slice(0, 100).map((p, i) => ({ id: crypto.createHash('sha256').update(p + ':' + i).digest('hex').slice(0, 20), path: p, name: path.basename(p), size: fs.statSync(p).size })); return sharedFiles.map(({id,name,size}) => ({id,name,size})); }
  const inbox = path.join(userDataDir, 'YoruHub', 'Recebidos');
  const uploadSessionsDir = path.join(userDataDir, 'YoruHub', 'UploadSessions');
  const airplayConfigFile = path.join(userDataDir, 'YoruHub', 'airplay-receiver.json');
  const smartHomeDir = path.join(userDataDir, 'YoruSmartHome');
  const tapoConfigFile = path.join(smartHomeDir, 'tapo.json');
  fs.mkdirSync(smartHomeDir, { recursive: true });
  try { const saved=JSON.parse(fs.readFileSync(airplayConfigFile,'utf8')); if(saved && typeof saved.executable==='string' && path.isAbsolute(saved.executable) && fs.existsSync(saved.executable) && /\.exe$/i.test(saved.executable)) airplayExecutable=saved.executable; } catch (_) {}
  fs.mkdirSync(inbox, { recursive: true });
  fs.mkdirSync(uploadSessionsDir, { recursive: true });
  const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
  const sessionFile = id => path.join(uploadSessionsDir, id + '.json');
  const partFile = id => path.join(uploadSessionsDir, id + '.part');
  function readUploadSession(id) { if (!/^[a-f0-9]{32}$/.test(String(id || ''))) return null; try { return JSON.parse(fs.readFileSync(sessionFile(id), 'utf8')); } catch (_) { return null; } }
  function saveUploadSession(meta) { fs.writeFileSync(sessionFile(meta.id), JSON.stringify(meta), { mode: 0o600 }); }
  function network() {
    const out = [];
    for (const [name, list] of Object.entries(os.networkInterfaces())) for (const item of list || []) {
      if (!item.internal && item.family === 'IPv4') out.push({ name, address: item.address, netmask: item.netmask });
    }
    return out;
  }
  async function ejectVolume(drive) {
    if (process.platform !== 'win32') throw new Error('Ejeção segura está disponível somente no Windows.');
    const match = String(drive || '').match(/^([A-Za-z]):\\?$/);
    if (!match) throw new Error('Unidade inválida. Informe uma letra como E:.');
    const letter = match[1].toUpperCase();
    const script = `$shell = New-Object -ComObject Shell.Application; $item = $shell.Namespace(17).ParseName('${letter}:'); if ($null -eq $item) { throw 'Unidade não encontrada' }; $item.InvokeVerb('Eject'); Start-Sleep -Milliseconds 700; [pscustomobject]@{ ok = $true; drive = '${letter}:' } | ConvertTo-Json -Compress`;
    const result = await new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], { windowsHide:true, timeout:15000, maxBuffer:256*1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message || 'Não foi possível ejetar a unidade.').trim().slice(0,400)));
        try { resolve(JSON.parse(String(stdout || '{}').trim())); } catch (_) { resolve({ ok:true, drive:letter+':' }); }
      });
    });
    return result;
  }

  async function connectivityStatus() {
    if (process.platform !== 'win32') return { ok:false, adapters:[], wifi:{count:0,connected:false,adapters:[]}, bluetooth:{adapterCount:0,service:'Unavailable',serviceRunning:false,devices:[]}, note:'Inventário universal disponível nesta versão para Windows.' };
    const raw = await runPowerShell(`$ErrorActionPreference='SilentlyContinue'; $nets=@(Get-NetAdapter -IncludeHidden | Select-Object Name,InterfaceDescription,Status,MediaType,PhysicalMediaType,NdisPhysicalMedium,LinkSpeed,MacAddress,HardwareInterface,ifIndex); $bts=@(Get-PnpDevice -Class Bluetooth -PresentOnly | Select-Object FriendlyName,Status,Class,InstanceId); $unknown=@(Get-PnpDevice -PresentOnly | Where-Object {($_.Class -eq 'Unknown' -and $_.FriendlyName -match 'wireless|wi-fi|wlan|802\\.11|network controller|bluetooth')} | Select-Object -First 40 FriendlyName,Status,Class); $svc=Get-Service -Name bthserv; [pscustomobject]@{networkAdapters=$nets;bluetoothDevices=$bts;unrecognizedNetworkDevices=$unknown;bluetoothService=$(if($svc){$svc.Status.ToString()}else{'Unavailable'})} | ConvertTo-Json -Compress -Depth 5`);
    return normalizeAdapterInventory(raw && !Array.isArray(raw) ? raw : {});
  }
  async function openWifiSettings() {
    if (process.platform !== 'win32') throw new Error('Configurações de Wi-Fi disponíveis somente no Windows.');
    return new Promise((resolve, reject) => execFile('cmd.exe', ['/c', 'start', '', 'ms-settings:network-wifi'], { windowsHide:true }, err => err ? reject(new Error('Não foi possível abrir as configurações de Wi-Fi do Windows.')) : resolve({ok:true,message:'Configurações de Wi-Fi abertas pelo Windows. Faça a conexão e instale o driver do adaptador se necessário.'})));
  }
  function readTapoConfig() {
    try { return JSON.parse(fs.readFileSync(tapoConfigFile, 'utf8')); } catch (_) { return {}; }
  }
  function getTapoCredentials(config = readTapoConfig()) {
    if (!config.passwordEncrypted) return '';
    if (!safeStorage || !safeStorage.isEncryptionAvailable || !safeStorage.isEncryptionAvailable()) throw new Error('O armazenamento seguro do Windows está indisponível. Não é seguro guardar a senha Tapo neste computador.');
    try { return safeStorage.decryptString(Buffer.from(config.passwordEncrypted, 'base64')); }
    catch (_) { throw new Error('Não foi possível abrir a senha Tapo protegida por este usuário do Windows. Digite a senha novamente.'); }
  }
  function tapoConfigGet() {
    const config = readTapoConfig();
    let configured = false;
    try { configured = !!(config.email && getTapoCredentials(config)); } catch (_) {}
    return { configured, email:String(config.email || ''), host:String(config.host || ''), secureStorageAvailable:!!(safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()), model:'L530E', runtime:'python-kasa' };
  }
  function tapoConfigSet(input = {}) {
    const clean = validateTapoConfig(input);
    const previous = readTapoConfig();
    const password = clean.password || (previous.passwordEncrypted ? getTapoCredentials(previous) : '');
    if (!clean.email) throw new Error('Informe o e-mail da conta TP-Link/Tapo.');
    if (!password) throw new Error('Informe a senha da conta TP-Link/Tapo.');
    if (clean.password) {
      if (!safeStorage || !safeStorage.isEncryptionAvailable || !safeStorage.isEncryptionAvailable()) throw new Error('O Windows não disponibilizou criptografia segura. A senha não foi salva.');
      previous.passwordEncrypted = Buffer.from(safeStorage.encryptString(clean.password)).toString('base64');
    }
    previous.email = clean.email;
    previous.host = clean.host || previous.host || '';
    fs.writeFileSync(tapoConfigFile, JSON.stringify(previous), { mode:0o600 });
    return tapoConfigGet();
  }
  function tapoConfigClear() {
    try { fs.rmSync(tapoConfigFile, { force:true }); } catch (_) {}
    return { ok:true, configured:false };
  }
  async function tapoBridge(payload) {
    const config = readTapoConfig();
    const password = getTapoCredentials(config);
    if (!config.email || !password) throw new Error('Configure o e-mail e a senha da conta TP-Link/Tapo antes de continuar.');
    const scriptPath = path.join(__dirname, 'tapo-bridge.py');
    const result = await tapoBridgeRunner({ email:config.email, password, host:config.host || '', broadcasts:lanBroadcasts(), subnets:lanSubnets(), ...payload }, scriptPath);
    if (!result || result.ok !== true) return result || {ok:false,error:'Conector Tapo sem resposta.'};
    if (result.host && net.isIP(String(result.host))) {
      config.host = String(result.host);
      fs.writeFileSync(tapoConfigFile, JSON.stringify(config), { mode:0o600 });
    }
    return result;
  }
  async function tapoRuntimeStatus() {
    return tapoBridgeRunner({ action:'check' }, path.join(__dirname, 'tapo-bridge.py'));
  }
  async function tapoDiscover() {
    const result = await tapoBridge({ action:'discover' });
    if (!result.ok) return result;
    return { ...result, items:(Array.isArray(result.items) ? result.items : []).map(normalizeTapoState) };
  }
  async function tapoControl(action, args = {}) {
    const safe = validateTapoAction(action, args);
    const result = await tapoBridge({ action:safe.action, args:safe });
    if (!result.ok) return result;
    return normalizeTapoState(result);
  }
  function tapoSelectHost(host) {
    const config = readTapoConfig();
    const clean = validateTapoConfig({ email:config.email, host });
    if (!config.passwordEncrypted) throw new Error('Configure primeiro as credenciais da conta Tapo.');
    config.host = clean.host;
    fs.writeFileSync(tapoConfigFile, JSON.stringify(config), { mode:0o600 });
    return tapoConfigGet();
  }

  async function bluetoothOpenSettings() {
    if (process.platform !== 'win32') throw new Error('Configurações Bluetooth disponíveis somente no Windows.');
    return new Promise((resolve, reject) => execFile('cmd.exe', ['/c', 'start', '', 'ms-settings:bluetooth'], { windowsHide: true }, err => {
      if (err) reject(new Error('Não foi possível abrir as configurações Bluetooth do Windows.'));
      else resolve({ ok: true, message: 'Configurações Bluetooth abertas. Conclua o pareamento pelo Windows.' });
    }));
  }
  async function setSystemVolume(value) {
    if (process.platform !== 'win32') throw new Error('Controle de volume disponível somente no Windows.');
    const n = Math.max(0, Math.min(100, Math.round(Number(value))));
    if (!Number.isFinite(n)) throw new Error('Volume inválido.');
    const script = `
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
 int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p);
 int GetChannelCount(out uint c); int SetMasterVolumeLevel(float v, Guid c);
 int SetMasterVolumeLevelScalar(float v, Guid c); int GetMasterVolumeLevel(out float v);
 int GetMasterVolumeLevelScalar(out float v); int SetChannelVolumeLevel(uint c, float v, Guid g);
 int SetChannelVolumeLevelScalar(uint c, float v, Guid g); int GetChannelVolumeLevel(uint c, out float v);
 int GetChannelVolumeLevelScalar(uint c, out float v); int SetMute(bool m, Guid c); int GetMute(out bool m);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int d, int s, out IntPtr p); int GetDefaultAudioEndpoint(int d, int r, out IMMDevice dvc); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid iid, int ctx, IntPtr p, out IAudioEndpointVolume v); }
public static class YoruAudio { public static void Set(int value) {
 var e=(IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; e.GetDefaultAudioEndpoint(0,1,out d);
 var id=typeof(IAudioEndpointVolume).GUID; IAudioEndpointVolume v; d.Activate(ref id,23,IntPtr.Zero,out v);
 v.SetMasterVolumeLevelScalar(value/100f,Guid.Empty);
}}
'@
[YoruAudio]::Set(${n})
Write-Output '{"ok":true,"volume":${n}}'
`;
    return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], { windowsHide:true, timeout:12000, maxBuffer:256*1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message || 'Não foi possível ajustar o volume.').trim().slice(0,400)));
      try { resolve(JSON.parse(String(stdout || '').trim().split(/\r?\n/).pop())); } catch (_) { reject(new Error('O Windows não confirmou a alteração de volume.')); }
    }));
  }

  function runPsScript(file, args, timeoutMs) {
    const scriptPath = path.join(__dirname, '..', 'scripts', file);
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath,...args],
        { windowsHide:true, timeout:timeoutMs, maxBuffer:1024*1024 },
        (err, stdout, stderr) => {
          let parsed = null;
          try { parsed = JSON.parse(String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || 'null'); } catch (_) {}
          resolve(parsed || { ok:false, error:String(stderr || err?.message || 'O Windows não retornou resposta.').trim().slice(0,400) });
        });
    });
  }

  async function bluetoothClassicScan(seconds = 10) {
    if (process.platform !== 'win32') return { ok:false, items:[], error:'Disponível somente no Windows.' };
    const duration = Math.max(3, Math.min(30, Math.round(Number(seconds) || 10)));
    return runPsScript('bt-classic-scan.ps1', ['-Seconds', String(duration)], (duration * 2 + 15) * 1000);
  }

  async function bluetoothNearbyScan(seconds = 8) {
    if (process.platform !== 'win32') return { ok:false, available:false, items:[], error:'A descoberta BLE próxima está disponível somente no Windows.' };
    const duration = Math.max(3, Math.min(30, Math.round(Number(seconds) || 8)));
    const scriptPath = path.join(__dirname, '..', 'scripts', 'ble-scan.ps1');
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath,'-Seconds',String(duration)],
        { windowsHide:true, timeout:(duration + 15) * 1000, maxBuffer:1024*1024 },
        (err, stdout, stderr) => {
          let parsed = null;
          try { parsed = JSON.parse(String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || 'null'); } catch (_) {}
          if (parsed && parsed.ok) {
            const normalized = normalizeBleScanResult(parsed, duration);
            return resolve(normalized);
          }
          resolve({ ok:false, available:false, items:[], error:String(parsed?.error || stderr || err?.message || 'Não foi possível iniciar a descoberta BLE.').trim().slice(0,500), guidance:parsed?.guidance || 'Verifique se o Bluetooth está ligado e se o adaptador oferece suporte a Bluetooth Low Energy.' });
        });
    });
  }

  // Combina o inventário de dispositivos Bluetooth que o Windows já reconhece (inclui Bluetooth clássico,
  // como caixas de som) com os anúncios BLE de dispositivos próximos. A busca BLE isolada não encontra
  // necessariamente caixas de som/teclados clássicos; por isso ela nunca deve ser a única fonte da lista.
  async function bluetoothDiscover(seconds = 8) {
    if (process.platform !== 'win32') return { ok:false, devices:[], error:'A descoberta Bluetooth está disponível somente no Windows.' };
    const duration = Math.max(3, Math.min(20, Math.round(Number(seconds) || 8)));
    const script = `$ErrorActionPreference='SilentlyContinue'; $bt=@(Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -and $_.FriendlyName -notmatch 'Bluetooth Radio|Bluetooth Enumerator|Microsoft Bluetooth (LE )?Enumerator|Generic Bluetooth Adapter|RFCOMM Protocol TDI|Protocol Support Module|Intel.*Wireless Bluetooth|Realtek.*Bluetooth' } | Select-Object FriendlyName,Status,Class,InstanceId); $audio=@(Get-PnpDevice -Class AudioEndpoint -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'Bluetooth|Hands-Free|A2DP|AVRCP|Stereo' } | Select-Object FriendlyName,Status,Class,InstanceId); @($bt + $audio | Sort-Object InstanceId -Unique) | ConvertTo-Json -Compress -Depth 4`;
    const [windowsItems, nearby, classic] = await Promise.all([runPowerShell(script), bluetoothNearbyScan(duration), bluetoothClassicScan(duration)]);
    const devices = normalizeBluetoothDevices({ windows:windowsItems, classic:classic?.items || [], nearby:nearby?.items || [], limit:20 });
    return { ok:true, devices, total:devices.length, windowsCount:Array.isArray(windowsItems)?windowsItems.length:(windowsItems?1:0), bleCount:Array.isArray(nearby?.items)?nearby.items.length:0, bleError:nearby?.ok===false?nearby.error:'', classicCount:Array.isArray(classic?.items)?classic.items.length:0, durationSeconds:duration, message:devices.length ? `${devices.length} dispositivo(s) Bluetooth reconhecido(s) pelo Windows ou anunciado(s) nas proximidades.` : 'Nenhum dispositivo Bluetooth foi encontrado. Ligue o dispositivo ou coloque-o em modo de pareamento e tente novamente.' };
  }

  function btAddress(device) {
    const t = device && typeof device === 'object' ? device : { Address:String(device || '') };
    const id = String(t.InstanceId || t.instanceId || '');
    let a = String(t.Address || t.address || '').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
    if (!a) a = id.startsWith('BLE:') ? id.slice(4).replace(/[^A-Fa-f0-9]/g,'').toUpperCase() : (id.match(/(?:DEV_|DEV)([A-Fa-f0-9]{12})/i) || [,''])[1].toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(a)) throw new Error('Não consegui obter o endereço do dispositivo. Faça uma nova busca.');
    return a;
  }
  async function bluetoothConnectionStatus(device) {
    if (process.platform !== 'win32') return { ok:false, error:'Disponível somente no Windows.' };
    return runPsScript('bt-connect.ps1', ['-Address', btAddress(device), '-Action', 'check'], 25000);
  }
  async function bluetoothConnectNow(device) {
    if (process.platform !== 'win32') throw new Error('Disponível somente no Windows.');
    const r = await runPsScript('bt-connect.ps1', ['-Address', btAddress(device), '-Action', 'connect'], 45000);
    if (r?.ok && r.connected) return { ok:true, connected:true, message:`${r.name || 'O dispositivo'} está conectado.` };
    return { ok:false, connected:false, error:String(r?.error || 'O Windows não confirmou a conexão.').slice(0,300) };
  }

  // Pareia de verdade pela API do Windows (DeviceInformationCustomPairing). Se o dispositivo exigir PIN ou o
  // Windows recusar o pareamento automático, cai para a tela nativa de Bluetooth. Nunca declara "conectado":
  // só informa o que o Windows confirmou (pareado / já pareado).
  async function bluetoothConnect(device) {
    if (process.platform !== 'win32') throw new Error('O pareamento Bluetooth está disponível somente no Windows.');
    const target = device && typeof device === 'object' ? device : { InstanceId:String(device || '') };
    const id = String(target.InstanceId || target.instanceId || '');
    const name = String(target.FriendlyName || target.name || 'Dispositivo Bluetooth').trim().slice(0,140);
    if (!id || id.length > 500 || /['\r\n\0]/.test(id)) throw new Error('Identificador do dispositivo inválido. Faça uma nova busca.');
    let address = String(target.Address || target.address || '').replace(/[^A-Fa-f0-9]/g,'').toUpperCase();
    if (!address) address = id.startsWith('BLE:') ? id.slice(4).replace(/[^A-Fa-f0-9]/g,'').toUpperCase() : (id.match(/(?:DEV_|DEV)([A-Fa-f0-9]{12})/i) || [,''])[1].toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(address)) {
      await bluetoothOpenSettings();
      return { ok:true, opened:true, paired:false, deviceName:name, message:`Não consegui obter o endereço de ${name}. Abri o Bluetooth do Windows para você parear manualmente.` };
    }
    const r = await runPsScript('bt-pair.ps1', ['-Address', address, '-TimeoutSeconds', '40'], 60000);
    if (r && r.ok && r.paired) {
      // O Windows costuma conectar áudio sozinho logo após parear; espera um pouco e confere.
      if (!r.alreadyPaired) await new Promise(res => setTimeout(res, 4000));
      const st = await bluetoothConnectionStatus({ Address:address });
      const connected = st?.ok === true && st.connected === true;
      return { ok:true, paired:true, alreadyPaired:!!r.alreadyPaired, connected, address, deviceName:name,
        message: connected ? `${name} está pareado e conectado.` : `${name} está pareado, mas não conectado.` };
    }
    if (r && (r.needsManual || r.status === 'CannotPair' || r.status === 'RequiredHandlerNotRegistered')) {
      await bluetoothOpenSettings();
      return { ok:true, opened:true, paired:false, deviceName:name, message:`${name} exige confirmação ou PIN no Windows. Abri o Bluetooth do sistema para você concluir.` };
    }
    return { ok:false, paired:false, deviceName:name, error:String(r?.error || r?.message || 'O Windows não conseguiu parear.').slice(0,300) };
  }


  async function bluetoothGattInspect(address) {
    const mac = String(address || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(mac)) throw new Error('Endereço Bluetooth LE inválido.');
    if (process.platform !== 'win32') return { ok:false, address:mac, services:[], error:'A inspeção GATT está disponível somente no Windows.' };
    const scriptPath = path.join(__dirname, '..', 'scripts', 'ble-gatt-inspect.ps1');
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',scriptPath,'-Address',mac],
        { windowsHide:true, timeout:45000, maxBuffer:2*1024*1024 },
        (err, stdout, stderr) => {
          let parsed = null;
          try { parsed = JSON.parse(String(stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || 'null'); } catch (_) {}
          if (!parsed) return resolve({ ok:false,address:mac,services:[],error:String(stderr || err?.message || 'Não foi possível interpretar o retorno da inspeção GATT.').trim().slice(0,500) });
          resolve(normalizeGattInspection(parsed, mac));
        });
    });
  }


  async function bluetoothDeviceDetails(instanceId) {
    const id=String(instanceId||'');
    if(!id||id.length>500||/['\\r\\n\\0]/.test(id))throw new Error('Dispositivo Bluetooth inválido.');
    const escaped=id.replace(/'/g,"''");
    const rows=await runPowerShell(`Get-PnpDevice -Class Bluetooth -ErrorAction SilentlyContinue | Where-Object {$_.InstanceId -eq '${escaped}'} | Select-Object FriendlyName,Status,Class,InstanceId | ConvertTo-Json -Compress`);
    const device=Array.isArray(rows)?rows[0]:rows;
    if(!device)throw new Error('O Windows não encontrou mais esse dispositivo. Atualize a lista.');
    const name=device.FriendlyName||'';
    return {...device,kind:/headphone|headset|fone/i.test(name)?'headphone':/speaker|alto.?falante|caixa/i.test(name)?'speaker':/phone|telefone|android|iphone/i.test(name)?'phone':'device'};
  }

  async function iphoneUsbStatus() {
    if (process.platform !== 'win32') return { available:false, devices:[], guidance:'A detecção USB do iPhone está disponível somente no Windows.' };
    const rows = await runPowerShell("Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'Apple Mobile Device|iPhone|Apple iPhone' -or $_.InstanceId -match 'VID_05AC' } | Select-Object FriendlyName,Status,Class,InstanceId | ConvertTo-Json -Compress");
    const devices = (Array.isArray(rows) ? rows : rows ? [rows] : []).map(d => ({
      name:String(d.FriendlyName || 'Dispositivo Apple'), status:String(d.Status || 'Unknown'),
      class:String(d.Class || 'USB'), instanceId:String(d.InstanceId || '')
    }));
    return { available:true, connected:devices.length>0, devices, guidance:devices.length
      ? 'iPhone identificado pelo Windows. Desbloqueie o aparelho, toque em Confiar neste computador e use Importar no app Fotos do Windows.'
      : 'Conecte o iPhone por cabo USB, desbloqueie a tela e aceite “Confiar neste computador”. Se não aparecer, instale/atualize Apple Devices e o driver Apple.' };
  }
  async function openWindowsPhotosImport() {
    if (process.platform !== 'win32') throw new Error('A importação USB pelo Fotos está disponível somente no Windows.');
    return new Promise((resolve,reject) => execFile('cmd.exe',['/c','start','','ms-photos:'],{windowsHide:true},err => err ? reject(new Error('Não foi possível abrir o Fotos do Windows.')) : resolve({ok:true,message:'Fotos do Windows aberto. Selecione Importar > De um dispositivo conectado.'})));
  }
  function setAirplayExecutable(executable) {
    const candidate=String(executable || '').trim();
    if (!candidate || !path.isAbsolute(candidate) || !/\.exe$/i.test(candidate) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) throw new Error('Selecione um executável .exe válido de um receptor AirPlay instalado.');
    airplayExecutable=candidate;
    fs.writeFileSync(airplayConfigFile,JSON.stringify({executable:candidate}),{mode:0o600});
    return {ok:true,path:candidate,name:path.basename(candidate)};
  }
  function airplayStatus() {
    return {configured:!!(airplayExecutable && fs.existsSync(airplayExecutable)),running:!!(airplayProcess && !airplayProcess.killed),name:airplayExecutable?path.basename(airplayExecutable):null,guidance:'O Yoru pode iniciar um receptor AirPlay instalado no Windows. O espelhamento e o áudio dependem do aplicativo receptor, da rede Wi-Fi e das permissões do firewall.'};
  }
  function airplayStart() {
    if (process.platform!=='win32') throw new Error('Receptor AirPlay externo disponível somente no Windows.');
    if (!airplayExecutable || !fs.existsSync(airplayExecutable)) throw new Error('Configure primeiro o executável de um receptor AirPlay instalado.');
    if (airplayProcess && !airplayProcess.killed) throw new Error('O receptor AirPlay já foi iniciado pelo Yoru.');
    const child=spawn(airplayExecutable,[],{windowsHide:false,stdio:'ignore'}); airplayProcess=child;
    child.once('exit',()=>{if(airplayProcess===child)airplayProcess=null;});
    child.once('error',()=>{if(airplayProcess===child)airplayProcess=null;});
    return {ok:true,message:'Receptor AirPlay iniciado. No iPhone, abra a Central de Controle > Espelhar a Tela e selecione o receptor.'};
  }
  function airplayStop() {
    if(!airplayProcess)return {ok:true,running:false};
    const child=airplayProcess;airplayProcess=null;try{child.kill();}catch(_){}
    return {ok:true,running:false,message:'Processo iniciado pelo Yoru encerrado.'};
  }

  async function scan() {
    const [volumes, bluetooth, usb, connectivity] = await Promise.all([
      runPowerShell("Get-Volume | Where-Object {$_.DriveLetter} | Select-Object @{N='drive';E={$_.DriveLetter+':\\'}},FileSystemLabel,FileSystem,DriveType,Size,SizeRemaining | ConvertTo-Json -Compress"),
      runPowerShell("Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue | Select-Object FriendlyName,Status,Class,InstanceId | ConvertTo-Json -Compress"),
      runPowerShell("Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object {$_.InstanceId -like 'USB*'} | Select-Object -First 80 FriendlyName,Status,Class,InstanceId | ConvertTo-Json -Compress"),
      connectivityStatus()
    ]);
    const arr = (v) => Array.isArray(v) ? v : (v ? [v] : []);
    return { network: network(), adapters:connectivity, volumes: arr(volumes), bluetooth: arr(bluetooth), usb: arr(usb), platform: process.platform, inbox };
  }
  function start() {
    if (server && session) return { ok: true, ...session };
    const token = crypto.randomBytes(24).toString('hex');
    const handler = (req, res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      const url = new URL(req.url, 'http://localhost');
      const supplied = url.searchParams.get('token') || req.headers['x-yoru-token'];
      if (!supplied || Buffer.byteLength(String(supplied)) !== Buffer.byteLength(token) || !crypto.timingSafeEqual(Buffer.from(String(supplied)), Buffer.from(token))) { res.writeHead(401); return res.end('Unauthorized'); }
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        return res.end(`<!doctype html><html lang="pt-br"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0b1220"><title>Yoru Hub · iPhone e iPad</title><style>*{box-sizing:border-box}body{font:16px -apple-system,BlinkMacSystemFont,system-ui;background:#0b1220;color:#e8f1ff;max-width:760px;margin:0 auto;padding:20px;line-height:1.5}header{padding:12px 2px 20px}h1{font-size:30px;margin:0}section{background:#152238;padding:20px;border:1px solid #29415f;border-radius:16px;margin:14px 0}button,input{max-width:100%;padding:13px;border-radius:10px;border:1px solid #456;background:#20334d;color:white;font:inherit}button{cursor:pointer;background:#167ac6;font-weight:650}input[type=file]{width:100%;margin:10px 0}li{padding:10px 4px;border-bottom:1px solid #345;overflow-wrap:anywhere}button:disabled{opacity:.55;cursor:wait}.file-actions{display:flex;gap:10px;flex-wrap:wrap}.progress{width:100%;height:10px;accent-color:#36b6ff}.empty{color:#9eb3ce;padding:12px 0}a{overflow-wrap:anywhere}@media(max-width:520px){body{padding:14px}section{padding:15px;margin:10px 0}h1{font-size:26px}button{width:100%;margin:4px 0}.file-actions{display:grid;grid-template-columns:1fr}}a{color:#8bcaff}small,.muted{color:#9eb3ce}.steps{padding-left:20px}.status{min-height:26px;overflow-wrap:anywhere}.tag{display:inline-block;padding:4px 9px;background:#173e36;color:#9ff0cf;border-radius:20px;font-size:12px}</style><header><span class="tag">REDE LOCAL · SESSÃO PRIVADA</span><h1>Yoru Hub</h1><p class="muted">Transferência de arquivos entre seu iPhone/iPad e o computador.</p></header><section><h2>Enviar do iPhone para o computador</h2><p class="muted">Escolha fotos, vídeos ou documentos. No seletor do iOS, use Fototeca ou Buscar para selecionar arquivos.</p><div class="file-actions"><label>Fotos e vídeos<input id="media" type="file" accept="image/*,video/*" multiple></label><label>Documentos e outros arquivos<input id="files" type="file" multiple></label></div><div class="file-actions"><button id="send">Enviar seleção</button><button id="cancel" type="button" disabled>Cancelar envio</button></div><progress id="progress" class="progress" max="100" value="0"></progress><p id="status" class="status" role="status" aria-live="polite">Selecione fotos, vídeos ou documentos para enviar.</p><small>Limite de 100 MB por arquivo. O envio usa blocos de até 4 MB e pode continuar após reconectar, se você selecionar o mesmo arquivo. Arquivos recebidos ficam na pasta Recebidos do Yoru.</small></section><section><h2>Baixar para o iPhone</h2><p class="muted">Toque em um arquivo abaixo. O Safari poderá abrir uma prévia; use Compartilhar → Salvar em Arquivos ou Salvar Imagem/Vídeo.</p><h3>Arquivos compartilhados pelo computador</h3><ul id="shared"></ul><h3>Arquivos enviados do iPhone</h3><button id="refresh">Atualizar lista</button><ul id="list"></ul></section><section><h2>Como usar no iPhone</h2><ol class="steps"><li>Conecte o iPhone e o computador à mesma rede Wi-Fi.</li><li>No Yoru para Windows, clique em <b>Iniciar compartilhamento</b>.</li><li>Abra no Safari o endereço exibido pelo Yoru.</li><li>Para guardar um download, toque em Compartilhar e escolha <b>Salvar em Arquivos</b>.</li></ol><p class="muted">O iOS não permite acesso irrestrito ao sistema de arquivos, controle remoto do aparelho ou montagem USB universal pelo Windows. Esta página usa os recursos de compartilhamento autorizados pelo Safari.</p></section><script>const token=new URLSearchParams(location.search).get('token');const status=document.querySelector('#status');let activeUpload=null;const fileInputs=[document.querySelector('#media'),document.querySelector('#files')],sendButton=document.querySelector('#send'),cancelButton=document.querySelector('#cancel'),progress=document.querySelector('#progress');cancelButton.onclick=()=>{if(activeUpload)activeUpload.abort()};sendButton.onclick=async()=>{let files=fileInputs.flatMap(input=>[...input.files]);if(!files.length){status.textContent='Selecione pelo menos um arquivo.';return}let total=files.reduce((n,f)=>n+f.size,0),done=0;sendButton.disabled=true;cancelButton.disabled=false;progress.value=0;for(let index=0;index<files.length;index++){const f=files[index];if(f.size>100*1024*1024){status.textContent='Ignorado: '+f.name+' excede 100 MB.';continue}status.textContent='Na fila '+(index+1)+'/'+files.length+' · '+f.name;try{await (async()=>{const key='yoru-upload:'+f.name+':'+f.size+':'+f.lastModified;let saved=localStorage.getItem(key),meta=null;const controller=new AbortController();activeUpload={abort:()=>controller.abort()};if(saved){try{const r=await fetch('/upload-session?token='+encodeURIComponent(token)+'&id='+encodeURIComponent(saved));if(r.ok)meta=await r.json();else localStorage.removeItem(key)}catch(_){}}if(!meta){const r=await fetch('/upload-session?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:f.name,size:f.size}),signal:controller.signal});if(!r.ok)throw new Error(r.status===409?'Já existe um arquivo com esse nome.':'Não foi possível criar a transferência.');meta=await r.json();localStorage.setItem(key,meta.id)}let offset=meta.offset||0;while(offset<f.size){const end=Math.min(offset+meta.chunkSize,f.size);const r=await fetch('/upload-chunk?token='+encodeURIComponent(token)+'&id='+encodeURIComponent(meta.id),{method:'PUT',headers:{'x-yoru-offset':String(offset)},body:f.slice(offset,end),signal:controller.signal});if(!r.ok){if(r.status===409){const st=await(await fetch('/upload-session?token='+encodeURIComponent(token)+'&id='+encodeURIComponent(meta.id))).json();offset=st.offset;continue}throw new Error('Falha no bloco HTTP '+r.status)}offset=(await r.json()).offset;const pct=Math.round((done+offset)/Math.max(total,1)*100);progress.value=pct;status.textContent='Na fila '+(index+1)+'/'+files.length+' · Enviando '+(index+1)+'/'+files.length+' · '+f.name+' · '+Math.round(offset/Math.max(f.size,1)*100)+'% deste arquivo · '+pct+'% total'}const fin=await fetch('/upload-finalize?token='+encodeURIComponent(token),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:meta.id}),signal:controller.signal});if(!fin.ok)throw new Error('Não foi possível concluir o arquivo.');localStorage.removeItem(key);activeUpload=null})().catch(e=>{activeUpload=null;throw e});done+=f.size}catch(e){status.textContent=(e.name==='AbortError'?'Envio cancelado. ':'Falha em '+f.name+': '+e.message+' A fila foi interrompida.');sendButton.disabled=false;cancelButton.disabled=true;return}}status.textContent='Fila concluída · transferência concluída · '+files.length+' arquivo(s).';fileInputs.forEach(input=>input.value='');progress.value=100;sendButton.disabled=false;cancelButton.disabled=true;load()};async function load(){let shared=await(await fetch('/shared?token='+encodeURIComponent(token))).json();document.querySelector('#shared').replaceChildren();if(!shared.length){const empty=document.createElement('li');empty.className='empty';empty.textContent='Nenhum arquivo compartilhado pelo computador.';document.querySelector('#shared').append(empty)}for(let f of shared){let li=document.createElement('li'),link=document.createElement('a');link.textContent=f.name;link.style.color='#7fc8ff';link.href='/shared-download?token='+encodeURIComponent(token)+'&id='+encodeURIComponent(f.id);li.append(link,document.createTextNode(' · '+f.size+' bytes'));document.querySelector('#shared').append(li)}let r=await fetch('/files?token='+encodeURIComponent(token));let a=await r.json();document.querySelector('#list').replaceChildren();if(!a.length){const empty=document.createElement('li');empty.className='empty';empty.textContent='Nenhum arquivo recebido ainda.';document.querySelector('#list').append(empty)}for(let f of a){let li=document.createElement('li'),link=document.createElement('a');link.textContent=f.name;link.style.color='#7fc8ff';link.href='/download?token='+encodeURIComponent(token)+'&name='+encodeURIComponent(f.name);li.append(link,document.createTextNode(' · '+f.size+' bytes'));document.querySelector('#list').append(li)}}document.querySelector('#refresh').onclick=load;load();</script></html>`);
      }
      if (req.method === 'PUT' && url.pathname === '/upload') {
        const name = safeName(url.searchParams.get('name'));
        const dest = path.join(inbox, name);
        const maxBytes = MAX_TRANSFER_BYTES;
        const declared = Number(req.headers['content-length'] || 0);
        if (declared > maxBytes) { res.writeHead(413); return res.end('File exceeds 100 MB limit'); }
        let size = 0, failed = false, settled = false;
        const out = fs.createWriteStream(dest, { flags: 'wx' });
        const cleanup = () => { if (settled) return; settled = true; out.destroy(); fs.rm(dest, { force: true }, () => {}); };
        req.on('data', chunk => { size += chunk.length; if (size > maxBytes) { failed = true; cleanup(); if (!res.headersSent) { res.writeHead(413); res.end('File exceeds 100 MB limit'); } } });
        req.on('aborted', cleanup);
        req.on('error', cleanup);
        out.on('finish', () => { if (settled) return; settled = true; res.writeHead(201, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: true, name, size })); });
        out.on('error', () => { if (settled) return; settled = true; fs.rm(dest, { force: true }, () => {}); if (!res.headersSent) { res.writeHead(failed ? 413 : 409); res.end('Upload failed or file already exists'); } });
        req.pipe(out);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/upload-session') {
        let body = ''; req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
        req.on('end', () => { try {
          const input = JSON.parse(body || '{}'); const name = safeName(input.name); const size = Number(input.size);
          if (!Number.isSafeInteger(size) || size < 0 || size > MAX_TRANSFER_BYTES) { res.writeHead(413); return res.end('Invalid file size'); }
          if (fs.existsSync(path.join(inbox, name))) { res.writeHead(409); return res.end('File already exists'); }
          const id = crypto.randomBytes(16).toString('hex'); const meta = { id, name, size, offset: 0, createdAt: Date.now(), updatedAt: Date.now() };
          fs.writeFileSync(partFile(id), Buffer.alloc(0), { flag: 'wx', mode: 0o600 }); saveUploadSession(meta);
          res.writeHead(201, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ id, name, size, offset: 0, chunkSize: MAX_CHUNK_BYTES }));
        } catch (_) { if (!res.headersSent) { res.writeHead(400); res.end('Invalid session request'); } } }); return;
      }
      if (req.method === 'GET' && url.pathname === '/upload-session') {
        const meta = readUploadSession(url.searchParams.get('id')); if (!meta) { res.writeHead(404); return res.end('Session not found'); }
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); return res.end(JSON.stringify(meta));
      }
      if (req.method === 'PUT' && url.pathname === '/upload-chunk') {
        const id = url.searchParams.get('id'), meta = readUploadSession(id); const offset = Number(req.headers['x-yoru-offset']);
        if (!meta) { res.writeHead(404); return res.end('Session not found'); }
        if (!Number.isSafeInteger(offset) || offset !== meta.offset) { res.writeHead(409); return res.end(JSON.stringify({ error: 'Offset mismatch', offset: meta.offset })); }
        let received = 0, chunks = []; req.on('data', c => { received += c.length; if (received > MAX_CHUNK_BYTES || meta.offset + received > meta.size) { req.destroy(); } else chunks.push(c); });
        req.on('end', () => { try { if (!received && meta.size !== 0) throw new Error('Empty chunk'); fs.appendFileSync(partFile(id), Buffer.concat(chunks)); meta.offset += received; meta.updatedAt = Date.now(); saveUploadSession(meta); res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ id, offset: meta.offset, size: meta.size, complete: meta.offset === meta.size })); } catch (_) { if (!res.headersSent) { res.writeHead(400); res.end('Chunk rejected'); } } }); return;
      }
      if (req.method === 'POST' && url.pathname === '/upload-finalize') {
        let body = ''; req.on('data', c => { body += c; if (body.length > 1024) req.destroy(); }); req.on('end', () => { try {
          const id = JSON.parse(body || '{}').id; const meta = readUploadSession(id); if (!meta) { res.writeHead(404); return res.end('Session not found'); }
          if (meta.offset !== meta.size || fs.statSync(partFile(id)).size !== meta.size) { res.writeHead(409); return res.end(JSON.stringify({ error: 'Upload incomplete', offset: meta.offset, size: meta.size })); }
          const dest = path.join(inbox, meta.name); if (fs.existsSync(dest)) { res.writeHead(409); return res.end('File already exists'); }
          const sha256 = crypto.createHash('sha256').update(fs.readFileSync(partFile(id))).digest('hex'); fs.renameSync(partFile(id), dest); fs.rmSync(sessionFile(id), { force: true });
          res.writeHead(201, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: true, name: meta.name, size: meta.size, sha256 }));
        } catch (_) { if (!res.headersSent) { res.writeHead(400); res.end('Finalize failed'); } } }); return;
      }
      if (req.method === 'DELETE' && url.pathname === '/upload-session') {
        const id = url.searchParams.get('id'); const meta = readUploadSession(id); if (!meta) { res.writeHead(404); return res.end('Session not found'); }
        fs.rmSync(partFile(id), { force: true }); fs.rmSync(sessionFile(id), { force: true }); res.writeHead(200); return res.end('Cancelled');
      }
      if (req.method === 'GET' && url.pathname === '/shared') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(sharedFiles.map(({id,name,size}) => ({id,name,size})))); }
      if (req.method === 'GET' && url.pathname === '/shared-download') { const f = sharedFiles.find(x => x.id === url.searchParams.get('id')); if (!f || !fs.existsSync(f.path)) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${safeName(f.name)}"` }); return fs.createReadStream(f.path).pipe(res); }
      if (req.method === 'GET' && url.pathname === '/files') {
        const files = fs.readdirSync(inbox, { withFileTypes: true }).filter(x => x.isFile()).map(x => { const p = path.join(inbox, x.name), s = fs.statSync(p); return { name: x.name, size: s.size }; });
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(files));
      }
      if (req.method === 'GET' && url.pathname === '/download') {
        const name = safeName(url.searchParams.get('name')); const file = path.join(inbox, name);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${name.replace(/"/g, '')}"` }); return fs.createReadStream(file).pipe(res);
      }
      res.writeHead(404); res.end('Not found');
    };
    server = http.createServer(handler);
    return new Promise(resolve => server.listen(0, '0.0.0.0', () => {
      const port = server.address().port;
      const urls = network().map(n => `http://${n.address}:${port}/?token=${token}`);
      session = { port, token, urls, inbox, warning: 'Acesso somente na rede local. Compartilhe o endereço apenas com pessoas autorizadas.' };
      resolve({ ok: true, ...session });
    }));
  }
  function stop() { if (!server) return { ok: true }; const s = server; server = null; session = null; return new Promise(resolve => s.close(() => resolve({ ok: true }))); }
  function status() { return { running: !!server, urls: session?.urls || [], inbox, agent: agent ? { baseUrl: agent.baseUrl, info: agent.info } : null, localFolder }; }
  function setLocalFolder(folder) { if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('Pasta local inválida'); localFolder = path.resolve(folder); return localFolder; }
  function localList(rel='') { if (!localFolder) throw new Error('Escolha uma pasta local primeiro'); const base=resolveInside(localFolder, rel); return { path: rel||'', items: fs.readdirSync(base,{withFileTypes:true}).map(d=>{const p=path.join(base,d.name); let st; try { st=fs.lstatSync(p); } catch (_) { return null; } if (st.isSymbolicLink()) return null; return {name:d.name,type:st.isDirectory()?'directory':'file',size:st.isFile()?st.size:0,modifiedAt:st.mtime.toISOString()}; }).filter(Boolean).slice(0,1000) }; }
  function allowedHost(host) { return host==='localhost'||host==='127.0.0.1'||host==='::1'||/^10\./.test(host)||/^192\.168\./.test(host)||/^172\.(1[6-9]|2\d|3[01])\./.test(host)||/^169\.254\./.test(host); }
  async function connectAgent(baseUrl, token) {
    const u=new URL(String(baseUrl||'')); if(!['http:','https:'].includes(u.protocol)||!allowedHost(u.hostname)) throw new Error('Use um endereço HTTP/HTTPS de rede privada (LAN).');
    if(!token||String(token).length<16) throw new Error('Token do agente inválido.');
    const base=u.origin; const response=await fetch(base+'/api/info',{headers:{Authorization:'Bearer '+String(token)},signal:AbortSignal.timeout(8000)}); if(!response.ok) throw new Error('Agente não respondeu ou token incorreto.'); const info=await response.json(); agent={baseUrl:base,token:String(token),info}; return {ok:true,info};
  }
  async function agentList(rel='') { if(!agent) throw new Error('Conecte um agente primeiro'); const u=new URL(agent.baseUrl+'/api/list');u.searchParams.set('path',rel||'');const r=await fetch(u,{headers:{Authorization:'Bearer '+agent.token},signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('Falha ao listar pasta remota: '+r.status);return await r.json(); }
  async function transferToAgent(localPath, remotePath='') { if(!agent)throw new Error('Conecte um agente primeiro'); if(!localFolder)throw new Error('Escolha a pasta local primeiro'); const p=resolveInside(localFolder,localPath);const st=fs.statSync(p);if(!st.isFile())throw new Error('Selecione um arquivo');if(st.size>MAX_TRANSFER_BYTES)throw new Error('Limite de envio para agente: 100 MB por arquivo');const u=new URL(agent.baseUrl+'/api/upload');u.searchParams.set('path',remotePath);u.searchParams.set('name',path.basename(p));const source=fs.readFileSync(p);const sha256=crypto.createHash('sha256').update(source).digest('hex');const r=await fetch(u,{method:'PUT',headers:{Authorization:'Bearer '+agent.token,'content-type':'application/octet-stream','content-length':String(source.length)},body:source,signal:AbortSignal.timeout(120000)});if(!r.ok)throw new Error('Falha no envio remoto: '+r.status);const result=await r.json();if(result.sha256&&result.sha256!==sha256)throw new Error('Integridade do arquivo remoto não confere.');return {...result,sha256,verified:true}; }
  async function receiveFromAgent(remotePath, localRel='') { if(!agent)throw new Error('Conecte um agente primeiro');if(!localFolder)throw new Error('Escolha a pasta local primeiro');const safeDestDir=resolveInside(localFolder,localRel||'',{allowMissing:true});fs.mkdirSync(safeDestDir,{recursive:true});const u=new URL(agent.baseUrl+'/api/download');u.searchParams.set('path',remotePath);const r=await fetch(u,{headers:{Authorization:'Bearer '+agent.token},signal:AbortSignal.timeout(120000)});if(!r.ok)throw new Error('Falha no download remoto: '+r.status);const declared=Number(r.headers.get('content-length')||0);if(declared>MAX_TRANSFER_BYTES)throw new Error('Download excede o limite de 100 MB.');const name=safeName(path.basename(remotePath));const dest=path.join(safeDestDir,name);if(fs.existsSync(dest))throw new Error('Já existe um arquivo com esse nome no destino');const buf=Buffer.from(await r.arrayBuffer());if(buf.length>MAX_TRANSFER_BYTES)throw new Error('Download excede o limite de 100 MB.');const digest=crypto.createHash('sha256').update(buf).digest('hex');const remoteDigest=r.headers.get('x-yoru-sha256');if(remoteDigest&&remoteDigest!==digest)throw new Error('Integridade do download não confere.');fs.writeFileSync(dest,buf,{flag:'wx'});return {ok:true,path:dest,size:buf.length,sha256:digest,verified:Boolean(remoteDigest)}; }
  function disconnectAgent(){agent=null;return {ok:true};}

  function adbExec(args, timeout=15000) {
    return new Promise((resolve, reject) => {
      execFile('adb', args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message || 'ADB não disponível').trim().slice(0, 500)));
        resolve(String(stdout || '').trim());
      });
    });
  }
  function findExecutable(name) {
    const candidates = process.platform === 'win32'
      ? [name + '.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'scrcpy', name + '.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'scrcpy', name + '.exe')]
      : [name];
    for (const candidate of candidates) {
      if (candidate === name) return candidate;
      try { if (fs.existsSync(candidate)) return candidate; } catch (_) {}
    }
    return name;
  }
  function scrcpyStatus() {
    const exe = findExecutable('scrcpy');
    const pathDirs = String(process.env.PATH || '').split(path.delimiter);
    const onPath = pathDirs.some(dir => { try { return fs.existsSync(path.join(dir, process.platform === 'win32' ? 'scrcpy.exe' : 'scrcpy')); } catch (_) { return false; } });
    return { available: process.platform === 'win32' ? (exe !== 'scrcpy' || onPath) : onPath, running: !!(scrcpyProcess && !scrcpyProcess.killed), serial: scrcpySerial, guidance: 'Instale o scrcpy e deixe-o disponível no PATH. A tela só abre após autorização USB/ADB no Android.' };
  }
  async function androidScreenStart(serial, options = {}) {
    if (!serial || !/^[A-Za-z0-9._:-]{1,200}$/.test(serial)) throw new Error('Identificador Android inválido');
    const state = await adbExec(['-s', serial, 'get-state']);
    if (state !== 'device') throw new Error('Aparelho não autorizado ou indisponível. Confirme a autorização na tela do Android.');
    if (scrcpyProcess && !scrcpyProcess.killed) throw new Error('Já existe uma sessão de tela Android aberta. Encerre-a antes de iniciar outra.');
    const exe = findExecutable('scrcpy');
    const withAudio = options === true || options?.audio === true;
    if (withAudio) {
      const version = await new Promise(resolve => execFile(exe, ['--version'], { windowsHide:true, timeout:5000 }, (err, stdout) => resolve(err ? '' : String(stdout || ''))));
      const match = version.match(/scrcpy\s+(\d+)\./i);
      if (!match || Number(match[1]) < 2) throw new Error('Áudio exige scrcpy 2.0 ou superior. Atualize o scrcpy ou desative a opção de áudio.');
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const child = spawn(exe, ['--serial', serial, withAudio ? '--audio' : '--no-audio'], { windowsHide: false, stdio: 'ignore' });
      scrcpyProcess = child; scrcpySerial = serial;
      child.once('error', err => { if (!settled) { settled = true; scrcpyProcess = null; scrcpySerial = null; reject(new Error('Não foi possível iniciar o scrcpy. Instale-o e adicione-o ao PATH: ' + err.message)); } });
      child.once('spawn', () => { if (!settled) { settled = true; resolve({ ok: true, serial, audio:withAudio, message: withAudio ? 'Tela Android aberta pelo scrcpy com áudio.' : 'Tela Android aberta pelo scrcpy sem áudio.' }); } });
      child.once('exit', () => { if (scrcpyProcess === child) { scrcpyProcess = null; scrcpySerial = null; } });
    });
  }
  function androidScreenStop() {
    if (!scrcpyProcess) return { ok: true, running: false };
    const child = scrcpyProcess; scrcpyProcess = null; scrcpySerial = null;
    try { child.kill(); } catch (_) {}
    return { ok: true, running: false };
  }
  async function androidConnectWifi(hostPort) {
    const target=String(hostPort||'').trim();
    const match=target.match(/^(\d{1,3}(?:\.\d{1,3}){3}):(\d{1,5})$/);
    if(!match || match[1].split('.').some(n=>Number(n)>255) || Number(match[2])<1 || Number(match[2])>65535) throw new Error('Informe IP e porta válidos, por exemplo 192.168.1.50:5555.');
    const ip=match[1]; if(!/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(ip)) throw new Error('Por segurança, a conexão ADB Wi-Fi aceita somente endereços IPv4 privados da rede local.');
    const output=await adbExec(['connect',target],20000);
    if(/failed|unable|cannot/i.test(output)) throw new Error(output.slice(0,300));
    return {ok:true,target,message:output||`Solicitação de conexão enviada para ${target}.`};
  }

  async function androidStatus() {
    try {
      const version = await adbExec(['version']);
      const output = await adbExec(['devices', '-l']);
      const devices = output.split(/\r?\n/).slice(1).filter(Boolean).map(line => {
        const parts=line.trim().split(/\s+/); const serial=parts[0]; const state=parts[1] || 'unknown';
        const detail=parts.slice(2).join(' ');
        return { serial, state, detail, authorized: state==='device' };
      });
      return { available:true, version:version.split(/\r?\n/)[0], devices, guidance:'No Android, ative Opções do desenvolvedor > Depuração USB e confirme a chave RSA no aparelho. Só dispositivos autorizados podem transferir arquivos.' };
    } catch (e) { return { available:false, devices:[], error:e.message, guidance:'Instale o Android SDK Platform-Tools, adicione adb ao PATH e reinicie o Yoru.' }; }
  }
  async function androidList(serial, remotePath='/sdcard/Download') {
    if (!serial || !/^[A-Za-z0-9._:-]{1,200}$/.test(serial)) throw new Error('Identificador Android inválido');
    if (typeof remotePath !== 'string' || !/^\/sdcard(?:\/|$)/.test(remotePath) || remotePath.includes('..') || /[\r\n\0]/.test(remotePath)) throw new Error('Navegação limitada ao armazenamento compartilhado /sdcard');
    const state = await adbExec(['-s', serial, 'get-state']);
    if (state !== 'device') throw new Error('Aparelho não autorizado ou indisponível. Confira a tela do Android.');
    const output = await adbExec(['-s', serial, 'shell', 'ls', '-1p', remotePath], 20000);
    const items = output.split(/\r?\n/).filter(Boolean).filter(x => x !== '.' && x !== '..').slice(0, 1000).map(name => {
      const directory = name.endsWith('/');
      const clean = name.replace(/\/$/, '');
      if (!clean || clean.includes('/') || clean === '.' || clean === '..') return null;
      return { name: clean, type: directory ? 'directory' : 'file' };
    }).filter(Boolean);
    return { path: remotePath, items };
  }
  async function androidTransfer(direction, serial, remotePath, localPath) {
    if (!serial || typeof serial!=='string' || serial.length>200) throw new Error('Identificador Android inválido');
    if (!/^([A-Za-z0-9._:-]+)$/.test(serial)) throw new Error('Identificador Android inválido');
    if (!remotePath || !remotePath.startsWith('/sdcard/') || remotePath.includes('..') || /[\r\n\0]/.test(remotePath)) throw new Error('Use um caminho dentro de /sdcard/ sem ..');
    const state=await adbExec(['-s',serial,'get-state']); if(state!=='device') throw new Error('Aparelho não autorizado ou indisponível. Confira a tela do Android.');
    if(direction==='pull') {
      if(!localFolder) throw new Error('Escolha uma pasta local no Yoru Hub primeiro');
      const dest=resolveInside(localFolder,String(localPath||''));
      fs.mkdirSync(dest,{recursive:true}); const name=safeName(path.posix.basename(remotePath)); const target=path.join(dest,name); if(fs.existsSync(target)) throw new Error('Já existe um arquivo com esse nome no destino');
      await adbExec(['-s',serial,'pull',remotePath,target],120000); return {ok:true,path:target};
    }
    if(direction==='push') {
      if(!localFolder) throw new Error('Escolha uma pasta local no Yoru Hub primeiro');
      const source=resolveInside(localFolder,String(localPath||''));
      const st=fs.statSync(source); if(!st.isFile()) throw new Error('Selecione um arquivo'); if(st.size>MAX_TRANSFER_BYTES) throw new Error('Limite de envio Android: 100 MB');
      await adbExec(['-s',serial,'push',source,remotePath],120000); return {ok:true,remotePath};
    }
    throw new Error('Operação Android inválida');
  }
  return { scan, connectivityStatus, openWifiSettings, tapoConfigGet, tapoConfigSet, tapoConfigClear, tapoRuntimeStatus, tapoDiscover, tapoControl, tapoSelectHost, discoverAgents, iphoneUsbStatus, openWindowsPhotosImport, setAirplayExecutable, airplayStatus, airplayStart, airplayStop, bluetoothNearbyScan, bluetoothClassicScan, bluetoothDiscover, bluetoothConnect, bluetoothConnectionStatus, bluetoothConnectNow, bluetoothGattInspect, ejectVolume, bluetoothOpenSettings, setSystemVolume, bluetoothDeviceDetails, start, stop, status, setSharedFiles, setLocalFolder, localList, connectAgent, agentList, transferToAgent, receiveFromAgent, disconnectAgent, androidStatus, androidConnectWifi, scrcpyStatus, androidScreenStart, androidScreenStop, androidList, androidPull:(serial,remote,local)=>androidTransfer('pull',serial,remote,local), androidPush:(serial,local,remote)=>androidTransfer('push',serial,remote,local) };
}
module.exports = { createHubService, normalizeDiscoveredAgents, normalizeBleScanResult, normalizeGattInspection, gattUuidLabel, GATT_UUID_NAMES, safeName, resolveInside, MAX_TRANSFER_BYTES, MAX_CHUNK_BYTES: 4 * 1024 * 1024 };
