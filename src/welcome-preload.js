const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('welcome', {
  go: (tab) => ipcRenderer.send('welcome-go', String(tab || '')),
  done: () => ipcRenderer.send('welcome-done'),
});
