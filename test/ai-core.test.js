'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AIC = require('../src/ai-core');

// ---------- ajudantes ----------
const CFG = AIC.normalizeConfig({ provider: 'custom', custom: { url: 'http://local/v1', model: 'm' } });
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const delta = (t) => sse({ choices: [{ delta: { content: t } }] });

// corpo de streaming: cada item é um pedaço (string) ou { wait: ms } para simular silêncio
function body(parts) {
  return (async function* () {
    for (const p of parts) {
      if (typeof p === 'object') await new Promise((r) => setTimeout(r, p.wait));
      else yield p;
    }
  })();
}
const okStream = (parts) => ({ ok: true, status: 200, body: body(parts) });
const okJson = (j) => ({ ok: true, status: 200, json: async () => j });
const openaiJson = (t) => okJson({ choices: [{ message: { content: t } }] });
const httpErr = (status, message) => ({ ok: false, status, text: async () => JSON.stringify({ error: { message } }) });

function make(over = {}) {
  const calls = [];
  const events = [];
  const tags = [];
  let persisted = 0;
  const settings = { historyLimit: 20, maxTokens: 400, streamReplies: true, convSpeak: false, ...(over.settings || {}) };
  const ai = AIC.createAI({
    getSettings: () => settings,
    loadConfig: () => CFG,
    buildSystem: () => 'SYS',
    canStream: () => true,
    emitStream: (e) => events.push(e),
    persist: () => { persisted++; },
    onTags: (pr) => tags.push(pr),
    fetch: async (url, init) => {
      const req = { url, body: JSON.parse(init.body), signal: init.signal };
      calls.push(req);
      return over.fetch(req, calls.length);
    },
    ...(over.deps || {}),
  });
  return { ai, calls, events, tags, settings, persisted: () => persisted };
}
const roles = (ai) => ai.getHistory().map((m) => m.role);
const texts = (ai) => ai.getHistory().map((m) => m.content);

// ---------- fila: conversa cruzada ----------
test('duas perguntas ao mesmo tempo não se misturam: a 2ª só começa depois da 1ª', async () => {
  const order = [];
  const { ai } = make({
    fetch: async (req) => {
      const q = req.body.messages.at(-1).content;
      order.push(`inicio ${q}`);
      await new Promise((r) => setTimeout(r, q === 'primeira' ? 40 : 1)); // a 1ª demora mais
      order.push(`fim ${q}`);
      return okStream([delta(`[happy] resp ${q}`)]);
    },
  });
  const [a, b] = await Promise.all([ai.askAI('primeira'), ai.askAI('segunda')]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.deepEqual(order, ['inicio primeira', 'fim primeira', 'inicio segunda', 'fim segunda']);
  assert.deepEqual(roles(ai), ['user', 'assistant', 'user', 'assistant']); // alternância intacta
  assert.match(texts(ai)[1], /primeira/);
  assert.match(texts(ai)[3], /segunda/);
});

test('a 2ª pergunta já enxerga a resposta da 1ª no contexto enviado', async () => {
  const { ai, calls } = make({ fetch: async (req, n) => okStream([delta(`[happy] r${n}`)]) });
  await Promise.all([ai.askAI('p1'), ai.askAI('p2')]);
  const sent = calls[1].body.messages.filter((m) => m.role !== 'system').map((m) => m.content);
  assert.deepEqual(sent, ['p1', '[happy] r1', 'p2']);
});

test('remember() espera a resposta em andamento e não quebra a ordem pergunta/resposta', async () => {
  const { ai } = make({
    fetch: async () => { await new Promise((r) => setTimeout(r, 30)); return okStream([delta('[happy] oi')]); },
  });
  const p = ai.askAI('pergunta');
  ai.remember('que horas são?', 'São 10h.'); // chega "no meio" da resposta
  await p; await ai.idle();
  assert.deepEqual(texts(ai), ['pergunta', '[happy] oi', 'que horas são?', 'São 10h.']);
  assert.deepEqual(roles(ai), ['user', 'assistant', 'user', 'assistant']);
});

test('pergunta que falhou sai do histórico e a fila continua funcionando', async () => {
  const { ai } = make({
    fetch: async (req, n) => (n === 1 ? httpErr(401, 'chave ruim') : okStream([delta('[happy] certo')])),
  });
  const [a, b] = await Promise.all([ai.askAI('vai falhar'), ai.askAI('vai dar certo')]);
  assert.equal(a.ok, false);
  assert.match(a.text, /401.*chave inválida/);
  assert.equal(b.ok, true);
  assert.deepEqual(texts(ai), ['vai dar certo', '[happy] certo']); // só a que falhou foi removida
});

test('erro HTTP no streaming não tenta de novo no modo normal', async () => {
  const { ai, calls } = make({ fetch: async () => httpErr(402, 'sem saldo') });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, false);
  assert.match(r.text, /sem créditos/);
  assert.equal(calls.length, 1);
  assert.deepEqual(ai.getHistory(), []);
});

