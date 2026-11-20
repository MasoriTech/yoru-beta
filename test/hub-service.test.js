'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHubService, normalizeBleScanResult, normalizeGattInspection, gattUuidLabel, safeName } = require('../src/hub-service');

test('safeName neutraliza caminhos e caracteres inválidos', () => {
  assert.equal(safeName('../../teste?.txt'), '____teste_.txt');
  assert.equal(safeName(''), 'arquivo.bin');
});

test('Hub inicia compartilhamento autenticado e recebe arquivo', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-'));
  const hub = createHubService({ userDataDir: dir });
  t.after(async () => { await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const localFile = path.join(dir, 'send.txt'); fs.writeFileSync(localFile, 'from Yoru to phone');
  const selected = hub.setSharedFiles([localFile]); assert.equal(selected.length, 1);
  const started = await hub.start();
  assert.equal(started.ok, true);
  assert.ok(started.port > 0);
  const base = `http://127.0.0.1:${started.port}`;
  const shared = await (await fetch(`${base}/shared?token=${started.token}`)).json();
  assert.equal(shared[0].name, 'send.txt');
  const sharedDownload = await fetch(`${base}/shared-download?token=${started.token}&id=${shared[0].id}`);
  assert.equal(await sharedDownload.text(), 'from Yoru to phone');
  const denied = await fetch(`${base}/files`);
  assert.equal(denied.status, 401);
  const uploaded = await fetch(`${base}/upload?token=${started.token}&name=hello.txt`, { method: 'PUT', body: 'Yoru Hub test' });
  assert.equal(uploaded.status, 201);
  const files = await (await fetch(`${base}/files?token=${started.token}`)).json();
  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'hello.txt');
  const download = await fetch(`${base}/download?token=${started.token}&name=hello.txt`);
  assert.equal(await download.text(), 'Yoru Hub test');
  assert.equal((await hub.stop()).ok, true);
});


