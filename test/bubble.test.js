'use strict';
// Balão de fala (src/bubble.js), com elemento e relógio falsos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '..', 'src');
const load = () => import(pathToFileURL(path.join(SRC, 'bubble.js')).href);

function fakeEl() {
  const cls = new Set();
  return { style: { display: 'none' }, textContent: '', classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) } };
}
async function make(ctx, over = {}) {
  try { ctx.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] }); } catch (_) { /* já ligado neste teste */ }
  const { createBubble } = await load();
  const S = { visible: true, bubbleEnabled: true, typeAnimation: false, bubbleSeconds: 0, ...over };
  const el = fakeEl();
  return { el, S, b: createBubble({ el, settings: () => S }), tick: (ms) => ctx.mock.timers.tick(ms) };
}

test('hideDelay: o tempo do painel, ou 80 ms por letra com mínimo de 5 s', async () => {
  const { hideDelay } = await load();
  assert.equal(hideDelay('oi', { bubbleSeconds: 7 }), 7000);
  assert.equal(hideDelay('oi', { bubbleSeconds: 0 }), 5000);
  assert.equal(hideDelay('x'.repeat(200), { bubbleSeconds: 0 }), 16000);
});

test('say mostra o texto e some depois de ms; sem ms, fica', async (ctx) => {
  const { el, b, tick } = await make(ctx);
  b.say('oi', 3000);
  assert.equal(el.style.display, 'block'); assert.equal(el.textContent, 'oi');
  tick(2999); assert.equal(el.style.display, 'block');
  tick(1); assert.equal(el.style.display, 'none');
  b.say('fica');
  tick(60000); assert.equal(el.style.display, 'block');
});

test('com o avatar escondido, say e typeSay não fazem nada; com o balão desligado, typeSay também não', async (ctx) => {
  const { el, b, S } = await make(ctx);
  S.visible = false; b.say('a', 1000); b.typeSay('b');
  assert.equal(el.style.display, 'none'); assert.equal(el.textContent, '');
  S.visible = true; S.bubbleEnabled = false; b.typeSay('c');
  assert.equal(el.style.display, 'none');
  b.say('d'); assert.equal(el.textContent, 'd', 'say ignora a opção do balão (erros e avisos aparecem sempre)');
});

test('typeSay sem animação: texto inteiro e some no tempo do painel', async (ctx) => {
  const { el, b, tick } = await make(ctx, { bubbleSeconds: 4 });
  b.typeSay('olá mundo');
  assert.equal(el.textContent, 'olá mundo');
  tick(3999); assert.equal(el.style.display, 'block');
  tick(1); assert.equal(el.style.display, 'none');
});

test('typeSay com animação: aparece aos poucos, termina em ~1,5 s e depois some', async (ctx) => {
  const text = 'abcdefghij'.repeat(60); // 600 letras: passo de 10 a cada 25 ms
  const { el, b, tick } = await make(ctx, { typeAnimation: true });
  b.typeSay(text);
  assert.equal(el.textContent, '');
  tick(25); assert.equal(el.textContent.length, 10);
  tick(25 * 29); assert.equal(el.textContent.length, 300);
  tick(25 * 30); assert.equal(el.textContent, text);
  assert.equal(el.style.display, 'block');
  tick(text.length * 80 - 1); assert.equal(el.style.display, 'block');
  tick(1); assert.equal(el.style.display, 'none');
  const short = await make(ctx, { typeAnimation: true });
  short.b.typeSay('oi'); short.tick(25); assert.equal(short.el.textContent, 'o', 'texto curto: uma letra por passo');
  short.tick(25); assert.equal(short.el.textContent, 'oi');
});

test('uma fala nova cancela a digitação e o sumiço da anterior', async (ctx) => {
  const { el, b, tick } = await make(ctx, { typeAnimation: true });
  b.typeSay('x'.repeat(600));
  tick(100);
  b.say('nova');
  assert.equal(el.textContent, 'nova');
  tick(1000); assert.equal(el.textContent, 'nova', 'a digitação antiga não escreve por cima');
  b.say('a', 1000); b.say('b'); // o sumiço agendado pela primeira não pode apagar a segunda
  tick(5000); assert.equal(el.style.display, 'block'); assert.equal(el.textContent, 'b');
});

test('open limpa o estado de erro; finish mostra o texto final e agenda o sumiço', async (ctx) => {
  const { el, b, tick } = await make(ctx, { bubbleSeconds: 2 });
  el.classList.add('err');
  b.open();
  assert.equal(el.classList.has('err'), false); assert.equal(el.style.display, 'block');
  b.finish('resposta completa');
  assert.equal(el.textContent, 'resposta completa');
  tick(2000); assert.equal(el.style.display, 'none');
});

test('o renderer usa o bubble.js e não tem mais timers do balão', () => {
  const r = fs.readFileSync(path.join(SRC, 'renderer.js'), 'utf8');
  assert.match(r, /import \{ createBubble \} from '\.\/bubble\.js';/);
  assert.match(r, /createBubble\(\{ el: bubble, settings: \(\) => S \}\)/);
  const reply = fs.readFileSync(path.join(SRC, 'ai-reply.js'), 'utf8'); // o streaming mora em ai-reply.js
  assert.match(reply, /bub\.open\(\)/); assert.match(reply, /bub\.finish\(ev\.text\)/);
  assert.doesNotMatch(r, /bubbleTimer|typeTimer|function (say|typeSay)\b/);
  const b = fs.readFileSync(path.join(SRC, 'bubble.js'), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(b, /document\.|window\./);
});
