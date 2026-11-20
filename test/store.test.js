'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { writeAtomic, createDebouncedSaver } = require('../src/store');
const { createChatStore } = require('../src/chat-store');
const AIC = require('../src/ai-core');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-'));

test('writeAtomic grava o conteúdo e não deixa o .tmp para trás', () => {
  const f = path.join(tmp(), 'a.json');
  writeAtomic(f, '{"a":1}'); writeAtomic(f, '{"a":2}');
  assert.equal(fs.readFileSync(f, 'utf8'), '{"a":2}');
  assert.equal(fs.existsSync(f + '.tmp'), false);
});

test('saver: várias alterações seguidas viram uma gravação só', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let n = 0;
  const s = createDebouncedSaver(() => { n++; }, { delay: 200 });
  s.save(); s.save(); s.save();
  assert.equal(s.pending, true);
  t.mock.timers.tick(199); assert.equal(n, 0);
  t.mock.timers.tick(1); assert.equal(n, 1);
  assert.equal(s.pending, false);
});

test('saver: o prazo recomeça a cada save()', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let n = 0;
  const s = createDebouncedSaver(() => { n++; }, { delay: 200 });
  s.save(); t.mock.timers.tick(150); s.save(); t.mock.timers.tick(150);
  assert.equal(n, 0);
  t.mock.timers.tick(50); assert.equal(n, 1);
});

test('saver: flush grava na hora e cancela o agendado; erro de disco não derruba', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let n = 0;
  const s = createDebouncedSaver(() => { n++; if (n === 1) throw new Error('disco cheio'); }, { delay: 200 });
  s.save(); assert.doesNotThrow(() => s.flush());
  assert.equal(n, 1);
  t.mock.timers.tick(500); assert.equal(n, 1); // o agendado foi cancelado
});

test('saver desligado (enabled=false) não grava nem agenda', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let n = 0, on = false;
  const s = createDebouncedSaver(() => { n++; }, { delay: 10, enabled: () => on });
  s.save(); s.flush(); t.mock.timers.tick(100);
  assert.equal(n, 0); assert.equal(s.pending, false);
  on = true; s.flush(); assert.equal(n, 1);
});

function chatEnv(over = {}) {
  const dir = tmp(), file = path.join(dir, 'chat-state.json');
  const ai = AIC.createAI({ getSettings: () => ({ historyLimit: 20 }), loadConfig: () => ({}), buildSystem: () => '' });
  const chatBuf = [];
  const state = { on: true };
  const store = createChatStore({ ai, chatBuf, file: () => file, enabled: () => state.on, delay: 600, ...over });
  return { ai, chatBuf, store, file, state };
}

test('chat-store: salva e restaura histórico e mensagens do chat', () => {
  const a = chatEnv();
  a.ai.setHistory([{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }]);
  a.chatBuf.push({ role: 'user', text: 'oi' }, { role: 'assistant', text: 'olá' });
  a.store.writeNow();
  const b = chatEnv({ file: () => a.file });
  assert.equal(b.store.load(), true);
  assert.deepEqual(b.ai.getHistory().map((m) => m.content), ['oi', 'olá']);
  assert.deepEqual(b.chatBuf.map((m) => m.text), ['oi', 'olá']);
});

test('chat-store: pergunta sem resposta e mensagens inválidas não voltam', () => {
  const a = chatEnv();
  fs.writeFileSync(a.file, JSON.stringify({
    history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'sem resposta' }],
    chat: [{ role: 'user', text: 'a' }, { role: 'x', text: 'lixo' }, null, { role: 'assistant', text: 'b' }, { role: 'error', text: 'e' }, { role: 'user', text: 'pendente' }],
  }));
  a.store.load();
  assert.deepEqual(a.ai.getHistory().map((m) => m.content), ['a', 'b']);
  assert.deepEqual(a.chatBuf.map((m) => m.text), ['a', 'b', 'e']);
});

test('chat-store: guarda só as últimas 100 mensagens do chat', () => {
  const a = chatEnv();
  fs.writeFileSync(a.file, JSON.stringify({ history: [], chat: Array.from({ length: 130 }, (_, i) => ({ role: 'assistant', text: 'm' + i })) }));
  a.store.load();
  assert.equal(a.chatBuf.length, 100);
  assert.equal(a.chatBuf[0].text, 'm30');
});

test('chat-store: arquivo ausente ou quebrado não dá erro', () => {
  const a = chatEnv();
  assert.equal(a.store.load(), false);
  fs.writeFileSync(a.file, '{quebrado');
  assert.equal(a.store.load(), false);
  assert.deepEqual(a.ai.getHistory(), []);
});

test('chat-store: com "guardar conversa" desligado não lê nem grava', () => {
  const a = chatEnv();
  a.state.on = false;
  a.store.persist(); a.store.writeNow();
  assert.equal(fs.existsSync(a.file), false);
  fs.writeFileSync(a.file, JSON.stringify({ history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }));
  assert.equal(a.store.load(), false);
  assert.deepEqual(a.ai.getHistory(), []);
});

test('chat-store: persist() espera o prazo antes de gravar', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = chatEnv();
  a.store.persist();
  assert.equal(fs.existsSync(a.file), false);
  t.mock.timers.tick(600);
  assert.equal(fs.existsSync(a.file), true);
});
