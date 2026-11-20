'use strict';
// Fluxo completo da conversa por voz, com relógio, rede e Electron falsos.
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createVoice } = require('../src/voice-main');

const YT_HTML = '{"videoRenderer":{"videoId":"dQw4w9WgXcQ","title":{"runs":[{"text":"x"}]}}}';

function make({ hour = 9, settings = {}, ytOk = true, tapoControl = null, openSmartHome = null } = {}) {
  const sent = [];
  const opened = [];
  let clock = new Date(2026, 10, 1, hour, 0, 0);
  const cfg = { convWake: 'Yoru', convAliases: '', convMode: 'wake', convFollow: 30, convSpeak: true, convComments: false, convPcActions: true, convReminders: true, convCity: '', ...settings };
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-')), 'agenda.json');
  const fetched = [];
  const tapoCalls = [];
  const v = createVoice({
    settings: () => cfg,
    panel: () => null,
    avatar: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, ...p }) } }),
    askAI: async () => ({ ok: true, text: 'resposta da IA' }),
    remember() {}, logToPanel() {}, rollDice() {}, stopSpeak() {},
    openExternal: (u) => opened.push(u),
    tapoControl: async (action, args = {}) => { tapoCalls.push({ action, args }); return tapoControl ? tapoControl(action, args) : { ok:true, isOn:true, brightness:args.brightness || 60, colorTemp:args.colorTemp || 4000 }; },
    openSmartHome: () => { if (openSmartHome) openSmartHome(); },
    stt: { on() {}, prepare: async () => {}, transcribe: async () => '', dispose() {} },
    now: () => clock,
    rnd: () => 0,
    agendaFile: file,
    fetch: async (url) => { fetched.push(url); if (!ytOk) throw new Error('sem rede'); return { ok: true, text: async () => YT_HTML }; },
  });
  return { v, sent, opened, fetched, tapoCalls, cfg, setClock: (d) => { clock = d; }, last: () => sent[sent.length - 1] };
}


test('comandos de voz controlam a cor e o brilho da Tapo sem chamar a IA genérica', async () => {
  const t = make();
  await t.v.handle('Yoru, acenda a luz azul com 40%');
  assert.equal(t.tapoCalls.some(x => x.action === 'color' && x.args.hue === 220 && x.args.brightness === 40), true);
  assert.match(t.last().text, /azul/i);
  assert.notEqual(t.last().text, 'resposta da IA');
  t.v.dispose();
});

test('comando relativo de brilho consulta o estado atual e altera em passos', async () => {
  const calls = [];
  const t = make({ tapoControl: async (action, args) => { calls.push({ action, args }); return action === 'state' ? { ok:true, brightness:60 } : { ok:true, brightness:75 }; } });
  await t.v.handle('Yoru, deixe a luz mais forte');
  assert.deepEqual(calls, [{ action:'state', args:{} }, { action:'brightness', args:{ brightness:75 } }]);
  t.v.dispose();
});

test('comandos de voz acionam efeito nativo Party da Tapo', async () => {
  const t = make();
  await t.v.handle('Yoru, ative o efeito festa');
  assert.equal(t.tapoCalls.some(x => x.action === 'effect' && x.args.effect === 'Party'), true);
  assert.match(t.last().text, /Festa/i);
  t.v.dispose();
});

test('pergunta por voz consulta e descreve o estado atual da lâmpada', async () => {
  const t = make({ tapoControl: async (action) => action === 'state' ? { ok:true, isOn:true, brightness:73, colorTemp:3500, hsv:{ hue:0, saturation:0, value:73 } } : { ok:true } });
  await t.v.handle('Yoru, como está a lâmpada?');
  assert.deepEqual(t.tapoCalls, [{ action:'state', args:{} }]);
  assert.match(t.last().text, /ligada/i);
  assert.match(t.last().text, /73 por cento/i);
  assert.match(t.last().text, /3500 Kelvin/i);
  t.v.dispose();
});

