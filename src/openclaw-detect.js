'use strict';
// Descobre sozinho como falar com o OpenClaw instalado neste PC: lê o ~/.openclaw/openclaw.json (porta, token,
// se o endpoint de chat está ligado), testa o gateway e lista os agentes. Tudo com dependências injetáveis (fs, fetch...),
// sem Electron, para testar com `npm test`. O token fica só aqui e no processo principal: nunca é devolvido ao painel.
const nodeFs = require('node:fs');
const nodeOs = require('node:os');
const nodePath = require('node:path');

const DEFAULT_PORT = 18789;
const SNIPPET = `{
  gateway: {
    http: {
      endpoints: {
        chatCompletions: { enabled: true },
      },
    },
  },
}`;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const mask = (t) => (t.length <= 8 ? '****' : `${t.slice(0, 4)}…${t.slice(-2)} (${t.length} caracteres)`);
const defaultConfigPath = (os = nodeOs, path = nodePath) => path.join(os.homedir(), '.openclaw', 'openclaw.json');

// ---------- leitura da configuração ----------
// O openclaw.json pode ser JSON5 (comentários, vírgula sobrando, chaves sem aspas). Isto só LÊ; para gravar, só JSON puro.
function lenientParse(text) {
  const t = String(text || '');
  try { return { value: JSON.parse(t), strict: true }; } catch (_) { /* tenta o modo tolerante */ }
  let out = '', i = 0, q = '';
  while (i < t.length) { // tira comentários sem mexer dentro de textos
    const c = t[i], n = t[i + 1];
    if (q) { out += c; if (c === '\\') { out += n || ''; i += 2; continue; } if (c === q) q = ''; i++; continue; }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < t.length && t[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < t.length && !(t[i] === '*' && t[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  out = out
    .replace(/'([^'\\\n]*)'/g, (_m, s) => JSON.stringify(s))            // 'texto' -> "texto"
    .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:/g, '$1"$2":')              // chave: -> "chave":
    .replace(/,(\s*[}\]])/g, '$1');                                       // vírgula sobrando
  try { return { value: JSON.parse(out), strict: false }; } catch (_) { return { value: null, strict: false }; }
}

// Pega o que o Yoru precisa do openclaw.json (já lido). `env` cobre o token guardado em variável de ambiente.
function inspectConfig(cfg, env = {}) {
  const gw = isObj(cfg) && isObj(cfg.gateway) ? cfg.gateway : {};
  const auth = isObj(gw.auth) ? gw.auth : {};
  const eps = isObj(gw.http) && isObj(gw.http.endpoints) ? gw.http.endpoints : {};
  const cc = isObj(eps.chatCompletions) ? eps.chatCompletions : {};
  const mode = String(auth.mode || (auth.token ? 'token' : auth.password ? 'password' : 'token'));
  const pick = (v, ...envKeys) => (typeof v === 'string' && v ? v : envKeys.map((k) => env[k]).find((x) => typeof x === 'string' && x) || '');
  const secret = mode === 'none' ? '' : mode === 'password' ? pick(auth.password, 'OPENCLAW_GATEWAY_PASSWORD') : pick(auth.token, 'OPENCLAW_GATEWAY_TOKEN');
  const port = Number.isInteger(gw.port) && gw.port > 0 && gw.port < 65536 ? gw.port : DEFAULT_PORT;
  return { port, mode, secret, secretIsRef: isObj(auth.token) || isObj(auth.password), enabled: cc.enabled === true, bind: String(gw.bind || '') };
}

