'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/settings');
const AS = require('../src/ai-stream');

test('clamp: limita, aceita texto numérico e usa o padrão para lixo', () => {
  assert.equal(S.clamp(5, 0, 1, 0.5), 1);
  assert.equal(S.clamp('0.25', 0, 1, 0.5), 0.25);
  assert.equal(S.clamp('abc', 0, 1, 0.5), 0.5);
  assert.equal(S.clamp(undefined, 3, 9, 4), 4);
});

test('sanitize só devolve o que foi pedido e dentro dos limites', () => {
  assert.deepEqual(S.sanitize({}, S.DEFAULTS), {});
  assert.deepEqual(S.sanitize({ scale: 99, opacity: 0, rotation: 'x' }, S.DEFAULTS), { scale: 1.6, opacity: 0.2, rotation: 0 });
  assert.equal(S.sanitize({ historyLimit: 7 }, {}).historyLimit, 8); // sempre par
  assert.equal(S.sanitize({ maxTokens: 120 }, {}).maxTokens, 100);
  assert.equal(S.sanitize({ maxTokens: 9999 }, {}).maxTokens, 1500);
});

test('sanitize ignora campos desconhecidos e valores fora da lista', () => {
  const o = S.sanitize({ hack: 1, quality: 'ultra', panelTheme: 'neon', antialias: 'maybe', renderRes: 3, sttThreads: 5 }, {});
  assert.deepEqual(o, {});
  assert.equal(S.sanitize({ quality: 'high', panelTheme: 'ocean', renderRes: 1.5 }, {}).panelTheme, 'ocean');
});

test('sanitize: modelo de navegação aceita apenas layouts disponíveis', () => {
  assert.equal(S.DEFAULTS.panelLayout, 'floatdock');
  for (const panelLayout of ['floatdock', 'iconsidebar', 'discord']) {
    assert.equal(S.sanitize({ panelLayout }, {}).panelLayout, panelLayout);
  }
  assert.deepEqual(S.sanitize({ panelLayout: 'inexistente' }, {}), {});
});


test('sanitize: Float Dock aceita quatro posições e estado recolhido', () => {
  assert.equal(S.DEFAULTS.panelDockPosition, 'bottom');
  assert.equal(S.DEFAULTS.panelDockCollapsed, false);
  for (const panelDockPosition of ['top', 'right', 'bottom', 'left']) {
    assert.equal(S.sanitize({ panelDockPosition }, {}).panelDockPosition, panelDockPosition);
  }
  assert.deepEqual(S.sanitize({ panelDockPosition: 'center' }, {}), {});
  assert.deepEqual(S.sanitize({ panelDockCollapsed: true }, {}), { panelDockCollapsed: true });
  assert.deepEqual(S.sanitize({ panelDockCollapsed: false }, {}), { panelDockCollapsed: false });
});

test('sanitize: booleanos viram true/false', () => {
  const o = S.sanitize({ streamReplies: 0, keepChat: 'sim', convSpeak: '' }, {});
  assert.deepEqual(o, { streamReplies: false, keepChat: true, convSpeak: false });
});

test('sanitize: cor do painel e nomes de arquivo passam por validação', () => {
  assert.equal(S.sanitize({ panelAccent: '#a1B2c3' }, {}).panelAccent, '#a1B2c3');
  assert.equal('panelAccent' in S.sanitize({ panelAccent: 'red' }, {}), false);
  assert.equal(S.sanitize({ avatarFile: 'default' }, {}).avatarFile, 'default');
  assert.equal(S.sanitize({ avatarFile: 'Noelle.vrm' }, {}).avatarFile, 'Noelle.vrm');
  assert.equal('avatarFile' in S.sanitize({ avatarFile: '../../etc/passwd.vrm' }, {}), false);
  assert.equal('avatarFile' in S.sanitize({ avatarFile: 'x.exe' }, {}), false);
  assert.equal(S.sanitize({ item: 'custom:Katana.glb' }, {}).item, 'custom:Katana.glb');
  assert.equal('item' in S.sanitize({ item: 'custom:../a.glb' }, {}), false);
  assert.equal(S.sanitize({ item: 'mug' }, {}).item, 'mug');
});

