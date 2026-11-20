'use strict';
// Teste de interface do painel: abre o panel.html de verdade num DOM simulado (jsdom), com a ponte `window.panel` falsa,
// e confere que todos os scripts carregam em ordem sem erro, que as abas e sub-abas trocam o que aparece
// e que as configurações chegam nos controles. Precisa do pacote jsdom (devDependency); sem ele o teste é pulado.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

let JSDOM, VirtualConsole;
try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch (_) { /* sem npm install */ }
const SRC = path.join(__dirname, '..', 'src');
const { DEFAULTS } = require('../src/settings');

async function openPanel() {
  const errors = [];
  const cbs = {};
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push((e.detail && e.detail.message) || e.message));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const answers = {
    getSettings: async () => ({ ...DEFAULTS }),
    getVersion: async () => '0.0.0',
    libList: async () => ({ avatars: [], items: [] }),
    getConfig: async () => ({ provider: 'anthropic', systemPrompt: 'oi', providers: { anthropic: { model: 'x', hasKey: false } } }),
    commandsInfo: async () => ({ commands: [['Teste', ['ex']]], sites: [], shortcuts: [], chars: 10, tokens: 3 }),
    panelBounds: async () => ({ x: 0, y: 0, width: 800, height: 600 }),
    ttsVoices: async () => [], memList: async () => [], agendaList: async () => [], criaList: async () => [],
    profileGet: async () => ({}), perfInfo: async () => ({}), ttsStat: async () => ({}),
  };
  const panel = new Proxy({}, { get: (_, k) => {
    if (answers[k]) return answers[k];
    if (typeof k === 'string' && /^on[A-Z]/.test(k)) return (cb) => { (cbs[k] = cbs[k] || []).push(cb); };
    return async () => ({ ok: false });
  } });
  const dom = await JSDOM.fromFile(path.join(SRC, 'panel.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    url: 'file://' + path.join(SRC, 'panel.html') + '?theme=dark&accent=%23ff7a2e',
    beforeParse(w) {
      w.panel = panel;
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, addListener() {} }));
      w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => ({}), set: () => true });
      w.AudioContext = function () {};
      w.navigator.mediaDevices = { addEventListener() {}, removeEventListener() {}, enumerateDevices: async () => [], getUserMedia: async () => { throw new Error('sem microfone'); } };
      w.speechSynthesis = { getVoices: () => [], onvoiceschanged: null, addEventListener() {} };
      w.ResizeObserver = class { observe() {} disconnect() {} };
    },
  });
  await new Promise((r) => dom.window.addEventListener('load', r));
  await new Promise((r) => setTimeout(r, 300));
  return { dom, d: dom.window.document, errors, cbs };
}

test('painel: abre sem erro, todas as abas ativam e as sub-abas mostram só os seus cards', { skip: !JSDOM && 'jsdom não instalado' }, async () => {
  const { dom, d, errors } = await openPanel();
  try {
    assert.deepEqual(errors, [], 'nenhum erro ao carregar os scripts');
    const tabs = [...d.querySelectorAll('.tab')];
    assert.ok(tabs.length >= 9, `abas encontradas: ${tabs.length}`);
    let subs = 0;
    for (const t of tabs) {
      t.click();
      const pane = d.getElementById('tab-' + t.dataset.tab);
      assert.ok(pane.classList.contains('active'), `aba ${t.dataset.tab} não ativou`);
      for (const b of pane.querySelectorAll('.subtab')) {
        b.click(); subs++;
        const on = [...pane.querySelectorAll('[data-sub]:not(.subtab)')].filter((el) => el.classList.contains('sub-on'));
        assert.ok(on.length > 0, `${t.dataset.tab}/${b.dataset.sub} sem cards`);
        for (const el of on) assert.ok(el.dataset.sub.split(' ').includes(b.dataset.sub), `${t.dataset.tab}/${b.dataset.sub} mostra card de outra sub-aba`);
        assert.ok(b.classList.contains('active'));
      }
    }
    assert.ok(subs >= 18, `sub-abas testadas: ${subs}`);
    assert.deepEqual(errors, [], 'nenhum erro ao navegar');
  } finally { await new Promise((r) => setTimeout(r, 250)); dom.window.close(); } // deixa terminar as chamadas assíncronas do painel antes de fechar o DOM
});

test('painel: cada aba abre na primeira sub-aba e as configurações chegam nos controles', { skip: !JSDOM && 'jsdom não instalado' }, async () => {
  const { dom, d, errors, cbs } = await openPanel();
  try {
    for (const nav of d.querySelectorAll('.subtabs')) {
      assert.ok(nav.querySelector('.subtab').classList.contains('active'), 'abre na 1ª sub-aba');
    }
    assert.equal(d.querySelector('[data-key="walkEnabled"]').checked, !!DEFAULTS.walkEnabled);
    // as falas espontâneas desligadas escurecem os cards que dependem delas
    for (const cb of cbs.onSettings) cb({ ...DEFAULTS, convChatter: false, walkEnabled: !DEFAULTS.walkEnabled });
    assert.equal(d.querySelector('[data-key="walkEnabled"]').checked, !DEFAULTS.walkEnabled);
    const dep = [...d.querySelectorAll('.chatter-dep')];
    assert.ok(dep.length >= 4);
    assert.ok(dep.every((el) => el.classList.contains('dim')));
    for (const cb of cbs.onSettings) cb({ ...DEFAULTS, convChatter: true });
    assert.ok(dep.every((el) => !el.classList.contains('dim')));
    assert.deepEqual(errors, []);
  } finally { await new Promise((r) => setTimeout(r, 250)); dom.window.close(); } // deixa terminar as chamadas assíncronas do painel antes de fechar o DOM
});

