'use strict';
// scripts/setup-openclaw.js: liga o endpoint de chat do gateway sem estragar o resto da configuração.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const S = require('../scripts/setup-openclaw');

test('plan: liga o endpoint e preserva o resto da configuração', () => {
  const cfg = { agents: { x: 1 }, gateway: { port: 18789, auth: { mode: 'token', token: 'abcdef123456' }, http: { endpoints: { responses: { enabled: true } } } } };
  const p = S.plan(cfg);
  assert.equal(p.changed, true);
  assert.equal(p.next.gateway.http.endpoints.chatCompletions.enabled, true);
  assert.equal(p.next.gateway.http.endpoints.responses.enabled, true);
  assert.equal(p.next.gateway.port, 18789);
  assert.deepEqual(p.next.agents, { x: 1 });
  assert.equal(p.secret, 'abcdef123456');
  assert.equal(cfg.gateway.http.endpoints.chatCompletions, undefined, 'não altera o objeto de entrada');
});

test('plan: já ligado = nada a mudar; arquivo vazio também funciona', () => {
  assert.equal(S.plan({ gateway: { http: { endpoints: { chatCompletions: { enabled: true } } } } }).changed, false);
  assert.equal(S.plan({}).changed, true);
  assert.equal(S.plan(null).next.gateway.http.endpoints.chatCompletions.enabled, true);
});

test('plan: avisa de bind aberto e de gateway sem token em texto', () => {
  const open = S.plan({ gateway: { bind: '0.0.0.0', auth: { mode: 'token' } } });
  assert.ok(open.notes.some((n) => /0\.0\.0\.0/.test(n)));
  assert.ok(open.notes.some((n) => /token/i.test(n)));
  assert.equal(S.plan({ gateway: { bind: 'loopback', auth: { token: 't'.repeat(12) } } }).notes.length, 0);
});

test('mask: não vaza o token inteiro', () => {
  assert.ok(!S.mask('abcdef0123456789').includes('cdef0123456'));
  assert.equal(S.mask('abc'), '****');
});

test('main: simula por padrão, grava com --apply e faz cópia de segurança', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-oc-'));
  const file = path.join(dir, 'openclaw.json');
  const original = JSON.stringify({ gateway: { auth: { token: 'tok-1234567890' } } });
  fs.writeFileSync(file, original);
  const lines = [];
  const out = (l) => lines.push(l);

  assert.equal(S.main(['--config', file], out), 0);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'sem --apply nada é gravado');
  assert.ok(!lines.join('\n').includes('tok-1234567890'), 'token mascarado');

  assert.equal(S.main(['--config', file, '--apply'], out), 0);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(saved.gateway.http.endpoints.chatCompletions.enabled, true);
  assert.equal(saved.gateway.auth.token, 'tok-1234567890');
  const baks = fs.readdirSync(dir).filter((f) => f.includes('.yoru-bak-'));
  assert.equal(baks.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, baks[0]), 'utf8'), original);

  fs.rmSync(dir, { recursive: true, force: true });
});

test('main: arquivo com comentários (JSON5) não é reescrito; arquivo ausente avisa', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-oc-'));
  const file = path.join(dir, 'openclaw.json');
  const json5 = '{ // meu gateway\n gateway: { port: 1, }, }';
  fs.writeFileSync(file, json5);
  const lines = [];
  assert.equal(S.main(['--config', file, '--apply'], (l) => lines.push(l)), 2);
  assert.equal(fs.readFileSync(file, 'utf8'), json5);
  assert.match(lines.join('\n'), /chatCompletions/);
  assert.equal(S.main(['--config', path.join(dir, 'nao-existe.json')], () => {}), 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
