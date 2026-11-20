'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const CS = require('../src/criacao-service');
const CRIA = require('../src/criacao');
const AIC = require('../src/ai-core');

const PNG = 'data:image/png;base64,' + Buffer.from('imagem-falsa').toString('base64');
const headers = (type) => ({ get: (k) => (k.toLowerCase() === 'content-type' ? type : null) });
const json = (j, status = 200) => ({ ok: status < 400, status, json: async () => j, text: async () => JSON.stringify(j), headers: headers('application/json') });
const bytes = (type, str = 'bytes', status = 200) => ({ ok: status < 400, status, arrayBuffer: async () => Buffer.from(str), headers: headers(type), text: async () => '' });
const status = (n) => ({ ok: false, status: n, text: async () => '{}', headers: headers('text/plain') });

function make(over = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-cria-'));
  const calls = [], models = [];
  const cfg = AIC.normalizeConfig(over.cfg || {});
  const svc = CS.createCriaService({
    dataDir: () => dir,
    loadConfig: () => cfg,
    callModel: async (msgs, c, sys, max) => { models.push({ provider: c.provider, model: c.provider === 'openrouter' ? c.openrouter.model : null, max, sys, msgs }); return over.callModel ? over.callModel(c, models.length) : 'texto'; },
    fetch: async (url, init) => { calls.push({ url: String(url), init }); return over.fetch(String(url), init, calls.length); },
    cropToRatio: over.cropToRatio,
    wait: async () => {},
    now: over.now,
  });
  return { svc, dir, calls, models };
}
const orKey = { provider: 'anthropic', openrouter: { apiKey: 'k', model: 'x' } };

// ---------- texto ----------
test('criaLLM: modelo "chat" usa a IA da aba IA direto', async () => {
  const { svc, models } = make({ cfg: { provider: 'ollama' }, callModel: () => 'oi' });
  assert.equal(await svc.criaLLM([], 'S', 100, 'chat'), 'oi');
  assert.deepEqual(models.map((m) => m.provider), ['ollama']);
});

test('criaLLM: sem chave do OpenRouter: erro claro, ou IA local no automático', async () => {
  await assert.rejects(make({ cfg: { provider: 'anthropic' } }).svc.criaLLM([], 'S', 100, 'auto'), /pelo menos uma chave grátis/);
  const local = make({ cfg: { provider: 'custom', custom: { model: 'm' } }, callModel: () => 'local' });
  assert.equal(await local.svc.criaLLM([], 'S', 100, 'auto'), 'local');
  await assert.rejects(make({ cfg: { provider: 'ollama' } }).svc.criaLLM([], 'S', 100, CRIA.FREE_TEXT_ORDER[0]), /chave grátis/); // modelo fixo exige a chave
});

test('criaLLM automático: passa para o próximo modelo quando um falha', async () => {
  const { svc, models } = make({ cfg: orKey, callModel: (c, n) => { if (n < 3) throw new Error('fora do ar'); return 'ok'; } });
  assert.equal(await svc.criaLLM([], 'S', 100, 'auto'), 'ok');
  assert.deepEqual(models.map((m) => m.model), CRIA.autoTextModels(AIC.normalizeConfig(orKey)).slice(0, 3).map((m) => m.id));
});

test('criaLLM: chave inválida (401) para na hora, sem trocar de modelo', async () => {
  const { svc, models } = make({ cfg: orKey, callModel: () => { throw Object.assign(new Error('401'), { http: 401 }); } });
  await assert.rejects(svc.criaLLM([], 'S', 100, 'auto'), /401/);
  assert.equal(models.length, 1);
});

test('criaLLM: resposta vazia conta como falha e tenta o próximo', async () => {
  const { svc, models } = make({ cfg: orKey, callModel: (c, n) => (n === 1 ? '  ' : 'bom') });
  assert.equal(await svc.criaLLM([], 'S', 100, 'auto'), 'bom');
  assert.equal(models.length, 2);
});