// Liga gateway.http.endpoints.chatCompletions.enabled num objeto (sem mexer no original) — usado pelo script e pelo botão.
function plan(cfg) {
  const notes = [];
  const next = structuredClone(isObj(cfg) ? cfg : {});
  const gw = (next.gateway = isObj(next.gateway) ? next.gateway : {});
  const http = (gw.http = isObj(gw.http) ? gw.http : {});
  const eps = (http.endpoints = isObj(http.endpoints) ? http.endpoints : {});
  const cc = (eps.chatCompletions = isObj(eps.chatCompletions) ? eps.chatCompletions : {});
  const changed = cc.enabled !== true;
  cc.enabled = true;

  const info = inspectConfig(cfg);
  if (info.mode === 'none') notes.push('O gateway está sem autenticação (mode "none"): o Yoru ainda pede um token na aba IA, use qualquer texto. Mantenha o gateway só neste PC.');
  else if (!info.secret) notes.push('Não achei o token em texto no arquivo (pode estar em variável de ambiente OPENCLAW_GATEWAY_TOKEN ou em um SecretRef). Use o mesmo valor que o gateway usa.');
  const bind = info.bind.toLowerCase();
  if (bind && !['loopback', '127.0.0.1', 'localhost'].includes(bind)) {
    notes.push(`O gateway escuta em "${info.bind}", ou seja, alcançável por outros aparelhos. Um token válido dá acesso total ao agente: prefira loopback, ou Tailscale se precisar de acesso remoto.`);
  }
  return { changed, next, mode: info.mode, secret: info.secret, notes };
}

// Grava o endpoint ligado, com cópia de segurança. Só reescreve JSON puro (senão perderia os comentários do usuário).
function enableEndpoint(file, { fs = nodeFs, now = () => new Date() } = {}) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = lenientParse(raw);
  if (!parsed.strict) return { ok: false, reason: 'not-json' };
  const p = plan(parsed.value);
  if (!p.changed) return { ok: true, changed: false };
  const backup = `${file}.yoru-bak-${now().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, JSON.stringify(p.next, null, 2) + '\n');
  return { ok: true, changed: true, backup };
}

// ---------- OpenRouter dentro do OpenClaw ----------
// Quem chama o modelo é o OpenClaw, então a chave do OpenRouter tem de estar na configuração DELE (env.vars.OPENROUTER_API_KEY; o OpenClaw 2026.11+ recusa a chave solta em env).
const KEY_RE = /^sk-or-\S{10,}$/;
const FALLBACK_FREE = 'meta-llama/llama-3.3-70b-instruct:free'; // o exemplo da documentação do OpenRouter para o OpenClaw

function setOpenRouterKey(file, key, { fs = nodeFs, now = () => new Date() } = {}) {
  if (!KEY_RE.test(String(key || ''))) return { ok: false, reason: 'bad-key' };
  const parsed = lenientParse(fs.readFileSync(file, 'utf8'));
  if (!parsed.strict) return { ok: false, reason: 'not-json' };
  const next = structuredClone(isObj(parsed.value) ? parsed.value : {});
  next.env = isObj(next.env) ? next.env : {};
  next.env.vars = isObj(next.env.vars) ? next.env.vars : {};
  const legacy = Object.prototype.hasOwnProperty.call(next.env, 'OPENROUTER_API_KEY'); // gravado pelas versões antigas da Yoru: o OpenClaw novo o rejeita
  if (!legacy && next.env.vars.OPENROUTER_API_KEY === key) return { ok: true, changed: false };
  const backup = `${file}.yoru-bak-${now().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(file, backup); // a cópia é do arquivo ANTES de entrar a chave
  delete next.env.OPENROUTER_API_KEY;
  next.env.vars.OPENROUTER_API_KEY = key;
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
  return { ok: true, changed: true, backup };
}

const isFreeModel = (m) => !!m && typeof m.id === 'string' && (m.id.endsWith(':free')
  || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0 && m.id !== 'openrouter/auto'));
