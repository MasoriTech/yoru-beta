'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { createWhatsAppBot, sanitizeConfig, extractText, matchRule, sameNumber, jidNumber } = require('../src/whatsapp-bot');

function fakeBaileys() {
  const state = { sockets: [], sent: [] };
  const B = {
    DisconnectReason: { loggedOut: 401, connectionReplaced: 440, restartRequired: 515 },
    Browsers: { macOS: (n) => ['Mac OS', n, '14'] },
    useMultiFileAuthState: async (dir) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'creds.json'), '{}'); return { state: {}, saveCreds: () => {} }; },
    fetchLatestBaileysVersion: async () => ({ version: [2, 3000, 1] }),
    makeWASocket: () => {
      const ev = new EventEmitter();
      const s = { ev, user: { id: '5511988887777:3@s.whatsapp.net' }, ended: false,
        sendMessage: async (jid, content) => { state.sent.push({ jid, content }); },
        readMessages: async () => {}, sendPresenceUpdate: async () => {}, end() { s.ended = true; }, logout: async () => {} };
      state.sockets.push(s);
      return s;
    },
  };
  return { B, state };
}
const msg = (jid, text, extra = {}) => ({ key: { remoteJid: jid, fromMe: false, id: 'x', ...extra }, message: { conversation: text } });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-wa-'));
const wait = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function make(overrides = {}) {
  const { B, state } = fakeBaileys();
  const calls = [];
  const statuses = [];
  const bot = createWhatsAppBot({
    userDataDir: tmp(), loadBaileys: async () => B, sleep: async () => {}, random: () => 0,
    callModel: async (messages, cfg, system) => { calls.push({ messages, system }); return 'Oi! [app:tema=escuro] Tudo bem?'; },
    routeConfig: () => ({ config: { provider: 'x' }, maxTokens: 220 }),
    onStatus: (s) => statuses.push(s.status),
    ...overrides,
  });
  return { bot, state, calls, statuses };
}

test('sameNumber aceita o 9 depois do DDD no Brasil e jidNumber ignora sufixos', () => {
  assert.ok(sameNumber('5511999998888', '551199998888'));
  assert.ok(sameNumber('+55 (11) 99999-8888', '5511999998888'));
  assert.ok(!sameNumber('5511999998888', '5521999998888'));
  assert.equal(jidNumber('5511999998888:12@s.whatsapp.net'), '5511999998888');
  assert.equal(jidNumber('123456@lid'), '');
});

test('sanitizeConfig limpa números, regras e limites', () => {
  const c = sanitizeConfig({ allowedNumbers: '+55 11 99999-8888, abc, 123', rules: [{ keyword: ' oi ', reply: ' olá ' }, { keyword: '', reply: 'x' }], maxPerHour: 9999, persona: 'p'.repeat(5000) });
  assert.deepEqual(c.allowedNumbers, ['5511999998888']);
  assert.deepEqual(c.rules, [{ keyword: 'oi', reply: 'olá' }]);
  assert.equal(c.maxPerHour, 200);
  assert.equal(c.persona.length, 1000);
  assert.equal(c.replyToEveryone, false);
});

test('extractText lê texto, legenda e mensagens temporárias; ignora mídia sem texto', () => {
  assert.equal(extractText({ message: { extendedTextMessage: { text: 'olá' } } }), 'olá');
  assert.equal(extractText({ message: { ephemeralMessage: { message: { conversation: 'temp' } } } }), 'temp');
  assert.equal(extractText({ message: { imageMessage: { caption: 'foto' } } }), 'foto');
  assert.equal(extractText({ message: { stickerMessage: {} } }), '');
  assert.equal(matchRule([{ keyword: 'Preço', reply: 'R$ 10' }], 'qual o preco?').reply, 'R$ 10');
});