test('criaLLM automático: depois da lista fixa, tenta os ":free" da lista viva (uma busca por hora)', async () => {
  let now = 1000;
  const { svc, models, calls } = make({
    cfg: orKey, now: () => now,
    callModel: (c) => { if (c.openrouter.model === 'novo/modelo:free') return 'achei'; throw new Error('nada'); },
    fetch: async () => json({ data: [{ id: 'novo/modelo:free', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } }] }),
  });
  const live = CRIA.pickFreeModels([{ id: 'novo/modelo:free', pricing: { prompt: '0', completion: '0' }, architecture: { output_modalities: ['text'] } }]);
  assert.ok(live.includes('novo/modelo:free'), 'a lista viva de teste precisa ser aceita por pickFreeModels');
  assert.equal(await svc.criaLLM([], 'S', 100, 'auto'), 'achei');
  assert.equal(models.length, CRIA.FREE_TEXT_ORDER.length + 1); // só há chave do OpenRouter: os 5 fixos + 1 da lista viva
  assert.equal(calls.length, 1);
  now += 1000; // dentro de 1 hora: usa o cache
  await svc.criaLLM([], 'S', 100, 'auto');
  assert.equal(calls.length, 1);
});

test('criaLLM: tudo falhando dá mensagem final com o último erro', async () => {
  const { svc } = make({ cfg: orKey, callModel: () => { throw new Error('limite'); }, fetch: async () => { throw new TypeError('sem rede'); } });
  await assert.rejects(svc.criaLLM([], 'S', 100, 'auto'), /Nenhum modelo gratuito respondeu.*limite/);
});

test('criaText / criaStoryboard / criaEnhance validam a entrada e usam os limites certos', async () => {
  const { svc, models } = make({ cfg: { provider: 'ollama' }, callModel: () => '1. Cena um\n2. Cena dois\n3. Cena três' });
  await assert.rejects(svc.criaText({ prompt: '  ' }), /Escreva o que/);
  await assert.rejects(svc.criaStoryboard({ idea: '' }), /Descreva a ideia/);
  assert.equal(await svc.criaText({ prompt: 'oi', textModel: 'chat' }), '1. Cena um\n2. Cena dois\n3. Cena três');
  assert.equal(models.at(-1).max, 1800);
  await svc.criaStoryboard({ idea: 'um gato', scenes: 3, textModel: 'chat' }).catch(() => {});
  assert.equal(models.at(-1).max, 1500);
  await svc.criaEnhance('gato', 'chat');
  assert.equal(models.at(-1).max, 300);
});

// ---------- imagem ----------
test('criaOneImage: sem prompt, sem chave e sem token dão erros claros', async () => {
  const none = make({ fetch: async () => { throw new Error('não deveria chamar a rede'); } });
  await assert.rejects(none.svc.criaOneImage({ prompt: '', model: 'cf-flux' }), /Escreva o que/);
  await assert.rejects(none.svc.criaOneImage({ prompt: 'gato', model: 'pollinations' }), /Pollinations deixou de ser grátis/);
  await assert.rejects(none.svc.criaOneImage({ prompt: 'gato', model: 'openrouter' }), /cole sua chave/);
  await assert.rejects(none.svc.criaOneImage({ prompt: 'gato', model: 'cf-sdxl' }), /ID da conta e o token/);
  assert.equal(none.calls.length, 0);
});

test('criaOneImage OpenRouter: aceita data URL de imagem, recusa resposta sem imagem', async () => {
  const good = make({ cfg: { openrouter: { apiKey: 'k' } }, fetch: async () => json({ choices: [{ message: { images: [{ image_url: { url: PNG } }] } }] }) });
  const r = await good.svc.criaOneImage({ prompt: 'gato', model: 'openrouter', seed: 7 });
  assert.equal(r.dataUrl, PNG); assert.equal(r.seed, 7);
  assert.equal(good.calls[0].init.headers.Authorization, 'Bearer k');
  const bad = make({ cfg: { openrouter: { apiKey: 'k' } }, fetch: async () => json({ choices: [{ message: { content: 'só texto' } }] }) });
  await assert.rejects(bad.svc.criaOneImage({ prompt: 'gato', model: 'openrouter' }), /não devolveu uma imagem/);
});

