'use strict';
// Núcleo da IA: histórico, fila de chamadas, streaming e troca de provedor.
// Não depende do Electron nem do sistema de arquivos: tudo que vem de fora (config, janela, fetch, salvar)
// entra por createAI({...}), então dá para testar com `npm test`.
const AS = require('./ai-stream');
const OR = require('./openrouter');
const ROUTER = require('./ai-router');

const CONFIG_DEFAULT = {
  provider: 'kobold', // kobold (padrão: o cérebro roda no seu PC) | anthropic | openrouter | ollama | custom | openclaw
  kobold: { url: 'http://localhost:5001/v1', apiKey: '', model: 'koboldcpp' }, // KoboldCpp: servidor local com API compatível com OpenAI (o nome do modelo é ignorado por ele)
  anthropic: { apiKey: '', model: 'claude-sonnet-5-5' },
  openrouter: { apiKey: '', model: 'openrouter/auto', fallbacks: '', sort: '', thinking: 'fast' }, // fallbacks: até 2 modelos reserva (separados por vírgula)
  ollama: { url: 'http://localhost:11434', model: 'llama3.1' },
  custom: { url: 'http://localhost:1234/v1', apiKey: '', model: '' }, // LM Studio, llama.cpp, Jan...
  openclaw: { url: 'http://127.0.0.1:18789/v1', apiKey: '', model: 'openclaw/default', backendModel: '' }, // gateway do OpenClaw (agente com skills); "openclaw/default" = agente padrão dele
  cloudflare: { accountId: '', apiToken: '' }, // aba Criação: imagens grátis (Cloudflare Workers AI)
  pollinations: { apiKey: '' },                // aba Criação: opcional, só para o modelo do Pollinations
  groq: { apiKey: '' },                        // aba Criação: texto grátis (console.groq.com/keys)
  gemini: { apiKey: '' },                      // aba Criação: texto grátis (aistudio.google.com/apikey)
  routing: { mode: 'auto', fastModel: '', thinkModel: '' },
  systemPrompt:
    'Você é a assistente que vive na área de trabalho do usuário. Responda em português, de forma curta (no máximo 2 frases), simpática e natural.',
};
const PROVIDERS = ['kobold', 'anthropic', 'openrouter', 'ollama', 'custom', 'openclaw'];

// junta o config.json lido do disco com os padrões (sem tocar no disco)
function normalizeConfig(c) {
  c = c && typeof c === 'object' ? c : {};
  const out = { ...CONFIG_DEFAULT, ...c };
  out.routing = { ...CONFIG_DEFAULT.routing, ...(c.routing || {}) };
  if (!ROUTER.MODES.includes(out.routing.mode)) out.routing.mode = 'auto';
  out.routing.fastModel = String(out.routing.fastModel || '').slice(0, 160);
  out.routing.thinkModel = String(out.routing.thinkModel || '').slice(0, 160);
  for (const k of [...PROVIDERS, 'cloudflare', 'pollinations', 'groq', 'gemini']) out[k] = { ...CONFIG_DEFAULT[k], ...(c[k] || {}) };
  if (!PROVIDERS.includes(out.provider)) out.provider = CONFIG_DEFAULT.provider;
  for (const k of ['kobold', 'anthropic', 'openrouter', 'ollama', 'openclaw']) { // modelo apagado na aba IA: volta ao padrão do provedor (o "custom" avisa por conta própria)
    if (!String(out[k].model || '').trim()) out[k].model = CONFIG_DEFAULT[k].model;
  }
  out.openclaw.backendModel = String(out.openclaw.backendModel || '').trim().slice(0, 160); // modelo que o agente usa por trás (ex.: openrouter/…:free); vazio = o do próprio OpenClaw
  if (!OR.SORTS.includes(out.openrouter.sort)) out.openrouter.sort = '';
  if (!OR.THINKING.includes(out.openrouter.thinking)) out.openrouter.thinking = 'fast';
  out.openrouter.fallbacks = OR.parseFallbacks(out.openrouter.fallbacks, '', Infinity).join(', '); // o limite de 2 vale só ao montar o pedido (depois de tirar o modelo principal)
  return out;
}