test('responde só a números permitidos, usa a IA e remove tags internas', async () => {
  const { bot, state, calls } = make();
  bot.setConfig({ allowedNumbers: ['5511999998888'], persona: 'Simpática', botName: 'Lia' });
  await bot.start();
  const s = state.sockets[0];
  await bot._handleMessage(s, msg('5521911112222@s.whatsapp.net', 'oi'));
  assert.equal(state.sent.length, 0);
  assert.match(bot.status().note, /não está na lista/);
  await bot._handleMessage(s, msg('551199998888@s.whatsapp.net', 'oi tudo bem?'));
  assert.equal(state.sent.length, 1);
  assert.equal(state.sent[0].jid, '551199998888@s.whatsapp.net');
  assert.doesNotMatch(state.sent[0].content.text, /\[app/);
  assert.match(calls[0].system, /Lia/);
  assert.match(calls[0].system, /Simpática/);
  assert.equal(bot.status().stats.replied, 1);
});

test('regra por palavra-chave responde sem chamar a IA; grupos e mensagens próprias são ignorados', async () => {
  const { bot, state, calls } = make();
  bot.setConfig({ allowedNumbers: ['5511999998888'], rules: [{ keyword: 'horário', reply: 'Das 9h às 18h.' }] });
  await bot.start();
  const s = state.sockets[0];
  await bot._handleMessage(s, msg('5511999998888@s.whatsapp.net', 'Qual o horario?'));
  assert.equal(state.sent[0].content.text, 'Das 9h às 18h.');
  assert.equal(calls.length, 0);
  await bot._handleMessage(s, msg('12345-678@g.us', 'oi'));
  await bot._handleMessage(s, { key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: true }, message: { conversation: 'oi' } });
  assert.equal(state.sent.length, 1);
});

test('sem lista e sem "responder a todos" não responde ninguém; limite por hora vale', async () => {
  const { bot, state } = make();
  bot.setConfig({ useAI: true });
  await bot.start();
  const s = state.sockets[0];
  await bot._handleMessage(s, msg('5511999998888@s.whatsapp.net', 'oi'));
  assert.equal(state.sent.length, 0);
  bot.setConfig({ replyToEveryone: true, maxPerHour: 2 });
  for (let i = 0; i < 4; i++) await bot._handleMessage(s, msg('5511999998888@s.whatsapp.net', 'oi ' + i));
  assert.equal(state.sent.length, 2);
});

test('QR, conexão, reconexão infinita e logout apagam a sessão', async () => {
  const { bot, state, statuses } = make();
  await bot.start();
  const s = state.sockets[0];
  s.ev.emit('connection.update', { qr: '2@abc' });
  assert.equal(bot.status().status, 'qr');
  assert.equal(bot.status().qr, '2@abc');
  s.ev.emit('connection.update', { connection: 'open' });
  assert.equal(bot.status().status, 'connected');
  assert.equal(bot.status().me, '5511988887777');
  assert.equal(bot.status().qr, '');
  s.ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 515 } } } });
  assert.equal(bot.status().status, 'reconnecting');
  await wait(700);
  assert.equal(state.sockets.length, 2, 'reconectou sozinho');
  state.sockets[1].ev.emit('connection.update', { connection: 'close', lastDisconnect: { error: { output: { statusCode: 401 } } } });
  assert.equal(bot.status().status, 'off');
  assert.equal(bot.status().hasSession, false);
  assert.ok(statuses.includes('starting'));
});

test('biblioteca ausente vira erro claro e stop desliga', async () => {
  const bot = createWhatsAppBot({ userDataDir: tmp(), callModel: async () => '', loadBaileys: async () => { throw new Error('Cannot find module'); } });
  const snap = await bot.start();
  assert.equal(snap.status, 'error');
  assert.match(snap.error, /npm install/);
  assert.equal(bot.stop().status, 'off');
});

test('configuração persiste no disco entre execuções', () => {
  const dir = tmp();
  const a = createWhatsAppBot({ userDataDir: dir, callModel: async () => '' });
  a.setConfig({ allowedNumbers: ['5511999998888'], autoStart: true });
  const b = createWhatsAppBot({ userDataDir: dir, callModel: async () => '' });
  assert.deepEqual(b.status().config.allowedNumbers, ['5511999998888']);
  assert.equal(b.status().config.autoStart, true);
});


test('desconectar cancela resposta que ainda está aguardando antes do envio', async () => {
  const dir = tmp();
  const { B, state } = fakeBaileys();
  let release;
  const sleeping = new Promise((resolve) => { release = resolve; });
  const bot = createWhatsAppBot({
    userDataDir: dir, loadBaileys: async () => B, sleep: () => sleeping, random: () => 0,
    callModel: async () => 'Resposta atrasada.',
  });
  bot.setConfig({ allowedNumbers: ['5511999998888'], rules: [{ keyword: 'oi', reply: 'Olá!' }] });
  await bot.start();
  const s = state.sockets[0];
  const pending = bot._handleMessage(s, msg('5511999998888@s.whatsapp.net', 'oi'));
  await wait(10);
  bot.stop();
  release();
  await pending;
  assert.equal(state.sent.length, 0, 'não deve enviar depois de desconectar');
});
