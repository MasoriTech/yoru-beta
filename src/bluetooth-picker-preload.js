'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bluetoothPicker', {
  onData: (callback) => ipcRenderer.on('bluetooth-picker-data', (_event, data) => callback(data || {})),
  select: (index) => ipcRenderer.send('bluetooth-picker-select', Number(index)),
  confirm: () => ipcRenderer.send('bluetooth-picker-confirm'),
  rescan: () => ipcRenderer.send('bluetooth-picker-rescan'),
  cancel: () => ipcRenderer.send('bluetooth-picker-cancel'),
  close: () => ipcRenderer.send('bluetooth-picker-close')
});
