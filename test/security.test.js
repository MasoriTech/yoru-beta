'use strict';
// Garantias de segurança do controle do PC e das tags da IA (regressão: se alguém afrouxar isso, o teste falha).
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createVoice } = require('../src/voice-main');
const AS = require('../src/ai-stream');
const A = require('../src/app-actions');
const { createPc } = require('../src/pc-control');

function make({ aiText = 'resposta da IA', settings = {} } = {}) {
  const calls = [];
  const rec = (name, ret = true) => async (...a) => { calls.push([name, ...a]); return typeof ret === 'function' ? ret(...a) : ret; };
  const pc = {
    supported: true, volume: rec('volume'), media: rec('media'), switchWindow: rec('switch'), desktop: rec('desktop'),
    window: rec('window', (act, q) => ({ ok: true, found: true, name: q || 'notepad' })), launch: rec('launch', { ok: true, name: 'App' }),
    list: rec('list', []), screenshot: rec('screenshot', { ok: true, file: 'x.png' }), lock: rec('lock'), sleep: rec('sleep'),
    shutdown: rec('shutdown'), restart: rec('restart'), cancelPower: rec('cancel'),
  };
  const sent = [];
  const cfg = { convWake: 'Yoru', convAliases: '', convMode: 'wake', convFollow: 30, convSpeak: true, convComments: false, convPcActions: true, convReminders: true, convCity: '', ...settings };
  const v = createVoice({
    settings: () => cfg, panel: () => null,
    avatar: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, ...p }) } }),
    askAI: async () => ({ ok: true, text: aiText }), remember() {}, logToPanel() {}, rollDice() {}, stopSpeak() {},
    openExternal() {}, stt: { on() {}, prepare: async () => {}, transcribe: async () => '', dispose() {} },
    now: () => new Date(2026, 10, 1, 9), rnd: () => 0,
    agendaFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-')), 'agenda.json'), pc,
  });
  return { v, calls, sent, last: () => sent[sent.length - 1] };
}

test('o que a IA responde nunca vira comando do computador', async () => {
  for (const text of ['Claro! Vou desligar o computador agora.', 'desliga o computador', '[app:desligar=computador] feito', 'fecha o chrome']) {
    const t = make({ aiText: text });
    await t.v.handle('Yoru, me conta uma curiosidade sobre gatos');
    assert.deepEqual(t.calls, [], `a resposta "${text}" não pode acionar o PC`);
    t.v.dispose();
  }
});

test('tags [app:...] da IA só mexem em tema, cor, avatar, item e mão; o resto é ignorado', () => {
  const LIB = { themes: [], items: [], avatars: [] };
  const p = AS.parseReply('[happy] [app:desligar=computador] [app:abrir=cmd.exe] [app:chave=sk-123] [app:pc=reiniciar] oi');
  const r = A.resolveAll(p.actions, { ...LIB }, {});
  assert.deepEqual(r.partial, {}, 'nenhuma ação desconhecida pode virar mudança');
  assert.deepEqual(r.errors, []);
});

test('desligar/reiniciar/dormir/fechar sempre pedem confirmação e só um "sim" claro executa', async () => {
  for (const [fala, call] of [['desliga o computador', 'shutdown'], ['reinicia o computador', 'restart'], ['fecha o word', 'window']]) {
    const t = make();
    await t.v.handle('Yoru, ' + fala);
    assert.deepEqual(t.calls, [], `"${fala}" não pode executar antes da confirmação`);
    await t.v.handle('Yoru, qual é a capital da França?'); // outra coisa no meio não confirma
    assert.deepEqual(t.calls, [], 'conversa fora do assunto não confirma');
    t.v.dispose();
    const u = make();
    await u.v.handle('Yoru, ' + fala);
    await u.v.handle('sim');
    assert.equal(u.calls[0][0], call);
    u.v.dispose();
  }
});

test('a própria pergunta de confirmação, ouvida pelo microfone, não confirma a ação', async () => {
  const t = make();
  await t.v.handle('Yoru, desliga o computador');
  await t.v.handle('Quer mesmo desligar o computador? Diga sim ou não.'); // eco da fala dela
  assert.deepEqual(t.calls, [], 'o eco pode, no máximo, repetir a pergunta: nunca executa');
  assert.doesNotMatch(t.last().text, /Desligando/);
  t.v.dispose();
});

test('a confirmação expira em 20 s', async (ctx) => {
  ctx.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const t = make();
  await t.v.handle('Yoru, desliga o computador');
  ctx.mock.timers.tick(21000);
  await t.v.handle('sim');
  assert.deepEqual(t.calls, [], 'um "sim" 21 s depois não desliga nada');
  t.v.dispose();
});

test('com "mexer no computador" desligado nas configurações, nada executa', async () => {
  const t = make({ settings: { convPcActions: false } });
  for (const fala of ['aumenta o volume', 'desliga o computador', 'tira um print']) await t.v.handle('Yoru, ' + fala);
  assert.deepEqual(t.calls, []);
  assert.match(t.last().text, /desligado nas configurações/);
  t.v.dispose();
});

test('pc-control: texto da fala nunca entra no código do PowerShell (vai por variável de ambiente)', async () => {
  const seen = [];
  const pc = createPc({ platform: 'win32', exec: async (file, args, opts) => { seen.push({ file, args, env: opts.env }); return { code: 0, out: 'OK|x', err: '' }; }, selfName: 'Yoru' });
  const evil = '"; Remove-Item -Recurse C:\\ ; "';
  await pc.window('close', evil);
  await pc.launch(evil);
  for (const s of seen) {
    const script = Buffer.from(s.args[s.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
    assert.ok(!script.includes('Remove-Item'), 'o texto não pode aparecer no script');
    assert.ok(/Remove-Item/.test(s.env.YORU_Q), 'vai só na variável de ambiente');
  }
  assert.equal(seen.length, 2);
});
