'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const M = require('../src/memory');
const S = require('../src/ai-stream');

test('add: limpa, deduplica sem diferenciar maiúsculas e limita o tamanho', () => {
  let r = M.add([], '  Gosta   de café  ');
  assert.equal(r.added.text, 'Gosta de café');
  assert.equal(M.add(r.list, 'gosta de CAFÉ').added, null);
  assert.equal(M.add([], 'x'.repeat(500)).added.text.length, M.MAX_LEN);
  assert.equal(M.add([], '   ').added, null);
});

test('add: recusa senhas, documentos e cartões', () => {
  assert.equal(M.add([], 'minha senha é 1234').added, null);
  assert.equal(M.add([], 'CPF 123.456.789-09').added, null);
  assert.equal(M.add([], 'cartão 4111 1111 1111 1111').added, null);
  assert.ok(M.add([], 'Mora em Curitiba').added);
});

test('o limite de itens descarta os mais antigos', () => {
  let l = [];
  for (let i = 0; i < M.MAX_ITEMS + 5; i++) l = M.add(l, 'fato ' + i).list;
  assert.equal(l.length, M.MAX_ITEMS);
  assert.equal(l[0].text, 'fato 5');
});

test('remove e forget', () => {
  let l = M.add(M.add([], 'Tem um gato chamado Miau').list, 'Trabalha com design').list;
  assert.equal(M.forget(l, 'gato').removed, 1);
  assert.equal(M.forget(l, 'ga').removed, 0); // trecho curto demais
  assert.equal(M.remove(l, l[0].id).length, 1);
});

test('extractTags tira as tags do texto', () => {
  const r = M.extractTags('[happy] [lembrar: Gosta de café] Anotado! [esquecer: gato]');
  assert.deepEqual(r.remember, ['Gosta de café']);
  assert.deepEqual(r.forget, ['gato']);
  assert.equal(r.text, '[happy] Anotado!');
});

test('parseReply (ai-stream) também remove as tags de memória', () => {
  const r = S.parseReply('[happy] [lembrar: Mora em Curitiba] Pode deixar!');
  assert.equal(r.text, 'Pode deixar!');
  assert.equal(r.emotion, 'happy');
  assert.deepEqual(r.remember, ['Mora em Curitiba']);
});

test('visibleText esconde tag de memória incompleta (mesmo longa)', () => {
  assert.equal(S.visibleText('[happy] Ok [lembrar: gosta de café com leite e'), 'Ok');
  assert.equal(S.visibleText('[happy] Ok [lembrar: gosta de café] Certo'), 'Ok Certo');
});

test('promptBlock lista as lembranças e explica as tags', () => {
  const p = M.promptBlock(M.add([], 'Chama-se Ana').list);
  assert.match(p, /- Chama-se Ana/);
  assert.match(p, /\[lembrar:/);
  assert.match(M.promptBlock([]), /ainda não guardou/);
});

test('load/save: round trip e arquivo ausente ou corrompido', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mem-')), 'memory.json');
  assert.deepEqual(M.load(f), []);
  const l = M.add([], 'Prefere respostas curtas').list;
  M.save(f, l);
  assert.deepEqual(M.load(f).map((x) => x.text), ['Prefere respostas curtas']);
  fs.writeFileSync(f, '{nao e json');
  assert.deepEqual(M.load(f), []);
});

test('categoriza lembranças sem perder compatibilidade com arquivos antigos', () => {
  assert.equal(M.categorize('Trabalho na área financeira'), 'trabalho');
  assert.equal(M.categorize('Gosto de café'), 'preferencias');
  const old = M.sanitize([{ id: 'old', text: 'Mora em Curitiba', at: 10 }]);
  assert.equal(old[0].category, 'pessoal');
  assert.equal(old[0].updatedAt, 10);
});

test('busca por texto e categoria', () => {
  const list = M.add(M.add([], 'Gosta de café').list, 'Trabalha em hospital').list;
  assert.equal(M.search(list, 'café').length, 1);
  assert.equal(M.search(list, '', 'trabalho').length, 1);
  assert.equal(M.search(list, 'hospital', 'preferencias').length, 0);
});

test('edita lembrança mantendo ID e bloqueando duplicatas/sensíveis', () => {
  const list = M.add(M.add([], 'Gosta de café').list, 'Trabalha em hospital').list;
  const id = list[0].id;
  const changed = M.update(list, id, 'Prefere chá');
  assert.equal(changed.updated.id, id);
  assert.equal(changed.updated.category, 'preferencias');
  assert.equal(M.update(changed.list, id, 'CPF 123.456.789-09').updated, null);
  assert.equal(M.update(changed.list, id, 'Trabalha em hospital').updated, null);
});

test('prompt de memória prioriza lembranças recentes e limita contexto', () => {
  const list = Array.from({ length: 60 }, (_, i) => ({ id: String(i), text: `Fato ${i} ${'x'.repeat(150)}`, category: 'outros', at: i, updatedAt: i }));
  const prompt = M.promptBlock(list);
  assert.ok(prompt.length < 3800);
  assert.match(prompt, /Fato 59/);
});
