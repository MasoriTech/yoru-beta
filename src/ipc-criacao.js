'use strict';
// Handlers IPC da aba Criação (imagens, textos, vídeos, SVG e HTML guardados como projetos).
// A lógica de gerar e guardar fica em criacao-service.js; aqui só a ponte entre o painel e ela.
const fs = require('fs');
const path = require('path');
const CRIA = require('./criacao');
const { realKey } = require('./ai-core');

function registerCriacaoIpc({ ipcMain, shell, dialog, BrowserWindow, loadConfig, saveConfig, svc, asMsg, isPanelSender = () => true }) {
  const { criaLoad, criaStore, criaPath, criaView, criaEnhance, criaOneImage, criaText, criaStoryboard, criaCode, criaPreviewFile, criaSave } = svc;
  const criaHandle = (name, fn) => ipcMain.handle(name, async (e, ...args) => { if (!isPanelSender(e.sender)) return { ok: false, error: 'remetente não autorizado' }; try { return { ok: true, ...(await fn(e, ...args)) }; } catch (err) { return { ok: false, error: asMsg(err) }; } });
  criaHandle('cria-meta', () => ({
    maxPrompt: CRIA.MAX_PROMPT,
    styles: CRIA.STYLES.map(({ id, label }) => ({ id, label })),
    ratios: CRIA.RATIOS.map(({ id, label, w, h }) => ({ id, label, w, h })),
    models: CRIA.IMAGE_MODELS.map(({ id, label, kind, needs, free, negative }) => ({ id, label, kind, needs, free, negative: !!negative, group: free ? 'Grátis (Cloudflare)' : 'Pagos (opcional)' })),
    textModels: CRIA.TEXT_MODELS.map(({ id, label, free, group, needs }) => ({ id, label, free, group, needs })),
    kinds: CRIA.TEXT_KINDS.map(({ id, label }) => ({ id, label })),
    tones: CRIA.TONES, sizes: CRIA.SIZES.map(({ id, label }) => ({ id, label })),
    langs: CRIA.LANGS.map(({ id, label }) => ({ id, label })),
    svgKinds: CRIA.SVG_KINDS.map(({ id, label }) => ({ id, label })), htmlKinds: CRIA.HTML_KINDS.map(({ id, label }) => ({ id, label })),
    palettes: CRIA.CODE_PALETTES.map(({ id, label }) => ({ id, label })),
    motions: CRIA.MOTIONS, fades: CRIA.FADES.map(({ id, label }) => ({ id, label })),
  }));
  // sorteia uma ideia de prompt para o botão 🎲
  criaHandle('cria-idea', (_e, tool) => ({ idea: CRIA.randomIdea(tool) }));
  // chaves dos serviços gratuitos (a chave nunca volta para a tela; só um aviso de que existe e os 4 últimos caracteres)
  const criaKeyInfo = () => {
    const c = loadConfig(), hint = (k) => { const v = realKey(k); return v ? { has: true, hint: '…' + v.slice(-4) } : { has: false, hint: '' }; };
    return {
      cloudflareAccountId: c.cloudflare.accountId || '', cloudflareToken: hint(c.cloudflare.apiToken),
      openrouter: hint(c.openrouter.apiKey), pollinations: hint(c.pollinations.apiKey), groq: hint(c.groq.apiKey), gemini: hint(c.gemini.apiKey),
    };
  };
  criaHandle('cria-keys-get', () => ({ keys: criaKeyInfo() }));
  criaHandle('cria-keys-set', (_e, o) => {
    o = o || {};
    const c = loadConfig(), clean = (v) => String(v || '').trim().slice(0, 300);
    if (typeof o.cloudflareAccountId === 'string') c.cloudflare.accountId = clean(o.cloudflareAccountId).replace(/[^A-Za-z0-9]/g, '');
    if (clean(o.cloudflareToken)) c.cloudflare.apiToken = clean(o.cloudflareToken);
    if (clean(o.openrouter)) c.openrouter.apiKey = clean(o.openrouter); // não muda o provedor do chat
    if (clean(o.pollinations)) c.pollinations.apiKey = clean(o.pollinations);
    if (clean(o.groq)) c.groq.apiKey = clean(o.groq);
    if (clean(o.gemini)) c.gemini.apiKey = clean(o.gemini);
    for (const k of Array.isArray(o.clear) ? o.clear : []) {
      if (k === 'cloudflare') { c.cloudflare.accountId = ''; c.cloudflare.apiToken = ''; }
      if (k === 'openrouter') c.openrouter.apiKey = '';
      if (k === 'pollinations') c.pollinations.apiKey = '';
      if (k === 'groq') c.groq.apiKey = '';
      if (k === 'gemini') c.gemini.apiKey = '';
    }
    saveConfig(c);
    return { keys: criaKeyInfo() };
  });
  criaHandle('cria-list', (_e, f) => {
    const all = criaLoad();
    return {
      total: all.length,
      favorites: all.filter((p) => p.favorite === true).length,
      bytes: all.reduce((n, p) => n + (Number(p.bytes) || 0), 0),
      projects: CRIA.filterProjects(all, f || {}).map((p) => ({ ...criaView(p), when: CRIA.humanDate(p.createdAt), typeLabel: CRIA.typeLabel(p.type), dur: p.meta && p.meta.duration ? CRIA.formatDuration(p.meta.duration) : '' })),
    };
  });
  criaHandle('cria-enhance', async (_e, o) => ({ prompt: await criaEnhance(o && o.prompt, o && o.textModel) }));
  criaHandle('cria-image', async (_e, o) => ({ ...(await criaOneImage(o || {})) }));
  criaHandle('cria-text', async (_e, o) => ({ text: await criaText(o || {}) }));
  criaHandle('cria-code', async (_e, o) => ({ ...(await criaCode(o || {})) }));
  // abre o SVG/HTML que está na tela no navegador padrão (arquivo temporário; não vira projeto)
  criaHandle('cria-open-code', async (_e, o) => {
    const err = await shell.openPath(criaPreviewFile(o)); if (err) throw new Error(err); return {};
  });
  criaHandle('cria-storyboard', async (_e, o) => ({ scenes: await criaStoryboard(o || {}) }));
  criaHandle('cria-save', (_e, o) => ({ project: criaSave(o || {}) }));
  criaHandle('cria-read-text', (_e, id) => {
    const p = criaLoad().find((x) => x.id === id);
    if (!p || !['text', 'svg', 'html'].includes(p.type)) throw new Error('Projeto não encontrado.');
    return { text: fs.readFileSync(criaPath(p.file), 'utf8') };
  });
  criaHandle('cria-favorite', (_e, id, favorite) => {
    const list = criaLoad(); const p = list.find((x) => x.id === id);
    if (!p) throw new Error('Projeto não encontrado.');
    p.favorite = favorite === true; criaStore(list);
    return { project: criaView(p) };
  });
  criaHandle('cria-rename', (_e, id, title) => {
    const list = criaLoad(); const p = list.find((x) => x.id === id);
    if (!p) throw new Error('Projeto não encontrado.');
    p.title = String(title || '').trim().slice(0, 60) || p.title; criaStore(list); return { project: criaView(p) };
  });
  criaHandle('cria-delete', (_e, id) => {
    const list = criaLoad(); const p = list.find((x) => x.id === id);
    if (!p) return {};
    for (const f of [p.file, p.poster]) if (f) { try { fs.unlinkSync(criaPath(f)); } catch (_) {} }
    criaStore(list.filter((x) => x.id !== id)); return {};
  });
  criaHandle('cria-reveal', (_e, id) => { const p = criaLoad().find((x) => x.id === id); if (p) shell.showItemInFolder(criaPath(p.file)); return {}; });
  criaHandle('cria-open', async (_e, id) => {
    const p = criaLoad().find((x) => x.id === id); if (!p) throw new Error('Projeto não encontrado.');
    const err = await shell.openPath(criaPath(p.file)); if (err) throw new Error(err); return {};
  });
  criaHandle('cria-export', async (e, id) => {
    const p = criaLoad().find((x) => x.id === id); if (!p) throw new Error('Projeto não encontrado.');
    const parent = BrowserWindow.fromWebContents(e.sender);
    const r = await dialog.showSaveDialog(parent, { defaultPath: `${CRIA.safeFileName(p.title)}${path.extname(p.file)}` });
    if (r.canceled || !r.filePath) return { canceled: true };
    fs.copyFileSync(criaPath(p.file), r.filePath); return { path: r.filePath };
  });
}

module.exports = { registerCriacaoIpc };