test('navegação Android rejeita caminhos fora do armazenamento compartilhado', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-android-'));
  const hub = createHubService({ userDataDir: dir });
  t.after(async () => { await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  await assert.rejects(() => hub.androidList('SERIAL123', '/data/data/com.app'), /armazenamento compartilhado/);
  await assert.rejects(() => hub.androidList('SERIAL123', '/sdcard/../data'), /armazenamento compartilhado/);
});

test('Hub bloqueia links simbólicos que escapam da pasta autorizada', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-safe-'));
  const root = path.join(dir, 'root'); const outside = path.join(dir, 'outside');
  fs.mkdirSync(root); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'segredo.txt'), 'segredo');
  const link = path.join(root, 'atalho');
  try { fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { t.skip('Sistema não permite criar link simbólico neste ambiente.'); fs.rmSync(dir,{recursive:true,force:true}); return; }
  const hub = createHubService({ userDataDir: path.join(dir, 'data') }); hub.setLocalFolder(root);
  t.after(async () => { await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  assert.throws(() => hub.localList('atalho'), /link simbólico|fora da pasta/i);
  assert.equal(hub.localList('').items.some(x => x.name === 'atalho'), false);
});

test('limite de transferência do Hub é explícito e consistente', () => {
  const { MAX_TRANSFER_BYTES } = require('../src/hub-service');
  assert.equal(MAX_TRANSFER_BYTES, 100 * 1024 * 1024);
});


test('portal Safari do iPhone explica limites do iOS e aceita upload móvel', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-ios-'));
  const hub = createHubService({ userDataDir: dir });
  t.after(async () => { await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const started = await hub.start();
  const base = `http://127.0.0.1:${started.port}`;
  const page = await fetch(`${base}/?token=${started.token}`);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /iPhone\/iPad/);
  assert.match(html, /Salvar em Arquivos/);
  assert.match(html, /100 MB/);
  assert.match(html, /não permite acesso irrestrito/);
  const upload = await fetch(`${base}/upload?token=${started.token}&name=ios-upload.txt`, { method: 'PUT', body: 'arquivo enviado pelo Safari' });
  assert.equal(upload.status, 201);
  const downloaded = await fetch(`${base}/download?token=${started.token}&name=ios-upload.txt`);
  assert.equal(await downloaded.text(), 'arquivo enviado pelo Safari');
});


test('portal iPhone expõe fila, progresso e cancelamento de uploads', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-ios-queue-'));
  const hub = createHubService({ userDataDir: dir });
  t.after(async () => { await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const started = await hub.start();
  const response = await fetch(`http://127.0.0.1:${started.port}/?token=${started.token}`);
  const html = await response.text();
  assert.match(html, /Cancelar envio/);
  assert.match(html, /upload-chunk/);
  assert.match(html, /localStorage\.getItem\(key\)/);
  assert.match(html, /upload-finalize/);
  assert.match(html, /Na fila/);
  assert.match(html, /Fila concluída/);
  assert.match(html, /activeUpload\.abort/);
});

test('upload retomável mantém offset, aceita chunks e finaliza com hash', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-resume-'));
  const hub = createHubService({ userDataDir: dir });
  t.after(async () => { await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const started = await hub.start(); const base = `http://127.0.0.1:${started.port}`; const auth = `?token=${started.token}`;
  const content = Buffer.from('arquivo dividido em partes para retomar');
  const created = await fetch(base + '/upload-session' + auth, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'retomavel.txt', size: content.length }) });
  assert.equal(created.status, 201); const session = await created.json();
  const first = content.subarray(0, 12);
  const chunk1 = await fetch(base + '/upload-chunk' + auth + '&id=' + session.id, { method: 'PUT', headers: { 'x-yoru-offset': '0' }, body: first });
  assert.equal(chunk1.status, 200); assert.equal((await chunk1.json()).offset, 12);
  const status = await (await fetch(base + '/upload-session' + auth + '&id=' + session.id)).json(); assert.equal(status.offset, 12);
  const wrong = await fetch(base + '/upload-chunk' + auth + '&id=' + session.id, { method: 'PUT', headers: { 'x-yoru-offset': '0' }, body: content.subarray(12) }); assert.equal(wrong.status, 409);
  const second = await fetch(base + '/upload-chunk' + auth + '&id=' + session.id, { method: 'PUT', headers: { 'x-yoru-offset': '12' }, body: content.subarray(12) }); assert.equal(second.status, 200);
  const finalized = await fetch(base + '/upload-finalize' + auth, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: session.id }) }); assert.equal(finalized.status, 201);
  const result = await finalized.json(); assert.equal(result.name, 'retomavel.txt'); assert.equal(result.sha256.length, 64);
  const downloaded = await fetch(base + '/download' + auth + '&name=retomavel.txt'); assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), content);
});

test('upload retomável bloqueia sessão inexistente e cancelamento remove parcial', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-resume-cancel-'));
  const hub = createHubService({ userDataDir: dir });
  t.after(async () => { await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const started = await hub.start(); const base = `http://127.0.0.1:${started.port}`; const auth = `?token=${started.token}`;
  const created = await fetch(base + '/upload-session' + auth, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'cancelado.bin', size: 20 }) });
  const session = await created.json();
  const cancelled = await fetch(base + '/upload-session' + auth + '&id=' + session.id, { method: 'DELETE' }); assert.equal(cancelled.status, 200);
  const status = await fetch(base + '/upload-session' + auth + '&id=' + session.id); assert.equal(status.status, 404);
});

test('normaliza resultados de descoberta BLE, remove duplicados e prioriza sinal forte', () => {
  const result = normalizeBleScanResult({ ok:true, items:[
    { address:'aabbccddeeff', name:'Fone', rssi:-72, connectable:true },
    { address:'AABBCCDDEEFF', name:'Fone duplicado', rssi:-80, connectable:false },
    { address:'112233445566', name:'Caixa', rssi:-41, connectable:true },
    { address:'endereco-invalido', name:'Ignorar', rssi:-20 }
  ]}, 8);
  assert.equal(result.ok, true);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].address, '112233445566');
  assert.equal(result.items[1].address, 'AABBCCDDEEFF');
  assert.equal(result.items[1].name, 'Fone');
  assert.equal(result.items[0].source, 'BLE próximo');
});