test('criaOneImage Pollinations: chave no cabeçalho (não na URL), tipo validado, nova tentativa quando ocupado', async () => {
  const seq = [status(429), bytes('image/png', 'png!')];
  const { svc, calls } = make({ cfg: { pollinations: { apiKey: 'segredo' } }, fetch: async () => seq.shift() });
  const r = await svc.criaOneImage({ prompt: 'gato', model: 'pollinations', seed: 1 });
  assert.match(r.dataUrl, /^data:image\/png;base64,/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer segredo');
  assert.ok(!calls[0].url.includes('segredo'));
  const html = make({ cfg: { pollinations: { apiKey: 'k' } }, fetch: async () => bytes('text/html') });
  await assert.rejects(html.svc.criaOneImage({ prompt: 'gato', model: 'pollinations' }), /não devolveu uma imagem/);
  for (const [code, re] of [[401, /recusou a chave/], [402, /Pollen/]]) {
    await assert.rejects(make({ cfg: { pollinations: { apiKey: 'k' } }, fetch: async () => status(code) }).svc.criaOneImage({ prompt: 'g', model: 'pollinations' }), re);
  }
});

test('criaOneImage Cloudflare: FLUX (json base64) é recortado no formato escolhido', async () => {
  const cropped = [];
  const { svc, calls } = make({
    cfg: { cloudflare: { accountId: 'acc', apiToken: 'tok' } },
    fetch: async () => json({ result: { image: Buffer.from('flux').toString('base64') }, success: true }),
    cropToRatio: (buf, ratio) => { cropped.push([buf.toString(), ratio.w, ratio.h]); return Buffer.from('recortado'); },
  });
  const r = await svc.criaOneImage({ prompt: 'gato', model: 'cf-flux', ratio: '16:9' });
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  assert.match(calls[0].url, /acc/);
  assert.equal(cropped.length, 1);
  assert.equal(cropped[0][0], 'flux');
  assert.equal(r.dataUrl, 'data:image/png;base64,' + Buffer.from('recortado').toString('base64'));
});

test('criaOneImage Cloudflare: quadrado não recorta; Stable Diffusion devolve a imagem direto', async () => {
  let cropCalls = 0;
  const flux = make({ cfg: { cloudflare: { accountId: 'a', apiToken: 't' } }, fetch: async () => json({ result: { image: Buffer.from('x').toString('base64') } }), cropToRatio: () => { cropCalls++; return null; } });
  const r1 = await flux.svc.criaOneImage({ prompt: 'g', model: 'cf-flux', ratio: '1:1' });
  assert.equal(cropCalls, 0);
  assert.match(r1.dataUrl, /^data:image\/jpeg;base64,/);
  const sd = make({ cfg: { cloudflare: { accountId: 'a', apiToken: 't' } }, fetch: async () => bytes('image/png', 'sd') });
  assert.match((await sd.svc.criaOneImage({ prompt: 'g', model: 'cf-sdxl' })).dataUrl, /^data:image\/png;base64,/);
});

test('criaOneImage Cloudflare: cota esgotada, token recusado e resposta sem imagem', async () => {
  const cfg = { cloudflare: { accountId: 'a', apiToken: 't' } };
  const err = (st, msg) => ({ ok: false, status: st, text: async () => JSON.stringify({ errors: [{ message: msg }] }), headers: headers('application/json') });
  await assert.rejects(make({ cfg, fetch: async () => err(429, 'you have used all neurons 4006') }).svc.criaOneImage({ prompt: 'g', model: 'cf-sdxl' }), /cota grátis de hoje/);
  await assert.rejects(make({ cfg, fetch: async () => err(403, 'forbidden') }).svc.criaOneImage({ prompt: 'g', model: 'cf-sdxl' }), /recusou o token/);
  await assert.rejects(make({ cfg, fetch: async () => json({ result: {} }) }).svc.criaOneImage({ prompt: 'g', model: 'cf-flux' }), /não devolveu uma imagem/);
  await assert.rejects(make({ cfg, fetch: async () => bytes('text/plain') }).svc.criaOneImage({ prompt: 'g', model: 'cf-sdxl' }), /não devolveu uma imagem/);
});

test('falha de rede vira mensagem amigável', async () => {
  const { svc } = make({ cfg: { cloudflare: { accountId: 'a', apiToken: 't' } }, fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(svc.criaOneImage({ prompt: 'g', model: 'cf-sdxl' }), /Não consegui conectar em a Cloudflare/);
});

// ---------- projetos em disco ----------
test('criaSave guarda imagem, texto e vídeo e lista do mais novo para o mais antigo', () => {
  const { svc, dir } = make({});
  const img = svc.criaSave({ type: 'image', data: PNG, prompt: 'gato', meta: { style: 'anime', seed: 5, extra: 'x', model: { a: 1 } } });
  assert.equal(img.type, 'image'); assert.equal(img.exists, true);
  assert.deepEqual(img.meta, { style: 'anime', seed: 5 }); // só chaves conhecidas e valores simples
  assert.match(img.fileUrl, /^file:/);
  const txt = svc.criaSave({ type: 'text', data: 'Era uma vez\n  um gato', title: 'Conto', prompt: 'p' });
  assert.equal(txt.preview, 'Era uma vez um gato');
  assert.equal(fs.readFileSync(path.join(dir, 'criacao', txt.file), 'utf8'), 'Era uma vez\n  um gato');
  const vid = svc.criaSave({ type: 'video', data: [1, 2, 3], poster: PNG, prompt: 'v' });
  assert.ok(vid.posterUrl);
  assert.deepEqual(svc.criaLoad().map((p) => p.type), ['video', 'text', 'image']);
});

test('criaSave recusa tipo inválido, imagem inválida, texto vazio e vídeo vazio', () => {
  const { svc } = make({});
  assert.throws(() => svc.criaSave({ type: 'audio' }), /Tipo de projeto inválido/);
  assert.throws(() => svc.criaSave({ type: 'image', data: 'nao-e-data-url' }), /Imagem inválida/);
  assert.throws(() => svc.criaSave({ type: 'text', data: '   ' }), /Não há texto/);
  assert.throws(() => svc.criaSave({ type: 'video', data: [] }), /vídeo está vazio/);
  assert.deepEqual(svc.criaLoad(), []);
});

test('criaPath nunca sai da pasta criacao', () => {
  const { svc, dir } = make({});
  const base = path.join(dir, 'criacao');
  for (const evil of ['../../etc/passwd', '..\\..\\x', '/etc/passwd', 'a/../../b']) {
    assert.equal(path.dirname(svc.criaPath(evil)), base, evil);
  }
  assert.equal(svc.criaPath(undefined), base);
});

test('criaLoad ignora índice quebrado ou entradas inválidas', () => {
  const { svc, dir } = make({});
  svc.criaDir();
  fs.writeFileSync(path.join(dir, 'criacao', 'projects.json'), '{quebrado');
  assert.deepEqual(svc.criaLoad(), []);
  fs.writeFileSync(path.join(dir, 'criacao', 'projects.json'), JSON.stringify([{ id: 'a', file: 'a.txt' }, null, { id: 5 }, { id: 'b' }]));
  assert.deepEqual(svc.criaLoad().map((p) => p.id), ['a']);
});

test('criaView marca arquivo que sumiu', () => {
  const { svc, dir } = make({});
  const p = svc.criaSave({ type: 'text', data: 'oi', prompt: 'p' });
  fs.unlinkSync(path.join(dir, 'criacao', p.file));
  assert.equal(svc.criaView(svc.criaLoad()[0]).exists, false);
});

test('asMsg extrai mensagem de erros e de textos', () => {
  assert.equal(CS.asMsg(new Error('x')), 'x');
  assert.equal(CS.asMsg('texto'), 'texto');
  assert.equal(CS.asMsg(null), 'null');
});

// ---------- vários serviços de texto grátis ----------
const callLog = [];
const multi = (cfg, fail = {}) => make({
  cfg, callModel: (c) => {
    callLog.push({ provider: c.provider, url: c.custom && c.custom.url, key: c.custom && c.custom.apiKey, model: c.provider === 'custom' ? c.custom.model : c.openrouter.model });
    const last = callLog.at(-1); const f = fail[last.model]; if (f) throw f; return 'resposta';
  },
});

test('criaLLM: Gemini, Groq e Cloudflare falam o formato da OpenAI pelo provedor "custom"', async () => {
  callLog.length = 0;
  const m = multi({ gemini: { apiKey: 'g-key' }, groq: { apiKey: 'q-key' }, cloudflare: { accountId: 'ACC1', apiToken: 'cf-tok' } });
  await m.svc.criaLLM([], 'S', 100, 'gemini:gemini-2.5-flash');
  await m.svc.criaLLM([], 'S', 100, 'groq:llama-3.3-70b-versatile');
  await m.svc.criaLLM([], 'S', 100, 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  assert.deepEqual(callLog.map((c) => [c.provider, c.url, c.key, c.model]), [
    ['custom', 'https://generativelanguage.googleapis.com/v1beta/openai', 'g-key', 'gemini-2.5-flash'],
    ['custom', 'https://api.groq.com/openai/v1', 'q-key', 'llama-3.3-70b-versatile'],
    ['custom', 'https://api.cloudflare.com/client/v4/accounts/ACC1/ai/v1', 'cf-tok', '@cf/meta/llama-3.3-70b-instruct-fp8-fast'],
  ]);
});

test('criaLLM: modelo fixo sem a chave dele dá o erro daquele serviço', async () => {
  const none = make({ callModel: () => { throw new Error('não deveria chamar'); } }).svc;
  await assert.rejects(none.criaLLM([], 'S', 10, 'gemini:gemini-2.5-flash'), /aistudio\.google\.com/);
  await assert.rejects(none.criaLLM([], 'S', 10, 'groq:llama-3.3-70b-versatile'), /console\.groq\.com/);
  await assert.rejects(none.criaLLM([], 'S', 10, 'cf:@cf/google/gemma-3-12b-it'), /ID da conta e o token/);
  await assert.rejects(make({ cfg: { cloudflare: { accountId: 'a' } } }).svc.criaLLM([], 'S', 10, 'cf:@cf/google/gemma-3-12b-it'), /ID da conta e o token/); // falta o token
});

test('criaLLM automático: só usa serviços com chave, na ordem; um serviço cai e o próximo responde', async () => {
  callLog.length = 0;
  const m = multi({ gemini: { apiKey: 'g' }, groq: { apiKey: 'q' } }, { 'gemini-2.5-flash': new Error('limite') });
  assert.equal(await m.svc.criaLLM([], 'S', 10, 'auto'), 'resposta');
  assert.deepEqual(callLog.map((c) => c.model), ['gemini-2.5-flash', 'llama-3.3-70b-versatile']); // sem chave da Cloudflare/OpenRouter, ninguém mais é tentado
});

test('criaLLM automático: chave recusada (401) de um serviço pula o resto dele, mas não os outros', async () => {
  callLog.length = 0;
  const bad = Object.assign(new Error('401'), { http: 401 });
  const m = multi({ gemini: { apiKey: 'ruim' }, groq: { apiKey: 'q' } }, { 'gemini-2.5-flash': bad, 'gemini-2.5-flash-lite': bad });
  assert.equal(await m.svc.criaLLM([], 'S', 10, 'auto'), 'resposta');
  assert.equal(callLog.filter((c) => /gemini/.test(c.model)).length, 1); // o 2º modelo do Gemini nem foi tentado
  // modelo fixo com chave recusada: erro direto
  await assert.rejects(multi({ gemini: { apiKey: 'ruim' } }, { 'gemini-2.5-flash': bad }).svc.criaLLM([], 'S', 10, 'gemini:gemini-2.5-flash'), /401/);
});

test('criaLLM: o raciocínio <think> de alguns modelos não vai para o texto', async () => {
  const m = make({ cfg: { groq: { apiKey: 'q' } }, callModel: () => '<think>pensando...</think>\nOlá!' });
  assert.equal(await m.svc.criaLLM([], 'S', 10, 'groq:qwen/qwen3-32b'), 'Olá!');
});

test('criaText: o tamanho define o limite de resposta e o idioma entra na instrução', async () => {
  const sys = [];
  const m = make({ cfg: { provider: 'ollama' }, callModel: (c) => 'ok' });
  const svc = CS.createCriaService({ dataDir: () => m.dir, loadConfig: () => AIC.normalizeConfig({ provider: 'ollama' }), callModel: async (msgs, c, system, max) => { sys.push({ system, max }); return 'ok'; } });
  await svc.criaText({ prompt: 'oi', textModel: 'chat', size: 'enorme', lang: 'en' });
  assert.equal(sys[0].max, CRIA.maxTokensFor('enorme')); assert.match(sys[0].system, /Responda em inglês/);
  await svc.criaText({ prompt: 'oi', textModel: 'chat', size: 'mini' });
  assert.ok(sys[1].max < sys[0].max);
});

// ---------- prompt negativo ----------
test('prompt negativo: vai para SDXL/DreamShaper, não para o FLUX, e vira "Avoid" no OpenRouter', async () => {
  const bodies = [];
  const cf = make({ cfg: { cloudflare: { accountId: 'a', apiToken: 't' } }, fetch: async (u, init) => { bodies.push(JSON.parse(init.body)); return bytes('image/png', 'png'); } });
  await cf.svc.criaOneImage({ prompt: 'gato', model: 'cf-sdxl', negative: '  borrado,   texto ' });
  await cf.svc.criaOneImage({ prompt: 'gato', model: 'cf-sdxl-base', negative: 'feio' });
  await cf.svc.criaOneImage({ prompt: 'gato', model: 'cf-sdxl' });
  assert.equal(bodies[0].negative_prompt, 'borrado, texto'); assert.equal(bodies[1].negative_prompt, 'feio'); assert.equal(bodies[2].negative_prompt, undefined);
  const flux = make({ cfg: { cloudflare: { accountId: 'a', apiToken: 't' } }, fetch: async (u, init) => { bodies.push(JSON.parse(init.body)); return json({ result: { image: Buffer.from('x').toString('base64') } }); } });
  await flux.svc.criaOneImage({ prompt: 'gato', model: 'cf-flux', ratio: '1:1', negative: 'feio' });
  assert.equal(bodies.at(-1).negative_prompt, undefined);
  const or = make({ cfg: { openrouter: { apiKey: 'k' } }, fetch: async (u, init) => { bodies.push(JSON.parse(init.body)); return json({ choices: [{ message: { images: [{ image_url: { url: PNG } }] } }] }); } });
  await or.svc.criaOneImage({ prompt: 'gato', model: 'openrouter', negative: 'texto' });
  assert.match(bodies.at(-1).messages[0].content, /Avoid: texto/);
});

test('vídeo: até 10 cenas e os novos campos de movimento e transição vão para os metadados do projeto', () => {
  const m = make();
  const p = m.svc.criaSave({ type: 'image', data: PNG, prompt: 'x', meta: { negative: 'feio', lang: 'en', motion: 'pan', fade: 1, lixo: 'nao' } });
  assert.deepEqual(p.meta, { negative: 'feio', lang: 'en', motion: 'pan', fade: 1 });
});

// ---------- SVG e HTML ----------
const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#ff7a2e"/><text x="5" y="95">Tom & Jerry</text></svg>';
const fence = (lang, code) => `Claro!\n\`\`\`${lang}\n${code}\n\`\`\`\nPronto.`;

test('criaCode SVG: pede o formato certo, tira o código da resposta e limpa (sem script, & corrigido)', async () => {
  const dirty = SVG_OK.replace('<circle', '<script>alert(1)</script><circle onclick="x()"');
  const { svc, models } = make({ cfg: orKey, callModel: () => fence('svg', dirty) });
  const r = await svc.criaCode({ type: 'svg', prompt: 'um sol', kind: 'icone', palette: 'neon', ratio: '16:9' });
  assert.ok(r.code.startsWith('<svg')); assert.ok(r.code.endsWith('</svg>'));
  assert.ok(!/<script|onclick/i.test(r.code)); assert.match(r.code, /Tom &amp; Jerry/);
  assert.match(models[0].sys, /viewBox="0 0 1280 720"/); assert.match(models[0].sys, /icon/i); assert.match(models[0].sys, /neon/i);
  assert.equal(models[0].max, CRIA.codeMaxTokens('svg')); assert.equal(models[0].msgs[0].content, 'um sol');
});

test('criaCode HTML: devolve o código como a IA escreveu (a CSP entra ao salvar/abrir)', async () => {
  const html = '<!DOCTYPE html><html><head><title>Oi</title></head><body><h1>Oi</h1></body></html>';
  const { svc, models } = make({ cfg: orKey, callModel: () => fence('html', html) });
  const r = await svc.criaCode({ type: 'html', prompt: 'uma página', kind: 'cartao' });
  assert.equal(r.code, html);
  assert.match(models[0].sys, /self-contained HTML/); assert.match(models[0].sys, /business card/); assert.equal(models[0].max, CRIA.codeMaxTokens('html'));
});

test('criaCode: ajuste manda o código atual junto; pedido vazio, resposta sem código e SVG cortado dão erro claro', async () => {
  const { svc, models } = make({ cfg: orKey, callModel: () => fence('svg', SVG_OK) });
  await svc.criaCode({ type: 'svg', prompt: 'deixe o círculo azul', current: SVG_OK });
  assert.match(models[0].msgs[0].content, /current SVG code/); assert.ok(models[0].msgs[0].content.includes(SVG_OK)); assert.match(models[0].msgs[0].content, /deixe o círculo azul/);
  await assert.rejects(svc.criaCode({ type: 'svg', prompt: '   ' }), /Descreva o SVG/);
  await assert.rejects(svc.criaCode({ type: 'html', prompt: '' }), /Descreva a página HTML/);
  await assert.rejects(make({ cfg: orKey, callModel: () => 'Desculpe, não consigo desenhar isso.' }).svc.criaCode({ type: 'svg', prompt: 'x' }), /código que eu consiga usar/);
  await assert.rejects(make({ cfg: orKey, callModel: () => '```svg\n<svg viewBox="0 0 9 9"><rect width="9"' }).svc.criaCode({ type: 'svg', prompt: 'x' }), /veio cortada/);
});

test('criaSave SVG/HTML: arquivo limpo na pasta, título e miniatura, e nada inválido entra', () => {
  const { svc, dir } = make();
  const s = svc.criaSave({ type: 'svg', data: SVG_OK.replace('<circle', '<script>x</script><circle'), prompt: 'um sol laranja', meta: { kind: 'icone', palette: 'neon', ratio: '1:1', model: 'x'.repeat(200) } });
  assert.equal(s.type, 'svg'); assert.match(s.file, /\.svg$/); assert.equal(s.exists, true); assert.equal(s.title, 'um sol laranja'); assert.equal(s.meta.palette, 'neon'); assert.equal(s.meta.model.length, 80);
  const svgText = fs.readFileSync(path.join(dir, 'criacao', s.file), 'utf8');
  assert.ok(!/<script/i.test(svgText)); assert.match(svgText, /Tom &amp; Jerry/);
  const h = svc.criaSave({ type: 'html', data: '<html><head><title>Meu cartão</title></head><body><h1>Oi</h1><script>1</script></body></html>', prompt: 'um cartão' });
  assert.equal(h.title, 'Meu cartão'); assert.equal(h.preview, 'Meu cartão'); assert.match(h.file, /\.html$/);
  const htmlText = fs.readFileSync(path.join(dir, 'criacao', h.file), 'utf8');
  assert.match(htmlText, /Content-Security-Policy/); assert.match(htmlText, /default-src 'none'/); assert.match(htmlText, /<script>1<\/script>/); // scripts embutidos seguem funcionando
  assert.throws(() => svc.criaSave({ type: 'svg', data: 'oi' }), /SVG inválido/);
  assert.throws(() => svc.criaSave({ type: 'html', data: '   ' }), /Não há HTML/);
  assert.deepEqual(svc.criaLoad().map((p) => p.type).sort(), ['html', 'svg']);
});

test('criaPreviewFile: arquivo temporário seguro que não vira projeto', () => {
  const { svc, dir } = make();
  const f = svc.criaPreviewFile({ type: 'html', code: '<h1>Oi</h1>' });
  assert.equal(path.basename(f), '_previa.html'); assert.equal(path.dirname(f), path.join(dir, 'criacao'));
  const t = fs.readFileSync(f, 'utf8'); assert.match(t, /^<!DOCTYPE html>/); assert.match(t, /default-src 'none'/); assert.match(t, /<h1>Oi<\/h1>/);
  const g = svc.criaPreviewFile({ type: 'svg', code: '<svg onload="x()"><rect/></svg>' });
  assert.ok(!/onload/.test(fs.readFileSync(g, 'utf8'))); assert.equal(svc.criaLoad().length, 0);
  assert.throws(() => svc.criaPreviewFile({ type: 'svg', code: 'nada' }), /Não há SVG/);
});
