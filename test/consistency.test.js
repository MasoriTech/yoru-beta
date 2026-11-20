'use strict';
// Garante que a lista de gestos e de itens é a mesma no app, no avatar, no painel e no prompt da IA.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AS = require('../src/ai-stream');
const mainSource = require('./helpers/main-source');
const panelSource = require('./helpers/panel-source');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('todos os gestos têm animação no avatar (e vice-versa)', () => {
  const r = read('emotes.js');   // os gestos moram em src/emotes.js
  const block = r.slice(r.indexOf('const EMOTES = {'));
  const ids = [...block.matchAll(/^\s+(\w+): \{ dur:/gm)].map((m) => m[1]).filter((x) => x !== 'land' && x !== 'punch').sort();
  assert.deepEqual(ids, [...AS.EMOTE_IDS].sort());
});

test('o painel lista todos os gestos', () => {
  const p = panelSource();
  const m = p.slice(p.indexOf('const EMOTES = ['), p.indexOf('let state = {}'));
  const ids = [...m.matchAll(/\['(\w+)', '[^']+', '[^']+'\]/g)].map((x) => x[1]).sort();
  assert.deepEqual(ids, [...AS.EMOTE_IDS].sort());
});


test('novos emotes v5 existem no avatar 3D, Chibi, painel e IA', () => {
  const emotesSrc = read('emotes.js');
  const panel = panelSource();
  const { EMOTE_REACTION } = require('../src/avatar2d-logic.js');
  for (const id of AS.NEW_EMOTES_V5) {
    assert.ok(emotesSrc.includes(`${id}: { dur:`), id + ' no 3D');
    assert.ok(EMOTE_REACTION[id], id + ' no Chibi');
    assert.ok(panel.includes(`['${id}',`), id + ' no painel');
    assert.ok(AS.EMOTE_LABELS[id], id + ' na IA');
  }
});

test('itens embutidos: avatar, painel e validação do main coincidem', () => {
  const r = read('items.js'); // os itens embutidos moram em items.js
  const makers = r.match(/const ITEM_MAKERS = \{([^}]*)\}/)[1].split(',').map((x) => x.split(':')[0].trim()).sort();
  const p = panelSource();
  const panelItems = [...p.slice(p.indexOf('const ITEMS = ['), p.indexOf('let lib =')).matchAll(/\['(\w+)', '[^']+', '[^']+'\]/g)]
    .map((x) => x[1]).filter((x) => x !== 'none').sort();
  const mainList = mainSource().match(/\(\['none', ([^\]]*)\]\.includes\(p\.item\)/)[1].match(/'(\w+)'/g).map((x) => x.replace(/'/g, '')).sort();
  assert.deepEqual(panelItems, makers);
  assert.deepEqual(mainList, makers);
});

test('tag de gesto novo é reconhecida na resposta da IA', () => {
  const r = AS.parseReply('[happy] [emote:cheer] Conseguimos!');
  assert.deepEqual(r.emotes, ['cheer']);
  assert.equal(r.text, 'Conseguimos!');
});

test('configurações antigas ganham os gestos novos (lista de migração)', () => {
  for (const id of AS.NEW_EMOTES_V4) assert.ok(AS.EMOTE_IDS.includes(id), id);
  for (const id of AS.NEW_EMOTES_V5) assert.ok(AS.EMOTE_IDS.includes(id), id);
  for (const id of AS.NEW_EMOTES_V2) assert.ok(AS.EMOTE_IDS.includes(id), id);
});

test('temas: main, painel e CSS têm a mesma lista', () => {
  const main = mainSource();
  const mainThemes = main.match(/const PANEL_THEMES = \[([^\]]*)\]/)[1].match(/'(\w+)'/g).map((x) => x.replace(/'/g, '')).sort();
  const p = panelSource();
  const grid = p.slice(p.indexOf('const THEMES = ['), p.indexOf('const themeGrid'));
  const panelThemes = [...grid.matchAll(/\['(\w+)', '[^']+'/g)].map((m) => m[1]).sort();
  assert.deepEqual(panelThemes, mainThemes);
  const bg = main.match(/const THEME_BG = \{([^}]*)\}/)[1];
  for (const t of mainThemes.filter((x) => x !== 'auto')) {
    assert.ok(bg.includes(t + ':'), `fundo da janela para ${t}`);
    if (t !== 'dark') assert.ok(p.includes(`:root[data-theme="${t}"]`), `CSS do tema ${t}`); // o escuro é o :root base
  }
});

test('passeio: configurações, validação, painel, preload e IPC coincidem', () => {
  const main = mainSource();
  const panel = panelSource();
  const pre = read('preload.js');
  const rend = read('renderer.js');
  for (const k of ['walkEnabled', 'walkSpeed', 'walkEvery']) {
    assert.ok(new RegExp(`^  ${k}:`, 'm').test(main), `padrão de ${k}`);
    assert.ok(main.includes(`'${k}'`) || main.includes(`p.${k}`), `validação de ${k}`);
    assert.ok(panel.includes(`data-key="${k}"`), `controle de ${k} no painel`);
  }
  assert.ok(panel.includes('data-action="walk-now"') && main.includes("name === 'walk-now'"));
  assert.ok(pre.includes("'walk-busy'") && main.includes("'walk-busy'"));
  assert.ok(pre.includes("ipcRenderer.on('walk'") && main.includes("send('walk'"));
  assert.ok((rend + read('walk.js')).includes('window.api.onWalk') && rend.includes('window.api.walkBusy')); // a animação do passeio mora em walk.js
});

test('passeio: limites de velocidade e intervalo', () => {
  const main = mainSource();
  assert.match(main, /clamp\(p\.walkSpeed, 40, 300, 110\)/);
  assert.match(main, /clamp\(p\.walkEvery, 3, 300, 15\)/);
});

test('poses novas (danças, sentar): renderer, IA e migração coincidem', () => {
  const rend = read('emote-player.js');   // quem toca os gestos (e o "levantar") é o emote-player.js
  const emotesSrc = read('emotes.js');   // os gestos moram em src/emotes.js
  const emoteIds = [...emotesSrc.slice(emotesSrc.indexOf('const EMOTES = {')).matchAll(/^\s+(\w+): \{ dur:/gm)].map((m) => m[1]);
  for (const id of AS.NEW_EMOTES_V3) {
    assert.ok(emoteIds.includes(id), `${id} existe no renderer`);
    assert.ok(AS.EMOTE_IDS.includes(id), `${id} está na lista da IA`);
    assert.ok(panelSource().includes(`['${id}',`), `${id} está no painel`);
  }
  assert.match(read('settings.js'), /emoteVer: 5/);
  assert.ok(rend.includes("id === 'stand'"), 'levantar cancela o gesto');
});

test('mover a janela nunca usa setPosition (no Windows com 125%/150% ele vai aumentando a janela)', () => {
  const main = mainSource().split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/win\.setPosition\(/.test(main), 'use setWinPos()');
  assert.match(main, /function setWinPos[\s\S]*?setBounds\([\s\S]*?\.\.\.winSize\(\)/);
});

test('o chão do passeio é a barra de tarefas (mesmo chão da queda)', () => {
  const main = mainSource();
  const mov = fs.readFileSync(path.join(__dirname, '..', 'src', 'movement.js'), 'utf8'); // o passeio mora em movement.js
  const walk = mov.slice(mov.indexOf('function startWalk'), mov.indexOf('function stepWalk'));
  assert.ok(walk.includes('MOTION.planWalk('), 'passeio usa o plano de motion.js');
  const motion = fs.readFileSync(path.join(__dirname, '..', 'src', 'motion.js'), 'utf8');
  const plan = motion.slice(motion.indexOf('function planWalk'), motion.indexOf('function stepWalk'));
  assert.ok(plan.includes('floorTop('), 'plano do passeio usa floorTop');
  assert.match(main, /let y = floorTop\(workArea, H\)/);
});

test('sub-abas: cada botão tem cards e cada card pertence a sub-abas existentes', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel.html'), 'utf8');
  const navs = [...panel.matchAll(/<nav class="subtabs"[\s\S]*?<\/nav>/g)];
  assert.ok(navs.length >= 7, 'abas longas têm sub-abas');
  for (const n of navs) {
    const rest = panel.slice(n.index + n[0].length);
    const end = Math.min(...['<div class="pane', '<script'].map((m) => { const i = rest.indexOf(m); return i < 0 ? Infinity : i; }));
    const body = rest.slice(0, end);
    const btns = [...n[0].matchAll(/data-sub="(\w+)"/g)].map((m) => m[1]);
    const used = [...body.matchAll(/<div data-sub="([\w ]+)"/g)].flatMap((m) => m[1].split(' '));
    for (const b of btns) assert.ok(used.includes(b), `sub-aba sem cards: ${b}`);
    for (const c of used) assert.ok(btns.includes(c), `card com sub-aba inexistente: ${c}`);
    assert.equal(new Set(btns).size, btns.length, 'botões repetidos');
  }
});