// ---------- timeout ----------
test('timeout vale para silêncio: resposta longa e lenta, com pedaços chegando, não é cortada', async () => {
  const { ai } = make({
    deps: { loadConfig: () => AIC.normalizeConfig({ provider: 'ollama' }) },
    fetch: async () => okStream([
      JSON.stringify({ message: { content: '[happy] Um ' } }) + '\n', { wait: 30 },
      JSON.stringify({ message: { content: 'dois ' } }) + '\n', { wait: 30 },
      JSON.stringify({ message: { content: 'três.' }, done: true }) + '\n',
    ]),
  });
  const r = await ai.askAI('conta');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Um dois três.');
});

test('streamModel: o relógio reinicia a cada pedaço (não é limite total)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const gates = [];
  const pause = (signal) => new Promise((res, rej) => {
    gates.push(res);
    signal.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError')));
  });
  const { ai } = make({
    fetch: async (req) => ({
      ok: true, status: 200,
      body: (async function* () {
        yield delta('a');               // t = 0
        await pause(req.signal);        // silêncio 1
        yield delta('b');               // t = 100 s: o relógio recomeça aqui
        await pause(req.signal);        // silêncio 2
        yield delta('c');
        yield 'data: [DONE]\n\n';
      })(),
    }),
  });
  const tick = async (ms) => { await new Promise((r) => setImmediate(r)); t.mock.timers.tick(ms); await new Promise((r) => setImmediate(r)); };
  const got = [];
  const p = ai.streamModel([{ role: 'user', content: 'oi' }], CFG, 'SYS', (d) => got.push(d));
  await tick(100000);  // 100 s sem nada (limite do provedor: 120 s)
  gates[0]();
  await tick(100000);  // passaram 200 s no total, mas só 100 s desde o último pedaço
  gates[1]();
  assert.equal(await p, 'abc');
  assert.deepEqual(got, ['a', 'b', 'c']);
});

test('streamModel: silêncio maior que o limite vira "Tempo esgotado"', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { ai } = make({
    fetch: async (req) => ({
      ok: true, status: 200,
      body: (async function* () { // nunca entrega nada; só termina se o pedido for abortado
        await new Promise((_, rej) => req.signal.addEventListener('abort', () => rej(new DOMException('abort', 'AbortError'))));
        yield '';
      })(),
    }),
  });
  const p = ai.streamModel([{ role: 'user', content: 'oi' }], CFG, 'SYS', () => {});
  await new Promise((r) => setImmediate(r));
  t.mock.timers.tick(120001); // limite do provedor "custom"
  await assert.rejects(p, /Tempo esgotado/);
});

test('callModel: TimeoutError e falha de rede viram mensagens amigáveis', async () => {
  const mk = (err) => make({ fetch: async () => { throw err; } }).ai;
  const timeout = Object.assign(new Error('t'), { name: 'TimeoutError' });
  await assert.rejects(mk(timeout).callModel([{ role: 'user', content: 'x' }], CFG, 'S'), /Tempo esgotado/);
  await assert.rejects(mk(new TypeError('fetch failed')).callModel([{ role: 'user', content: 'x' }], CFG, 'S'), /Não consegui conectar em http:\/\/local\/v1/);
});

// ---------- resposta só com tags ----------
test('resposta só com tags ([lembrar:]) não vira erro: vira "Pronto!" e a ação é aplicada', async () => {
  const { ai, tags } = make({ fetch: async () => okStream([delta('[lembrar: gosta de café]')]) });
  const r = await ai.askAI('meu gosto é café');
  assert.equal(r.ok, true);
  assert.equal(r.text, 'Pronto!');
  assert.deepEqual(r.remember, ['gosta de café']);
  assert.equal(r.streamed, false); // nada visível foi mostrado/falado
  assert.deepEqual(tags[0].remember, ['gosta de café']);
  assert.equal(ai.getHistory().length, 2);
});

test('resposta só com [app:...] também aplica a ação', async () => {
  const { ai, tags } = make({ fetch: async () => okStream([delta('[happy] [app:tema=oceano]')]) });
  const r = await ai.askAI('muda o tema');
  assert.equal(r.ok, true);
  assert.deepEqual(tags[0].actions, [{ kind: 'tema', value: 'oceano' }]);
});

