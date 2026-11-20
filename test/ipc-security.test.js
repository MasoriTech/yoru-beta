'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createIpcSecurity } = require('../src/ipc-security');

function setup(url = 'file:///app/src/panel.html') {
  const handlers = {}, events = {};
  const wc = { id: 1, isDestroyed: () => false, getURL: () => url, mainFrame: { url } };
  const win = { isDestroyed: () => false, webContents: wc };
  const BrowserWindow = { fromWebContents: (x) => x === wc ? win : null, getAllWindows: () => [win] };
  const ipcMain = { handle: (n, f) => { handlers[n] = f; }, on: (n, f) => { events[n] = f; } };
  let now = 1000;
  const secure = createIpcSecurity({ ipcMain, BrowserWindow, appDir: '/app/src', now: () => now, limits: { ping: { count: 2, windowMs: 1000 } } });
  return { secure, handlers, events, wc, win, setNow: (n) => { now = n; } };
}

test('IPC aceita apenas janela do app e frame principal local', async () => {
  const s = setup(); let called = 0;
  s.secure.handle('safe', () => ++called);
  assert.equal(await s.handlers.safe({ sender: s.wc, senderFrame: s.wc.mainFrame }), 1);
  await assert.rejects(() => s.handlers.safe({ sender: s.wc, senderFrame: { url: 'https://evil.test' } }), /não autorizada/);
  assert.equal(called, 1);
});

test('IPC limita rajadas e libera após a janela de tempo', async () => {
  const s = setup(); s.secure.handle('ping', () => true);
  const e = { sender: s.wc, senderFrame: s.wc.mainFrame };
  assert.equal(await s.handlers.ping(e), true);
  assert.equal(await s.handlers.ping(e), true);
  await assert.rejects(() => s.handlers.ping(e), /limite de uso/);
  s.setNow(2100);
  assert.equal(await s.handlers.ping(e), true);
});


test('IPC limita execuções MASORI e leitura excessiva do workspace', async () => {
  const limits = { 'masori-run': { count: 1, windowMs: 1000 }, 'masori-workspace-read': { count: 2, windowMs: 1000 } };
  const handlers = {};
  const wc = { id: 9, isDestroyed: () => false, getURL: () => 'file:///app/src/panel.html', mainFrame: { url: 'file:///app/src/panel.html' } };
  const win = { isDestroyed: () => false, webContents: wc };
  const BrowserWindow = { fromWebContents: (x) => x === wc ? win : null, getAllWindows: () => [win] };
  const secure = createIpcSecurity({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; }, on: () => {} }, BrowserWindow, appDir: '/app/src', limits });
  secure.handle('masori-run', () => true); secure.handle('masori-workspace-read', () => true);
  const event = { sender: wc, senderFrame: wc.mainFrame };
  assert.equal(await handlers['masori-run'](event), true);
  await assert.rejects(() => handlers['masori-run'](event), /limite de uso/);
  assert.equal(await handlers['masori-workspace-read'](event), true);
  assert.equal(await handlers['masori-workspace-read'](event), true);
  await assert.rejects(() => handlers['masori-workspace-read'](event), /limite de uso/);
});


test('exportação de logs recebe limite próprio no IPC', async () => {
  const { DEFAULT_LIMITS } = require('../src/ipc-security');
  assert.deepEqual(DEFAULT_LIMITS['app-logs-export'], { count: 3, windowMs: 60_000 });
});
