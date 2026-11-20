'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const STORE = require('../src/masori-store');
test('sanitiza configuração individual e rejeita provedores desconhecidos', () => {
  const c = STORE.sanitizeConfig({ 'masori-dev': { provider: 'ollama', model: 'qwen3:0.6b' }, 'masori-agent': { provider: 'evil', model: 'x'.repeat(300) } });
  assert.deepEqual(c['masori-dev'], { provider: 'ollama', model: 'qwen3:0.6b', enabled: true });
  assert.equal(c['masori-agent'].provider, 'inherit');
  assert.equal(c['masori-agent'].model.length, 160);
});
test('cria configuração do agente sem alterar o provedor base', () => {
  const base = { provider: 'openrouter', openrouter: { model: 'default', apiKey: 'secret' }, ollama: { url: 'http://localhost:11434', model: 'llama' } };
  const cfg = STORE.agentConfig(base, { provider: 'ollama', model: 'qwen3:0.6b' });
  assert.equal(cfg.provider, 'ollama'); assert.equal(cfg.ollama.model, 'qwen3:0.6b');
  assert.equal(base.provider, 'openrouter'); assert.equal(base.ollama.model, 'llama');
});
test('mantém histórico limitado e recupera memória apenas do agente correspondente', () => {
  let history = [];
  for (let i = 0; i < 35; i++) history = STORE.appendHistory(history, { task: `Tarefa ${i}`, specialists: [{ agent: 'masori-dev', ok: true, text: `Relatório ${i}` }] });
  assert.equal(history.length, 30);
  assert.match(STORE.memoryFor(history, 'masori-dev'), /Relatório 34/);
  assert.equal(STORE.memoryFor(history, 'masori-voice'), '');
});

test('history retains execution state and selected workspace paths', () => {
  const history = STORE.appendHistory([], { id: 'run-1', task: 'Analisar projeto', ok: false, status: 'cancelled', workspaceFiles: ['README.md', 'src/main.js'], specialists: [{ agent: 'masori-dev', ok: false, cancelled: true, text: 'Interrompido' }] });
  assert.equal(history[0].status, 'cancelled');
  assert.deepEqual(history[0].workspaceFiles, ['README.md', 'src/main.js']);
  assert.equal(history[0].specialists[0].cancelled, true);
});
