'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { createVoice } = require('../src/voice-main');

function makeBluetoothVoice(opts = {}) {
  const replies=[]; const picker=[]; const connections=[]; const connectNow=[];
  const devices=[
    {FriendlyName:'Teclado BT',Status:'OK',Class:'Bluetooth',InstanceId:'BTHLE\\DEV_001122334455',Source:'Windows'},
    {FriendlyName:'JBL Go 3',Status:'OK',Class:'Bluetooth',InstanceId:'BTHENUM\\DEV_AABBCCDDEEFF',Source:'Windows'},
    {FriendlyName:'Mouse sem fio',Status:'OK',Class:'Bluetooth',InstanceId:'BTHLE\\DEV_112233445566',Source:'Windows'}
  ];
  const settings={convWake:'Yoru',convAliases:'',convMode:'wake',convFollow:30,convSpeak:true,convComments:false,convPcActions:true,convReminders:true,convCity:''};
  const voice=createVoice({
    settings:()=>settings,panel:()=>null,
    avatar:()=>({isDestroyed:()=>false,webContents:{send:(channel,payload)=>{if(channel==='ai-reply')replies.push(payload);}}}),
    askAI:async()=>({ok:true,text:'resposta IA'}),remember(){},logToPanel(){},rollDice(){},stopSpeak(){},openExternal(){},
    stt:{on(){},prepare:async()=>{},transcribe:async()=>'',dispose(){}},
    agendaFile:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'yoru-bt-')),'agenda.json'),
    hubBluetoothScan:async()=>({ok:true,devices}),
    openBluetoothPicker:(payload)=>picker.push(payload),
    updateBluetoothPicker:(payload)=>picker.push(payload),
    bluetoothConnect:async(device)=>{connections.push(device);return {ok:true,paired:true,connected:opts.connected!==false,address:'AABBCCDDEEFF',message:'Pareado pelo Windows.'}},
    bluetoothConnectNow:async(device)=>{connectNow.push(device);return {ok:true,connected:true,message:'Conectado.'}}
  });
  return {voice,replies,picker,connections,connectNow,devices,last:()=>replies.at(-1)};
}

test('pedido explícito abre janela com lista e informa quantos dispositivos encontrou',async()=>{
  const t=makeBluetoothVoice();
  await t.voice.handle('Yoru, mostrar dispositivos Bluetooth');
  assert.equal(t.last().text,'Encontrei 3 dispositivos Bluetooth.');
  for (const d of t.devices) assert.ok(!t.last().text.includes(d.FriendlyName),'não deve falar os nomes um por um');
  assert.equal(t.picker[0].stage,'list');
  assert.equal(t.picker[0].devices.length,3);
  t.voice.dispose();
});

test('voz seleciona “o 2”, confirma pelo nome e inicia o fluxo de conexão após “sim”',async()=>{
  const t=makeBluetoothVoice();
  await t.voice.handle('Yoru, mostrar dispositivos Bluetooth');
  await t.voice.handle('o 2');
  assert.match(t.last().text,/JBL Go 3/);
  assert.match(t.last().text,/Diga sim ou não/);
  assert.equal(t.picker.at(-1).stage,'confirm');
  assert.equal(t.picker.at(-1).device.FriendlyName,'JBL Go 3');
  assert.equal(t.connections.length,0,'a conexão exige confirmação');
  await t.voice.handle('sim');
  assert.equal(t.connections.length,1);
  assert.equal(t.connections[0].FriendlyName,'JBL Go 3');
  assert.equal(t.picker.at(-1).stage,'result');
  assert.match(t.last().text,/JBL Go 3 está pareado e conectado/);
  t.voice.dispose();
});

test('não cancela a conexão sem chamar o sistema',async()=>{
  const t=makeBluetoothVoice();
  await t.voice.handle('Yoru, mostrar dispositivos Bluetooth');
  await t.voice.handle('segundo');
  await t.voice.handle('não');
  assert.equal(t.connections.length,0);
  assert.equal(t.picker.at(-1).stage,'cancelled');
  assert.match(t.last().text,/Não iniciei o pareamento/);
  t.voice.dispose();
});

test('depois de parear sem conectar, pergunta se quer conectar e conecta após “sim”',async()=>{
  const t=makeBluetoothVoice({connected:false});
  await t.voice.handle('Yoru, mostrar dispositivos Bluetooth');
  await t.voice.handle('o 2');
  await t.voice.handle('sim');
  assert.match(t.last().text,/pareado, mas não está conectado\. Quer que eu conecte agora\? Diga sim ou não/);
  assert.equal(t.connectNow.length,0,'não conecta sem confirmação');
  await t.voice.handle('sim');
  assert.equal(t.connectNow.length,1);
  assert.match(t.last().text,/JBL Go 3 está conectado/);
  t.voice.dispose();
});

test('depois de parear sem conectar, “não” mantém só pareado',async()=>{
  const t=makeBluetoothVoice({connected:false});
  await t.voice.handle('Yoru, mostrar dispositivos Bluetooth');
  await t.voice.handle('o 2');
  await t.voice.handle('sim');
  await t.voice.handle('não');
  assert.equal(t.connectNow.length,0);
  assert.match(t.last().text,/ficou pareado, mas não conectado/);
  t.voice.dispose();
});

test('se já conectou após parear, não pergunta nada',async()=>{
  const t=makeBluetoothVoice({connected:true});
  await t.voice.handle('Yoru, mostrar dispositivos Bluetooth');
  await t.voice.handle('o 2');
  await t.voice.handle('sim');
  assert.match(t.last().text,/pareado e conectado/);
  assert.equal(t.connectNow.length,0);
  t.voice.dispose();
});