const realKey = (k) => (k && k !== 'COLE_SUA_CHAVE_AQUI' ? k : '');

async function httpFail(label, r) {
  let msg = '', meta = null;
  try {
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      const e = j.error;
      msg = (e && (e.message || e)) || j.message || t;
      if (e && typeof e === 'object') meta = e.metadata || null;
    } catch (_) { msg = t; }
  } catch (_) {}
  if (typeof msg !== 'string') msg = JSON.stringify(msg);
  let err;
  if (label === 'OpenRouter') { // mensagens próprias (créditos, privacidade dos modelos :free, limite do dia...)
    err = new Error(OR.describe(r.status, msg, meta));
    if (OR.isDailyLimit(msg, meta)) err.daily = true;
  } else if (label === 'OpenClaw' && [401, 403, 404, 405].includes(r.status)) {
    err = new Error(openclawHttpHint(r.status, msg));
  } else {
    const hint = r.status === 401 ? ' (chave inválida ou ausente)'
      : r.status === 402 ? ' (sem créditos)'
      : r.status === 404 ? ' (modelo ou endereço não encontrado)'
      : r.status === 429 ? ' (muitas requisições, tente de novo)' : '';
    err = new Error(`${label}: ${r.status}${hint} ${String(msg).slice(0, 300)}`);
  }
  err.http = r.status;
  if (label === 'OpenClaw') err.openclaw = true;
  const ra = r.headers && typeof r.headers.get === 'function' ? Number(r.headers.get('retry-after')) : NaN;
  if (ra > 0) err.retryAfter = ra;
  return err;
}

// Mensagens do gateway do OpenClaw: o erro mais comum é o endpoint HTTP estar desligado (vem assim de fábrica).
function openclawHttpHint(status, msg) {
  const det = String(msg || '').slice(0, 200);
  if (status === 401) return 'OpenClaw: token recusado (401). Copie de novo o gateway.auth.token (ou a senha, se o modo for password) do ~/.openclaw/openclaw.json para a aba \"IA\".';
  if (status === 403) return `OpenClaw: acesso negado (403). ${det}`.trim();
  return 'OpenClaw: o gateway respondeu ' + status + ', e isso quase sempre quer dizer que o endpoint de chat está desligado (vem assim de fábrica). ' +
    'Ative gateway.http.endpoints.chatCompletions.enabled = true no ~/.openclaw/openclaw.json (ou rode: npm run setup:openclaw) e confira o endereço, que termina em /v1.' + (det ? ` Detalhe: ${det}` : '');
}

// Agente do OpenClaw a partir do campo \"modelo\": openclaw | openclaw/default | openclaw/<id> | openclaw:<id> | agent:<id> | <id>.
// `agentId` é null quando vale o agente padrão do gateway (aí não mandamos o cabeçalho de agente).
function openclawTarget(raw) {
  const m = String(raw || '').trim();
  if (!m) return { model: 'openclaw/default', agentId: null };
  if (/^openclaw$/i.test(m)) return { model: m, agentId: null };
  const hit = /^(openclaw|agent)[:/](.+)$/i.exec(m);
  const id = (hit ? hit[2] : m).trim();
  const model = hit ? m : `openclaw/${id}`; // só o id, sem prefixo: o gateway espera openclaw/<id>
  return { model, agentId: !id || /^default$/i.test(id) ? null : id };
}

// O prompt padrão do Yoru pede respostas de 2 frases. Com um agente que usa skills isso corta o resultado da tarefa.
const OPENCLAW_NOTE =
  '\n\nVocê está conectada a um agente OpenClaw, com skills e ferramentas próprias. Quando o pedido pedir uma ação (pesquisar, ler ou criar arquivos, ' +
  'automatizar, usar um serviço), use as suas skills em vez de apenas descrever o que faria. Ao terminar, conte o resultado de forma clara: ' +
  'o limite de frases curtas não vale para o resultado de uma tarefa. Mantenha a tag de emoção no começo da resposta.';