test('sem credenciais, o comando de voz abre a área Smart Home com orientação', async () => {
  let opened = 0;
  const t = make({ tapoControl: async () => { throw new Error('Configure o e-mail e a senha da conta TP-Link/Tapo antes de continuar.'); }, openSmartHome: () => { opened++; } });
  await t.v.handle('Yoru, acenda a luz');
  assert.equal(opened, 1);
  assert.match(t.last().text, /configure primeiro sua conta Tapo/i);
  t.v.dispose();
});

test('bom dia de manhã: resposta simples; de tarde: correção sarcástica', async () => {
  const a = make({ hour: 9 });
  await a.v.handle('Yoru, bom dia');
  assert.match(a.last().text, /^Bom dia/);
  assert.doesNotMatch(a.last().text, /\?!|certo/);
  a.v.dispose();

  const b = make({ hour: 15 });
  await b.v.handle('Yoru, bom dia');
  assert.match(b.last().text, /boa tarde/i);
  assert.match(b.last().text, /15 horas|tarde/);
  b.v.dispose();
});

test('"quero escutar uma música" -> ela pergunta qual -> responde -> abre o vídeo', async () => {
  const t = make();
  await t.v.handle('Yoru, quero escutar uma música');
  assert.match(t.last().text, /Qual música|Qual música\?/);
  assert.equal(t.opened.length, 0, 'ainda não abriu nada');
  await t.v.handle('Legião Urbana'); // sem dizer o nome: ela está esperando a resposta
  assert.deepEqual(t.opened, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  assert.match(t.last().text, /Legião Urbana/);
  assert.match(t.fetched[0], /search_query=Legi%C3%A3o%20Urbana/);
  t.v.dispose();
});

test('música com o nome já dito abre direto, sem perguntar', async () => {
  const t = make();
  await t.v.handle('Yoru, toca Evidências');
  assert.deepEqual(t.opened, ['https://www.youtube.com/watch?v=dQw4w9WgXcQ']);
  t.v.dispose();
});

test('sem rede: abre a página de busca do YouTube em vez de falhar', async () => {
  const t = make({ ytOk: false });
  await t.v.handle('Yoru, toca Evidências');
  assert.deepEqual(t.opened, ['https://www.youtube.com/results?search_query=Evid%C3%AAncias']);
  assert.match(t.last().text, /abri a busca/);
  t.v.dispose();
});

test('Spotify: abre a busca (não dá para dar play sozinho)', async () => {
  const t = make();
  await t.v.handle('Yoru, quero ouvir Djavan no Spotify');
  assert.deepEqual(t.opened, ['https://open.spotify.com/search/Djavan']);
  t.v.dispose();
});

test('responder "qualquer uma" abre uma seleção surpresa', async () => {
  const t = make();
  await t.v.handle('Yoru, toca uma música');
  await t.v.handle('qualquer uma');
  assert.equal(t.opened.length, 1);
  assert.match(t.last().text, /seleção surpresa/);
  t.v.dispose();
});

test('"para" cancela a pergunta pendente', async () => {
  const t = make();
  await t.v.handle('Yoru, toca uma música');
  await t.v.handle('para');
  await t.v.handle('Legião Urbana'); // vira conversa normal com a IA, não música
  assert.equal(t.opened.length, 0);
  assert.equal(t.last().text, 'resposta da IA');
  t.v.dispose();
});

test('"me mostre o youtube" e "abrir youtube" abrem o site', async () => {
  const t = make();
  await t.v.handle('Yoru, me mostre o youtube');
  await t.v.handle('abrir youtube');
  assert.deepEqual(t.opened, ['https://www.youtube.com', 'https://www.youtube.com']);
  t.v.dispose();
});

test('saudação + pedido: "bom dia" e já abre', async () => {
  const t = make({ hour: 16 });
  await t.v.handle('Yoru, bom dia, abre o youtube');
  assert.deepEqual(t.opened, ['https://www.youtube.com']);
  assert.match(t.last().text, /^Bom dia\? O certo agora é boa tarde/);
  assert.match(t.last().text, /Abrindo o YouTube|abrindo o YouTube/);
  t.v.dispose();
});

test('ações no computador desligadas: não abre nada', async () => {
  const t = make({ settings: { convPcActions: false } });
  await t.v.handle('Yoru, toca Evidências');
  assert.equal(t.opened.length, 0);
  assert.match(t.last().text, /desligado/);
  t.v.dispose();
});

test('contas, moeda, número e piada funcionam sem IA', async () => {
  const t = make();
  await t.v.handle('Yoru, quanto é 7 vezes 8');
  assert.match(t.last().text, /56/);
  await t.v.handle('Yoru, quanto é 5 dividido por 0');
  assert.match(t.last().text, /zero/);
  await t.v.handle('Yoru, cara ou coroa');
  assert.match(t.last().text, /cara|coroa/);
  await t.v.handle('Yoru, sorteie um número de 1 a 6');
  assert.match(t.last().text, /número [1-6],/);
  await t.v.handle('Yoru, conte uma piada');
  assert.ok(t.last().text.length > 20 && t.last().text !== 'resposta da IA');
  t.v.dispose();
});

test('timer: marca e avisa na hora', async () => {
  const t = make({ hour: 10 });
  await t.v.handle('Yoru, coloca um timer de 5 minutos');
  assert.match(t.last().text, /5 minutos/);
  const before = t.sent.length;
  t.v.agendaTick();
  assert.equal(t.sent.length, before, 'ainda não é hora');
  t.setClock(new Date(2026, 10, 1, 10, 5, 1));
  t.v.agendaTick();
  assert.match(t.last().text, /Acabou o tempo!.*timer de 5 minutos/);
  t.v.dispose();
});

test('timer sem tempo: ela pergunta e entende "10 minutos"', async () => {
  const t = make({ hour: 10 });
  await t.v.handle('Yoru, coloque um timer');
  assert.match(t.last().text, /Quanto tempo/);
  await t.v.handle('10 minutos');
  assert.match(t.last().text, /10 minutos/);
  t.v.dispose();
});

test('timer toca mesmo com os lembretes da agenda desligados', async () => {
  const t = make({ hour: 10, settings: { convReminders: false } });
  await t.v.handle('Yoru, timer de 1 minuto');
  t.setClock(new Date(2026, 10, 1, 10, 1, 5));
  t.v.agendaTick();
  assert.match(t.last().text, /Acabou o tempo/);
  t.v.dispose();
});

// ---------- controle do computador (v0.9.6) ----------
function makeWithPc(opts = {}) {
  const calls = [];
  const rec = (name, ret) => async (...a) => { calls.push([name, ...a]); return typeof ret === 'function' ? ret(...a) : ret; };
  const pc = {
    supported: true,
    volume: rec('volume', true), media: rec('media', true), switchWindow: rec('switch', true), desktop: rec('desktop', true),
    window: rec('window', (act, q) => (opts.found === false ? { ok: false, found: false } : { ok: true, found: true, name: q || 'notepad' })),
    launch: rec('launch', (n) => ({ ok: n !== 'xyz', name: 'App ' + n })),
    list: rec('list', [{ proc: 'chrome', title: 'Google' }, { proc: 'chrome', title: 'Outra' }, { proc: 'Spotify', title: 'Musica' }]),
    screenshot: rec('screenshot', { ok: true, file: 'C:\\x.png' }), lock: rec('lock', true), sleep: rec('sleep', true),
    shutdown: rec('shutdown', true), restart: rec('restart', true), cancelPower: rec('cancel', true),
  };
  const sent = [];
  const cfg = { convWake: 'Yoru', convAliases: '', convMode: 'wake', convFollow: 30, convSpeak: true, convComments: false, convPcActions: true, convReminders: true, convCity: '', ...(opts.settings || {}) };
  const v = createVoice({
    settings: () => cfg, panel: () => null,
    avatar: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, ...p }) } }),
    askAI: async () => ({ ok: true, text: 'resposta da IA' }), remember() {}, logToPanel() {}, rollDice() {}, stopSpeak() {},
    openExternal() {}, stt: { on() {}, prepare: async () => {}, transcribe: async () => '', dispose() {} },
    now: () => new Date(2026, 10, 1, 9), rnd: () => 0,
    agendaFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-')), 'agenda.json'), pc,
  });
  return { v, calls, sent, cfg, last: () => sent[sent.length - 1] };
}

