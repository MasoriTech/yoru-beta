'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/ai-router');

test('auto classifica voz e perguntas simples como FAST', () => {
  assert.equal(R.classify('Oi, tudo bem?'), 'fast');
  assert.equal(R.classify('me diga a hora', { voice: true }), 'fast');
});
test('auto encaminha pedidos longos e analíticos para THINK', () => {
  assert.equal(R.classify('Faça uma análise detalhada da arquitetura e compare as alternativas.'), 'think');
  assert.equal(R.classify('x'.repeat(701)), 'think');
});
test('FAST aplica modelo alternativo e limite de tokens sem alterar config original', () => {
  const original = { provider: 'ollama', ollama: { model: 'base' }, routing: { mode: 'fast', fastModel: 'small' } };
  const out = R.route(original, 'oi', { maxTokens: 900 });
  assert.equal(out.mode, 'fast'); assert.equal(out.config.ollama.model, 'small'); assert.equal(out.maxTokens, 220);
  assert.equal(original.ollama.model, 'base');
});
test('THINK usa modelo alternativo e orçamento completo', () => {
  const out = R.route({ provider: 'anthropic', anthropic: { model: 'main' }, routing: { mode: 'think', thinkModel: 'reasoner' } }, 'analise', { maxTokens: 800 });
  assert.equal(out.config.anthropic.model, 'reasoner'); assert.equal(out.maxTokens, 800);
});
test('LOCAL seleciona Ollama e modo inválido volta para auto', () => {
  const cfg = { provider: 'anthropic', ollama: { url: 'http://localhost:11434', model: 'qwen' }, routing: { mode: 'local' } };
  assert.equal(R.route(cfg, 'oi').config.provider, 'ollama');
  assert.equal(R.route({ routing: { mode: 'bad' } }, 'oi').mode, 'fast');
});

test('LOCAL com o KoboldCpp continua nele em vez de trocar para o Ollama', () => {
  const cfg = { provider: 'kobold', kobold: { url: 'http://localhost:5001/v1', model: 'koboldcpp' }, ollama: { model: 'qwen' }, routing: { mode: 'local' } };
  const out = R.route(cfg, 'oi');
  assert.equal(out.config.provider, 'kobold'); assert.equal(out.config.kobold.url, 'http://localhost:5001/v1');
});
