// Workspace local de leitura controlada para Masori-Sama. Não executa comandos nem segue links simbólicos.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAX_FILE_BYTES = 300 * 1024;
const MAX_CONTEXT_BYTES = 48 * 1024;
const MAX_CONTEXT_FILES = 8;
const ALLOWED_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx',
  '.html', '.htm', '.css', '.scss', '.less', '.xml', '.yaml', '.yml', '.toml', '.py',
  '.bat', '.cmd', '.ps1', '.sh', '.sql', '.csv', '.ini', '.conf', '.log', '.gitignore',
  '.editorconfig', '.env.example', '.sample', '.vue', '.svelte', '.java', '.kt', '.go',
  '.rs', '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.rb', '.properties'
]);
const ALLOWED_NAMES = new Set(['Dockerfile', 'Makefile', 'LICENSE', 'NOTICE', '.gitignore', '.editorconfig']);
const BLOCKED_NAMES = new Set(['.git', 'node_modules', '.ssh', '.gnupg', '.aws', '.azure', '.kube', 'secrets', 'secret', 'credentials', 'keys', 'dist', 'coverage', '.venv', 'venv', '__pycache__', '.next', '.nuxt', '.cache', '.gradle', 'target', '.tox', '.pytest_cache']);
const SENSITIVE_FILE = /(?:^|[._-])(secret|secrets|credential|credentials|private[-_. ]?key|id_rsa|id_ed25519)(?:[._-]|$)|^\.env(?:$|\.)|^\.npmrc$|^\.pypirc$|^auth\.json$|^tokens?\.json$|\.(?:pem|key|p12|pfx)$/i;

function inside(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}
function normalizeRelative(value) {
  const raw = String(value || '').replace(/\\/g, '/').trim();
  if (raw.includes('\0') || raw.startsWith('/') || /^[a-z]:/i.test(raw)) throw new Error('Caminho inválido.');
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || ['<', '>', ':', '"', '|', '?', '*'].some((ch) => part.includes(ch)) || BLOCKED_NAMES.has(part.toLowerCase()))) throw new Error('Caminho bloqueado pelo workspace seguro.');
  return parts.join(path.sep);
}
function resolveRoot(root) {
  const resolved = fs.realpathSync(String(root || ''));
  if (!fs.statSync(resolved).isDirectory()) throw new Error('A pasta de trabalho não é válida.');
  return resolved;
}
function resolveSafe(root, relative, { mustExist = true } = {}) {
  const base = resolveRoot(root);
  const rel = normalizeRelative(relative);
  const candidate = path.resolve(base, rel || '.');
  if (!inside(base, candidate)) throw new Error('Caminho fora do workspace.');
  if (!mustExist) return { base, candidate, rel };
  const real = fs.realpathSync(candidate);
  if (!inside(base, real)) throw new Error('O caminho aponta para fora do workspace.');
  const stat = fs.lstatSync(candidate);
  if (stat.isSymbolicLink()) throw new Error('Links simbólicos não são permitidos.');
  return { base, candidate, real, rel, stat };
}
function isTextFile(name) {
  return !SENSITIVE_FILE.test(name) && (ALLOWED_NAMES.has(name) || ALLOWED_EXT.has(path.extname(name).toLowerCase()));
}
function list(root, relative = '') {
  const item = resolveSafe(root, relative);
  if (!item.stat.isDirectory()) throw new Error('O caminho solicitado não é uma pasta.');
  const rows = fs.readdirSync(item.candidate, { withFileTypes: true })
    .filter((entry) => !BLOCKED_NAMES.has(entry.name.toLowerCase()) && !entry.isSymbolicLink() && !SENSITIVE_FILE.test(entry.name))
    .map((entry) => {
      const rel = path.posix.join(String(relative || '').replace(/\\/g, '/'), entry.name);
      const full = path.join(item.candidate, entry.name);
      let stat;
      try { stat = fs.lstatSync(full); } catch (_) { return null; }
      if (entry.isDirectory()) return { name: entry.name, relativePath: rel, type: 'directory', size: 0, modifiedAt: stat.mtimeMs };
      if (!entry.isFile() || !isTextFile(entry.name)) return null;
      return { name: entry.name, relativePath: rel, type: 'file', size: stat.size, modifiedAt: stat.mtimeMs, readable: stat.size <= MAX_FILE_BYTES };
    }).filter(Boolean)
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1));
  return { path: String(relative || '').replace(/\\/g, '/'), entries: rows.slice(0, 200), truncated: rows.length > 200 };
}
function read(root, relative) {
  const item = resolveSafe(root, relative);
  if (!item.stat.isFile()) throw new Error('O caminho solicitado não é um arquivo.');
  if (!isTextFile(path.basename(item.candidate))) throw new Error('Este tipo de arquivo não pode ser lido pelo workspace.');
  if (item.stat.size > MAX_FILE_BYTES) throw new Error(`Arquivo muito grande para leitura segura (limite ${MAX_FILE_BYTES} bytes).`);
  const buffer = fs.readFileSync(item.candidate);
  if (buffer.includes(0)) throw new Error('Arquivo binário não permitido.');
  return { relativePath: String(relative || ''), text: buffer.toString('utf8'), size: item.stat.size, truncated: false };
}

