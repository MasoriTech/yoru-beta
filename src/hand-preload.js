'use strict';
// A janela da mão recebe posição do cursor, pose, cabeça do avatar e configuração. A única coisa que ela envia é "fiz carinho", sem dados.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('handApi', {
  onCursor: (cb) => ipcRenderer.on('hand-cursor', (_e, c) => cb(c)),
  onPose: (cb) => ipcRenderer.on('hand-pose', (_e, p) => cb(p)),
  onConfig: (cb) => ipcRenderer.on('hand-config', (_e, c) => cb(c)),
  onHold: (cb) => ipcRenderer.on('hand-hold', (_e, p) => cb(p)),
  onFriend: (cb) => ipcRenderer.on('hand-friend', (_e, f) => cb(f)),
  pat: () => ipcRenderer.send('hand-pat'),
});
