'use strict';
// Falas espontâneas: escolha do tipo, frases, agendamento e opções da aba Comportamento.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const V = require('../src/voice-logic');
const { createVoice } = require('../src/voice-main');
const mainSource = require('./helpers/main-source');

const ALL = { checkin: true, time: true, sleep: true, talk: true, care: true, sulk: true, smash: true, custom: true };
const NONE = { checkin: false, time: false, sleep: false, talk: false, care: false, sulk: false, smash: false, custom: false };

test('"vai dormir" só aparece à noite; de dia nunca é sorteado', () => {
  for (let h = 5; h < 21; h++) {
    for (let i = 0; i < 40; i++) assert.notEqual(V.pickChatterKind(ALL, h, Math.random, null), 'sleep', `h=${h}`);
  }
  const night = new Set();
  for (let i = 0; i < 300; i++) night.add(V.pickChatterKind(ALL, 23, Math.random, null));
  assert.ok(night.has('sleep'));
});

test('só sorteia tipos ligados e devolve null se todos estiverem desligados', () => {
  const only = { ...NONE, time: true };
  for (let i = 0; i < 30; i++) assert.equal(V.pickChatterKind(only, 14, Math.random, null), 'time');
  assert.equal(V.pickChatterKind(NONE, 14), null);
  assert.equal(V.pickChatterKind({ ...NONE, sleep: true }, 14), null); // só "dormir" de dia
});

test('não repete o mesmo tipo duas vezes seguidas quando há alternativa', () => {
  for (let i = 0; i < 100; i++) assert.notEqual(V.pickChatterKind(ALL, 23, Math.random, 'talk'), 'talk');
  assert.equal(V.pickChatterKind({ ...NONE, talk: true }, 14, Math.random, 'talk'), 'talk'); // único ligado
});

test('as frases: oi você tá aí, fala comigo, vai dormir e as horas', () => {
  const d = new Date(2026, 10, 1, 15, 30);
  assert.match(V.chatterLine('checkin', d, () => 0).text, /tá aí/i);
  assert.match(V.chatterLine('talk', d, () => 0).text, /fala comigo/i);
  assert.match(V.chatterLine('sleep', new Date(2026, 10, 1, 23, 0), () => 0).text, /dorm/i);
  const t = V.chatterLine('time', d, () => 0);
  assert.match(t.text, /^São 15 horas e 30 minutos\./);
  assert.match(t.text, /tarde|Falta pouco|cansaço/i); // comentário do período do dia
});

test('não repete a mesma frase em seguida', () => {
  for (const kind of ['checkin', 'talk', 'sleep', 'care', 'sulk', 'smash']) {
    const first = V.chatterLine(kind, new Date(2026, 10, 1, 23), () => 0).text;
    for (let i = 0; i < 40; i++) assert.notEqual(V.chatterLine(kind, new Date(2026, 10, 1, 23), Math.random, first).text, first);
  }
});

function make(settings = {}, { idle = 9999 } = {}) {
  const sent = [];
  let clock = new Date(2026, 10, 1, 15, 0, 0);
  const cfg = { convWake: 'Yoru', convFollow: 30, convSpeak: true, convChatter: true, visible: true, chatterMin: 10, chatterMax: 20, chatterIdleMin: 0, ...settings };
  const v = createVoice({
    settings: () => cfg, panel: () => null,
    avatar: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, ...p }) } }),
    askAI: async () => ({ ok: true, text: 'x' }), remember() {}, logToPanel() {}, rollDice() {}, stopSpeak() {}, openExternal() {},
    stt: { on() {}, prepare: async () => {}, transcribe: async () => '', dispose() {} },
    now: () => clock, rnd: () => 0.5, idleSeconds: () => idle,
    agendaFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-')), 'agenda.json'),
    fetch: async () => ({ ok: true, text: async () => '' }),
  });
  return { v, sent, cfg };
}