test('volume e mídia vão direto, sem confirmar', async () => {
  const t = makeWithPc();
  await t.v.handle('Yoru, aumenta o volume');
  await t.v.handle('Yoru, coloca o volume em 30');
  await t.v.handle('Yoru, pausa a música');
  await t.v.handle('Yoru, próxima música');
  assert.deepEqual(t.calls, [['volume', 'up', 5], ['volume', 'set', 30], ['media', 'playpause'], ['media', 'next']]);
  t.v.dispose();
});

test('minimizar e trocar de janela não pedem confirmação; "fechar" pede', async () => {
  const t = makeWithPc();
  await t.v.handle('Yoru, minimiza o chrome');
  assert.deepEqual(t.calls[0], ['window', 'minimize', 'chrome']);
  await t.v.handle('Yoru, fecha o word');
  assert.equal(t.calls.length, 1, 'ainda não fechou');
  assert.match(t.last().text, /Quer mesmo fechar/);
  await t.v.handle('sim');
  assert.deepEqual(t.calls[1], ['window', 'close', 'winword|word']);
  assert.match(t.last().text, /Fechei/);
  t.v.dispose();
});

test('responder "não" cancela a ação perigosa', async () => {
  const t = makeWithPc();
  await t.v.handle('Yoru, desliga o computador');
  assert.match(t.last().text, /desligar o computador/);
  await t.v.handle('não');
  assert.equal(t.calls.length, 0);
  assert.match(t.last().text, /não fiz nada/);
  await t.v.handle('Yoru, reinicia o computador');
  await t.v.handle('sim');
  assert.deepEqual(t.calls, [['restart']]);
  await t.v.handle('Yoru, cancela o desligamento');
  assert.deepEqual(t.calls[1], ['cancel']);
  t.v.dispose();
});