// Skills precisam de chamada de ferramentas: só entram os que declaram suporte (ou não informam nada).
const supportsTools = (m) => !Array.isArray(m.supported_parameters) || m.supported_parameters.includes('tools');
const isText = (m) => !m.architecture || !Array.isArray(m.architecture.output_modalities) || m.architecture.output_modalities.join() === 'text';
function freeModels(list) {
  return (Array.isArray(list) ? list : []).filter((m) => isFreeModel(m) && supportsTools(m) && isText(m))
    .sort((a, b) => (Number(b.context_length) || 0) - (Number(a.context_length) || 0) || a.id.localeCompare(b.id)).map((m) => m.id);
}
// Escolhe o modelo gratuito: o da documentação, se estiver disponível; senão o de maior contexto que aceita ferramentas.
function pickFreeModel(list) {
  const ids = freeModels(list);
  return ids.includes(FALLBACK_FREE) ? FALLBACK_FREE : ids[0] || FALLBACK_FREE;
}
// "meta-llama/x:free" -> "openrouter/meta-llama/x:free" (formato que o OpenClaw espera)
const backendModelRef = (v) => { const m = String(v || '').trim().slice(0, 160); return !m ? '' : /^openrouter\//.test(m) ? m : `openrouter/${m}`; };

// ---------- teste do gateway ----------
// status: ok | bad-token | endpoint-off | down
async function probe({ port, secret, fetch = globalThis.fetch, timeoutMs = 5000 }) {
  const url = `http://127.0.0.1:${port}/v1`;
  try {
    const r = await fetch(`${url}/models`, { headers: secret ? { Authorization: `Bearer ${secret}` } : {}, signal: AbortSignal.timeout(timeoutMs) });
    if (r.status === 401 || r.status === 403) return { status: 'bad-token', url };
    if (r.status === 404 || r.status === 405) return { status: 'endpoint-off', url };
    if (!r.ok) return { status: 'down', url, http: r.status };
    let ids = [];
    try { const j = await r.json(); ids = (Array.isArray(j && j.data) ? j.data : []).map((m) => m && m.id).filter((x) => typeof x === 'string'); } catch (_) {}
    return { status: 'ok', url, agents: ids };
  } catch (_) {
    return { status: 'down', url };
  }
}

// ---------- onde o token pode estar ----------
// O gateway pode usar um segredo que NÃO está em texto no openclaw.json: variável de ambiente, env.vars, ~/.openclaw/.env,
// o gateway.cmd do serviço do Windows ou um SecretRef. Junta todos os candidatos (sem repetir), na ordem de confiança.
const SECRET_RE = /^[A-Za-z0-9._~+\/=:-]{8,256}$/;
const TOKEN_KEYS = ['OPENCLAW_GATEWAY_TOKEN', 'CLAWDBOT_GATEWAY_TOKEN'];
const PASS_KEYS = ['OPENCLAW_GATEWAY_PASSWORD', 'CLAWDBOT_GATEWAY_PASSWORD'];
function parseDotenv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}
// gateway.cmd (Windows): linhas `set "OPENCLAW_GATEWAY_TOKEN=valor"` ou `set OPENCLAW_GATEWAY_TOKEN=valor`
function parseCmdEnv(text) {
  const out = {};
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = raw.match(/^\s*set\s+"?([A-Z0-9_]+)=([^"\r\n]*)"?\s*$/i);
    if (m) out[m[1].toUpperCase()] = m[2].trim();
  }
  return out;
}
function readTextSafe(fs, file) { try { return fs.readFileSync(file, 'utf8'); } catch (_) { return ''; } }
function collectSecrets({ cfg, info, env = {}, fs = nodeFs, file }) {
  const dir = file ? nodePath.dirname(file) : '';
  const gw = isObj(cfg) && isObj(cfg.gateway) ? cfg.gateway : {};
  const auth = isObj(gw.auth) ? gw.auth : {};
  const cfgVars = isObj(cfg) && isObj(cfg.env) && isObj(cfg.env.vars) ? cfg.env.vars : {};
  const dot = dir ? parseDotenv(readTextSafe(fs, nodePath.join(dir, '.env'))) : {};
  const svc = dir ? parseCmdEnv(readTextSafe(fs, nodePath.join(dir, 'gateway.cmd'))) : {};
  const sources = [cfgVars, dot, svc, env]; // variáveis do próprio openclaw.json primeiro
  const look = (k) => sources.map((s) => s[k]).find((x) => typeof x === 'string' && x) || '';
  const ref = (v) => (isObj(v) && typeof v.id === 'string' ? look(v.id) : ''); // SecretRef {source:'env', id:'NOME'}
  const text = (v) => (typeof v === 'string' ? v : '');
  const tok = [text(auth.token), ref(auth.token), ...TOKEN_KEYS.map(look)];
  const pwd = [text(auth.password), ref(auth.password), ...PASS_KEYS.map(look)];
  const ordered = info.mode === 'password' ? [...pwd, ...tok] : [...tok, ...pwd]; // o outro tipo entra por último: já salvou muita gente
  const seen = new Set();
  return ordered.filter((v) => v && SECRET_RE.test(v) && !seen.has(v) && seen.add(v));
}
// Pergunta ao próprio OpenClaw (ele resolve SecretRef e variáveis). Só roda se nenhum candidato anterior serviu.
async function cliSecrets(exec) {
  const found = [];
  for (const key of ['gateway.auth.token', 'gateway.auth.password']) {
    try {
      const r = await exec(['config', 'get', key], { timeout: 20000 });
      if (r && r.code === 0) for (const line of String(r.out || '').split(/\r?\n/)) { const t = line.trim().replace(/^"|"$/g, ''); if (SECRET_RE.test(t) && !found.includes(t)) found.push(t); }
    } catch (_) { /* sem CLI */ }
  }
  return found;
}
// Testa cada candidato: o primeiro que o gateway não recusa vence. Sem candidatos, testa sem token (modo "none").
async function probeCandidates(cands, { port, fetch }) {
  if (!cands.length) return { res: await probe({ port, secret: '', fetch }), secret: '' };
  let last = null;
  for (const secret of cands) {
    const res = await probe({ port, secret, fetch });
    if (res.status !== 'bad-token') return { res, secret };
    last = res;
  }
  return { res: last, secret: '' };
}