test('"Falar agora" fala mesmo com as falas periódicas desligadas, e avisa se nenhum tipo está ligado', () => {
  const a = make({ convChatter: false });
  assert.equal(a.v.chatterNow(), true);
  assert.equal(a.sent.length, 1);
  assert.ok(a.sent[0].text.length > 3);
  a.v.dispose();
  const b = make({ chatterCheckin: false, chatterTime: false, chatterSleep: false, chatterTalk: false, chatterCare: false, chatterSulk: false, chatterSmash: false, chatterCustom: '' });
  assert.equal(b.v.chatterNow(), false);
  assert.equal(b.sent.length, 0);
  b.v.dispose();
});

test('agendador: marca a próxima fala, respeita o intervalo, o avatar escondido e o "parado há"', () => {
  const real = Date.now;
  let t = 1_000_000_000_000;
  Date.now = () => t;
  try {
    const m = make({ chatterMin: 10, chatterMax: 20 });
    m.v.chatterTick();                       // agenda (rnd 0.5 => 15 min)
    t += 14 * 60000; m.v.chatterTick();
    assert.equal(m.sent.length, 0, 'ainda não chegou a hora');
    m.cfg.visible = false; t += 2 * 60000; m.v.chatterTick();
    assert.equal(m.sent.length, 0, 'avatar escondido: não fala');
    m.cfg.visible = true; m.v.chatterTick();
    assert.equal(m.sent.length, 1, 'passou do prazo e está visível: fala');
    t += 1 * 60000; m.v.chatterTick();
    assert.equal(m.sent.length, 1, 'reagendou: não fala de novo logo em seguida');
    m.v.dispose();

    const idle = make({ chatterMin: 1, chatterMax: 1, chatterIdleMin: 5 }, { idle: 60 }); // usando o PC há 1 min
    idle.v.chatterTick(); t += 2 * 60000; idle.v.chatterTick();
    assert.equal(idle.sent.length, 0, 'você está ativo: espera');
    idle.v.dispose();
    const calm = make({ chatterMin: 1, chatterMax: 1, chatterIdleMin: 5 }, { idle: 600 });  // parado há 10 min
    calm.v.chatterTick(); t += 2 * 60000; calm.v.chatterTick();
    assert.equal(calm.sent.length, 1, 'parado: pode falar');
    calm.v.dispose();

    const off = make({ convChatter: false });
    off.v.chatterTick(); t += 999 * 60000; off.v.chatterTick();
    assert.equal(off.sent.length, 0, 'desligado: nunca fala sozinha');
    off.v.dispose();
  } finally { Date.now = real; }
});

test('mudar o intervalo reagenda a próxima fala', () => {
  const real = Date.now;
  let t = 2_000_000_000_000;
  Date.now = () => t;
  try {
    const m = make({ chatterMin: 10, chatterMax: 10 });
    m.v.chatterTick();                                  // marca para daqui a 10 min
    m.cfg.chatterMin = 60; m.cfg.chatterMax = 60;
    m.v.chatterTick();                                  // detecta a mudança e reagenda para 60 min
    t += 30 * 60000; m.v.chatterTick();
    assert.equal(m.sent.length, 0);
    t += 31 * 60000; m.v.chatterTick();
    assert.equal(m.sent.length, 1);
    m.v.dispose();
  } finally { Date.now = real; }
});