test('normalização BLE informa indisponibilidade sem inventar dispositivos', () => {
  const result = normalizeBleScanResult({ ok:false, error:'Adaptador indisponível' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.items, []);
  assert.match(result.error, /Adaptador indisponível/);
});

test('normaliza inventário GATT e expõe somente capacidades anunciadas', () => {
  const result = normalizeGattInspection({
    ok:true,address:'aabbccddeeff',name:'Fone BLE',status:'Success',
    services:[{uuid:'0000180f-0000-1000-8000-00805f9b34fb',characteristics:[
      {uuid:'00002a19-0000-1000-8000-00805f9b34fb',properties:['Read','Notify'],canRead:true,canWrite:false,canNotify:true},
      {uuid:'12345678-1234-1234-1234-123456789abc',properties:['Write'],canRead:false,canWrite:true,canNotify:false}
    ],characteristicsStatus:'Success'}]
  });
  assert.equal(result.ok,true);
  assert.equal(result.address,'aabbccddeeff');
  assert.equal(result.serviceCount,1);
  assert.equal(result.characteristicCount,2);
  assert.equal(result.services[0].characteristics[0].canRead,true);
  assert.equal(result.services[0].characteristics[0].canNotify,true);
  assert.equal(result.services[0].characteristics[1].canWrite,true);
});

test('normalização GATT não inventa serviços quando a consulta falha', () => {
  const result = normalizeGattInspection({ok:false,error:'AccessDenied',services:[]},'001122334455');
  assert.equal(result.ok,false);
  assert.equal(result.serviceCount,0);
  assert.equal(result.error,'AccessDenied');
});


test('GATT identifica UUIDs padrão sem perder os identificadores originais', () => {
  assert.equal(gattUuidLabel('0000180f-0000-1000-8000-00805f9b34fb'), 'Battery Service');
  assert.equal(gattUuidLabel('00002a19-0000-1000-8000-00805f9b34fb'), 'Battery Level');
  assert.equal(gattUuidLabel('00002a29-0000-1000-8000-00805f9b34fb'), 'Manufacturer Name String');
  assert.equal(gattUuidLabel('aaaaaaaa-0000-1000-8000-00805f9b34fb'), '');
  const result = normalizeGattInspection({ ok:true, services:[{ uuid:'0000180f-0000-1000-8000-00805f9b34fb', characteristics:[{ uuid:'00002a19-0000-1000-8000-00805f9b34fb', properties:['Read'], canRead:true }] }] }, 'AABBCCDDEEFF');
  assert.equal(result.services[0].label, 'Battery Service');
  assert.equal(result.services[0].uuid, '0000180f-0000-1000-8000-00805f9b34fb');
  assert.equal(result.services[0].characteristics[0].label, 'Battery Level');
  assert.equal(result.services[0].characteristics[0].uuid, '00002a19-0000-1000-8000-00805f9b34fb');
});

test('central iPhone expõe estado USB e exige executável AirPlay existente', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-iphone-'));
  const hub = createHubService({ userDataDir: dir });
  t.after(async () => { hub.airplayStop(); await hub.stop(); fs.rmSync(dir, { recursive: true, force: true }); });
  const usb = await hub.iphoneUsbStatus();
  assert.equal(typeof usb.available, 'boolean');
  assert.ok(Array.isArray(usb.devices));
  assert.throws(() => hub.setAirplayExecutable('not-an-executable'), /executável/);
  const airplay = hub.airplayStatus();
  assert.equal(airplay.configured, false);
  assert.equal(airplay.running, false);
});

test('painel iPhone oferece detecção USB, importação Fotos e receptor AirPlay', () => {
  const fs = require('node:fs'); const path = require('node:path');
  const html = fs.readFileSync(path.join(__dirname, '../src/panel.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../src/panel-hub.js'), 'utf8');
  for (const id of ['hubIphoneScan','hubIphoneImport','hubAirplayConfigure','hubAirplayStart','hubAirplayStop','hubIphoneUsbInfo','hubAirplayInfo']) assert.match(html, new RegExp(`id="${id}"`));
  for (const api of ['hubIphoneUsbStatus','hubIphonePhotosImport','hubAirplayConfigure','hubAirplayStatus','hubAirplayStart','hubAirplayStop']) assert.match(js, new RegExp(api));
});

