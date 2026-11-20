'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/ai-stream');

const toBody = (str, size = 7) => (async function* () {
  const enc = new TextEncoder();
  for (let i = 0; i < str.length; i += size) yield enc.encode(str.slice(i, i + size));
})();

test('parseReply separa emoção e gestos', () => {
  const r = S.parseReply('[happy] [emote:wave] Oi, tudo bem?');
  assert.equal(r.emotion, 'happy');
  assert.deepEqual(r.emotes, ['wave']);
  assert.equal(r.text, 'Oi, tudo bem?');
});

test('parseReply mantém colchetes que não são tags', () => {
  assert.equal(S.parseReply('Veja [1] e [foo]').text, 'Veja [1] e [foo]');
});

test('visibleText esconde tag incompleta', () => {
  assert.equal(S.visibleText('[hap'), '');
  assert.equal(S.visibleText('[happy] Oi [emo'), 'Oi');
  assert.equal(S.visibleText('[happy] Oi'), 'Oi');
});

test('sentenceEnd junta frases curtas e ignora decimais', () => {
  assert.equal(S.sentenceEnd('Oi! Tudo bem', 0), -1);
  const t = 'Oi! Hoje faz 3.5 graus lá fora, bem frio. Leve um casaco.';
  const e = S.sentenceEnd(t, 0);
  assert.equal(t.slice(0, e), 'Oi! Hoje faz 3.5 graus lá fora, bem frio.');
});

test('streamer emite start, frases e end na ordem', () => {
  const ev = [];
  const st = S.createReplyStreamer((e) => ev.push(e));
  const raw = '[happy] [emote:wave] Que bom te ver por aqui hoje! Como foi o seu dia até agora? Conta tudo.';
  for (let i = 0; i < raw.length; i += 5) st.push(raw.slice(i, i + 5));
  const final = st.end();
  assert.equal(ev[0].type, 'start');
  assert.equal(ev[0].emotion, 'happy');
  assert.equal(final, 'Que bom te ver por aqui hoje! Como foi o seu dia até agora? Conta tudo.');
  const sentences = ev.filter((e) => e.type === 'sentence').map((e) => e.text);
  assert.equal(sentences.join(' '), final);
  assert.ok(sentences.length >= 2);
  assert.equal(ev[ev.length - 1].type, 'end');
  assert.deepEqual(ev[ev.length - 1].emotes, ['wave']);
  assert.ok(!ev.some((e) => e.type === 'text' && /\[/.test(e.text)), 'nenhuma tag vaza para o balão');
});

test('streamer sem texto não dispara start nem end', () => {
  const ev = [];
  const st = S.createReplyStreamer((e) => ev.push(e));
  st.push('[happy] ');
  assert.equal(st.started, false);
  assert.equal(st.end(), null);
  assert.deepEqual(ev, []);
});

test('Anthropic SSE', async () => {
  const sse = [
    'event: message_start', 'data: {"type":"message_start"}', '',
    'event: content_block_delta', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Olá"}}', '',
    'event: content_block_delta', 'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":", mundo"}}', '',
    'event: message_stop', 'data: {"type":"message_stop"}', '', '',
  ].join('\n');
  const got = [];
  const full = await S.readAnthropicStream(toBody(sse), (d) => got.push(d));
  assert.equal(full, 'Olá, mundo');
  assert.deepEqual(got, ['Olá', ', mundo']);
});

test('OpenAI SSE com [DONE] e acentos cortados entre pedaços', async () => {
  const sse = 'data: {"choices":[{"delta":{"content":"Pão"}}]}\n\ndata: {"choices":[{"delta":{"content":" de queijo"}}]}\n\ndata: [DONE]\n\n';
  const full = await S.readOpenAIStream(toBody(sse, 3), () => {});
  assert.equal(full, 'Pão de queijo');
});

test('Ollama NDJSON', async () => {
  const nd = '{"message":{"content":"Oi"},"done":false}\n{"message":{"content":"!"},"done":false}\n{"done":true}\n';
  assert.equal(await S.readOllamaStream(toBody(nd), () => {}), 'Oi!');
});

test('erro no meio do fluxo é propagado', async () => {
  const sse = 'data: {"type":"error","error":{"message":"sobrecarregado"}}\n\n';
  await assert.rejects(S.readAnthropicStream(toBody(sse), () => {}), /sobrecarregado/);
});

test('voz: a 1ª frase sai mais cedo (vírgula depois de 30 letras) e decimais não quebram', () => {
  const out = [];
  const st = S.createReplyStreamer((e) => { if (e.type === 'sentence') out.push(e.text); });
  const raw = 'Segundo o que eu sei sobre isso, a resposta é simples e curta. O valor é 3,5 mesmo.';
  for (let i = 0; i < raw.length; i += 3) st.push(raw.slice(i, i + 3));
  st.end();
  assert.equal(out[0], 'Segundo o que eu sei sobre isso,');
  assert.equal(out.join(' '), raw, 'nada se perde nem repete');
  assert.ok(out.some((x) => x.includes('3,5')));
});

test('voz: histórico enviado à IA é curto e começa numa fala do usuário', () => {
  const m = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const t = S.trimForVoice(m);
  assert.ok(t.length <= 10);
  assert.equal(t[0].role, 'user');
  assert.equal(t[t.length - 1].content, '19'.replace('19', m[19].content));
  assert.equal(S.trimForVoice(m.slice(0, 4)).length, 4);
});