test('ir para um programa que não está aberto tenta abri-lo; não achando, avisa', async () => {
  const t = makeWithPc({ found: false });
  await t.v.handle('Yoru, muda para o chrome');
  assert.deepEqual(t.calls.map((c) => c[0]), ['window', 'launch']);
  assert.match(t.last().text, /abri/);
  await t.v.handle('Yoru, minimiza o excel');
  assert.match(t.last().text, /Não achei/);
  t.v.dispose();
});

test('abrir programa desconhecido procura no menu Iniciar', async () => {
  const t = makeWithPc();
  await t.v.handle('Yoru, abra o photoshop');
  assert.deepEqual(t.calls[0], ['launch', 'photoshop']);
  assert.match(t.last().text, /Abrindo App photoshop/);
  await t.v.handle('Yoru, abra o xyz');
  assert.match(t.last().text, /Não achei/);
  t.v.dispose();
});

test('com "mexer no computador" desligado, nada é executado', async () => {
  const t = makeWithPc({ settings: { convPcActions: false } });
  await t.v.handle('Yoru, aumenta o volume');
  assert.equal(t.calls.length, 0);
  assert.match(t.last().text, /desligado/);
  t.v.dispose();
});

test('lista o que está aberto, sem repetir programa', async () => {
  const t = makeWithPc();
  await t.v.handle('Yoru, o que está aberto?');
  assert.match(t.last().text, /chrome, Spotify/);
  t.v.dispose();
});

