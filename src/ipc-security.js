'use strict';

// Camada central de confiança para IPC. Só aceita a janela principal de um BrowserWindow
// pertencente ao app e carregando uma página local dentro de src/.
const path = require('path');
const { pathToFileURL, fileURLToPath } = require('url');

const DEFAULT_LIMITS = Object.freeze({
  chat: { count: 12, windowMs: 60_000 },
  tts: { count: 40, windowMs: 60_000 },
  'cria-image': { count: 8, windowMs: 60_000 },
  'cria-text': { count: 12, windowMs: 60_000 },
  'cria-code': { count: 10, windowMs: 60_000 },
  'cria-storyboard': { count: 8, windowMs: 60_000 },
  'optimize-run': { count: 8, windowMs: 60_000 },
  'gesture-action': { count: 45, windowMs: 10_000 },
  'backup-create': { count: 2, windowMs: 60_000 },
  'backup-restore': { count: 2, windowMs: 60_000 },
  'runtime-diagnostics': { count: 20, windowMs: 60_000 },
  'support-report-export': { count: 3, windowMs: 60_000 },
  'app-logs-export': { count: 3, windowMs: 60_000 },
  'hub-scan': { count: 20, windowMs: 60_000 },
  'wa-web-start': { count: 6, windowMs: 60_000 },
  'wa-web-logout': { count: 4, windowMs: 60_000 },
  'wa-web-config-set': { count: 60, windowMs: 60_000 },
  'remote-set-password': { count: 6, windowMs: 60_000 },
  'remote-set': { count: 20, windowMs: 60_000 },
  'remote-new-pairing': { count: 12, windowMs: 60_000 },
  'hub-start': { count: 3, windowMs: 60_000 },
  'hub-stop': { count: 10, windowMs: 60_000 },
  'masori-plan': { count: 20, windowMs: 60_000 },
  'masori-run': { count: 4, windowMs: 60_000 },
  'masori-cancel': { count: 10, windowMs: 60_000 },
  'masori-workspace-info': { count: 20, windowMs: 60_000 },
  'masori-workspace-pick': { count: 6, windowMs: 60_000 },
  'masori-workspace-list': { count: 60, windowMs: 60_000 },
  'masori-workspace-read': { count: 30, windowMs: 60_000 },
  'masori-workspace-search': { count: 12, windowMs: 60_000 },
  'masori-export-report': { count: 5, windowMs: 60_000 },
  'masori-vision-sources': { count: 12, windowMs: 60_000 },
  'masori-vision-capture': { count: 10, windowMs: 60_000 },
  'masori-vision-discard': { count: 20, windowMs: 60_000 },
  'masori-vision-analyze': { count: 4, windowMs: 60_000 },
  'openclaw-detect': { count: 6, windowMs: 60_000 },
  'openclaw-skills': { count: 4, windowMs: 60_000 },
  'openclaw-openrouter': { count: 6, windowMs: 60_000 },
  'openclaw-repair': { count: 3, windowMs: 60_000 },
  'openclaw-skills-search': { count: 12, windowMs: 60_000 },
  'openclaw-skills-installed': { count: 6, windowMs: 60_000 },
  'openclaw-skills-install': { count: 4, windowMs: 60_000 },
  'openclaw-skills-update': { count: 3, windowMs: 60_000 },
});

function createIpcSecurity({ ipcMain, BrowserWindow, appDir, limits = DEFAULT_LIMITS, now = Date.now }) {
  const root = path.resolve(appDir);
  const rootUrl = pathToFileURL(root + path.sep).href;
  const buckets = new Map();

  function isTrusted(event) {
    try {
      if (!event || !event.sender || event.sender.isDestroyed()) return false;
      if (event.senderFrame && event.sender.mainFrame && event.senderFrame !== event.sender.mainFrame) return false;
      const owner = BrowserWindow.fromWebContents(event.sender);
      if (!owner || owner.isDestroyed()) return false;
      if (!BrowserWindow.getAllWindows().includes(owner)) return false;
      const url = event.senderFrame?.url || event.sender.getURL();
      if (typeof url !== 'string' || !url.startsWith(rootUrl)) return false;
      const parsed = new URL(url);
      const file = path.resolve(fileURLToPath(parsed));
      return file.startsWith(root + path.sep) && parsed.protocol === 'file:';
    } catch (_) { return false; }
  }

  function allowed(event, channel) {
    if (!isTrusted(event)) return false;
    const rule = limits[channel];
    if (!rule) return true;
    const key = `${event.sender.id}:${channel}`;
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket || time - bucket.start >= rule.windowMs) bucket = { start: time, count: 0 };
    bucket.count += 1;
    buckets.set(key, bucket);
    // Limpa buckets antigos para não crescer indefinidamente.
    if (buckets.size > 500) {
      for (const [k, v] of buckets) if (time - v.start > 2 * 60_000) buckets.delete(k);
    }
    return bucket.count <= rule.count;
  }

  const secure = Object.create(null);
  return new Proxy(secure, {
    get(_target, prop) {
      if (prop === 'handle') return (channel, listener) => ipcMain.handle(channel, async (event, ...args) => {
        if (!allowed(event, channel)) {
          const error = new Error('Solicitação IPC não autorizada ou limite de uso excedido.');
          error.code = 'ERR_IPC_DENIED';
          throw error;
        }
        return listener(event, ...args);
      });
      if (prop === 'on') return (channel, listener) => ipcMain.on(channel, (event, ...args) => {
        if (allowed(event, channel)) return listener(event, ...args);
        return undefined;
      });
      const value = ipcMain[prop];
      return typeof value === 'function' ? value.bind(ipcMain) : value;
    },
  });
}

module.exports = { createIpcSecurity, DEFAULT_LIMITS };
