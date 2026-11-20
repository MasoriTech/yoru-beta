'use strict';
// Tudo que é específico da OpenRouter: cabeçalhos, corpo do pedido, mensagens de erro, novas tentativas,
// lista de modelos com rótulos e consulta da chave. Funções puras (sem Electron), testáveis com `npm test`.
// O ai-core.js e o criacao-service.js só chamam estas funções.

const BASE = 'https://openrouter.ai/api/v1';
// Identificam o app nos painéis da OpenRouter (ranking e uso por app). Troque APP_URL pelo endereço do seu projeto, se tiver um.
const APP_URL = 'https://yoru.app';
const APP_TITLE = 'Yoru';

const SORTS = ['', 'latency', 'throughput', 'price'];
const THINKING = ['fast', 'model'];
const MAX_FALLBACKS = 2; // a OpenRouter aceita até 3 modelos no total (o principal + 2 reservas)

const headers = (key) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${key}`,
  'HTTP-Referer': APP_URL,
  'X-Title': APP_TITLE,
});

// "a/b, c/d" ou ["a/b"] -> ["a/b", "c/d"] (sem repetidos, sem o próprio modelo principal)
function parseFallbacks(v, primary = '', limit = MAX_FALLBACKS) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[,\n;]+/);
  const out = [];
  for (const x of list) {
    const id = String(x || '').trim();
    if (id && id !== primary && !out.includes(id)) out.push(id);
  }
  return out.slice(0, limit);
}

// modelos Claude via OpenRouter aceitam cache de prompt: o trecho fixo (personalidade, comandos, memória) fica em cache
function systemMessage(model, system, tail = '') {
  if (/^anthropic\//i.test(model)) {
    return {
      role: 'system',
      content: [
        { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
        ...(tail ? [{ type: 'text', text: tail.trim() }] : []),
      ],
    };
  }
  return { role: 'system', content: system + tail };
}

const hasPdf = (messages) => messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p && p.type === 'file'));

/**
 * Corpo do pedido de chat.
 *  o: config do OpenRouter ({ model, fallbacks, sort, thinking })
 *  voice: conversa por voz (resposta curta e rápida: o raciocínio dos modelos que "pensam" é limitado)
 */
function chatBody(o, { system, tail = '', messages, maxTokens, stream, voice = false }) {
  const model = String(o.model || '').trim() || 'openrouter/auto';
  const fb = parseFallbacks(o.fallbacks, model);
  const body = { max_tokens: maxTokens, stream, messages: [systemMessage(model, system, tail), ...messages] };
  if (fb.length) body.models = [model, ...fb]; // a OpenRouter tenta o próximo se o primeiro falhar ou estiver ocupado
  else body.model = model;
  if (SORTS.includes(o.sort) && o.sort) body.provider = { sort: o.sort };
  // Modelos que pensam gastam o limite de tokens raciocinando e podem devolver texto vazio: raciocínio curto e oculto.
  // Quem escolher "thinking: model" mantém o padrão do modelo (menos na voz, onde o limite é de ~260 tokens).
  if (voice || o.thinking !== 'model') body.reasoning = { effort: 'low', exclude: true };
  if (hasPdf(messages)) body.plugins = [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }]; // leitor de PDF gratuito
  return body;
}

// ---------- erros ----------
const asText = (x) => (typeof x === 'string' ? x : x == null ? '' : JSON.stringify(x));

// O "raw" que a OpenRouter repassa do provedor costuma ser um JSON em texto: pega só a mensagem dele
function rawDetail(meta) {
  if (!meta || meta.raw == null) return '';
  let raw = meta.raw;
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch (_) { return raw.slice(0, 200); } }
  const m = raw && (raw.message || (raw.error && (raw.error.message || raw.error)));
  return asText(m || raw).slice(0, 200);
}

function isDailyLimit(msg, meta) {
  return /per-day|daily|free-models-per-day/i.test(`${asText(msg)} ${asText(meta && meta.raw)}`);
}

// status + mensagem do servidor -> frase que o usuário entende
function describe(status, msg, meta) {
  const text = asText(msg);
  const prov = meta && meta.provider_name ? ` [${meta.provider_name}]` : '';
  const detail = rawDetail(meta) || text;
  let hint;
  if (status === 401) hint = 'chave inválida ou desativada: confira em openrouter.ai/keys';
  else if (status === 402) hint = 'sem créditos: recarregue em openrouter.ai/credits (modelos :free não gastam créditos)';
  else if (status === 403 && meta && Array.isArray(meta.reasons)) hint = `o texto foi barrado pela moderação do modelo (${meta.reasons.join(', ')})`;
  else if (status === 403) hint = 'acesso negado (a chave pode ter limite de gasto ou a conta está restrita)';
  else if (status === 404 && /data policy|privacy/i.test(text)) hint = 'nenhum provedor atende suas configurações de privacidade: para modelos :free, ative a publicação em openrouter.ai/settings/privacy';
  else if (status === 404) hint = 'modelo não encontrado ou fora do ar: use o botão Buscar para ver os disponíveis';
  else if (status === 400) hint = 'pedido recusado (o modelo não aceita algo do pedido ou a conversa passou do limite dele)';
  else if (status === 408) hint = 'o provedor demorou demais';
  else if (status === 429 && isDailyLimit(text, meta)) hint = 'acabou o limite diário dos modelos gratuitos: tente amanhã, escolha outro modelo ou compre créditos (US$ 10 sobem o limite para 1.000 por dia)';
  else if (status === 429) hint = 'muitos pedidos ao mesmo tempo (os modelos :free têm limite por minuto): espere um pouco ou configure um modelo reserva';
  else if (status === 502 || status === 503) hint = 'o provedor do modelo está fora do ar agora: tente de novo ou configure um modelo reserva';
  else if (status >= 500) hint = 'erro no servidor da OpenRouter';
  return `OpenRouter: ${status}${hint ? ` (${hint})` : ''}${prov} ${detail}`.replace(/\s+$/, '').slice(0, 420);
}

// erro que veio no CORPO de uma resposta 200 ({ error: { code, message, metadata } }), também no meio do streaming
function fromApiError(e) {
  const o = e && typeof e === 'object' ? e : { message: asText(e) };
  const code = Number(o.code);
  const status = Number.isFinite(code) && code >= 400 ? code : 502;
  const err = new Error(describe(status, o.message || 'erro do provedor', o.metadata));
  err.http = status;
  if (isDailyLimit(o.message, o.metadata)) err.daily = true;
  return err;
}

// ---------- novas tentativas ----------
const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
// Quanto esperar antes de tentar de novo (ms), ou null se não adianta tentar (chave inválida, sem créditos, limite do dia...)
function retryDelay(e, attempt) {
  if (!e || e.daily) return null;
  if (!(RETRY_STATUS.has(e.http) || e.net === true)) return null;
  if (e.retryAfter) return e.retryAfter <= 8 ? Math.ceil(e.retryAfter * 1000) : null;
  return [800, 2000][attempt] || 2000;
}

// ---------- lista de modelos ----------
const perM = (v) => { const n = Number(v) * 1e6; return Number.isFinite(n) ? String(+n.toFixed(2)) : '?'; };
const isFree = (m) => /:free$/.test(m.id) || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0);

function modelLabel(m) {
  const bits = [];
  if (m.context_length) bits.push(`${Math.round(m.context_length / 1000)}k`);
  const p = m.pricing;
  if (isFree(m)) bits.push('grátis');
  else if (p && Number(p.prompt) >= 0 && Number(p.completion) >= 0) bits.push(`US$ ${perM(p.prompt)}/${perM(p.completion)} por 1M`);
  else bits.push('preço varia');
  return bits.join(' · ');
}

// /models -> { ids, labels } só com modelos de texto (os de imagem, áudio e embeddings não servem para conversar).
// Ordem: openrouter/auto, gratuitos, depois o resto (cada grupo em ordem alfabética).
function describeModels(list) {
  const items = (Array.isArray(list) ? list : []).filter((m) => m && typeof m.id === 'string' && m.id
    && (!m.architecture || !Array.isArray(m.architecture.output_modalities) || m.architecture.output_modalities.join() === 'text'));
  const rank = (m) => (m.id === 'openrouter/auto' ? 0 : isFree(m) ? 1 : 2);
  items.sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  const labels = {};
  for (const m of items) labels[m.id] = modelLabel(m);
  return { ids: items.map((m) => m.id), labels };
}

// ---------- chave ----------
// GET /key: uso e limite da chave. Falhou? devolve null (é só uma informação extra, nunca atrapalha o teste).
async function keyInfo(key, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(`${BASE}/key`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && j.data) || null;
  } catch (_) { return null; }
}

function describeKey(d) {
  if (!d || typeof d !== 'object') return '';
  const money = (n) => `US$ ${Number(n).toFixed(2)}`;
  const parts = [];
  if (typeof d.limit_remaining === 'number') parts.push(`saldo da chave: ${money(d.limit_remaining)}`);
  else if (typeof d.usage === 'number') parts.push(`já gasto: ${money(d.usage)}`);
  if (d.is_free_tier) parts.push('conta sem créditos comprados (modelos :free: 50 pedidos por dia)');
  return parts.join(' · ');
}

module.exports = {
  BASE, APP_URL, APP_TITLE, SORTS, THINKING, MAX_FALLBACKS,
  headers, parseFallbacks, systemMessage, chatBody,
  describe, fromApiError, isDailyLimit, RETRY_STATUS, retryDelay,
  modelLabel, describeModels, keyInfo, describeKey,
};
