'use strict';
// Handlers IPC da biblioteca de avatares e itens (arquivos .vrm / .glb): listar, miniatura, importar, remover.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const LIBRARY = require('./library');
const { thumbnailOf } = require('./glb-thumb');

const { LIB_MAX_BYTES, LIB, uniqueName } = LIBRARY; // regras de nome/extensão e nomes únicos: ver library.js

// `commit(partial)`: grava no settings do app, aplica (janela, painel) e salva
const BUILTIN_ITEMS = require('./app-actions').BUILTIN_ITEMS.map((x) => x[0]); // os itens embutidos (os mesmos de items.js)

function registerLibraryIpc({ ipcMain, dialog, shell, BrowserWindow, nativeImage, assetsDir, lib, getSettings, commit, isPanelSender = () => true, renderItemThumb = async () => null }) {
  const panelOnly = (e) => !!e && isPanelSender(e.sender);
  const { libDir, libAll, libPath } = lib;
  const ASSETS = assetsDir;
  ipcMain.handle('lib-list', () => libAll());
  ipcMain.handle('lib-url', (_e, kind, id) => {
    if (kind === 'avatars' && id === 'default') return pathToFileURL(path.join(ASSETS, 'avatar.vrm')).href;
    const p = libPath(kind, id);
    return p ? pathToFileURL(p).href : null;
  });
  // miniatura do avatar (a que o próprio .vrm traz embutida), reduzida para o painel; null = sem miniatura
  const thumbCache = new Map(); // "id|mtime" -> dataURL | null
  // miniatura de item: desenhada pela janela do avatar (3D). Falhou? não guarda, e o painel pede de novo depois
  const itemThumbs = new Map(); // "chave|mtime|tamanho" -> Promise<dataURL|null>
  async function itemThumb(id) {
    let key = String(id), stamp = '';
    if (!BUILTIN_ITEMS.includes(key)) {
      const p = libPath('items', key);
      if (!p) return null;
      try { const st = await fs.promises.stat(p); stamp = `${st.mtimeMs}|${st.size}`; } catch (_) { return null; }
      key = 'custom:' + key;
    }
    const ck = key + '|' + stamp;
    if (!itemThumbs.has(ck)) {
      itemThumbs.set(ck, Promise.resolve(renderItemThumb(key)).catch(() => null).then((u) => { if (!u) itemThumbs.delete(ck); return u; }));
    }
    return itemThumbs.get(ck);
  }
  ipcMain.handle('lib-thumb', async (_e, kind, id) => {
    if (kind === 'items') return itemThumb(id);
    if (kind !== 'avatars') return null;
    const p = id === 'default' ? path.join(ASSETS, 'avatar.vrm') : libPath(kind, id);
    if (!p) return null;
    try {
      const st = await fs.promises.stat(p);
      const key = `${p}|${st.mtimeMs}|${st.size}`;
      if (thumbCache.has(key)) return thumbCache.get(key);
      const t = thumbnailOf(await fs.promises.readFile(p));
      let url = null;
      if (t) {
        const img = nativeImage.createFromBuffer(t.data);
        if (!img.isEmpty()) url = 'data:image/jpeg;base64,' + img.resize({ width: 320, quality: 'good' }).toJPEG(85).toString('base64');
      }
      thumbCache.set(key, url);
      return url;
    } catch (_) { return null; }
  });
  ipcMain.handle('lib-open', (e, kind) => { if (!panelOnly(e)) return false; if (LIB[kind]) shell.openPath(libDir(kind)); return true; });
  // copia arquivos para a biblioteca: confere extensão, tamanho e se é mesmo um modelo glTF/GLB/VRM
  async function importFiles(kind, paths) {
    const dir = libDir(kind);
    const added = [];
    const skipped = [];
    for (const src of paths) {
      const base = path.basename(String(src));
      try {
        if (!LIB[kind].ext.test(base)) { skipped.push(`${base}: formato não suportado`); continue; }
        const st = await fs.promises.stat(src);
        if (!st.isFile()) { skipped.push(`${base}: não é um arquivo`); continue; }
        if (st.size > LIB_MAX_BYTES) { skipped.push(`${base}: maior que ${LIB_MAX_BYTES / 1048576} MB`); continue; }
        const fh = await fs.promises.open(src, 'r');
        const head = Buffer.alloc(4);
        try { await fh.read(head, 0, 4, 0); } finally { await fh.close(); }
        if (head.toString('latin1') !== 'glTF') { skipped.push(`${base}: não parece um modelo .glb/.vrm válido`); continue; }
        const name = uniqueName(dir, base);
        await fs.promises.copyFile(src, path.join(dir, name));
        added.push(name);
      } catch (err) {
        skipped.push(`${base}: ${String((err && err.message) || err).slice(0, 80)}`);
      }
    }
    if (added.length === 1) { // um só arquivo: já usa
      const partial = kind === 'avatars' ? { avatarFile: added[0] } : { item: 'custom:' + added[0] };
      commit(partial);
    }
    return { ok: added.length > 0, added, skipped, lib: libAll(), error: added.length ? '' : (skipped[0] || 'nenhum arquivo válido') };
  }
  ipcMain.handle('lib-add', async (e, kind) => {
    if (!panelOnly(e)) return { ok: false, error: 'remetente não autorizado' };
    if (!LIB[kind]) return { ok: false, error: 'tipo inválido' };
    try {
      const parent = BrowserWindow.fromWebContents(e.sender);
      const r = await dialog.showOpenDialog(parent, {
        title: kind === 'avatars' ? 'Escolha um avatar' : 'Escolha um item',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: LIB[kind].label, extensions: LIB[kind].exts }],
      });
      if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true, lib: libAll() };
      return await importFiles(kind, r.filePaths);
    } catch (err) {
      return { ok: false, error: String((err && err.message) || err), lib: libAll() };
    }
  });
  // arquivos arrastados para o painel
  ipcMain.handle('lib-add-paths', async (e, kind, paths) => {
    if (!panelOnly(e)) return { ok: false, error: 'remetente não autorizado', lib: libAll() };
    if (!LIB[kind] || !Array.isArray(paths)) return { ok: false, error: 'pedido inválido', lib: libAll() };
    return importFiles(kind, paths.filter((x) => typeof x === 'string').slice(0, 20));
  });
  ipcMain.handle('lib-remove', (e, kind, id) => {
    if (!panelOnly(e)) return libAll();
    const p = libPath(kind, id);
    if (p) {
      try { fs.unlinkSync(p); } catch (_) {}
      const partial = {};
      if (kind === 'avatars' && getSettings().avatarFile === id) partial.avatarFile = 'default';
      if (kind === 'items' && getSettings().item === 'custom:' + id) partial.item = 'none';
      if (Object.keys(partial).length) commit(partial);
    }
    return libAll();
  });
}

module.exports = { registerLibraryIpc, BUILTIN_ITEMS };