test('resposta realmente vazia dá erro e não deixa lixo no histórico', async () => {
  const { ai } = make({ fetch: async () => okStream([]) });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, false);
  assert.match(r.text, /resposta vazia/);
  assert.deepEqual(ai.getHistory(), []);
});

test('erro ao aplicar as tags não derruba a resposta já guardada', async () => {
  const { ai } = make({
    fetch: async () => okStream([delta('[happy] oi')]),
    deps: { onTags: () => { throw new Error('boom'); } },
  });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, true);
  assert.deepEqual(roles(ai), ['user', 'assistant']);
});

// ---------- streaming ----------
test('streaming emite start/frases/end e marca streamed', async () => {
  const { ai, events } = make({
    settings: { convSpeak: true },
    fetch: async () => okStream([delta('[happy] Que bom te ver por aqui hoje! '), delta('Como foi o seu dia?')]),
  });
  const r = await ai.askAI('oi', { voice: true });
  assert.equal(r.streamed, true);
  assert.equal(events[0].type, 'start');
  assert.equal(events.at(-1).type, 'end');
  assert.ok(events.every((e) => e.speak === true)); // conversa por voz + convSpeak
});

test('streaming que cai no meio aproveita o texto que já chegou', async () => {
  const { ai } = make({
    fetch: async () => ({
      ok: true, status: 200,
      body: (async function* () { yield delta('[happy] Começo da resposta'); throw new TypeError('fetch failed'); })(),
    }),
  });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, true);
  assert.equal(r.streamed, true);
  assert.match(r.text, /Começo da resposta/);
});

test('servidor sem streaming: cai para o modo normal', async () => {
  const { ai, calls } = make({
    fetch: async (req) => (req.body.stream ? { ok: true, status: 200, body: null } : openaiJson('[happy] modo normal')),
  });
  const r = await ai.askAI('oi');
  assert.equal(r.ok, true);
  assert.equal(r.streamed, false);
  assert.equal(r.text, 'modo normal');
  assert.deepEqual(calls.map((c) => c.body.stream), [true, false]);
});

test('streamReplies desligado ou sem janela: usa direto o modo normal', async () => {
  for (const m of [make({ settings: { streamReplies: false }, fetch: async () => openaiJson('[happy] a') }),
                   make({ deps: { canStream: () => false }, fetch: async () => openaiJson('[happy] a') })]) {
    const r = await m.ai.askAI('oi');
    assert.equal(r.ok, true);
    assert.equal(m.calls.length, 1);
    assert.equal(m.calls[0].body.stream, false);
    assert.deepEqual(m.events, []);
  }
});

// ---------- histórico ----------
test('falha com outra troca no histórico remove a pergunta certa, não a última', async () => {
  let ai;
  ({ ai } = make({
    fetch: async () => {
      ai.getHistory().push({ role: 'user', content: 'entrou no meio' }); // outra troca entra enquanto a chamada está no ar
      throw Object.assign(new Error('x'), { http: 500 }); // erro HTTP: não cai para o modo normal
    },
  }));
  const r = await ai.askAI('vai falhar');
  assert.equal(r.ok, false);
  assert.deepEqual(texts(ai), ['entrou no meio']); // só "vai falhar" saiu
});

test('histórico respeita o limite e sempre começa numa pergunta', async () => {
  const { ai } = make({ settings: { historyLimit: 4 }, fetch: async () => okStream([delta('[happy] ok')]) });
  for (let i = 0; i < 5; i++) await ai.askAI(`p${i}`);
  assert.equal(ai.getHistory().length, 4);
  assert.equal(ai.getHistory()[0].role, 'user');
  assert.equal(ai.getHistory()[0].content, 'p3');
});

test('opts.hint vai só nesta chamada e não fica no histórico', async () => {
  const { ai, calls } = make({ fetch: async () => okStream([delta('[happy] ok')]) });
  await ai.askAI('notícias?', { hint: 'MANCHETES: x' });
  assert.match(calls[0].body.messages.at(-1).content, /MANCHETES: x/);
  assert.equal(ai.getHistory()[0].content, 'notícias?');
});

test('conversa por voz: manda menos contexto e menos tokens', async () => {
  const { ai, calls } = make({ settings: { maxTokens: 1000 }, fetch: async () => okStream([delta('[happy] ok')]) });
  for (let i = 0; i < 8; i++) await ai.askAI(`p${i}`);
  await ai.askAI('por voz', { voice: true });
  const last = calls.at(-1).body;
  assert.ok(last.messages.filter((m) => m.role !== 'system').length <= 10);
  assert.ok(last.max_tokens <= 260);
  assert.match(last.messages[0].content, /conversando por voz/);
});

