'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger, redact } = require('../src/logger');

test('logger grava eventos estruturados e remove credenciais conhecidas', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-log-'));
  try {
    const logger = createLogger({ directory: dir, now: () => 0 });
    assert.equal(logger.info('startup', 'Aplicativo iniciado', { version: '0.59.0' }), true);
    logger.error('provider', new Error('Falha apiKey=sk-12345678901234567890'), { password: 'senha-secreta', Authorization: 'Bearer abcdefghijk' });
    const lines = logger.readRecent().trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].level, 'info');
    assert.match(lines[1].message, /REDACTED/);
    assert.equal(lines.join(' ').includes('senha-secreta'), false);
    assert.equal(lines.join(' ').includes('12345678901234567890'), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('logger faz rotação e mantém limite de arquivos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-log-rotate-'));
  try {
    const logger = createLogger({ directory: dir, maxBytes: 65536, maxFiles: 2 });
    for (let i = 0; i < 100; i++) logger.info('stress', `registro ${i} ${'x'.repeat(900)}`);
    assert.ok(fs.existsSync(logger.file));
    assert.ok(fs.existsSync(`${logger.file}.1`));
    assert.ok(fs.statSync(logger.file).size <= 65536);
    assert.ok(fs.statSync(`${logger.file}.1`).size <= 65536);
    assert.match(logger.exportText(10), /registros técnicos locais/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('redact protege tokens e credenciais em URLs', () => {
  const text = redact(`Authorization: Bearer abcdefghijk https://user:secret@example.com api_key=abc123456 client_secret=segredo456 \"refresh_token\":\"tokenprivado\"`);
  assert.doesNotMatch(text, /abcdefghijk|user:secret|abc123456|segredo456|tokenprivado/);
});