test('as opções existem no painel, no main (padrões e validação) e no preload', () => {
  const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  const panel = require('./helpers/panel-source')(), main = mainSource(), pre = rd('panel-preload.js');
  for (const k of ['convChatter', 'chatterMin', 'chatterMax', 'chatterIdleMin', 'chatterCheckin', 'chatterTime', 'chatterSleep', 'chatterTalk', 'chatterCare']) {
    assert.match(panel, new RegExp(`data-key="${k}"`), 'painel: ' + k);
    assert.match(main, new RegExp(`\\b${k}\\b`), 'main: ' + k);
  }
  const tabCmp = panel.slice(panel.indexOf('id="tab-avatar"'), panel.indexOf('id="tab-perfil"'));
  assert.match(tabCmp, /data-sub="comportamento" data-sub2="fala"[^>]*>[\s\S]*?data-key="convChatter"/, 'o interruptor fica em Avatar › Comportamento › Fala');
  assert.match(main, /secureIpcMain\.handle\('chatter-now'/);
  assert.match(pre, /chatterNow/);
});

test('frases novas: "cadê você", "oi eu tô aqui" e "me chamou pra nada"', () => {
  const all = (k) => Array.from({ length: 40 }, (_, i) => V.chatterLine(k, new Date(2026, 10, 1, 15), () => i / 40).text).join('|');
  assert.match(all('checkin'), /Cadê você/);
  assert.match(all('checkin'), /Oi, eu tô aqui/);
  assert.match(all('sulk'), /pra nada/);
});

test('frases do usuário: uma por linha, entram no sorteio e só ligam se houver alguma', () => {
  assert.deepEqual(V.parseCustomLines('  Cadê você?  \n\nOi, eu tô aqui!\r\n'), ['Cadê você?', 'Oi, eu tô aqui!']);
  assert.deepEqual(V.parseCustomLines(''), []);
  assert.equal(V.chatterLine('custom', new Date(), () => 0, '', ['Só essa']).text, 'Só essa');
  const a = make({ chatterCheckin: false, chatterTime: false, chatterSleep: false, chatterTalk: false, chatterCare: false, chatterSulk: false, chatterSmash: false, chatterCustom: 'Minha frase' });
  assert.equal(a.v.chatterNow(), true);
  assert.equal(a.sent[0].text, 'Minha frase');
  a.v.dispose();
});

test('"socar a tela": fala e chama o efeito depois (só se o app oferecer o efeito)', async () => {
  const sent = []; let smashed = 0;
  const cfg = { convWake: 'Yoru', convFollow: 30, convSpeak: false, convChatter: true, visible: true, chatterMin: 10, chatterMax: 20,
    chatterCheckin: false, chatterTime: false, chatterSleep: false, chatterTalk: false, chatterCare: false, chatterSulk: false, chatterSmash: true };
  const v = createVoice({
    settings: () => cfg, panel: () => null,
    avatar: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, ...p }) } }),
    askAI: async () => ({ ok: true, text: 'x' }), remember() {}, logToPanel() {}, rollDice() {}, stopSpeak() {}, openExternal() {},
    stt: { on() {}, prepare: async () => {}, transcribe: async () => '', dispose() {} },
    smash: () => { smashed++; }, idleSeconds: () => 9999,
    agendaFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-')), 'agenda.json'),
    fetch: async () => ({ ok: true, text: async () => '' }),
  });
  assert.equal(v.chatterNow(), true);
  assert.match(sent[0].text, /Toma|tela|Olha|aqui/i);
  assert.equal(smashed, 0, 'o soco vem depois da fala');
  await new Promise((r) => setTimeout(r, 2400));
  assert.equal(smashed, 1);
  v.dispose();
  const none = make({ chatterCheckin: false, chatterTime: false, chatterSleep: false, chatterTalk: false, chatterCare: false, chatterSulk: false, chatterSmash: true });
  assert.equal(none.v.chatterNow(), false, 'sem o efeito disponível o soco não é sorteado');
  none.v.dispose();
});

test('horário de silêncio (23h–7h) bloqueia a fala agendada, inclusive virando a meia-noite', () => {
  const real = Date.now; let t = 1_000_000_000_000; Date.now = () => t;
  try {
    const m = make({ chatterMin: 1, chatterMax: 1, chatterQuiet: true, chatterQuietFrom: 14, chatterQuietTo: 16 }); // relógio do teste: 15h
    m.v.chatterTick(); t += 2 * 60000; m.v.chatterTick();
    assert.equal(m.sent.length, 0, '15h está dentro de 14h–16h: quieta');
    m.cfg.chatterQuietFrom = 23; m.cfg.chatterQuietTo = 7; m.v.chatterTick();
    assert.equal(m.sent.length, 1, '15h fora de 23h–7h: fala');
    m.v.dispose();
  } finally { Date.now = real; }
});

test('hora cheia: avisa uma vez por hora, só nos primeiros minutos', () => {
  const a = make({ convChatter: false, chatterHourly: true });
  a.v.chatterTick();
  assert.equal(a.sent.length, 1);
  assert.match(a.sent[0].text, /^São 15 horas/);
  a.v.chatterTick();
  assert.equal(a.sent.length, 1, 'não repete na mesma hora');
  a.v.dispose();
});