test('setHistory descarta lixo, mensagens fora de ordem e pergunta sem resposta; clearHistory zera', () => {
  const { ai } = make({ fetch: async () => null });
  ai.setHistory([
    { role: 'assistant', content: 'solta' }, null, { role: 'user', content: 5 },
    { role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }, { role: 'user', content: 'sem resposta' },
  ]);
  assert.deepEqual(texts(ai), ['a', 'b']);
  ai.clearHistory();
  assert.deepEqual(ai.getHistory(), []);
});

test('persist é chamado quando o histórico muda', async () => {
  const m = make({ fetch: async () => okStream([delta('[happy] ok')]) });
  await m.ai.askAI('oi');
  m.ai.remember('a', 'b'); await m.ai.idle();
  assert.equal(m.persisted(), 2);
});

// ---------- provedores ----------
test('buildRequest monta o pedido certo de cada provedor', () => {
  const msgs = [{ role: 'user', content: 'oi' }];
  const c = (o) => AIC.normalizeConfig(o);
  const a = AIC.buildRequest(c({ provider: 'anthropic', anthropic: { apiKey: 'k' } }), msgs, 'SYS', true, 100);
  assert.equal(a.kind, 'anthropic');
  assert.equal(a.headers['x-api-key'], 'k');
  assert.deepEqual(a.body.system, [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral' } }]); // prompt fixo em cache
  const at = AIC.buildRequest(c({ provider: 'anthropic', anthropic: { apiKey: 'k' } }), msgs, 'SYS', true, 100, '\n\nAgora são 10:00.');
  assert.equal(at.body.system.length, 2);
  assert.ok(at.body.system[0].cache_control && !at.body.system[1].cache_control, 'a parte que muda a cada pedido fica fora do cache');
  assert.deepEqual(a.body.messages, msgs);

  const o = AIC.buildRequest(c({ provider: 'openrouter', openrouter: { apiKey: 'k' } }), msgs, 'SYS', false, 100);
  assert.equal(o.kind, 'openai');
  assert.equal(o.headers.Authorization, 'Bearer k');
  assert.equal(o.body.messages[0].role, 'system');

  const l = AIC.buildRequest(c({ provider: 'ollama', ollama: { url: 'http://h:1/' } }), msgs, 'SYS', true, 100);
  assert.equal(l.url, 'http://h:1/api/chat');
  assert.equal(l.body.options.num_predict, 100);

  const u = AIC.buildRequest(c({ provider: 'custom', custom: { url: 'http://h/v1/', model: 'x' } }), msgs, 'SYS', true, 100);
  assert.equal(u.url, 'http://h/v1/chat/completions');
  assert.equal(u.headers.Authorization, undefined);
});

test('buildRequest avisa quando falta chave ou modelo', () => {
  const msgs = [];
  assert.throws(() => AIC.buildRequest(AIC.normalizeConfig({ provider: 'anthropic' }), msgs, 's', false, 1), /chave de API/);
  assert.throws(() => AIC.buildRequest(AIC.normalizeConfig({ provider: 'anthropic', anthropic: { apiKey: 'COLE_SUA_CHAVE_AQUI' } }), msgs, 's', false, 1), /chave de API/);
  assert.throws(() => AIC.buildRequest(AIC.normalizeConfig({ provider: 'openrouter' }), msgs, 's', false, 1), /OpenRouter/);
  assert.throws(() => AIC.buildRequest(AIC.normalizeConfig({ provider: 'custom' }), msgs, 's', false, 1), /nome do modelo/);
});

test('trocar de provedor entre duas perguntas muda o endereço usado', async () => {
  let cfg = AIC.normalizeConfig({ provider: 'custom', custom: { url: 'http://a/v1', model: 'x' } });
  const { ai, calls } = make({
    deps: { loadConfig: () => cfg },
    fetch: async () => okStream([delta('[happy] ok')]),
  });
  await ai.askAI('1');
  cfg = AIC.normalizeConfig({ provider: 'openrouter', openrouter: { apiKey: 'k' } });
  await ai.askAI('2');
  assert.match(calls[0].url, /^http:\/\/a\/v1/);
  assert.match(calls[1].url, /openrouter\.ai/);
});

test('normalizeConfig: provedor inválido volta ao padrão e modelo apagado volta ao modelo padrão', () => {
  const c = AIC.normalizeConfig({ provider: 'xyz', anthropic: { model: '  ' }, ollama: { model: '' } });
  assert.equal(c.provider, 'kobold');
  assert.equal(c.anthropic.model, AIC.CONFIG_DEFAULT.anthropic.model);
  assert.equal(c.ollama.model, AIC.CONFIG_DEFAULT.ollama.model);
  assert.equal(AIC.normalizeConfig(null).provider, 'kobold');
});

test('mídia anexada é montada na última mensagem só nesta chamada', async () => {
  const { ai, calls } = make({
    deps: { mediaMessage: (prov, content, media) => ({ role: 'user', content: `${content} +${media.length}img(${prov})` }) },
    fetch: async () => okStream([delta('[happy] vi')]),
  });
  await ai.askAI('olha', { attach: { text: '\n[arq]', media: [{}] } });
  assert.equal(calls[0].body.messages.at(-1).content, 'olha\n[arq] +1img(custom)');
  assert.equal(ai.getHistory()[0].content, 'olha\n[arq]'); // histórico sem a mídia
});

test('listModels lê o formato de cada provedor e avisa quando vem vazio', async () => {
  const fetchOk = (j) => async () => okJson(j);
  assert.deepEqual(await AIC.listModels({ provider: 'ollama' }, CFG, fetchOk({ models: [{ name: 'b' }, { name: 'a' }] })), ['a', 'b']);
  assert.deepEqual(await AIC.listModels({ provider: 'custom' }, CFG, fetchOk({ models: [{ name: 'z' }] })), ['z']);
  await assert.rejects(AIC.listModels({ provider: 'openrouter' }, CFG, fetchOk({ data: [] })), /nenhum modelo/);
  await assert.rejects(AIC.listModels({ provider: 'anthropic' }, CFG, fetchOk({})), /Cole a chave/);
});


test('askAI propaga cancelamento ao streaming e não inicia chamada de fallback', async () => {
  let announceStarted; const started = new Promise((resolve) => { announceStarted = resolve; });
  const { ai, calls } = make({ fetch: async (req) => {
    announceStarted();
    return new Promise((_resolve, reject) => {
      const abort = () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); };
      if (req.signal.aborted) abort(); else req.signal.addEventListener('abort', abort, { once: true });
    });
  } });
  const controller = new AbortController();
  const running = ai.askAI('tarefa cancelável', { signal: controller.signal });
  await started;
  controller.abort();
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(roles(ai), []);
});

