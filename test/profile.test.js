'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/profile');

test('sanitize limpa e limita os campos', () => {
  const p = P.sanitize({ name: '  Ingrid  ', nickname: 'In', birth: '1996-08-17', gender: 'f', height: '1,67', weight: 77, about: 'x'.repeat(500),
    interests: ['Viagens', 'viagens', ' Saúde ', ''], opt: { job: 'Analista', health: 'cpf 123.456.789-09' }, track: { weight: true }, weightGoal: 70 });
  assert.equal(p.name, 'Ingrid');
  assert.equal(p.height, 1.67);
  assert.equal(p.about.length, 300);
  assert.deepEqual(p.interests, ['Viagens', 'Saúde']);
  assert.equal(p.opt.job, 'Analista');
  assert.equal(p.opt.health, ''); // dado sensível é descartado
  assert.equal(p.track.weight, true);
  assert.ok(p.createdAt > 0);
});

test('valores inválidos viram vazio', () => {
  const p = P.sanitize({ birth: '2999-01-01', gender: 'x', height: 9, weight: 'abc', photo: 'http://x/y.png', interests: 'oi' });
  assert.equal(p.birth, '');
  assert.equal(p.gender, '');
  assert.equal(p.height, null);
  assert.equal(p.weight, null);
  assert.equal(p.photo, '');
  assert.deepEqual(p.interests, []);
  assert.equal(P.validDate('1996-02-31'), '');
});

test('createdAt é mantido e a foto jpeg é aceita', () => {
  const photo = 'data:image/jpeg;base64,/9j/4AAQ';
  const p = P.sanitize({ name: 'A', photo }, { createdAt: 1000 });
  assert.equal(p.createdAt, 1000);
  assert.equal(p.photo, photo);
});

test('idade considera se o aniversário já passou', () => {
  assert.equal(P.ageFrom('1996-08-17', new Date('2026-08-16T12:00:00')), 29);
  assert.equal(P.ageFrom('1996-08-17', new Date('2026-08-17T12:00:00')), 30);
  assert.equal(P.ageFrom('lixo'), null);
});

test('promptBlock: vazio sem dados ou desligado; completo com dados', () => {
  assert.equal(P.promptBlock(P.empty()), '');
  const p = P.sanitize({ name: 'Ingrid', nickname: 'In', gender: 'f', height: 1.67, interests: ['Viagens'], track: { weight: true }, weightGoal: 70 });
  const b = P.promptBlock(p);
  assert.match(b, /Chame o usuário de: In/);
  assert.match(b, /Altura: 1,67 m/);
  assert.match(b, /meta: 70 kg/);
  assert.equal(P.promptBlock({ ...p, useInPrompt: false }), '');
});
