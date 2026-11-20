'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const A = require('../src/app-actions');
const V = require('../src/voice-logic');
const AS = require('../src/ai-stream');
const mainSource = require('./helpers/main-source');

const LIB = {
  avatars: [{ id: 'Noelle.vrm', name: 'Noelle' }, { id: 'iron_man_mark_85.glb', name: 'iron man mark 85' }],
  items: [{ id: 'basketball.glb', name: 'basketball' }, { id: 'Katana.glb', name: 'Katana' }, { id: 'iphone_14_pro.glb', name: 'iphone 14 pro' }],
};
const intent = (s) => V.parseIntent(s, { lib: LIB });
const run = (s, cur = {}) => A.handleIntent(intent(s), LIB, cur);

test('tema por voz', () => {
  assert.deepEqual(run('muda o tema para escuro').partial, { panelTheme: 'dark' });
  assert.deepEqual(run('coloca o tema oceano').partial, { panelTheme: 'ocean' });
  assert.deepEqual(run('modo claro').partial, { panelTheme: 'light' });
  assert.deepEqual(run('deixa o painel azul').partial, { panelTheme: 'ocean' });
  assert.deepEqual(run('muda a cor de destaque para roxo').partial, { panelAccent: '#a855f7' });
});

test('tema desconhecido: lista as opções em vez de inventar', () => {
  const r = run('muda o tema para xadrez');
  assert.equal(r.ok, false);
  assert.match(r.say, /Escuro/);
});

test('pegar, trocar de mão e largar item', () => {
  assert.deepEqual(run('pega a katana').partial, { item: 'custom:Katana.glb' });
  assert.deepEqual(run('segura o celular').partial, { item: 'phone' });
  assert.deepEqual(run('pega a bola de basquete na mão esquerda').partial, { item: 'custom:basketball.glb', itemHand: 'left' });
  assert.deepEqual(run('pega a espada').partial, { item: 'custom:Katana.glb' });
  assert.deepEqual(run('larga o item', { item: 'phone' }).partial, { item: 'none' });
  assert.deepEqual(run('solta a katana', { item: 'custom:Katana.glb' }).partial, { item: 'none' });
  assert.deepEqual(run('troca de mão', { itemHand: 'right' }).partial, { itemHand: 'left' });
});

test('trocar de avatar', () => {
  assert.deepEqual(run('muda o avatar para noelle').partial, { avatarFile: 'Noelle.vrm' });
  assert.deepEqual(run('vira a noelle').partial, { avatarFile: 'Noelle.vrm' });
  assert.deepEqual(run('muda para o iron man').partial, { avatarFile: 'iron_man_mark_85.glb' });
  assert.deepEqual(run('troca o avatar para o padrão').partial, { avatarFile: 'default' });
});

test('não rouba frases de outros comandos', () => {
  for (const [s, type] of [['que horas são', 'time'], ['troca de janela', 'pc'], ['abre o youtube', 'open'],
    ['coloca um vídeo de culinária', 'play'], ['tira o som', 'pc'], ['tira um print da tela', 'pc'], ['rola um dado', 'dice'], ['mostra a área de trabalho', 'pc']]) {
    assert.equal(intent(s).type, type, s);
  }
  assert.notEqual(intent('muda o modelo de voz').type, 'app');
  assert.notEqual(intent('muda para o discord').type, 'app');
});

test('a IA mexe no app com tags e a tag some do texto', () => {
  const p = AS.parseReply('[happy] [app:item=Katana] [app:tema=oceano] Peguei a katana e mudei o tema!');
  assert.equal(p.text, 'Peguei a katana e mudei o tema!');
  assert.deepEqual(p.actions, [{ kind: 'item', value: 'Katana' }, { kind: 'tema', value: 'oceano' }]);
  const r = A.resolveAll(p.actions, LIB, {});
  assert.deepEqual(r.partial, { item: 'custom:Katana.glb', panelTheme: 'ocean' });
  assert.deepEqual(r.errors, []);
});

test('tag com nome inexistente é ignorada e reportada', () => {
  const r = A.resolveAll([{ kind: 'item', value: 'foguete' }, { kind: 'avatar', value: 'Noelle' }, { kind: 'senha', value: 'x' }], LIB, {});
  assert.deepEqual(r.partial, { avatarFile: 'Noelle.vrm' });
  assert.deepEqual(r.errors, ['item=foguete']);
});

test('tag incompleta não aparece no meio do streaming', () => {
  assert.equal(AS.visibleText('[happy] Oi! [app:item=Kata'), 'Oi!');
  assert.equal(AS.visibleText('[happy] Oi! [app:item=Katana] Peguei'), 'Oi! Peguei');
});

test('o prompt da IA lista temas, itens e avatares atuais', () => {
  const s = A.promptBlock(LIB, { panelTheme: 'ocean', item: 'custom:Katana.glb', avatarFile: 'Noelle.vrm' });
  for (const w of ['[app:tema=', '[app:item=', '[app:avatar=', 'Oceano', 'katana', 'bola de basquete', 'Noelle']) assert.ok(s.includes(w), w);
  assert.match(s, /agora: katana/);
});

test('o main.js liga tudo (configuração, prompt, tags e voz)', () => {
  const main = mainSource();
  assert.match(main, /aiAppControl: true,/);
  assert.match(main, /'aiKnowsCommands', 'aiAppControl'/);
  assert.match(main, /APPACT\.promptBlock\(libAll\(\), settings\)/);
  assert.match(main, /applyAiAppTags\(pr\)/);
  assert.match(main, /library: libAll,\s*appAction,/);
  const panel = require('./helpers/panel-source')();
  assert.match(panel, /data-key="aiAppControl"/);
});