test('KoboldCpp: é o cérebro padrão, fala o formato OpenAI e não exige chave nem nome de modelo', () => {
  assert.equal(AIC.CONFIG_DEFAULT.provider, 'kobold');
  assert.ok(AIC.PROVIDERS.includes('kobold'));
  const cfg = AIC.normalizeConfig({ provider: 'kobold', kobold: { model: '   ' } });
  assert.equal(cfg.kobold.model, 'koboldcpp', 'nome do modelo apagado volta ao padrão');
  const msgs = [{ role: 'user', content: 'oi' }];
  const r = AIC.buildRequest(cfg, msgs, 'SYS', true, 100, '\n\nAgora.');
  assert.equal(r.kind, 'openai'); assert.equal(r.label, 'KoboldCpp');
  assert.equal(r.url, 'http://localhost:5001/v1/chat/completions');
  assert.equal(r.headers.Authorization, undefined, 'sem chave, sem cabeçalho de autorização');
  assert.equal(r.body.model, 'koboldcpp'); assert.equal(r.body.max_tokens, 100); assert.equal(r.body.stream, true);
  assert.deepEqual(r.body.messages[0], { role: 'system', content: 'SYS\n\nAgora.' });
  assert.ok(r.ms >= 120000, 'modelo local pode demorar para começar a responder');
  const k = AIC.buildRequest(AIC.normalizeConfig({ provider: 'kobold', kobold: { url: 'http://h:5002/v1/', apiKey: 'segredo' } }), msgs, 's', false, 5);
  assert.equal(k.url, 'http://h:5002/v1/chat/completions'); assert.equal(k.headers.Authorization, 'Bearer segredo');
  assert.throws(() => AIC.buildRequest(AIC.normalizeConfig({ provider: 'kobold', kobold: { url: '' } }), msgs, 's', false, 1), /KoboldCpp/);
});

test('KoboldCpp: Buscar lista o modelo carregado (formato /v1/models)', async () => {
  const cfg = AIC.normalizeConfig({ provider: 'kobold' });
  const seen = [];
  const f = async (url, o) => { seen.push([url, o.headers]); return { ok: true, json: async () => ({ data: [{ id: 'koboldcpp/Llama-3-8B' }] }) }; };
  assert.deepEqual(await AIC.listModels({ provider: 'kobold' }, cfg, f), ['koboldcpp/Llama-3-8B']);
  assert.equal(seen[0][0], 'http://localhost:5001/v1/models');
});
