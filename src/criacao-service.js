'use strict';
// Aba Criação: gera imagens, textos, SVG e HTML (OpenRouter, Cloudflare, Pollinations, Gemini, Groq) e guarda os projetos na pasta "criacao".
// Sem Electron: a pasta de dados, a config, a IA do chat, o fetch e o recorte de imagem chegam por parâmetro.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const CRIA = require('./criacao');
const { httpFail, friendlyNetError, realKey } = require('./ai-core');
const OR = require('./openrouter');

const asMsg = (e) => String((e && e.message) || e);

/**
 * dataDir()                 -> pasta de dados do app
 * loadConfig()              -> config da IA (chaves e provedor)
 * callModel(msgs,cfg,sys,n) -> chamada de texto da IA do chat (ai-core)
 * cropToRatio(buf, ratio)   -> Buffer PNG recortado ao centro no formato pedido, ou null (só o app tem nativeImage)
 */
function createCriaService({ dataDir, loadConfig, callModel, fetch: fetchImpl = globalThis.fetch, cropToRatio = () => null, now = () => Date.now(), wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const criaDir = () => { const d = path.join(dataDir(), 'criacao'); fs.mkdirSync(d, { recursive: true }); return d; };
  const criaIndexFile = () => path.join(criaDir(), 'projects.json');
  function criaLoad() {
    try { const j = JSON.parse(fs.readFileSync(criaIndexFile(), 'utf8')); return Array.isArray(j) ? j.filter((p) => p && typeof p.id === 'string' && typeof p.file === 'string') : []; } catch (_) { return []; }
  }
  function criaStore(list) { const f = criaIndexFile(); const tmp = f + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(list, null, 1)); fs.renameSync(tmp, f); }
  const criaPath = (name) => path.join(criaDir(), path.basename(String(name || ''))); // nunca sai da pasta
  function criaView(p) {
    const exists = fs.existsSync(criaPath(p.file));
    return { ...p, exists, fileUrl: pathToFileURL(criaPath(p.file)).href, posterUrl: p.poster && fs.existsSync(criaPath(p.poster)) ? pathToFileURL(criaPath(p.poster)).href : null };
  }

  // Texto da aba Criação. Padrão: modelos gratuitos do OpenRouter, na ordem de CRIA.FREE_TEXT_ORDER; se nenhum responder,
  // tenta os ":free" da lista viva do OpenRouter. 'chat' usa a IA da aba IA. Com IA local (Ollama/servidor local) o "automático" usa ela, que já é grátis.
  let freeListCache = { at: 0, ids: [] };
  async function criaFreeFallbacks() {
    if (freeListCache.ids.length && now() - freeListCache.at < 3600000) return freeListCache.ids;
    try {
      const r = await fetchImpl(`${OR.BASE}/models`, { signal: AbortSignal.timeout(15000) });
      if (r.ok) freeListCache = { at: now(), ids: CRIA.pickFreeModels((await r.json()).data) };
    } catch (_) { /* sem a lista viva, só os modelos fixos */ }
    return freeListCache.ids;
  }
  const KEY_HELP = {
    gemini: 'Para usar o Gemini grátis, cole a chave do Google AI Studio (aistudio.google.com/apikey) em "Chaves gratuitas", aqui na aba Criação.',
    groq: 'Para usar o Groq grátis, cole a chave grátis (console.groq.com/keys) em "Chaves gratuitas", aqui na aba Criação.',
    cloudflare: 'Para usar os modelos da Cloudflare, preencha o ID da conta e o token em "Chaves gratuitas" (dash.cloudflare.com, conta grátis, sem cartão).',
    openrouter: 'Para usar os modelos de texto gratuitos do OpenRouter, cole uma chave grátis (openrouter.ai/keys) em "Chaves gratuitas", aqui na aba Criação.',
  };
  const NO_KEY_AT_ALL = 'Para usar os modelos de texto gratuitos, cole pelo menos uma chave grátis em "Chaves gratuitas", aqui na aba Criação (Google Gemini, Groq, Cloudflare ou OpenRouter: todas sem cartão).';
  const stripThink = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim(); // alguns modelos (Qwen) mostram o raciocínio

  // chama UM modelo da lista; devolve o texto (ou lança erro)
  async function callOne(m, cfg, messages, system, maxTokens) {
    let out;
    if (m.kind === 'openrouter') {
      out = await callModel(messages, { ...cfg, provider: 'openrouter', openrouter: { ...cfg.openrouter, model: m.id } }, system, maxTokens);
    } else { // Gemini, Groq e Cloudflare falam o formato da OpenAI: reaproveita o provedor "custom" do ai-core só para esta chamada
      const prov = CRIA.TEXT_PROVIDERS[m.provider];
      const apiKey = m.provider === 'cloudflare' ? realKey(cfg.cloudflare.apiToken) : realKey(cfg[m.provider].apiKey);
      out = await callModel(messages, { ...cfg, provider: 'custom', custom: { url: prov.base(cfg), apiKey, model: m.model } }, system, maxTokens);
    }
    out = stripThink(out);
    if (!out) throw new Error(`O modelo ${m.model || m.id} não devolveu texto.`);
    return out;
  }
  async function criaLLM(messages, system, maxTokens, textModelId) {
    const cfg = loadConfig(), tm = CRIA.getTextModel(textModelId);
    if (tm.kind === 'chat') return callModel(messages, cfg, system, maxTokens);
    let order;
    if (tm.kind === 'auto') {
      order = CRIA.autoTextModels(cfg).slice(0, 8); // chaves que existem, em ordem de preferência (máx. 8 tentativas)
      if (!order.length) {
        if (cfg.provider === 'ollama' || cfg.provider === 'custom') return callModel(messages, cfg, system, maxTokens); // IA local já é grátis
        throw new Error(NO_KEY_AT_ALL);
      }
    } else {
      if (!CRIA.keyReady(cfg, tm.needs)) throw new Error(KEY_HELP[tm.provider] || NO_KEY_AT_ALL);
      order = [tm];
    }
    const badProviders = new Set(); // provedor com chave recusada (401): pula os outros modelos dele
    let lastErr, liveAdded = false;
    for (let i = 0; i < order.length; i++) {
      const m = order[i];
      if (!badProviders.has(m.provider)) {
        try { return await callOne(m, cfg, messages, system, maxTokens); } catch (e) {
          lastErr = e;
          if (e.http === 401 || e.http === 403) { if (tm.kind !== 'auto') throw e; badProviders.add(m.provider); }
        }
      }
      // acabou a lista fixa: tenta os ":free" da lista viva do OpenRouter (só se houver chave dele)
      if (i === order.length - 1 && tm.kind === 'auto' && !liveAdded && CRIA.keyReady(cfg, 'openrouter') && !badProviders.has('openrouter')) {
        liveAdded = true;
        const tried = new Set(order.map((x) => x.id));
        for (const id of (await criaFreeFallbacks()).filter((x) => !tried.has(x)).slice(0, 4)) order.push({ id, kind: 'openrouter', provider: 'openrouter' });
      }
    }
    if (lastErr && (lastErr.http === 401 || lastErr.http === 403) && badProviders.size) throw lastErr; // só havia chaves recusadas: mostra o erro de chave
    throw new Error(`Nenhum modelo gratuito respondeu agora. Os gratuitos têm limite por minuto e por dia; tente mais tarde ou cole outra chave grátis em "Chaves gratuitas". Último erro: ${asMsg(lastErr)}`);
  }

  async function criaEnhance(prompt, textModel) {
    const out = await criaLLM([{ role: 'user', content: CRIA.clampPrompt(prompt) }], CRIA.ENHANCE_SYSTEM, 300, textModel);
    return CRIA.clampPrompt(out.replace(/^["'\s]+|["'\s]+$/g, ''));
  }

  async function criaOneImage(o) {
    const ratio = CRIA.getRatio(o.ratio), model = CRIA.getModel(o.model);
    const full = CRIA.buildImagePrompt(o.prompt, o.style), neg = CRIA.clampNegative(o.negative);
    if (!CRIA.clampPrompt(o.prompt) || !full) throw new Error('Escreva o que você quer criar.'); // o estilo sozinho nunca é um pedido
    const seed = Number.isFinite(Number(o.seed)) && o.seed !== '' && o.seed !== null ? Math.abs(Math.floor(Number(o.seed))) % 2147483647 : Math.floor(Math.random() * 1e9);
    if (model.kind === 'openrouter') {
      const cfg = loadConfig();
      const key = realKey(cfg.openrouter.apiKey);
      if (!key) throw new Error('Para usar o OpenRouter, cole sua chave na aba "IA" do painel (openrouter.ai/keys).');
      const mid = String(o.orModel || '').trim() || 'google/gemini-2.5-flash-image';
      try {
        const r = await fetchImpl(`${OR.BASE}/chat/completions`, {
          method: 'POST', signal: AbortSignal.timeout(150000),
          headers: OR.headers(key),
          body: JSON.stringify({ model: mid, modalities: ['image', 'text'], messages: [{ role: 'user', content: `${full}${neg ? `\nAvoid: ${neg}` : ''}\n(aspect ratio ${ratio.id})` }] }),
        });
        if (!r.ok) throw await httpFail('OpenRouter', r);
        const j = await r.json();
        if (j.error) throw OR.fromApiError(j.error); // erro dentro de uma resposta 200
        const msg = j.choices && j.choices[0] && j.choices[0].message;
        const url = msg && msg.images && msg.images[0] && msg.images[0].image_url && msg.images[0].image_url.url;
        if (!CRIA.parseDataUrl(url)) throw new Error(`O modelo "${mid}" não devolveu uma imagem. Escolha um modelo que gere imagens (veja a lista em openrouter.ai/models).`);
        return { dataUrl: url, seed };
      } catch (e) { throw friendlyNetError(e, 'o OpenRouter'); }
    }
    const cfg = loadConfig();
    if (model.kind === 'cloudflare') return criaCloudflareImage(cfg, model, ratio, full, seed, neg);
    // Pollinations: precisa de chave (Pollen). Sem ela o servidor devolve 401.
    const pkey = realKey(cfg.pollinations.apiKey);
    if (!pkey) throw new Error('O Pollinations deixou de ser grátis sem chave. Escolha um modelo da Cloudflare (grátis) ou cole uma chave do Pollinations em \"Chaves gratuitas\".');
    const url = CRIA.pollinationsUrl({ prompt: full, w: ratio.w, h: ratio.h, seed, model: model.model, negative: neg });
    let lastErr;
    for (let attempt = 0; attempt < 2; attempt++) { // 1 nova tentativa se o servidor estiver ocupado
      try {
        const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${pkey}` }, signal: AbortSignal.timeout(120000) });
        if (r.status === 401) throw new Error('O Pollinations recusou a chave (401). Confira a chave em \"Chaves gratuitas\".');
        if (r.status === 402) throw new Error('Acabou o Pollen da sua conta do Pollinations (402). Veja o saldo em enter.pollinations.ai.');
        if (r.status === 429 || r.status >= 500) { lastErr = new Error(r.status === 429 ? 'O Pollinations está com muitos pedidos. Espere um pouco e tente de novo.' : `O Pollinations está fora do ar agora (erro ${r.status}).`); await wait(2500); continue; }
        if (!r.ok) throw new Error(`O Pollinations recusou o pedido (erro ${r.status}).`);
        const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (!/^image\/(png|jpe?g|webp)$/.test(type)) throw new Error('O gerador de imagens não devolveu uma imagem. Tente de novo.');
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 20 * 1024 * 1024) throw new Error('A imagem veio grande demais.');
        return { dataUrl: `data:${type === 'image/jpg' ? 'image/jpeg' : type};base64,${buf.toString('base64')}`, seed };
      } catch (e) { throw friendlyNetError(e, 'o Pollinations'); }
    }
    throw lastErr;
  }

  // Cloudflare Workers AI (grátis, sem cartão: cota diária de 10 mil neurons). Precisa do ID da conta e de um token com permissão "Workers AI".
  async function criaCloudflareImage(cfg, model, ratio, full, seed, neg = '') {
    const id = String(cfg.cloudflare.accountId || '').trim(), token = realKey(cfg.cloudflare.apiToken);
    if (!id || !token) throw new Error('Para gerar imagens grátis, preencha o ID da conta e o token da Cloudflare em \"Chaves gratuitas\" (dash.cloudflare.com, conta grátis, sem cartão).');
    try {
      const r = await fetchImpl(CRIA.cloudflareUrl(id, model.model), {
        method: 'POST', signal: AbortSignal.timeout(120000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(CRIA.cloudflareBody(model, { prompt: full, w: ratio.w, h: ratio.h, seed, negative: neg })),
      });
      if (!r.ok) {
        const e = await httpFail('Cloudflare', r);
        if (/neurons|4006/i.test(e.message)) throw new Error('Acabou a cota grátis de hoje da Cloudflare (renova à meia-noite UTC). Tente amanhã ou use outro modelo.');
        if (r.status === 401 || r.status === 403) throw new Error('A Cloudflare recusou o token. Confira o ID da conta e se o token tem a permissão \"Workers AI\".');
        throw e;
      }
      const type = (r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      let buf, mime;
      if (type.includes('json')) { // FLUX: { result: { image: "<base64 jpeg>" }, success: true }
        const j = await r.json();
        const b64 = j && j.result && j.result.image;
        if (!b64 || typeof b64 !== 'string') throw new Error('A Cloudflare não devolveu uma imagem. Tente de novo.');
        buf = Buffer.from(b64, 'base64'); mime = 'image/jpeg';
      } else if (/^image\/(png|jpe?g|webp)$/.test(type)) { // Stable Diffusion: a imagem vem direto
        buf = Buffer.from(await r.arrayBuffer()); mime = type === 'image/jpg' ? 'image/jpeg' : type;
      } else throw new Error('A Cloudflare não devolveu uma imagem. Tente de novo.');
      if (buf.length > 20 * 1024 * 1024) throw new Error('A imagem veio grande demais.');
      if (model.square && ratio.w !== ratio.h) { // FLUX sai quadrado: recorta ao centro no formato escolhido
        const cropped = cropToRatio(buf, ratio);
        if (cropped) { buf = cropped; mime = 'image/png'; }
      }
      return { dataUrl: `data:${mime};base64,${buf.toString('base64')}`, seed };
    } catch (e) { throw friendlyNetError(e, 'a Cloudflare'); }
  }

  async function criaText(o) {
    const prompt = String(o.prompt || '').slice(0, CRIA.MAX_PROMPT * 4).trim();
    if (!prompt) throw new Error('Escreva o que você quer que ela escreva.');
    const text = await criaLLM([{ role: 'user', content: prompt }], CRIA.textSystem(o), CRIA.maxTokensFor(o.size), o.textModel);
    return text.trim();
  }

  async function criaStoryboard(o) {
    const n = Math.max(2, Math.min(10, Math.round(Number(o.scenes) || 5)));
    const idea = String(o.idea || '').slice(0, CRIA.MAX_PROMPT).trim();
    if (!idea) throw new Error('Descreva a ideia do vídeo.');
    const out = await criaLLM([{ role: 'user', content: idea }], CRIA.STORYBOARD_SYSTEM(n), 1500, o.textModel);
    const scenes = CRIA.parseStoryboard(out, n);
    if (scenes.length < 2) throw new Error('A IA não montou as cenas direito. Tente de novo ou descreva a ideia com mais detalhes.');
    return scenes;
  }

  // SVG e HTML: a IA de texto escreve o código. O SVG volta limpo (sem script etc.); o HTML volta como a IA escreveu (a CSP sem internet entra ao salvar/abrir).
  // Com `current`, o pedido é um ajuste do código que já está na tela.
  async function criaCode(o) {
    const type = o.type === 'html' ? 'html' : 'svg';
    const prompt = String(o.prompt || '').slice(0, CRIA.MAX_PROMPT * 4).trim();
    if (!prompt) throw new Error(type === 'svg' ? 'Descreva o SVG que você quer criar.' : 'Descreva a página HTML que você quer criar.');
    const current = String(o.current || '').trim();
    const out = await criaLLM([{ role: 'user', content: CRIA.codeUserMessage(prompt, current, type) }], CRIA.codeSystem(type, o), CRIA.codeMaxTokens(type), o.textModel);
    const code = CRIA.extractCode(out, type);
    if (!code) throw new Error('A IA não devolveu um código que eu consiga usar. Tente de novo ou descreva com mais detalhes.');
    if (type === 'svg') {
      if (!/<\/svg\s*>/i.test(code)) throw new Error('A resposta veio cortada e o SVG ficou incompleto. Peça algo mais simples ou escolha outro modelo de texto.');
      const r = CRIA.getRatio(o.ratio);
      return { code: CRIA.sanitizeSvg(code, { w: r.w, h: r.h }) };
    }
    return { code: code.trim() };
  }
  // o que vai para o arquivo: SVG limpo ou HTML completo com CSP; '' se o texto não for do tipo
  function codeFile(type, raw) {
    const text = String(raw || '').slice(0, 1500000);
    if (type === 'svg') return CRIA.sanitizeSvg(CRIA.extractCode(text, 'svg') || text);
    return /<[a-z!]/i.test(text) ? CRIA.prepareHtml(text) : '';
  }
  // abre a prévia no navegador padrão sem criar projeto (arquivo temporário na pasta de dados, sempre o mesmo nome)
  function criaPreviewFile(o) {
    const type = o && o.type === 'html' ? 'html' : 'svg';
    const code = codeFile(type, o && o.code);
    if (!code) throw new Error(type === 'svg' ? 'Não há SVG para abrir.' : 'Não há HTML para abrir.');
    const f = path.join(criaDir(), `_previa.${type}`);
    fs.writeFileSync(f, code, 'utf8');
    return f;
  }

  const META_KEYS = ['style', 'ratio', 'model', 'seed', 'duration', 'scenes', 'kind', 'tone', 'size', 'secPerScene', 'negative', 'lang', 'motion', 'fade', 'palette'];
  function criaSave(o) {
    const type = ['image', 'text', 'video', 'svg', 'html'].includes(o.type) ? o.type : null;
    if (!type) throw new Error('Tipo de projeto inválido.');
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const dir = criaDir();
    let file, poster = null, preview = '', bytes = 0;
    if (type === 'image') {
      const d = CRIA.parseDataUrl(o.data);
      if (!d) throw new Error('Imagem inválida.');
      file = `${id}.${d.ext}`;
      const buf = Buffer.from(d.b64, 'base64'); bytes = buf.length; fs.writeFileSync(path.join(dir, file), buf);
    } else if (type === 'text') {
      const t = String(o.data || '').slice(0, 200000);
      if (!t.trim()) throw new Error('Não há texto para salvar.');
      file = `${id}.txt`; bytes = Buffer.byteLength(t); fs.writeFileSync(path.join(dir, file), t, 'utf8'); preview = t.replace(/\s+/g, ' ').slice(0, 220);
    } else if (type === 'svg' || type === 'html') {
      const code = codeFile(type, o.data);
      if (!code || (type === 'svg' && !/<svg\b/i.test(code))) throw new Error(type === 'svg' ? 'SVG inválido.' : 'Não há HTML para salvar.');
      file = `${id}.${type}`; bytes = Buffer.byteLength(code); fs.writeFileSync(path.join(dir, file), code, 'utf8');
      preview = type === 'html' ? (CRIA.codeTitle(code) || CRIA.codePreviewText(code)) : CRIA.codeTitle(code);
      if (!String(o.title || '').trim() && CRIA.codeTitle(code)) o = { ...o, title: CRIA.codeTitle(code) };
    } else {
      const buf = Buffer.from(o.data || []);
      if (!buf.length) throw new Error('O vídeo está vazio.');
      if (buf.length > 400 * 1024 * 1024) throw new Error('O vídeo ficou grande demais para salvar.');
      file = `${id}.webm`; bytes = buf.length; fs.writeFileSync(path.join(dir, file), buf);
      const pd = CRIA.parseDataUrl(o.poster);
      if (pd) { poster = `${id}.poster.${pd.ext}`; fs.writeFileSync(path.join(dir, poster), Buffer.from(pd.b64, 'base64')); }
    }
    const meta = {};
    for (const k of META_KEYS) if (o.meta && o.meta[k] !== undefined && ['string', 'number', 'boolean'].includes(typeof o.meta[k])) meta[k] = typeof o.meta[k] === 'string' ? o.meta[k].slice(0, 80) : o.meta[k];
    const entry = { id, type, title: (String(o.title || '').trim() || CRIA.defaultTitle(type, o.prompt)).slice(0, 60), prompt: CRIA.clampPrompt(o.prompt), file, poster, preview, createdAt: Date.now(), bytes, meta };
    criaStore([entry, ...criaLoad()]);
    return criaView(entry);
  }

  return { criaDir, criaLoad, criaStore, criaPath, criaView, criaLLM, criaEnhance, criaOneImage, criaText, criaStoryboard, criaCode, criaPreviewFile, criaSave };
}

module.exports = { createCriaService, asMsg };
