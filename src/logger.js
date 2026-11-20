'use strict';

// Registro técnico local, com rotação e remoção de credenciais antes de persistir.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_FILES = 4;
const MAX_LINE_CHARS = 6000;
const SECRET_KEY = /("(?:[a-z_-]*(?:api[_-]?key|token|password|passwd|secret)|authorization)"\s*:\s*")[^"]*(")/gi;
const SECRET_ASSIGNMENT = /([a-z_-]*(?:api[_-]?key|token|password|passwd|secret)|authorization)(\s*[:=]\s*["']?)[^\s"'&,;]+/gi;

function redact(value) {
  return String(value == null ? '' : value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]')
    .replace(SECRET_KEY, '$1[REDACTED]$2')
    .replace(SECRET_ASSIGNMENT, '$1$2[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_KEY]')
    .replace(/(https?:\/\/[^:/\s]+:)[^@/\s]+@/gi, '$1[REDACTED]@');
}

function stringify(value) {
  if (value instanceof Error) return `${value.name || 'Error'}: ${value.message || ''}${value.stack ? `\n${value.stack}` : ''}`;
  if (typeof value === 'string') return value;
  try {
    const seen = new WeakSet();
    return JSON.stringify(value, (_key, item) => {
      if (item && typeof item === 'object') {
        if (seen.has(item)) return '[Circular]';
        seen.add(item);
      }
      if (typeof item === 'bigint') return item.toString();
      return item;
    });
  } catch (_) { return String(value); }
}

function createLogger({ directory, fsRef = fs, pathRef = path, now = Date.now, maxBytes = DEFAULT_MAX_BYTES, maxFiles = DEFAULT_FILES } = {}) {
  const dir = pathRef.resolve(directory || pathRef.join(process.cwd(), 'yoru-logs'));
  const file = pathRef.join(dir, 'yoru.log');
  const cap = Math.max(64 * 1024, Number(maxBytes) || DEFAULT_MAX_BYTES);
  const rotations = Math.max(1, Math.min(8, Math.floor(Number(maxFiles) || DEFAULT_FILES)));

  function regularFile(target) {
    try {
      const stat = fsRef.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile()) return null;
      return stat;
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }

  function ensureDirectory() {
    fsRef.mkdirSync(dir, { recursive: true });
    try {
      const stat = fsRef.lstatSync(dir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Pasta de logs não é um diretório seguro.');
    } catch (error) { throw error; }
  }

  function rotate(incomingBytes) {
    const current = regularFile(file);
    if (!current || current.size + incomingBytes <= cap) return;
    const oldest = `${file}.${rotations}`;
    try { fsRef.unlinkSync(oldest); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (let index = rotations - 1; index >= 1; index--) {
      const from = `${file}.${index}`;
      const to = `${file}.${index + 1}`;
      try { regularFile(from) && fsRef.renameSync(from, to); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    fsRef.renameSync(file, `${file}.1`);
  }

  function write(level, scope, message, details) {
    try {
      ensureDirectory();
      const text = [stringify(message), details === undefined ? '' : stringify(details)].filter(Boolean).join(' | ');
      const record = {
        at: new Date(now()).toISOString(),
        level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
        scope: redact(String(scope || 'app')).slice(0, 80),
        message: redact(text).slice(0, MAX_LINE_CHARS),
      };
      const line = `${JSON.stringify(record)}\n`;
      const bytes = Buffer.byteLength(line, 'utf8');
      const existing = regularFile(file);
      if (existing && existing.size + bytes > cap) rotate(bytes);
      // Recusa links simbólicos no arquivo ativo em vez de seguir um destino inesperado.
      regularFile(file);
      try {
        const stat = fsRef.lstatSync(file);
        if (stat.isSymbolicLink() || !stat.isFile()) return false;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      fsRef.appendFileSync(file, line, { encoding: 'utf8', mode: 0o600 });
      return true;
    } catch (_) { return false; }
  }

  function readRecent(limit = 500) {
    try {
      ensureDirectory();
      const files = [];
      for (let index = rotations; index >= 1; index--) files.push(`${file}.${index}`);
      files.push(file);
      const lines = [];
      for (const target of files) {
        const stat = regularFile(target);
        if (!stat || stat.size > cap + 4096) continue;
        const content = fsRef.readFileSync(target, 'utf8');
        lines.push(...content.split(/\r?\n/).filter(Boolean));
      }
      const max = Math.max(1, Math.min(2000, Math.floor(Number(limit) || 500)));
      return lines.slice(-max).join('\n') + (lines.length ? '\n' : '');
    } catch (_) { return ''; }
  }

  function exportText(limit = 500) {
    const body = readRecent(limit);
    return `# Yoru - registros técnicos locais\n# Segredos conhecidos são ocultados automaticamente. Os registros podem conter horários, nomes de módulos e caminhos do Windows.\n${body}`;
  }

  return Object.freeze({
    debug: (scope, message, details) => write('debug', scope, message, details),
    info: (scope, message, details) => write('info', scope, message, details),
    warn: (scope, message, details) => write('warn', scope, message, details),
    error: (scope, message, details) => write('error', scope, message, details),
    readRecent,
    exportText,
    file,
  });
}

module.exports = { createLogger, redact, DEFAULT_MAX_BYTES, DEFAULT_FILES };