test('configuração do receptor AirPlay é preservada entre sessões do Hub', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-hub-airplay-config-'));
  const exe = path.join(dir, 'receiver.exe'); fs.writeFileSync(exe, 'placeholder para teste');
  let hub = createHubService({ userDataDir: dir });
  t.after(async () => { hub.airplayStop(); await hub.stop(); fs.rmSync(dir, { recursive:true, force:true }); });
  assert.equal(hub.setAirplayExecutable(exe).ok, true);
  assert.equal(hub.airplayStatus().configured, true);
  await hub.stop();
  hub = createHubService({ userDataDir: dir });
  assert.equal(hub.airplayStatus().configured, true);
  assert.equal(hub.airplayStatus().name, 'receiver.exe');
});

test('descoberta de agentes valida anúncios e não expõe tokens', () => {
  const { normalizeDiscoveredAgents } = require('../src/hub-service');
  const items = normalizeDiscoveredAgents([
    { service:'yoru-hub-agent', name:'PC Sala', platform:'win32', address:'192.168.1.20', port:47780, protocol:'http', token:'NUNCA-EXIBIR' },
    { service:'yoru-hub-agent', name:'PC Sala', platform:'win32', address:'192.168.1.20', port:47780, protocol:'http' },
    { service:'outro-servico', address:'192.168.1.21', port:4000 },
    { service:'yoru-hub-agent', address:'8.8.8.8', port:4000 },
    { service:'yoru-hub-agent', address:'192.168.1.22', port:70000 }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'http://192.168.1.20:47780');
  assert.equal(Object.hasOwn(items[0], 'token'), false);
});

test('painel e ponte segura oferecem descoberta de agentes Yoru na rede', () => {
  const html = fs.readFileSync(path.join(__dirname, '../src/panel.html'), 'utf8');
  const panel = fs.readFileSync(path.join(__dirname, '../src/panel-hub.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../src/panel-preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
  assert.match(html, /id="hubDiscoverAgents"/);
  assert.match(html, /id="hubDiscoveredAgents"/);
  assert.match(panel, /hubDiscoverAgents\(\)/);
  assert.match(preload, /hubDiscoverAgents: \(\) => ipcRenderer\.invoke\('hub-discover-agents'\)/);
  assert.match(main, /secureIpcMain\.handle\('hub-discover-agents'/);
});


test('ADB Wi-Fi valida destino e restringe conexão à rede privada', async (t) => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yoru-hub-adb-wifi-'));
  const hub=createHubService({userDataDir:dir});
  t.after(async()=>{await hub.stop();fs.rmSync(dir,{recursive:true,force:true});});
  await assert.rejects(()=>hub.androidConnectWifi('8.8.8.8:5555'),/endereços IPv4 privados/);
  await assert.rejects(()=>hub.androidConnectWifi('192.168.1.10:99999'),/IP e porta válidos/);
  await assert.rejects(()=>hub.androidConnectWifi('localhost:5555'),/IP e porta válidos/);
});

test('painel Android oferece ADB Wi-Fi e opção explícita de áudio no espelhamento',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../src/panel.html'),'utf8');
  const panel=fs.readFileSync(path.join(__dirname,'../src/panel-hub.js'),'utf8');
  const preload=fs.readFileSync(path.join(__dirname,'../src/panel-preload.js'),'utf8');
  const main=fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8');
  for(const id of ['hubAndroidWifiTarget','hubAndroidWifiConnect','hubAndroidScreenAudio']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(panel,/hubAndroidConnectWifi/); assert.match(panel,/\{audio\}/);
  assert.match(preload,/hubAndroidConnectWifi/); assert.match(main,/hub-android-connect-wifi/);
});
