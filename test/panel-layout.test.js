'use strict';
// Organização do painel: onde cada coisa mora (Gestos em sub-abas; Desempenho dentro de Configurações).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const panel = read('panel.html');
const pane = (id, next) => panel.slice(panel.indexOf(`id="tab-${id}"`), panel.indexOf(next));

test('Desempenho saiu da barra lateral e mora em Configurações (antiga aba Geral)', () => {
  assert.ok(!/data-tab="perf"/.test(panel));
  assert.ok(!/id="tab-perf"/.test(panel));
  assert.match(panel, /<button class="tab" data-tab="geral"><i>⚙️<\/i>Configurações<\/button>/);
  const cfg = pane('geral', '<script src="./panel-core.js">');
  assert.match(cfg, /<h1 class="pane-title">Configurações</);
  assert.match(cfg, /<button class="subtab" role="tab" data-sub="desempenho">/);
  for (const g of ['aovivo', 'qualidade', 'economia', 'otimizar']) {
    assert.match(cfg, new RegExp(`<button class="subtab2" role="tab" data-sub2="${g}">`), g);
    assert.match(cfg, new RegExp(`<div data-sub="desempenho" data-sub2="${g}"`), `cards de ${g}`);
  }
  assert.equal((cfg.match(/<div data-sub="desempenho" data-sub2=/g) || []).length, 10); // inclui os 4 cards de Otimizar PC
  // os controles e os números ao vivo continuam no painel
  for (const id of ['st-fps', 'st-cpu', 'st-mem', 'procRows', 'sysInfo']) assert.match(cfg, new RegExp(`id="${id}"`), id);
  for (const k of ['quality', 'fpsActive', 'fpsIdle', 'renderRes', 'processPriority', 'sttThreads']) assert.match(cfg, new RegExp(`data-key="${k}"`), k);
  // janela destacável: Configurações no lugar de Geral, e sem Desempenho
  const w = read('windows.js');
  assert.match(w, /geral: 'Configurações'/);
  assert.ok(!/perf: 'Desempenho'/.test(w));
});

test('Gestos: quatro sub-abas (Câmera, Mão livre, Gestos e ações, Ajustes) com tudo no lugar', () => {
  const g = pane('gestos', '<!-- ABA IA -->');
  const btns = [...g.matchAll(/<button class="subtab" role="tab" data-sub="(\w+)">/g)].map((m) => m[1]);
  assert.deepEqual(btns, ['camera', 'mao', 'gestos', 'ajustes']);
  const where = (id) => { const i = g.indexOf(`id="${id}"`); return [...g.slice(0, i).matchAll(/<div data-sub="(\w+)" class="card/g)].pop()[1]; };
  for (const id of ['gToggle', 'gStage', 'gNowAct', 'gLog', 'gLogClear']) assert.equal(where(id), 'camera', id);
  // mouse no ar e mão livre moram juntos na sub-aba Mão livre (um só lugar para o controle por mão)
  for (const id of ['gMouse', 'gHand', 'chipCam', 'chipMouse', 'chipHand', 'v-gestureMouseSens', 'v-handSize']) assert.equal(where(id), 'mao', id);
  const mao = [...g.matchAll(/<div data-sub="mao" class="card[^"]*">([\s\S]*?)\n    <\/div>/g)].map((m) => m[1]).join('\n');
  for (const k of ['gestureMouseSens', 'handFree', 'handSize', 'handWander']) assert.match(mao, new RegExp(`data-key="${k}"`), k);
  assert.equal(where('gMap'), 'gestos');
  const ajustes = [...g.matchAll(/<div data-sub="ajustes" class="card">([\s\S]*?)\n    <\/div>/g)].map((m) => m[1]).join('\n');
  for (const k of ['gestureArm', 'gestureHold', 'gestureCooldown', 'gestureDetect', 'gestureSound', 'gestureReact', 'gesturePreview', 'gestureAuto', 'gestureIdleOff']) {
    assert.match(ajustes, new RegExp(`data-key="${k}"`), k);
  }
  // a câmera segue funcionando com a sub-aba escondida: a imagem e o selo moram na sub-aba Câmera, os botões de predefinição na outra
  assert.equal((g.match(/data-gpreset=/g) || []).length, 3);
});

test('Gestos: o código usa os recursos novos (ação ao lado do gesto, botão ▶, limpar, desligar sozinha, sensibilidade)', () => {
  const j = read('panel-gestos.js');
  assert.match(j, /gNowAct/);
  assert.match(j, /className = 'gtest'/);
  assert.match(j, /perform\(id, false, true\)/);
  assert.match(j, /gLogClear/);
  assert.match(j, /GL\.idleExpired\(/);
  assert.match(j, /\.\.\.GL\.detectConfig\(cfg\.gestureDetect\)/);
  assert.match(j, /restart\(\)/);
});

test('CSS das pílulas: a regra que esconde cards de outra seção não pode esconder os próprios botões', () => {
  // (o jsdom não calcula CSS, então este erro só aparece no navegador de verdade: as pílulas sumiam)
  const rule = panel.match(/\.pane \[data-sub2\][^{]*\{\s*display:none;\s*\}/);
  assert.ok(rule, 'regra de esconder data-sub2 existe');
  assert.match(rule[0], /:not\(\.subtab2\)/);
  assert.match(rule[0], /:not\(\.sub2-on\)/);
});
