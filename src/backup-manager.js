'use strict';
// Backup portátil validado. A restauração prepara tudo antes de substituir dados e tenta reverter em caso de falha.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const VERSION = 1;
const MAX_FILE = 40 * 1024 * 1024;
const MAX_TOTAL = 120 * 1024 * 1024;
const MAX_FILES = 5000;
const ALLOWED_ROOT_FILES = new Set(['settings.json', 'profile.json', 'memory.json', 'chat-state.json', 'agenda.json', 'last-open.json', 'library-seeded.json']);
const ALLOWED_DIRS = new Set(['avatars', 'items', 'criacao']);

function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return !!rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

async function ensureRoot(root) {
  try {
    const st = await fs.promises.lstat(root);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error('A pasta de dados do Yoru não é segura para backup.');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function addFile(abs, rel, out, totalRef) {
  const st = await fs.promises.lstat(abs);
  if (!st.isFile() || st.isSymbolicLink()) return;
  if (st.size > MAX_FILE || totalRef.value + st.size > MAX_TOTAL) throw new Error('O backup ultrapassa o limite de tamanho permitido.');
  if (out.length >= MAX_FILES) throw new Error('O backup contém arquivos demais.');
  const data = await fs.promises.readFile(abs);
  out.push({ path: rel.replace(/\\/g, '/'), data: data.toString('base64') });
  totalRef.value += data.length;
}

async function walk(dir, rel, out, totalRef) {
  let dirStat;
  try { dirStat = await fs.promises.lstat(dir); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) return;
  let entries;
  try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const ent of entries) {
    if (ent.isSymbolicLink() || ent.name.startsWith('_previa.')) continue;
    const abs = path.join(dir, ent.name), name = `${rel}/${ent.name}`;
    if (ent.isDirectory()) await walk(abs, name, out, totalRef);
    else if (ent.isFile()) await addFile(abs, name, out, totalRef);
  }
}

async function createBackup({ userDataDir, configFile }) {
  const root = path.resolve(userDataDir), files = [], total = { value: 0 };
  await ensureRoot(root);
  for (const name of ALLOWED_ROOT_FILES) await addFile(path.join(root, name), name, files, total).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  for (const rel of ALLOWED_DIRS) await walk(path.join(root, rel), rel, files, total);
  if (configFile) {
    const cfg = path.resolve(configFile);
    if (!isInside(root, cfg)) {
      try {
        const st = await fs.promises.lstat(cfg);
        if (st.isFile() && !st.isSymbolicLink()) {
          if (st.size > MAX_FILE || total.value + st.size > MAX_TOTAL) throw new Error('O backup ultrapassa o limite de tamanho permitido.');
          if (files.length >= MAX_FILES) throw new Error('O backup contém arquivos demais.');
          const data = await fs.promises.readFile(cfg);
          files.push({ path: 'external/config.json', data: data.toString('base64') }); total.value += data.length;
        }
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    } else {
      const rel = path.relative(root, cfg).replace(/\\/g, '/');
      if (rel === 'config.json') await addFile(cfg, rel, files, total).catch((error) => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  return Buffer.from(JSON.stringify({ format: 'YORU_BACKUP', version: VERSION, createdAt: new Date().toISOString(), files }), 'utf8');
}

function normalizeBackupPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) throw new Error('O backup contém um caminho inválido.');
  const normalized = value.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) throw new Error('O backup contém um caminho absoluto não permitido.');
  const parts = normalized.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('O backup contém uma tentativa de sair da pasta permitida.');
  if (parts.some((part) => /[<>:"|?*]/.test(part) || /[ .]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('O backup contém um nome de arquivo inválido para o Windows.');
  return normalized;
}

function targetFor(root, configFile, rel) {
  if (rel === 'external/config.json') return configFile ? path.resolve(configFile) : null;
  if (ALLOWED_ROOT_FILES.has(rel) || rel === 'config.json' || [...ALLOWED_DIRS].some((d) => rel.startsWith(d + '/'))) {
    const target = path.resolve(root, ...rel.split('/'));
    return isInside(root, target) ? target : null;
  }
  return null;
}

async function assertSafeTarget(root, target) {
  const absolute = path.resolve(target), rootPath = path.resolve(root);
  const inside = isInside(rootPath, absolute);
  const volumeRoot = path.parse(absolute).root;
  const base = inside ? rootPath : volumeRoot;
  const rel = path.relative(base, absolute);
  let current = base;
  if (inside) {
    try {
      const rootStat = await fs.promises.lstat(rootPath);
      if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('A pasta de restauração não é segura.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const parts = rel.split(path.sep).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const st = await fs.promises.lstat(current);
      if (st.isSymbolicLink()) throw new Error('O backup aponta para um caminho simbólico não permitido.');
      if (i < parts.length - 1 && !st.isDirectory()) throw new Error('Caminho de restauração inválido.');
      if (i === parts.length - 1 && !st.isFile()) throw new Error('O destino da restauração não é um arquivo.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

async function safeUnlink(target) {
  try { await fs.promises.unlink(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function restoreBackup({ buffer, userDataDir, configFile }) {
  const raw = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (raw.length > MAX_TOTAL * 1.5) throw new Error('Arquivo de backup muito grande.');
  let doc;
  try { doc = JSON.parse(raw.toString('utf8')); } catch (_) { throw new Error('Arquivo de backup inválido.'); }
  if (doc.format !== 'YORU_BACKUP' || doc.version !== VERSION || !Array.isArray(doc.files) || doc.files.length > MAX_FILES) throw new Error('Formato ou versão de backup não reconhecido.');
  const root = path.resolve(userDataDir); await ensureRoot(root);
  let total = 0;
  const planned = [], seen = new Set();
  // Fase 1: valida o documento e os destinos antes de tocar nos arquivos atuais.
  for (const item of doc.files) {
    if (!item || typeof item.path !== 'string' || typeof item.data !== 'string') throw new Error('O backup contém um arquivo incompleto.');
    const rel = normalizeBackupPath(item.path);
    const target = targetFor(root, configFile, rel);
    if (!target) continue; // compatibilidade: ignora itens não suportados por esta instalação
    const key = process.platform === 'win32' ? target.toLowerCase() : target;
    if (seen.has(key)) throw new Error('O backup contém caminhos duplicados.');
    seen.add(key);
    if (item.data.length > Math.ceil(MAX_FILE / 3) * 4 + 8) throw new Error('O backup excede o limite permitido.');
    const data = Buffer.from(item.data, 'base64');
    if (data.toString('base64').replace(/=+$/, '') !== item.data.replace(/=+$/, '')) throw new Error('Conteúdo inválido no backup.');
    total += data.length;
    if (data.length > MAX_FILE || total > MAX_TOTAL) throw new Error('O backup excede o limite permitido.');
    await assertSafeTarget(root, target);
    planned.push({ target, data, temp: null, rollback: null, movedOriginal: false, installed: false });
  }
  if (!planned.length) throw new Error('Nenhum arquivo válido para restaurar foi encontrado.');

  const nonce = crypto.randomBytes(6).toString('hex');
  // Fase 2: prepara todos os temporários antes de substituir o primeiro arquivo.
  try {
    for (let index = 0; index < planned.length; index++) {
      const item = planned[index];
      await fs.promises.mkdir(path.dirname(item.target), { recursive: true });
      await assertSafeTarget(root, item.target);
      item.temp = `${item.target}.yoru-stage-${process.pid}-${nonce}-${index}`;
      await fs.promises.writeFile(item.temp, item.data, { flag: 'wx', mode: 0o600 });
    }
  } catch (error) {
    for (const item of planned) if (item.temp) await safeUnlink(item.temp).catch(() => {});
    throw error;
  }

  // Fase 3: substituição com cópia temporária dos originais para rollback.
  try {
    for (let index = 0; index < planned.length; index++) {
      const item = planned[index];
      await assertSafeTarget(root, item.target);
      try {
        await fs.promises.lstat(item.target);
        item.rollback = `${item.target}.yoru-rollback-${process.pid}-${nonce}-${index}`;
        await fs.promises.rename(item.target, item.rollback);
        item.movedOriginal = true;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.promises.rename(item.temp, item.target);
      item.temp = null;
      item.installed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of [...planned].reverse()) {
      try {
        if (item.installed) await safeUnlink(item.target);
        if (item.movedOriginal && item.rollback) await fs.promises.rename(item.rollback, item.target);
        if (item.temp) await safeUnlink(item.temp);
      } catch (rollbackError) { rollbackErrors.push(rollbackError.message); }
    }
    if (rollbackErrors.length) throw new Error(`A restauração falhou e a reversão encontrou problemas: ${rollbackErrors.join('; ').slice(0, 300)}`);
    throw error;
  }

  for (const item of planned) if (item.rollback) await safeUnlink(item.rollback).catch(() => {});
  return { restored: planned.length, createdAt: String(doc.createdAt || '') };
}

module.exports = { createBackup, restoreBackup, VERSION, MAX_FILE, MAX_TOTAL, MAX_FILES, normalizeBackupPath };
