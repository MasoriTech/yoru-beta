'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/masori-core');
test('Masori-Sama is the coordinator and Yoru remains the desktop persona', () => {
  const p = M.plan('Crie um aplicativo em JavaScript e teste o código');
  assert.equal(p.coordinator, 'masori-sama');
  assert.ok(p.agents.includes('masori-sama'));
  assert.ok(p.agents.includes('masori-dev'));
  assert.ok(p.agents.includes('masori-agent'));
});
test('selects research and vision specialists from task intent', () => {
  const p = M.plan('Pesquise e compare imagens e capturas de tela');
  assert.ok(p.agents.includes('masori-research'));
  assert.ok(p.agents.includes('masori-vision'));
});
test('rejects empty task and bounds task length', () => {
  assert.equal(M.plan(' ').ok, false);
  assert.equal(M.plan('x'.repeat(5000)).task.length, 4000);
});
test('hint is transparent about specialist orchestration', () => {
  const p = M.plan('Desenvolva um site');
  const h = M.buildHint(p);
  assert.match(h, /não afirme uso de ferramentas externas/);
  assert.match(h, /Masori-Sama/);
});

test('planner identifies independent specialist orchestration mode', () => {
  const p = M.plan('Desenvolva e teste um aplicativo e pesquise alternativas');
  assert.equal(p.mode, 'independent-specialists');
  assert.ok(p.agents.includes('masori-sama'));
});
