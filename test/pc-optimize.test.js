'use strict';
// Otimizar o PC: só ações da lista, nada de texto de fora dentro do PowerShell, e tudo ligado (painel, preload, IPC).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createOptimizer, ACTIONS, GUID, PS } = require('../src/pc-optimize');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const decode = (args) => Buffer.from(args[args.length - 1], 'base64').toString('utf16le');

function make(replies = {}) {
  const calls = [];
  const exec = async (file, args, opts = {}) => {
    const script = file === 'powershell.exe' ? decode(args) : '';
    calls.push({ file, args, script, env: opts.env || {} });
    const key = Object.keys(replies).find((k) => script.includes(k) || file.includes(k));
    return key ? replies[key] : { code: 0, out: 'OK|0', err: '' };
  };
  return { o: createOptimizer({ platform: 'win32', exec }), calls };
}

test('fora do Windows nada é executado', async () => {
  const calls = [];
  const o = createOptimizer({ platform: 'linux', exec: async (...a) => { calls.push(a); return { code: 0, out: '' }; } });
  assert.equal(o.supported, false);
  for (const r of [await o.info(), await o.run('temp'), await o.startupList(), await o.startupSet('x', false)]) assert.equal(r.ok, false);
  assert.deepEqual(calls, []);
});

test('id fora da lista é recusado sem rodar nada', async () => {
  const { o, calls } = make();
  for (const id of ['format-c', 'temp; rm -rf', '', undefined, '../x', 'power-ultimate']) assert.equal((await o.run(id)).ok, false);
  assert.deepEqual(calls, []);
});

test('limpeza informa quanto foi liberado e usa só pastas fixas', async () => {
  const { o, calls } = make({ 'Get-ChildItem': { code: 0, out: 'OK|52428800', err: '' } });
  const r = await o.run('temp');
  assert.equal(r.ok, true);
  assert.match(r.message, /50 MB/);
  assert.equal(r.freed, 52428800);
  assert.match(calls[0].script, /\$env:TEMP/);
  assert.match(calls[0].script, /AddDays\(-1\)/, 'temporários só com mais de 1 dia');
  assert.match(calls[0].script, /Length -lt 12/, 'recusa raiz curta demais (ex.: C:\\)');
  const d = make();
  await d.o.run('dumps');
  assert.match(d.calls[0].script, /CrashDumps/);
  assert.match(d.calls[0].script, /AddDays\(-0\)/);
});

test('DNS usa ipconfig, sem PowerShell', async () => {
  const { o, calls } = make();
  assert.equal((await o.run('dns')).ok, true);
  assert.deepEqual([calls[0].file, calls[0].args], ['ipconfig.exe', ['/flushdns']]);
});

test('planos de energia usam os GUIDs do Windows e a falha vira erro claro', async () => {
  const { o, calls } = make();
  for (const k of ['high', 'balanced', 'saver']) await o.run('power-' + k);
  assert.ok(calls[0].script.includes(GUID.high) && calls[1].script.includes(GUID.balanced) && calls[2].script.includes(GUID.saver));
  const f = make({ powercfg: { code: 0, out: 'FAIL', err: '' } });
  const r = await f.o.run('power-high');
  assert.equal(r.ok, false);
  assert.match(r.error, /alto desempenho/);
});

test('diagnóstico lê o JSON do PowerShell e reconhece o plano de energia', async () => {
  const out = JSON.stringify({ drive: 'C', freeB: 200e9, usedB: 300e9, tempB: 734003200, planGuid: GUID.balanced, planName: 'Equilibrado', top: { name: 'chrome', mb: 900 } });
  const { o } = make({ 'powercfg /getactivescheme': { code: 0, out, err: '' } });
  const d = await o.info();
  assert.equal(d.ok, true);
  assert.equal(d.plan, 'balanced');
  assert.equal(d.freeGB, 200);
  assert.equal(d.freePct, 40);
  assert.equal(d.tempMB, 700);
  assert.deepEqual(d.top, [{ name: 'chrome', mb: 900 }], 'um único processo vira lista');
  const bad = make({ 'powercfg /getactivescheme': { code: 0, out: 'lixo', err: '' } });
  assert.equal((await bad.o.info()).ok, false);
});

