'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeBluetoothDevices, parseBluetoothIndex, findBluetoothDeviceByName, isBluetoothController } = require('../src/bluetooth-devices');

test('normaliza dispositivos Bluetooth clássicos do Windows e anúncios BLE numa lista única', () => {
  const result = normalizeBluetoothDevices({
    windows: [
      { FriendlyName:'Bluetooth Radio', Status:'OK', Class:'Bluetooth', InstanceId:'USB\\VID_1234' },
      { FriendlyName:'JBL Go 3 Speaker', Status:'OK', Class:'Bluetooth', InstanceId:'BTHENUM\\DEV_AABBCCDDEEFF' },
      { FriendlyName:'Teclado sem fio', Status:'OK', Class:'Bluetooth', InstanceId:'BTHLE\\DEV_112233445566' }
    ],
    nearby: [
      { name:'JBL Go 3 Speaker', address:'AABBCCDDEEFF', rssi:-40, connectable:true },
      { name:'Sensor BLE', address:'001122334455', rssi:-65, connectable:true }
    ]
  });
  assert.equal(result.length, 3);
  assert.equal(result[0].FriendlyName, 'JBL Go 3 Speaker');
  assert.equal(result[0].Source, 'Windows');
  assert.equal(result[0].Kind, 'speaker');
  assert.equal(result[1].Kind, 'input');
  assert.equal(result[2].FriendlyName, 'Sensor BLE');
});

test('não lista rádios e enumeradores Bluetooth como se fossem acessórios', () => {
  assert.equal(isBluetoothController({ FriendlyName:'Intel(R) Wireless Bluetooth' }), true);
  assert.equal(isBluetoothController({ FriendlyName:'Microsoft Bluetooth LE Enumerator' }), true);
  assert.equal(isBluetoothController({ FriendlyName:'JBL Bluetooth Speaker' }), false);
  assert.deepEqual(normalizeBluetoothDevices({ windows:[{ FriendlyName:'Bluetooth Radio', InstanceId:'USB\\VID_1234' }] }), []);
});

test('entende números falados e formas como “o 2” ou “número cinco”', () => {
  assert.equal(parseBluetoothIndex('o 2', 5), 1);
  assert.equal(parseBluetoothIndex('número cinco', 5), 4);
  assert.equal(parseBluetoothIndex('terceiro', 5), 2);
  assert.equal(parseBluetoothIndex('doze', 12), 11);
  assert.equal(parseBluetoothIndex('número 8', 5), -1);
});

test('seleção por nome só retorna quando existe correspondência única', () => {
  const devices=[{FriendlyName:'JBL Go 3 Speaker'},{FriendlyName:'Sony WH-1000'}];
  assert.equal(findBluetoothDeviceByName('sony wh-1000',devices), devices[1]);
  assert.equal(findBluetoothDeviceByName('JBL',devices), devices[0]);
  assert.equal(findBluetoothDeviceByName('som',devices), null);
});

test('inclui dispositivos clássicos próximos ainda não pareados e deduplica por endereço', () => {
  const result = normalizeBluetoothDevices({
    windows: [{ FriendlyName:'JBL Go 3', Status:'OK', Class:'Bluetooth', InstanceId:'BTHENUM\\DEV_AABBCCDDEEFF' }],
    classic: [
      { name:'JBL Go 3', address:'AABBCCDDEEFF', paired:true, source:'Bluetooth próximo' },
      { name:'Caixa de som nova', address:'112233445566', paired:false, source:'Bluetooth próximo' }
    ]
  });
  assert.equal(result.length, 2);
  assert.equal(result[1].FriendlyName, 'Caixa de som nova');
  assert.equal(result[1].Status, 'Disponível para parear');
  assert.equal(result[1].Address, '112233445566');
  assert.equal(result[1].Kind, 'speaker');
});