function search(root, query) {
  const needle = String(query || '').trim().slice(0, 120).toLowerCase();
  if (needle.length < 2) throw new Error('Digite pelo menos dois caracteres para pesquisar.');
  const base = resolveRoot(root);
  const results = [];
  let scanned = 0, bytesRead = 0, truncated = false;
  const MAX_SCANNED = 300;
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_RESULTS = 60;
  function walk(folder, relative, depth) {
    if (depth > 12 || scanned >= MAX_SCANNED || bytesRead >= MAX_BYTES || results.length >= MAX_RESULTS) { truncated = true; return; }
    let entries;
    try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch (_) { return; }
    for (const entry of entries) {
      if (scanned >= MAX_SCANNED || bytesRead >= MAX_BYTES || results.length >= MAX_RESULTS) { truncated = true; break; }
      if (entry.isSymbolicLink() || BLOCKED_NAMES.has(entry.name.toLowerCase()) || SENSITIVE_FILE.test(entry.name)) continue;
      const rel = path.posix.join(relative, entry.name);
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) { walk(full, rel, depth + 1); continue; }
      if (!entry.isFile() || !isTextFile(entry.name)) continue;
      scanned++;
      try {
        const stat = fs.lstatSync(full);
        if (stat.size > MAX_FILE_BYTES || stat.size + bytesRead > MAX_BYTES) { truncated = true; continue; }
        const real = fs.realpathSync(full);
        if (!inside(base, real)) continue;
        const buffer = fs.readFileSync(full);
        bytesRead += buffer.length;
        if (buffer.includes(0)) continue;
        const text = buffer.toString('utf8');
        const lower = text.toLowerCase();
        let at = -1;
        while ((at = lower.indexOf(needle, at + 1)) !== -1) {
          const line = text.slice(0, at).split('\n').length;
          const start = Math.max(0, at - 80), end = Math.min(text.length, at + needle.length + 100);
          results.push({ relativePath: rel, line, snippet: text.slice(start, end).replace(/\s+/g, ' ').trim() });
          if (results.length >= MAX_RESULTS) { truncated = true; break; }
          // Um resultado por arquivo evita listas repetitivas e preserva diversidade.
          break;
        }
      } catch (_) { /* arquivo alterado/removido durante a busca: ignora */ }
    }
  }
  walk(base, '', 0);
  return { query: needle, results, scanned, bytesRead, truncated };
}

function buildContext(root, paths) {
  const unique = [...new Set((Array.isArray(paths) ? paths : []).map((v) => String(v || '').slice(0, 500)).filter(Boolean))].slice(0, MAX_CONTEXT_FILES);
  const parts = [];
  let bytes = 0;
  for (const rel of unique) {
    try {
      const item = read(root, rel);
      const remaining = MAX_CONTEXT_BYTES - bytes;
      if (remaining <= 0) break;
      const header = `\n--- ARQUIVO: ${item.relativePath} ---\n`;
      const content = Buffer.from(item.text, 'utf8');
      const allowed = Math.max(0, remaining - Buffer.byteLength(header));
      const piece = content.subarray(0, allowed).toString('utf8');
      parts.push(header + piece + (piece.length < item.text.length ? '\n[conteúdo truncado pelo limite de contexto]' : ''));
      bytes += Buffer.byteLength(header + piece);
    } catch (error) {
      parts.push(`\n--- ARQUIVO NÃO INCLUÍDO: ${rel} ---\n${String(error.message || error)}`);
    }
  }
  return { files: unique, text: parts.join('\n').slice(0, MAX_CONTEXT_BYTES + 4000) };
}
module.exports = { MAX_FILE_BYTES, MAX_CONTEXT_BYTES, MAX_CONTEXT_FILES, normalizeRelative, list, read, search, buildContext };