test('sanitize: intervalos mínimo/máximo nunca ficam invertidos', () => {
  const a = S.sanitize({ chatterMin: 100, chatterMax: 10 }, { chatterMin: 25, chatterMax: 60 });
  assert.ok(a.chatterMax >= a.chatterMin);
  const b = S.sanitize({ emoteMin: 50 }, { emoteMin: 8, emoteMax: 25 });
  assert.deepEqual([b.emoteMin, b.emoteMax], [50, 50]);
  const c = S.sanitize({ emoteMax: 4 }, { emoteMin: 8, emoteMax: 25 });
  assert.deepEqual([c.emoteMin, c.emoteMax], [4, 4]);
});

test('sanitize: texto livre é limpo e cortado; gestos desconhecidos saem da lista', () => {
  assert.equal(S.sanitize({ convWake: '  Yoru!!<b> ' }, {}).convWake, 'Yorub');
  assert.equal(S.sanitize({ convWake: '###' }, {}).convWake, S.DEFAULTS.convWake);
  assert.equal(S.sanitize({ convCity: 'São  Paulo$$' }, {}).convCity, 'São Paulo');
  assert.equal(S.sanitize({ chatterCustom: 'a'.repeat(5000) }, {}).chatterCustom.length, 2400);
  assert.deepEqual(S.sanitize({ emoteList: ['wave', 'nada', 'dance'] }, {}).emoteList, ['wave', 'dance']);
  assert.equal(S.sanitize({ voiceSink: 'a\u0001b' }, {}).voiceSink, undefined);
});

test('migrateSettings: arquivo antigo ganha os padrões e os gestos novos uma única vez', () => {
  const m = S.migrateSettings({ emoteList: ['wave'], scale: 0.8 });
  assert.equal(m.scale, 0.8);
  assert.equal(m.emoteVer, 5);
  for (const id of [...AS.NEW_EMOTES_V2, ...AS.NEW_EMOTES_V3, ...AS.NEW_EMOTES_V4, ...AS.NEW_EMOTES_V5]) assert.ok(m.emoteList.includes(id), id);
  const again = S.migrateSettings(m);
  assert.deepEqual(again.emoteList, m.emoteList); // não duplica
  assert.equal(S.migrateSettings(null).scale, S.DEFAULTS.scale);
  assert.equal(S.migrateSettings('lixo').emoteVer, 5);
});

test('migrateSettings não altera o objeto DEFAULTS', () => {
  const before = JSON.stringify(S.DEFAULTS);
  S.migrateSettings({ emoteList: ['wave'] });
  assert.equal(JSON.stringify(S.DEFAULTS), before);
});

test('voz de abertura: padrão é a Francisca (feminina) e configurações antigas voltam para ela uma vez', () => {
  assert.equal(S.DEFAULTS.neuralVoice, 'pt-BR-FranciscaNeural');
  assert.equal(S.migrateSettings(null).neuralVoice, 'pt-BR-FranciscaNeural');
  assert.equal(S.migrateSettings({ neuralVoice: '' }).neuralVoice, 'pt-BR-FranciscaNeural');
  assert.equal(S.migrateSettings({ neuralVoice: 'lixo!' }).neuralVoice, 'pt-BR-FranciscaNeural');
  const old = S.migrateSettings({ neuralVoice: 'pt-BR-AntonioNeural' }); // salvo antes da v0.10.24
  assert.equal(old.neuralVoice, 'pt-BR-FranciscaNeural');
  assert.equal(old.voiceVer, 1);
  const chosen = S.migrateSettings({ ...old, neuralVoice: 'pt-PT-RaquelNeural' }); // escolha posterior é respeitada
  assert.equal(chosen.neuralVoice, 'pt-PT-RaquelNeural');
  assert.equal(S.sanitize({ neuralVoice: '' }, {}).neuralVoice, 'pt-BR-FranciscaNeural');
  assert.equal(S.sanitize({ neuralVoice: 'pt-PT-DuarteNeural' }, {}).neuralVoice, 'pt-PT-DuarteNeural');
});

test('personalidade da Yoru aceita apenas perfis conhecidos', () => {
  assert.equal(S.sanitize({ yoruPersonality: 'playful' }, {}).yoruPersonality, 'playful');
  assert.deepEqual(S.sanitize({ yoruPersonality: 'system-prompt-injection' }, {}), {});
});


test('migração inicial ativa Float Dock uma vez e preserva a escolha nas próximas aberturas', () => {
  const first = S.migrateSettings({ panelLayout: 'discord' });
  assert.equal(first.panelLayout, 'floatdock');
  assert.equal(first.panelLayoutVer, 1);
  const changed = S.migrateSettings({ ...first, panelLayout: 'iconsidebar' });
  assert.equal(changed.panelLayout, 'iconsidebar');
});