// traduz falhas de rede em mensagens que o usuário entende
function friendlyNetError(e, where) {
  if (e && e.name === 'TimeoutError') return new Error('Tempo esgotado esperando a resposta.');
  if (e instanceof TypeError) {
    const err = new Error(where ? `Não consegui conectar em ${where}. O servidor está ligado?` : 'Sem conexão com a internet?');
    err.net = true; // falha de rede: vale tentar de novo (OpenRouter)
    return err;
  }
  return e;
}

// Monta o pedido HTTP de cada provedor (usado tanto na resposta normal quanto no streaming)
// `tail`: texto que muda a cada chamada (data/hora da conversa por voz). Fica fora do trecho em cache da Anthropic,
// para o prompt fixo (comandos, gestos, memória) ser reaproveitado e a resposta começar mais cedo.
// `extra.voice`: conversa por voz (a OpenRouter limita o raciocínio dos modelos que pensam)
function buildRequest(cfg, messages, system, stream, maxTokens, tail = '', extra = {}) {
  const p = cfg.provider;
  const json = { 'Content-Type': 'application/json' };
  const sys = { role: 'system', content: system + tail };
  if (p === 'ollama') {
    return {
      kind: 'ollama', label: 'Ollama', where: cfg.ollama.url, ms: 120000,
      url: `${cfg.ollama.url.replace(/\/$/, '')}/api/chat`, headers: json,
      body: { model: cfg.ollama.model, stream, options: { num_predict: maxTokens }, messages: [sys, ...messages] },
    };
  }
  if (p === 'openrouter') {
    const key = realKey(cfg.openrouter.apiKey);
    if (!key) throw new Error('Cole sua chave do OpenRouter na aba "IA" do painel (openrouter.ai/keys).');
    return {
      kind: 'openai', label: 'OpenRouter', where: '', retries: 2,
      ms: cfg.openrouter.thinking === 'model' && !extra.voice ? 120000 : 60000, // modelos que pensam demoram mais para começar
      url: `${OR.BASE}/chat/completions`,
      headers: OR.headers(key),
      body: OR.chatBody(cfg.openrouter, { system, tail, messages, maxTokens, stream, voice: !!extra.voice }),
    };
  }
  if (p === 'kobold') {
    // KoboldCpp (github.com/LostRuins/koboldcpp): servidor local no formato da OpenAI. Roda o modelo escolhido ao abrir o KoboldCpp, então o
    // campo "modelo" não escolhe nada (ele aceita qualquer nome). A chave só existe se o KoboldCpp foi aberto com --password.
    if (!cfg.kobold.url) throw new Error('Informe o endereço do KoboldCpp na aba "IA" (ex.: http://localhost:5001/v1).');
    const key = realKey(cfg.kobold.apiKey);
    return {
      // modelo local em CPU/GPU fraca pode levar bastante para começar a responder (processa o prompt inteiro primeiro)
      kind: 'openai', label: 'KoboldCpp', where: cfg.kobold.url, ms: 300000,
      url: `${cfg.kobold.url.replace(/\/$/, '')}/chat/completions`,
      headers: { ...json, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: { model: cfg.kobold.model || 'koboldcpp', max_tokens: maxTokens, stream, messages: [sys, ...messages] },
    };
  }
  if (p === 'custom') {
    if (!cfg.custom.model) throw new Error('Informe o nome do modelo na aba "IA" (use o botão Buscar para listar).');
    const key = realKey(cfg.custom.apiKey);
    return {
      kind: 'openai', label: 'Servidor local', where: cfg.custom.url, ms: 120000,
      url: `${cfg.custom.url.replace(/\/$/, '')}/chat/completions`,
      headers: { ...json, ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: { model: cfg.custom.model, max_tokens: maxTokens, stream, messages: [sys, ...messages] },
    };
  }
  if (p === 'openclaw') {
    // Gateway do OpenClaw, falando o formato da OpenAI (docs.openclaw.ai/gateway/openai-http-api).
    // O campo "modelo" aponta para um AGENTE (não para um modelo de IA); as skills são as desse agente.
    if (!cfg.openclaw.url) throw new Error('Informe o endereço do gateway do OpenClaw na aba "IA" (ex.: http://127.0.0.1:18789/v1).');
    const key = realKey(cfg.openclaw.apiKey);
    if (!key) throw new Error('Informe o token do gateway do OpenClaw na aba "IA" (gateway.auth.token, no ~/.openclaw/openclaw.json).');
    const { model, agentId } = openclawTarget(cfg.openclaw.model);
    return {
      // o agente pode demorar bem mais que uma resposta de chat normal (skills, ferramentas, arquivos)
      kind: 'openai', label: 'OpenClaw', where: cfg.openclaw.url, ms: 600000,
      url: `${cfg.openclaw.url.replace(/\/$/, '')}/chat/completions`,
      headers: {
        ...json, Authorization: `Bearer ${key}`,
        ...(agentId ? { 'x-openclaw-agent-id': agentId } : {}),
        ...(cfg.openclaw.backendModel ? { 'x-openclaw-model': cfg.openclaw.backendModel } : {}), // troca o modelo do agente só nesta chamada
      },
      // "user" fixo: o gateway deriva uma sessão estável, então o agente mantém o fio da tarefa entre uma fala e outra.
      // Sem max_tokens: o limite curto do chat (220 no modo FAST) cortaria a tarefa no meio; quem decide é o agente.
      body: { model, stream, user: 'yoru', messages: [{ role: 'system', content: system + OPENCLAW_NOTE + tail }, ...messages] },
    };
  }
  const key = realKey(cfg.anthropic.apiKey);
  if (!key) throw new Error('Cole sua chave de API na aba "IA" do painel.');
  return {
    kind: 'anthropic', label: 'Anthropic', where: '', ms: 60000,
    url: 'https://api.anthropic.com/v1/messages',
    headers: { ...json, 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: {
      model: cfg.anthropic.model, max_tokens: maxTokens, stream,
      system: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ...(tail ? [{ type: 'text', text: tail.trim() }] : []),
      ],
      messages,
    },
  };
}

const stripThink = (t) => String(t || '').replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();

function textOf(kind, j, label) {
  let t;
  if (kind === 'ollama') t = j.message && j.message.content;
  else if (kind === 'anthropic') t = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  else {
    // a OpenRouter pode devolver erro dentro de uma resposta 200 (provedor caiu no meio do pedido)
    if (j.error) throw label === 'OpenRouter' ? OR.fromApiError(j.error) : new Error(`${label}: ${(j.error && j.error.message) || j.error}`);
    const ch = j.choices && j.choices[0];
    if (ch && ch.error) throw label === 'OpenRouter' ? OR.fromApiError(ch.error) : new Error(`${label}: ${ch.error.message || ch.error}`);
    const c = ch && ch.message && ch.message.content;
    t = stripThink(Array.isArray(c) ? c.map((x) => x.text || '').join('') : c);
    if (!t && ch && ch.finish_reason === 'length') throw cutOff(label);
  }
  if (!t) throw new Error(`${label}: resposta vazia do modelo`);
  return t;
}

// o modelo gastou todo o limite de tokens antes de escrever a resposta (típico de modelos que "pensam")
function cutOff(label) {
  const e = new Error(`${label}: o modelo usou todo o limite de tokens pensando e não chegou a responder. Aumente o tamanho da resposta, escolha um modelo que não precise pensar tanto ou, no OpenRouter, deixe o raciocínio em "curto".`);
  e.final = true;
  return e;
}

// contexto extra quando a conversa é por voz: data/hora e estilo falado
function voiceContext(d = new Date()) {
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `\n\nAgora são ${hora} de ${dia}. Você está conversando por voz: fale de forma natural, em no máximo 2 frases curtas, sem listas, sem markdown e sem emojis.`;
}

// lista de modelos do provedor (para o botão "Buscar" do painel)
// Devolve { ids, labels }: `labels` (id -> "128k · grátis") existe só no OpenRouter e serve de dica no campo Modelo
async function listModelsDetailed(p, cfg, fetchImpl = globalThis.fetch) {
  const get = async (url, headers = {}) => {
    const r = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw await httpFail('Modelos', r);
    return r.json();
  };
  const list = (x, key, pick) => (x && Array.isArray(x[key]) ? x[key] : []).map(pick).filter(Boolean);
  let ids = [];
  if (p.provider === 'openrouter') {
    const d = OR.describeModels((await get(`${OR.BASE}/models`) || {}).data);
    if (!d.ids.length) throw new Error('o servidor não devolveu nenhum modelo.');
    return d; // já vem na ordem certa: openrouter/auto, gratuitos, resto
  } else if (p.provider === 'ollama') {
    const base = (p.baseUrl || cfg.ollama.url).replace(/\/$/, '');
    ids = list(await get(`${base}/api/tags`), 'models', (m) => m.name);
  } else if (p.provider === 'custom' || p.provider === 'openclaw' || p.provider === 'kobold') {
    const dflt = p.provider === 'openclaw' ? cfg.openclaw : p.provider === 'kobold' ? cfg.kobold : cfg.custom;
    const base = (p.baseUrl || dflt.url).replace(/\/$/, '');
    const key = (p.apiKey || '').trim() || realKey(dflt.apiKey);
    const j = await get(`${base}/models`, key ? { Authorization: `Bearer ${key}` } : {});
    ids = list(j, 'data', (m) => m.id);
    if (!ids.length) ids = list(j, 'models', (m) => m.id || m.name);
  } else {
    const key = (p.apiKey || '').trim() || realKey(cfg.anthropic.apiKey);
    if (!key) throw new Error('Cole a chave primeiro.');
    ids = list(await get('https://api.anthropic.com/v1/models?limit=1000', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }), 'data', (m) => m.id);
  }
  if (!ids.length) throw new Error('o servidor não devolveu nenhum modelo.');
  return { ids: ids.sort(), labels: {} };
}
const listModels = async (p, cfg, fetchImpl) => (await listModelsDetailed(p, cfg, fetchImpl)).ids;

/**
 * deps:
 *   getSettings()        -> settings atuais (historyLimit, maxTokens, streamReplies, convSpeak)
 *   loadConfig()         -> config já normalizada (provedor, chaves, modelos)
 *   buildSystem(cfg)     -> prompt de sistema
 *   canStream()          -> true se há janela viva para receber o streaming
 *   emitStream(ev)       -> entrega um evento de streaming ao avatar
 *   persist()            -> chamado quando o histórico muda (salvar em disco)
 *   onTags(pr)           -> aplica [lembrar:], [app:...] da resposta
 *   mediaMessage(provider, content, media) -> monta a mensagem com imagens/PDF
 *   fetch, now, log, wait -> injetáveis para teste
 */
function createAI(deps) {
  const {
    getSettings, loadConfig, buildSystem,
    canStream = () => false, emitStream = () => {}, persist = () => {}, onTags = () => {},
    mediaMessage = (_p, content) => ({ role: 'user', content }),
    fetch: fetchImpl = globalThis.fetch, now = () => new Date(), log = () => {},
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = deps;

  let history = [];
  let chain = Promise.resolve();
  const limit = () => Math.max(2, getSettings().historyLimit || 20);

  // Tenta de novo (só OpenRouter) quando a falha é passageira: limite por minuto, provedor ocupado, rede instável.
  // `canRetry` impede de repetir depois que já chegou texto (a resposta pela metade não pode ser duplicada).
  async function withRetry(req, extra, fn, canRetry = () => true) {
    const max = req.retries ? (extra.voice ? 1 : req.retries) : 0; // na voz uma tentativa só: esperar demais é pior que falhar
    for (let n = 0; ; n++) {
      try { return await fn(); } catch (e) {
        const d = n < max && canRetry() ? OR.retryDelay(e, n) : null;
        if (d == null) throw e;
        log(`[ia] ${req.label}: ${e.message}. Nova tentativa em ${d} ms`);
        await wait(d);
      }
    }
  }

  // OpenClaw respondeu 401: o token mudou (reinstalação, reinício do gateway...). Reconecta sozinha (relê e testa os tokens possíveis)
  // e repete UMA vez com a conexão nova. Devolve a config corrigida, ou null se não havia o que corrigir.
  async function healOpenclaw(e, cfg) {
    if (!e || e.http !== 401 || !e.openclaw || typeof deps.reconnectOpenclaw !== 'function' || !cfg || !cfg.openclaw) return null;
    const r = await deps.reconnectOpenclaw().catch(() => null);
    if (!r || !r.ok || !r.apiKey || r.apiKey === cfg.openclaw.apiKey) {
      e.message += ' A Yoru tentou reconectar sozinha e não conseguiu: use "🚀 Abrir e deixar pronto" na aba IA.';
      return null;
    }
    const next = structuredClone(cfg);
    next.openclaw.apiKey = r.apiKey;
    if (r.url) next.openclaw.url = r.url;
    log('[ia] OpenClaw: token atualizado sozinha; repetindo o pedido');
    return next;
  }

  async function callModel(messages, cfg, system, maxTokens = getSettings().maxTokens, tail = '', extra = {}) {
    try { return await callModelOnce(messages, cfg, system, maxTokens, tail, extra); } catch (e) {
      const next = await healOpenclaw(e, cfg);
      if (!next) throw e;
      return callModelOnce(messages, next, system, maxTokens, tail, extra);
    }
  }
  async function callModelOnce(messages, cfg, system, maxTokens = getSettings().maxTokens, tail = '', extra = {}) {
    const req = buildRequest(cfg, messages, system, false, maxTokens, tail, extra);
    return withRetry(req, extra, async () => {
      try {
        const timeoutSignal = AbortSignal.timeout(req.ms);
        const signal = extra.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([timeoutSignal, extra.signal]) : (extra.signal || timeoutSignal);
        const r = await fetchImpl(req.url, { method: 'POST', signal, headers: req.headers, body: JSON.stringify(req.body) });
        if (!r.ok) throw await httpFail(req.label, r);
        return textOf(req.kind, await r.json(), req.label);
      } catch (e) { throw friendlyNetError(e, req.where); }
    });
  }

  // Igual à callModel, mas entrega o texto aos pedaços (onDelta) conforme ele chega.
  // O limite de tempo vale para "ficar sem receber nada" (reinicia a cada pedaço): uma resposta longa e lenta
  // (modelo local, por exemplo) não é cortada no meio só porque passou de 60/120 s no total.
  async function streamModel(messages, cfg, system, onDelta, maxTokens = getSettings().maxTokens, tail = '', extra = {}) {
    try { return await streamModelOnce(messages, cfg, system, onDelta, maxTokens, tail, extra); } catch (e) {
      const next = await healOpenclaw(e, cfg); // 401 vem antes de qualquer texto, então repetir não duplica nada
      if (!next) throw e;
      return streamModelOnce(messages, next, system, onDelta, maxTokens, tail, extra);
    }
  }
  async function streamModelOnce(messages, cfg, system, onDelta, maxTokens = getSettings().maxTokens, tail = '', extra = {}) {
    const req = buildRequest(cfg, messages, system, true, maxTokens, tail, extra);
    let got = false; // já chegou algo do servidor? (depois disso não se repete o pedido)
    return withRetry(req, extra, async () => {
      const ctl = new AbortController();
      const externalAbort = () => ctl.abort(extra.signal && extra.signal.reason);
      if (extra.signal) { if (extra.signal.aborted) externalAbort(); else extra.signal.addEventListener('abort', externalAbort, { once: true }); }
      let timedOut = false, timer = null;
      const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort(); }, req.ms); };
      arm();
      try {
        const r = await fetchImpl(req.url, { method: 'POST', signal: ctl.signal, headers: req.headers, body: JSON.stringify(req.body) });
        if (!r.ok) throw await httpFail(req.label, r);
        if (!r.body) throw new Error('sem fluxo de resposta');
        const meta = {};
        let clean = '';
        // formato OpenAI (OpenRouter, servidor local): o raciocínio entre <think> não vai para o balão nem para a voz
        const tf = req.kind === 'openai' ? AS.createThinkFilter((t) => { clean += t; onDelta(t); }) : null;
        const push = (d) => { got = true; arm(); if (tf) tf.push(d); else onDelta(d); };
        let full;
        if (req.kind === 'anthropic') full = await AS.readAnthropicStream(r.body, push);
        else if (req.kind === 'ollama') full = await AS.readOllamaStream(r.body, push);
        else full = await AS.readOpenAIStream(r.body, push, (m) => Object.assign(meta, m));
        if (tf) { tf.end(); full = clean; }
        if (!full.trim() && meta.finish === 'length') throw cutOff(req.label);
        return full;
      } catch (e) {
        if (timedOut) throw new Error('Tempo esgotado esperando a resposta.');
        // erro no meio do fluxo: { error: { code, message } } (vira mensagem em português e ganha o código HTTP)
        throw friendlyNetError(e && e.apiError && req.label === 'OpenRouter' ? OR.fromApiError(e.apiError) : e, req.where);
      } finally { clearTimeout(timer); if (extra.signal) extra.signal.removeEventListener('abort', externalAbort); }
    }, () => !got);
  }

  // As chamadas entram numa fila: duas perguntas ao mesmo tempo (voz + painel) não embaralham a memória da conversa.
  function askAI(text, opts = {}) {
    const run = chain.then(() => askAIInner(text, opts));
    chain = run.catch(() => {});
    return run;
  }

  // opts.voice: conversa por voz | opts.hint: texto extra só desta chamada (não fica na memória) | opts.attach: arquivos preparados
  async function askAIInner(text, opts) {
    const settings = getSettings();
    const att = opts.attach || null;
    const userText = att ? text + att.text : text;
    const userMsg = { role: 'user', content: userText };
    history.push(userMsg);
    try {
      const baseCfg = loadConfig();
      const routed = ROUTER.route(baseCfg, userText, { voice: !!opts.voice, maxTokens: settings.maxTokens });
      const cfg = routed.config;
      const system = buildSystem(cfg);
      const tail = opts.voice ? voiceContext(now()) : '';
      let msgs = opts.hint ? [...history.slice(0, -1), { role: 'user', content: `${userText}\n\n${opts.hint}` }] : history.slice();
      // conversa por voz: respostas de 2 frases não precisam de 20 mensagens de contexto nem de 400 tokens.
      let maxTokens = routed.maxTokens;
      if (opts.voice) {
        msgs = AS.trimForVoice(msgs);
        maxTokens = Math.min(settings.maxTokens, AS.VOICE_MAX_TOKENS);
      }
      if (att && att.media && att.media.length) {
        const last = msgs[msgs.length - 1];
        msgs = [...msgs.slice(0, -1), mediaMessage(cfg.provider, last.content, att.media)];
      }
      let raw = null;
      let streamed = false;
      if (settings.streamReplies !== false && canStream()) {
        const speak = !!(opts.voice && settings.convSpeak);
        const st = AS.createReplyStreamer((ev) => emitStream({ ...ev, speak }));
        let streamErr = null;
        try { raw = await streamModel(msgs, cfg, system, (d) => st.push(d), maxTokens, tail, { voice: !!opts.voice, signal: opts.signal }); }
        catch (e) { streamErr = e; }
        if (st.started) { // chegou texto: mesmo que o fluxo tenha caído no meio, aproveita o que veio
          if (streamErr) log('[ia] streaming interrompido:', streamErr.message);
          st.end();
          raw = st.raw;
          streamed = true;
        } else if (streamErr) {
          if (opts.signal && opts.signal.aborted) throw streamErr; // cancelamento solicitado: não tenta uma chamada normal de fallback
          if (streamErr.http || streamErr.final) throw streamErr; // chave inválida, sem créditos, limite de tokens etc.: tentar de novo não adianta
          raw = null; // servidor sem suporte a streaming: tenta o modo normal abaixo
        } else if (st.raw.trim()) {
          raw = st.raw; // veio só com tags ([app:tema=...], [lembrar: ...]): trata abaixo, sem perder a ação
        } else {
          throw new Error('resposta vazia do modelo');
        }
      }
      if (raw === null) raw = await callModel(msgs, cfg, system, maxTokens, tail, { voice: !!opts.voice, signal: opts.signal });
      const pr = AS.parseReply(raw);
      if (!pr.text) {
        if (!pr.actions.length && !pr.remember.length && !pr.forget.length) throw new Error('resposta vazia do modelo');
        pr.text = 'Pronto!'; // a IA só executou uma ação, sem texto
      }
      history.push({ role: 'assistant', content: raw });
      history = history.slice(-limit()); // número par: começa sempre numa pergunta
      persist();
      try { onTags(pr); } catch (e) { log('[ia] falha ao aplicar tags:', e && e.message); } // a resposta já está no histórico: erro nas tags não a derruba
      return { ok: true, ...pr, streamed };
    } catch (e) {
      const i = history.lastIndexOf(userMsg); // remove a pergunta que falhou (não "a última": outra troca pode ter entrado)
      if (i !== -1) history.splice(i, 1);
      return { ok: false, text: String(e.message || e) };
    }
  }

  // guarda uma troca resolvida localmente (hora, abrir site...) na memória da conversa com a IA.
  // Entra na mesma fila: se uma resposta está a caminho, a troca só é guardada depois dela.
  function remember(user, assistant) {
    chain = chain.then(() => {
      history.push({ role: 'user', content: user }, { role: 'assistant', content: assistant });
      history = history.slice(-limit());
      while (history.length && history[0].role !== 'user') history.shift();
      persist();
    }).catch(() => {});
  }

  function clearHistory() { history = []; }
  const getHistory = () => history;

  // restaura o histórico salvo: só mensagens válidas, começando numa pergunta e terminando numa resposta
  function setHistory(list) {
    if (!Array.isArray(list)) return;
    history = list.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-limit());
    while (history.length && history[0].role !== 'user') history.shift();
    while (history.length && history[history.length - 1].role === 'user') history.pop(); // pergunta que ficou sem resposta
  }

  return {
    askAI, remember, clearHistory, getHistory, setHistory, callModel, streamModel,
    listModels: (p) => listModels(p, loadConfig(), fetchImpl),
    listModelsDetailed: (p) => listModelsDetailed(p, loadConfig(), fetchImpl), // { ids, labels }: o painel mostra contexto e preço
    // OpenRouter: saldo e limite da chave, em uma frase ('' se não for OpenRouter ou se a consulta falhar)
    async keyInfo() {
      const cfg = loadConfig();
      const key = cfg.provider === 'openrouter' ? realKey(cfg.openrouter.apiKey) : '';
      return key ? OR.describeKey(await OR.keyInfo(key, fetchImpl)) : '';
    },
    idle: () => chain, // resolve quando a fila esvazia (útil em testes)
  };
}

module.exports = { createAI, ROUTER, CONFIG_DEFAULT, PROVIDERS, normalizeConfig, realKey, httpFail, friendlyNetError, buildRequest, textOf, voiceContext, listModels, listModelsDetailed, openclawTarget, OPENCLAW_NOTE };
