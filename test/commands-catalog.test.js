'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../src/voice-logic');
const C = require('../src/commands-catalog');
const mainSource = require('./helpers/main-source');
// biblioteca de exemplo (os modelos que vêm no projeto)
const LIB = { avatars: [{ id: 'Noelle.vrm', name: 'Noelle' }], items: [{ id: 'Katana.glb', name: 'Katana' }, { id: 'basketball.glb', name: 'basketball' }] };

// frase do catálogo -> tipo de pedido que o app realmente reconhece
const EXPECT = {
  'que horas são': 'time', 'que dia é hoje': 'date',
  'abre o youtube': 'open', 'abre o gmail': 'open', 'abre a calculadora': 'open',
  'pesquisa gatos fofos': 'search', 'pesquisa receita de bolo no youtube': 'search',
  'toca Evidências': 'play', 'toca uma música aleatória': 'play', 'coloca um vídeo de culinária': 'play',
  'marca dentista amanhã às 15h': 'agenda-add', 'me lembra de beber água às 16h': 'agenda-add',
  'o que tem na agenda': 'agenda-list', 'apaga dentista da agenda': 'agenda-remove', 'limpa a agenda': 'agenda-clear',
  'timer de 10 minutos': 'timer', 'timer de meia hora': 'timer',
  'como está o tempo': 'weather', 'vai chover hoje': 'weather', 'quais as notícias': 'news',
  'quanto é 12 vezes 5': 'math', 'sorteia um número de 1 a 50': 'number', 'rola um dado': 'dice', 'cara ou coroa': 'coin',
  'dança': 'pose', 'senta': 'pose', 'levanta': 'pose', 'bate palmas': 'pose', 'continência': 'pose', 'mãos na cintura': 'pose',
  'para': 'stop', 'me conta uma piada': 'joke', 'quem é você': 'who', 'comandos': 'help', 'ajuda': 'help', 'obrigado': 'thanks', 'tchau': 'bye',
  'aumenta o volume': 'pc', 'diminui o volume': 'pc', 'volume 30': 'pc', 'tira o som': 'pc',
  'pausa': 'pc', 'próxima música': 'pc', 'minimiza a janela': 'pc', 'fecha a janela': 'pc', 'troca de janela': 'pc', 'traz o discord': 'pc',
  'tira um print da tela': 'pc', 'o que está aberto': 'pc', 'mostra a área de trabalho': 'pc', 'bloqueia o computador': 'pc',
  'muda o tema para escuro': 'app', 'muda a cor de destaque para roxo': 'app', 'troca o avatar para a Noelle': 'app', 'pega a katana': 'app', 'larga o item': 'app', 'quais itens você tem': 'app',
  'desliga o computador': 'pc', 'reinicia o computador': 'pc', 'cancela o desligamento': 'pc',
};

test('toda frase de exemplo é reconhecida pelo app com o tipo esperado', () => {
  for (const [phrase, type] of Object.entries(EXPECT)) {
    assert.equal(V.parseIntent(phrase, { lib: LIB }).type, type, `"${phrase}" deveria ser ${type}`);
  }
});

test('o bloco do prompt cita as áreas, os sites e os atalhos', () => {
  const s = C.promptBlock({ wake: 'Yoru', pcActions: true });
  for (const [area] of C.COMMANDS) assert.ok(s.includes(area), 'falta a área: ' + area);
  for (const site of ['YouTube', 'Gmail', 'WhatsApp', 'Spotify']) assert.ok(s.includes(site), 'falta o site: ' + site);
  assert.ok(s.includes('Ctrl+Shift+Space'));
  assert.ok(s.includes('“Yoru”'));
  assert.ok(!s.includes('DESLIGADO'));
});

test('avisa a IA quando abrir programas/controlar o PC está desligado', () => {
  assert.match(C.promptBlock({ pcActions: false }), /DESLIGADO/);
});

test('o prompt manda a IA orientar o usuário em vez de fingir que executou', () => {
  const s = C.promptBlock();
  assert.match(s, /NÃO finja que fez/);
  assert.match(s, /Diga: abre o youtube/);
});

test('o main.js injeta o bloco no prompt de todos os provedores (buildSystem)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const main = mainSource();
  const fn = main.slice(main.indexOf('function buildSystem'), main.indexOf('async function httpFail'));
  assert.match(fn, /CMDS\.promptBlock/);
  // todos os provedores usam o mesmo `system` montado ali
  assert.match(main, /buildSystem\(cfg\)/);
});

test('o botão da aba IA está ligado de ponta a ponta (painel, preload, main)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const panel = require('./helpers/panel-source')(), main = mainSource(), pre = rd('panel-preload.js');
  assert.match(panel, /<input type="checkbox" data-key="aiKnowsCommands"/);
  assert.match(main, /'keepChat', 'aiKnowsCommands'/, 'main precisa aceitar a chave ao salvar');
  assert.match(main, /aiKnowsCommands: true,/, 'padrão ligado');
  assert.match(pre, /commandsInfo: \(\) => ipcRenderer\.invoke\('commands-info'\)/);
  assert.match(main, /secureIpcMain\.handle\('commands-info'/);
  assert.match(panel, /panel\.commandsInfo\(\)/);
});