const pickAgent = (agents) => (agents.includes('openclaw/default') ? 'openclaw/default' : agents.find((a) => /^openclaw[/:]/.test(a)) || agents[0] || 'openclaw/default');

/**
 * Procura o OpenClaw, (opcionalmente) liga o endpoint e testa.
 * opts: { enable, file, env, fs, os, fetch, wait, retries }
 * Devolve { status, url, token, model, agents, enabledNow, backup, canEnable, notes, file }.
 *   status: ok | bad-token | endpoint-off | down | no-config | not-json
 * `token` só existe aqui dentro: quem chama (processo principal) grava e NÃO repassa ao painel.
 */
async function detect(opts = {}) {
  const { enable = false, env = process.env, fs = nodeFs, os = nodeOs, fetch = globalThis.fetch,
    wait = (ms) => new Promise((r) => setTimeout(r, ms)), retries = 4 } = opts;
  const file = opts.file || defaultConfigPath(os);
  const notes = [];
  const exists = fs.existsSync(file);
  let info = inspectConfig(null, env), strict = false, canEdit = false;
  if (exists) {
    const parsed = lenientParse(fs.readFileSync(file, 'utf8'));
    strict = parsed.strict;
    if (parsed.value) info = inspectConfig(parsed.value, env);
    else notes.push('Não consegui ler o openclaw.json (formato fora do comum): usei a porta padrão.');
    canEdit = strict;
  } else {
    notes.push(`Não encontrei ${file}. Tentei a porta padrão (${DEFAULT_PORT}) mesmo assim.`);
  }
  if (info.secretIsRef && !info.secret) notes.push('O token está guardado como segredo (SecretRef/variável de ambiente), que o Yoru não consegue ler: cole o token na aba IA.');

  let enabledNow = false, backup = '';
  if (enable && exists && info.enabled !== true) {
    if (!canEdit) return { status: 'not-json', file, notes, snippet: SNIPPET, canEnable: false, agents: [] };
    const w = enableEndpoint(file, { fs });
    enabledNow = !!(w.ok && w.changed);
    backup = w.backup || '';
  }

  const parsedCfg = exists ? lenientParse(fs.readFileSync(file, 'utf8')).value : null;
  const cands = collectSecrets({ cfg: parsedCfg, info, env, fs, file });
  let { res, secret } = await probeCandidates(cands, { port: info.port, fetch });
  if (res.status === 'bad-token' && typeof opts.exec === 'function') { // nenhum servia: pergunta ao próprio OpenClaw
    const more = (await cliSecrets(opts.exec)).filter((c) => !cands.includes(c));
    if (more.length) ({ res, secret } = await probeCandidates(more, { port: info.port, fetch }));
  }
  for (let n = 0; enabledNow && res.status === 'endpoint-off' && n < retries; n++) { // o gateway recarrega a configuração sozinho, mas demora um instante
    await wait(1000);
    res = (await probeCandidates(secret ? [secret] : cands, { port: info.port, fetch })).res;
  }
  if (secret && secret !== info.secret) notes.push('O token que o gateway aceita não é o que está em texto no openclaw.json (veio de outra fonte); usei esse.');
  let status = res.status;
  if (status === 'down' && !exists) status = 'no-config';
  const agents = res.agents || [];
  const token = info.mode === 'none' ? 'sem-token' : (secret || info.secret); // modo "none": o Yoru exige algum texto no campo
  return {
    status, url: res.url, token, model: status === 'ok' ? pickAgent(agents) : '', agents,
    enabledNow, backup, file, notes, mode: info.mode,
    canEnable: status === 'endpoint-off' && exists && canEdit,
    tokenHint: token ? mask(token) : '',
  };
}