test('eco: a própria fala dela captada pelo microfone não gera uma segunda resposta', async () => {
  const t = make();
  await t.v.handle('Yoru, me fale uma curiosidade qualquer'); // resposta: "resposta da IA"
  const before = t.sent.length;
  t.v.speakingState(true);
  t.v.speakingState(false);
  await t.v.handle('a resposta da IA'); // 3 palavras: curto demais para decidir, segue o fluxo normal
  const afterShort = t.sent.length;
  assert.ok(afterShort >= before);
  // resposta longa dela, depois o eco dela chega transcrito
  t.v.say({ text: 'Hoje o dia está bonito lá fora e eu queria te contar uma novidade' });
  const n = t.sent.length;
  await t.v.handle('hoje o dia está bonito lá fora e eu queria te contar');
  assert.equal(t.sent.length, n, 'o eco foi ignorado, sem nova resposta');
  await t.v.handle('Yoru, que horas são agora?', { force: true }); // o usuário de verdade ainda é atendido
  assert.ok(t.sent.length > n);
  t.v.dispose();
});

test('duas palmas acordam nos dois modos: ela responde e fica de ouvidos abertos', async () => {
  for (const mode of ['wake', 'always']) {
    const t = make({ settings: { convListening: true, convMode: mode } });
    const r = await t.v.clap();
    assert.equal(r.ok, true);
    assert.ok(t.sent.some((e) => e.ch === 'ai-reply' && e.speak), mode + ': respondeu falando');
    if (mode === 'wake') { // acordada: o próximo comando vale sem o nome
      await t.v.handle('que horas são');
      assert.ok(t.sent.some((e) => e.ch === 'ai-reply' && /horas|resposta/i.test(e.text)), 'atendeu sem o nome');
    }
    t.v.dispose();
  }
  const off = make({ settings: { convListening: true, convClap: false } });
  assert.equal((await off.v.clap()).ok, false, 'desligado nas configurações');
  off.v.dispose();
});

test('chat digitado: pedido local (hora) é resolvido na hora; conversa normal segue para a IA', async () => {
  const t = make();
  assert.equal(t.v.tryLocal('que horas são?'), true);
  await new Promise((r) => setTimeout(r, 20));
  assert.match(t.last().text, /\d/, 'respondeu a hora sem passar pela IA');
  assert.notEqual(t.last().text, 'resposta da IA');
  assert.equal(t.v.tryLocal('me conta uma história sobre dragões'), false);
  assert.equal(t.v.tryLocal('   '), false);
  t.v.dispose();
});

test('áudio de vídeo tocando ("passa", "próxima") não pula a música sem o nome dela', async () => {
  const t = make({ settings: { convMode: 'always' } });
  await t.v.handle('próxima');
  assert.equal(t.sent.filter((x) => x.ch === 'ai-reply').length, 0, 'ignorou o trecho solto');
  await t.v.handle('Yoru, próxima música');
  assert.equal(t.sent.filter((x) => x.ch === 'ai-reply').length, 1, 'com o nome, ela atende');
  t.v.dispose();
});

test('"vou dormir" apaga a luz da Tapo e deseja boa noite', async () => {
  const t = make();
  await t.v.handle('Yoru, vou dormir');
  assert.equal(t.tapoCalls.some(x => x.action === 'off'), true);
  assert.match(t.last().text, /luz|noite|sonhos/i);
  t.v.dispose();
});

test('"estou com sono" sem Tapo configurada segue a conversa normal, sem abrir o Smart Home', async () => {
  const t = make({ tapoControl: async () => { throw new Error('Configure a conta Tapo nas credenciais'); }, openSmartHome: () => { throw new Error('não devia abrir'); } });
  await t.v.handle('Yoru, estou com sono');
  assert.equal(t.opened.length, 0);
  assert.doesNotMatch(String(t.last() && t.last().text), /Smart Home|Conectividade/);
  t.v.dispose();
});