test('programas da inicialização: lista e troca, com o nome só por variável de ambiente', async () => {
  const list = JSON.stringify([{ name: 'Discord', on: true, cmd: 'C:\\x\\Discord.exe' }, { name: 'Steam', on: false, cmd: 'steam.exe' }]);
  const { o, calls } = make({ 'StartupApproved': { code: 0, out: list, err: '' } });
  const l = await o.startupList();
  assert.deepEqual(l.items.map((i) => [i.name, i.on]), [['Discord', true], ['Steam', false]]);

  const evil = '"; Remove-Item C:\\ -Recurse; "';
  const r = await o.startupSet(evil, false);
  const call = calls[calls.length - 1];
  assert.equal(call.env.YORU_Q, evil);
  assert.equal(call.env.YORU_ON, '0');
  assert.ok(!call.script.includes('Remove-Item C:'), 'o texto de fora nunca entra no código');
  assert.match(call.script, /known -notcontains \$n/, 'só vale para nome que já está na lista');
  assert.equal(typeof r.ok, 'boolean');

  for (const bad of ['', 'a\nb', 'x'.repeat(201), null, 42]) assert.equal((await o.startupSet(bad, true)).ok, false);
  const nf = make({ 'StartupApproved': { code: 0, out: 'NOTFOUND', err: '' } });
  assert.equal((await nf.o.startupSet('Fantasma', true)).ok, false);
});

test('nenhuma ação pede administrador nem mexe fora do usuário', () => {
  const all = Object.values(PS).map((v) => (typeof v === 'function' ? v(GUID.high) : v)).join('\n');
  assert.ok(!/HKLM:|Start-Process|-Verb RunAs|Stop-Service|Disable-|bcdedit|Set-MpPreference|Remove-Item\s+-Path\s+C:|Format-/i.test(all));
  assert.ok(ACTIONS.every((a) => a.id && a.group && a.label && a.desc));
  assert.ok(ACTIONS.find((a) => a.id === 'recycle').confirm, 'esvaziar a lixeira pede confirmação');
});