// Texto para o painel (em português)
function describe(r) {
  const base = {
    ok: `Pronto ✔ OpenClaw encontrado em ${r.url}` + (r.agents.length ? ` — agentes: ${r.agents.join(', ')}.` : '.') + (r.enabledNow ? ' Liguei o endpoint de chat (cópia de segurança ao lado do arquivo).' : ''),
    'bad-token': 'Achei o gateway, mas ele recusou todos os tokens que encontrei (arquivo, variáveis, .env, serviço e o próprio comando openclaw). Rode "openclaw gateway restart" e tente de novo, ou cole o token certo no campo Chave.',
    'endpoint-off': r.canEnable
      ? 'Achei o OpenClaw, mas o endpoint de chat está desligado (vem assim de fábrica).'
      : 'O gateway respondeu, mas o endpoint de chat está desligado e não consegui ligar sozinho. Adicione gateway.http.endpoints.chatCompletions.enabled = true no openclaw.json.',
    down: 'Não consegui falar com o gateway. O OpenClaw está rodando? (openclaw gateway status)',
    'no-config': 'Não achei o OpenClaw neste PC (sem ~/.openclaw/openclaw.json e nada respondendo na porta padrão). Instale-o e rode o onboarding, ou preencha o endereço e o token à mão.',
    'not-json': 'O openclaw.json tem comentários ou formato livre (JSON5), então não reescrevo sozinha. Junte este trecho à mão:\n' + SNIPPET,
  }[r.status] || 'Resultado inesperado.';
  return [base, ...r.notes].join(' ');
}

module.exports = { collectSecrets, parseDotenv, parseCmdEnv, cliSecrets, setOpenRouterKey, freeModels, pickFreeModel, isFreeModel, backendModelRef, KEY_RE, FALLBACK_FREE, lenientParse, inspectConfig, plan, enableEndpoint, probe, detect, describe, mask, pickAgent, defaultConfigPath, SNIPPET, DEFAULT_PORT };