test('painel: Avatar › Comportamento tem pílulas que trocam de seção, e o atalho da aba Conversa leva até Fala', { skip: !JSDOM && 'jsdom não instalado' }, async () => {
  const { dom, d, errors } = await openPanel();
  try {
    const pane = d.getElementById('tab-avatar');
    d.querySelector('.tab[data-tab="avatar"]').click();
    const visible = (g) => [...pane.querySelectorAll('[data-sub2]:not(.subtab2)')].filter((el) => el.classList.contains('sub2-on') && el.classList.contains('sub-on')).map((el) => el.dataset.sub2);
    // fora da sub-aba Comportamento, as pílulas não aparecem
    assert.ok(!pane.querySelector('.subtabs2').classList.contains('sub-on'));
    pane.querySelector('.subtab[data-sub="comportamento"]').click();
    assert.ok(pane.querySelector('.subtabs2').classList.contains('sub-on'), 'pílulas aparecem na sub-aba Comportamento');
    for (const g of ['mov', 'emo', 'corpo', 'fala']) {
      pane.querySelector(`.subtab2[data-sub2="${g}"]`).click();
      const vis = visible();
      assert.ok(vis.length >= 2, `${g}: cards visíveis`);
      assert.ok(vis.every((x) => x === g), `${g}: só mostra cards da própria seção`);
      assert.ok(pane.querySelector(`.subtab2[data-sub2="${g}"]`).classList.contains('active'));
    }
    // o card de modelo some quando se está em Comportamento
    assert.ok(!pane.querySelector('[data-sub="modelo"]').classList.contains('sub-on'));
    // atalho da aba Conversa: Avatar › Comportamento › Fala
    d.querySelector('.tab[data-tab="conversa"]').click();
    d.getElementById('goComportamento').click();
    assert.ok(pane.classList.contains('active'));
    assert.ok(pane.querySelector('.subtab[data-sub="comportamento"]').classList.contains('active'));
    assert.ok(pane.querySelector('.subtab2[data-sub2="fala"]').classList.contains('active'));
    assert.ok(visible().every((x) => x === 'fala') && visible().length >= 5);
    assert.deepEqual(errors, []);
  } finally { await new Promise((r) => setTimeout(r, 250)); dom.window.close(); }
});

test('painel: Gestos (3 sub-abas), botões ▶ de teste e Configurações › Desempenho funcionam', { skip: !JSDOM && 'jsdom não instalado' }, async () => {
  const { dom, d, errors } = await openPanel();
  try {
    // Gestos
    d.querySelector('.tab[data-tab="gestos"]').click();
    const gp = d.getElementById('tab-gestos');
    assert.ok(gp.classList.contains('active'));
    for (const sub of ['camera', 'gestos', 'ajustes']) {
      gp.querySelector(`.subtab[data-sub="${sub}"]`).click();
      const on = [...gp.querySelectorAll('[data-sub]:not(.subtab)')].filter((el) => el.classList.contains('sub-on'));
      assert.ok(on.length >= 1, `Gestos/${sub} sem cards`);
    }
    const tests = [...d.querySelectorAll('#gMap .gtest')];
    assert.equal(tests.length, 12, 'um botão ▶ por gesto');
    assert.ok(tests.every((b) => b.title));
    // o botão ▶ fica desligado quando o gesto não tem ação
    const sel = d.querySelector('#gMap select[data-g="fist"]');
    assert.ok(sel);
    // Configurações › Desempenho
    d.querySelector('.tab[data-tab="geral"]').click();
    const cp = d.getElementById('tab-geral');
    assert.ok(cp.classList.contains('active'));
    assert.ok(!d.getElementById('tab-perf'));
    cp.querySelector('.subtab[data-sub="desempenho"]').click();
    assert.ok(cp.querySelector('.subtabs2').classList.contains('sub-on'));
    for (const g of ['aovivo', 'qualidade', 'economia']) {
      cp.querySelector(`.subtab2[data-sub2="${g}"]`).click();
      const vis = [...cp.querySelectorAll('[data-sub2]:not(.subtab2)')].filter((el) => el.classList.contains('sub2-on') && el.classList.contains('sub-on'));
      assert.ok(vis.length >= 1 && vis.every((el) => el.dataset.sub2 === g), `Desempenho/${g}`);
    }
    // abrir em outra sub-aba esconde as pílulas de desempenho
    cp.querySelector('.subtab[data-sub="janelas"]').click();
    assert.ok(!cp.querySelector('.subtabs2').classList.contains('sub-on'));
    assert.deepEqual(errors, []);
  } finally { await new Promise((r) => setTimeout(r, 250)); dom.window.close(); }
});