test('painel, preload e main estão ligados e só o painel pode pedir', () => {
  const main = read('main.js'), pre = read('panel-preload.js'), html = read('panel.html'), js = read('panel-optimize.js');
  for (const ch of ['optimize-catalog', 'optimize-info', 'optimize-run', 'optimize-startup-list', 'optimize-startup-set']) {
    assert.ok(main.includes(`secureIpcMain.handle('${ch}'`), ch + ' no main');
    assert.ok(pre.includes(`'${ch}'`), ch + ' no preload');
  }
  assert.equal((main.match(/secureIpcMain\.handle\('optimize-/g) || []).length, (main.match(/secureIpcMain\.handle\('optimize-[^\n]*fromPanel\(e\)/g) || []).length, 'todo canal confere o remetente');
  assert.match(html, /data-sub2="otimizar"/);
  assert.match(html, /<script src="\.\/panel-optimize\.js"><\/script>/);
  assert.ok(!/innerHTML/.test(js), 'nomes de programas entram por textContent');
  assert.ok(!/<script>/.test(html.slice(html.indexOf('optBox') - 200, html.indexOf('optBox') + 3000)), 'sem script inline (CSP)');
});

// ---------- por voz ----------
const V = require('../src/voice-logic');
const op = (frase) => { const i = V.parseIntent(frase); return i.type === 'pc' ? i.op : i.type; };

test('voz: frases de otimizar o PC viram a ação certa', () => {
  const casos = [
    ['limpa o computador', 'opt-clean-all'], ['otimiza o pc', 'opt-clean-all'], ['faz uma limpeza no computador', 'opt-clean-all'], ['deixa o pc mais rápido', 'opt-clean-all'],
    ['limpa os arquivos temporários', 'opt-temp'], ['esvazia a lixeira', 'opt-recycle'], ['limpa o dns', 'opt-dns'], ['limpa o cache do chrome', 'opt-browser'],
    ['coloca o modo alto desempenho', 'opt-power-high'], ['ativa a economia de energia', 'opt-power-saver'], ['muda para o plano equilibrado', 'opt-power-balanced'],
    ['quanto espaço livre eu tenho no disco', 'opt-info'], ['como está o meu pc', 'opt-info'],
  ];
  for (const [frase, esperado] of casos) assert.equal(op(frase), esperado, frase);
});

test('voz: frases parecidas que NÃO são de otimizar continuam como antes', () => {
  assert.equal(V.parseIntent('limpa a agenda').type, 'agenda-clear');
  for (const frase of ['limpa a tela do computador', 'aumenta o volume', 'tira um print da tela', 'me conta uma piada', 'que horas são']) {
    const i = V.parseIntent(frase);
    assert.ok(!(i.type === 'pc' && /^opt-/.test(i.op)), frase);
  }
  assert.equal(V.parseIntent('não limpa o computador').type !== 'pc' || !/^opt-/.test(V.parseIntent('não limpa o computador').op), true, 'negação não executa');
});

test('voz: só a lixeira pede confirmação; limpar e trocar energia executam na hora', () => {
  assert.equal(V.parseIntent('esvazia a lixeira').danger, true);
  for (const f of ['limpa o computador', 'limpa o dns', 'modo alto desempenho']) assert.ok(!V.parseIntent(f).danger, f);
});

test('voz: o executor chama o otimizador, respeita a confirmação e o interruptor do PC', async () => {
  const { createVoice } = require('../src/voice-main');
  const os = require('node:os');
  const make2 = (settings = {}) => {
    const runs = [], sent = [];
    const optimizer = {
      run: async (id) => { runs.push(id); return { ok: true, message: 'Pronto: 80 MB liberados.' }; },
      info: async () => ({ ok: true, drive: 'C', freeGB: 212.4, freePct: 44, ramFreeGB: 6.1, ramTotalGB: 16, tempMB: 1536, plan: 'balanced' }),
    };
    const cfg = { convWake: 'Yoru', convAliases: '', convMode: 'wake', convFollow: 30, convSpeak: true, convComments: false, convPcActions: true, convReminders: true, convCity: '', ...settings };
    const v = createVoice({
      settings: () => cfg, panel: () => null,
      avatar: () => ({ isDestroyed: () => false, webContents: { send: (ch, p) => sent.push({ ch, ...p }) } }),
      askAI: async () => ({ ok: true, text: 'oi' }), remember() {}, logToPanel() {}, rollDice() {}, stopSpeak() {}, openExternal() {},
      stt: { on() {}, prepare: async () => {}, transcribe: async () => '', dispose() {} },
      now: () => new Date(2026, 10, 1, 9), rnd: () => 0, agendaFile: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-')), 'a.json'),
      pc: { supported: true }, optimizer,
    });
    return { v, runs, sent, said: () => sent.filter((m) => m.text).map((m) => m.text).join(' | ') };
  };

  let t = make2();
  await t.v.handle('Yoru, limpa o computador');
  assert.deepEqual(t.runs, ['clean-all']);
  assert.match(t.said(), /80 MB/);
  t.v.dispose();

  t = make2();
  await t.v.handle('Yoru, esvazia a lixeira');
  assert.deepEqual(t.runs, [], 'antes do sim não apaga nada');
  await t.v.handle('Yoru, qual é a capital da França?');
  assert.deepEqual(t.runs, [], 'outro assunto não confirma');
  t.v.dispose();
  t = make2();
  await t.v.handle('Yoru, esvazia a lixeira');
  await t.v.handle('sim');
  assert.deepEqual(t.runs, ['recycle']);
  t.v.dispose();

  t = make2();
  await t.v.handle('Yoru, quanto espaço livre eu tenho');
  assert.deepEqual(t.runs, []);
  assert.match(t.said(), /212\.4 giga livres/);
  assert.match(t.said(), /1\.5 giga de temporários/);
  t.v.dispose();

  t = make2({ convPcActions: false });
  await t.v.handle('Yoru, limpa o computador');
  assert.deepEqual(t.runs, [], 'com o controle do PC desligado nada roda');
  t.v.dispose();
});

test('cache dos navegadores: só pastas de cache, nunca senhas, histórico ou cookies', () => {
  assert.match(PS.browser, /Chrome[\s\S]*Edge[\s\S]*Brave[\s\S]*Firefox/);
  assert.ok(!/Cookies|Login Data|History|Preferences|Web Data|Bookmarks/i.test(PS.browser));
  assert.ok(ACTIONS.some((a) => a.id === 'clean-all') && ACTIONS.some((a) => a.id === 'browser'));
});

test('limpeza completa soma temporários, relatórios e navegadores, sem tocar na lixeira', async () => {
  const { o, calls } = make({ 'Get-ChildItem': { code: 0, out: 'OK|10485760', err: '' } });
  const r = await o.run('clean-all');
  assert.equal(r.ok, true);
  assert.equal(r.freed, 3 * 10485760);
  assert.match(r.message, /30 MB/);
  assert.equal(calls.length, 3);
  assert.ok(calls.every((c) => !/Clear-RecycleBin/.test(c.script)));
  assert.ok(calls[0].script.includes('$env:TEMP') && calls[1].script.includes('CrashDumps') && calls[2].script.includes('Chrome'));
});
