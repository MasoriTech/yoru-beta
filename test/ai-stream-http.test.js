'use strict';
// Teste de ponta a ponta: servidor HTTP de mentira que responde em SSE, lido com fetch de verdade.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const S = require('../src/ai-stream');

test('fetch + SSE + streamer entregam a primeira frase antes do fim', async () => {
  const parts = ['[happy] Que bom te ver ', 'por aqui hoje! ', 'Como foi o seu dia ', 'até agora? ', 'Conta tudo.'];
  const server = http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const t of parts) {
      res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: t } })}\n\n`);
      await new Promise((r) => setTimeout(r, 40));
    }
    res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  });
  await new Promise((r) => server.listen(0, r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/`);
    const events = [];
    const t0 = Date.now();
    let firstSentenceAt = 0;
    const st = S.createReplyStreamer((e) => {
      events.push(e);
      if (e.type === 'sentence' && !firstSentenceAt) firstSentenceAt = Date.now() - t0;
    });
    await S.readAnthropicStream(r.body, (d) => st.push(d));
    st.end();
    const total = Date.now() - t0;
    assert.ok(firstSentenceAt > 0 && firstSentenceAt < total - 60, `1ª frase em ${firstSentenceAt} ms, fim em ${total} ms`);
    assert.equal(events.at(-1).text, 'Que bom te ver por aqui hoje! Como foi o seu dia até agora? Conta tudo.');
  } finally { server.close(); }
});
