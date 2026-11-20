'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const SP = require('../src/speech');
const mainSource = require('./helpers/main-source');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('limpeza: markdown, emojis, links e código não são lidos', () => {
  assert.equal(SP.cleanForSpeech('**Oi** _tudo_ bem? 😀'), 'Oi tudo bem?');
  assert.equal(SP.cleanForSpeech('Veja https://exemplo.com/a?b=1 agora'), 'Veja agora');
  assert.equal(SP.cleanForSpeech('Antes ```js\nconst a = 1;\n``` depois'), 'Antes depois');
  assert.equal(SP.cleanForSpeech('Veja https://x.com', { skipCode: false }), 'Veja https://x.com');
});

test('ações entre asteriscos só saem se a opção estiver ligada', () => {
  assert.equal(SP.cleanForSpeech('*sorri* Olá!', { skipActions: true }), 'Olá!');
  assert.equal(SP.cleanForSpeech('*sorri* Olá!'), 'sorri Olá!');
});

test('dicionário de pronúncia: palavra inteira, sem diferenciar maiúsculas', () => {
  const rules = SP.parsePronunciations('Yoru = Ioru\n# comentário\nCPU => cê pê u\nlinha sem igual\n = vazio');
  assert.equal(rules.length, 2);
  assert.equal(SP.cleanForSpeech('A Yoru viu a cpu, não a CPUs.', { rules }), 'A Ioru viu a cê pê u, não a CPUs.');
  // caracteres especiais de regex e "$" na troca não quebram nada
  const r2 = SP.parsePronunciations('C++ = cê mais mais\nR$ = reais');
  assert.equal(SP.cleanForSpeech('Aprendo C++ por R$ 10', { rules: r2 }).includes('cê mais mais'), true);
  assert.equal(SP.parsePronunciations('x'.repeat(41) + ' = y').length, 0); // nome gigante é ignorado
});

test('limite de fala corta no fim de uma frase', () => {
  const t = 'Primeira frase. Segunda frase longa aqui. Terceira.';
  assert.equal(SP.limitSpeech(t, 0), t);
  assert.equal(SP.limitSpeech(t, 500), t);
  assert.equal(SP.limitSpeech(t, 30), 'Primeira frase.');
  assert.equal(SP.limitSpeech('palavra '.repeat(20), 30).endsWith('palavra'), true);
});

test('o renderer usa o mesmo speech.js (sem cópia) e o navegador o carrega antes do módulo', () => {
  const r = rd('renderer.js') + rd('voice.js'), html = rd('index.html');  // a voz mora em voice.js
  assert.ok(!/function (parsePronunciations|cleanForSpeech|limitSpeech)\b/.test(r), 'o renderer não define as funções de novo');
  assert.match(r, /const \{ parsePronunciations, cleanForSpeech, limitSpeech \} = globalThis\.YoruSpeech;/);
  assert.match(r, /^import '\.\/speech\.js';/m, 'o renderer importa o speech.js ele mesmo');
});

test('speech.js também funciona como script comum de navegador (sem module)', () => {
  const src = rd('speech.js');
  const g = {};
  new Function('globalThis', 'module', src)(g, undefined);   // `module` indefinido, como no navegador
  assert.equal(typeof g.YoruSpeech.cleanForSpeech, 'function');
  assert.equal(g.YoruSpeech.cleanForSpeech('**Oi** 😀'), 'Oi');
  assert.equal(g.YoruSpeech.limitSpeech('abc', 0), 'abc');
});

test('tudo ligado de ponta a ponta (main, renderer, painel)', () => {
  const main = mainSource(), ren = rd('renderer.js') + rd('settings-defaults.js') + rd('voice.js') + rd('ai-reply.js'), panel = require('./helpers/panel-source')();
  for (const k of ['neuralLang', 'speakSkipCode', 'speakSkipActions', 'speakMaxChars', 'voiceGapMs', 'voicePronounce', 'voiceSink']) {
    assert.match(main, new RegExp(k + ':'), 'padrão de ' + k);
    assert.match(main, new RegExp(`p\\.${k}|'${k}' in p|'${k}',`), 'sanitize de ' + k);
    assert.match(panel, new RegExp(`data-key="${k}"`), 'controle de ' + k);
    if (k !== 'neuralLang') assert.match(ren, new RegExp(k + ':'), 'padrão no renderer de ' + k); // o idioma da lista é só do painel
  }
  assert.match(ren, /speechText\(raw\)/);
  assert.match(ren, /limitSpeech\(speechText\(text\), S\.speakMaxChars\)/);
  assert.match(ren, /S\.voiceGapMs > 0/);
  assert.match(ren, /audioCtx\.setSinkId/);
  assert.match(main, /secureIpcMain\.handle\('tts-clear'/);
  assert.match(main, /broadcastPanels\('tts-stat'/);
  assert.match(rd('panel-preload.js'), /onTtsStat/);
  assert.match(panel, /id="ttsStat"/);
  assert.match(panel, /id="speakChips"/);
});

test('o painel só aceita valores válidos de voz (sanitize)', () => {
  const main = mainSource();
  const body = main.slice(main.indexOf('function sanitize'), main.indexOf('function sanitize') + 7000);
  assert.match(body, /\/\^\[a-z\]\{2,3\}\$\/\.test\(p\.neuralLang\)/);
  assert.match(body, /p\.voicePronounce\.slice\(0, 4000\)/);
});
