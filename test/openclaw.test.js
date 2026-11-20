'use strict';
// Provedor "openclaw": conversa com o gateway do OpenClaw (docs.openclaw.ai/gateway/openai-http-api),
// que fala o formato de chat da OpenAI. O app manda o agente no modelo e no cabeçalho, e dá mais tempo de espera
// (tarefas de agente podem demorar bem mais que uma resposta de chat comum).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const AIC = require('../src/ai-core');

const c = (p) => AIC.normalizeConfig(p);
const msgs = [{ role: 'user', content: 'oi' }];

test('config padrão: gateway local, agente padrão, nada de chave salva', () => {
  const cfg = c({});
  assert.equal(cfg.openclaw.url, 'http://127.0.0.1:18789/v1');
  assert.equal(cfg.openclaw.model, 'openclaw/default');
  assert.equal(cfg.openclaw.apiKey, '');
  assert.ok(AIC.PROVIDERS.includes('openclaw'));
});

test('buildRequest: URL, cabeçalho do agente e sessão estável', () => {
  const cfg = c({ provider: 'openclaw', openclaw: { url: 'http://127.0.0.1:18789/v1', apiKey: 'tok123', model: 'openclaw:main' } });
  const req = AIC.buildRequest(cfg, msgs, 'SYS', false, 300);
  assert.equal(req.kind, 'openai'); // mesmo formato de resposta da OpenAI: reaproveita o streaming já existente
  assert.equal(req.url, 'http://127.0.0.1:18789/v1/chat/completions');
  assert.equal(req.headers.Authorization, 'Bearer tok123');
  assert.equal(req.headers['x-openclaw-agent-id'], 'main');
  assert.equal(req.body.model, 'openclaw:main');
  assert.equal(req.body.user, 'yoru'); // sessão estável: o gateway mantém o fio da tarefa entre as falas
  assert.ok(req.ms >= 600000, 'tempo de espera bem maior que o do chat normal (agente pode demorar)');
});

test('buildRequest: aceita "agent:<id>" e tira o prefixo só para o cabeçalho', () => {
  const cfg = c({ provider: 'openclaw', openclaw: { apiKey: 'k', model: 'agent:video' } });
  const req = AIC.buildRequest(cfg, msgs, 'SYS', false, 300);
  assert.equal(req.headers['x-openclaw-agent-id'], 'video');
  assert.equal(req.body.model, 'agent:video'); // o modelo enviado ao gateway continua como a doc pede
});

test('buildRequest: sem token ou sem endereço, avisa o que falta (não tenta sem isso)', () => {
  assert.throws(() => AIC.buildRequest(c({ provider: 'openclaw' }), msgs, 's', false, 1), /token/i);
  assert.throws(() => AIC.buildRequest(c({ provider: 'openclaw', openclaw: { url: '', apiKey: 'k' } }), msgs, 's', false, 1), /endereço/i);
});

test('listModels: reaproveita o /models do gateway, como o servidor local', async () => {
  const calls = [];
  const fetchFake = async (url, opts) => {
    calls.push({ url, headers: opts.headers });
    return { ok: true, json: async () => ({ data: [{ id: 'openclaw:main' }, { id: 'openclaw:video' }] }) };
  };
  const ids = await AIC.listModels({ provider: 'openclaw', apiKey: 'tok', baseUrl: 'http://127.0.0.1:18789/v1' }, c({}), fetchFake);
  assert.deepEqual(ids, ['openclaw:main', 'openclaw:video']);
  assert.equal(calls[0].url, 'http://127.0.0.1:18789/v1/models');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
});

// ---------- a aba IA sabe mostrar e salvar esse provedor ----------
const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel.html'), 'utf8');
const panelIa = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel-ia.js'), 'utf8');
const ipcIa = fs.readFileSync(path.join(__dirname, '..', 'src', 'ipc-ia.js'), 'utf8');

test('painel: "openclaw" aparece no seletor de conexão e na tabela de nomes', () => {
  assert.match(panelHtml, /<option value="openclaw">/);
  assert.match(panelIa, /openclaw:\s*\{[^}]*key:\s*true[^}]*url:\s*true/s);
  assert.match(panelIa, /PROV_NAME\s*=\s*\{[^}]*openclaw/s);
});

test('painel: aviso de segurança do gateway existe e começa escondido', () => {
  assert.match(panelHtml, /id="openclawHint"[^>]*hidden/);
  assert.match(panelHtml, /127\.0\.0\.1/); // avisa para não expor o gateway na rede
});

test('main: get-config e set-config tratam o openclaw como os outros provedores com endereço', () => {
  assert.match(ipcIa, /openclaw:\s*\{\s*\.\.\.info\('openclaw'\)/); // + backendModel (modelo que o agente usa por trás)
  assert.match(ipcIa, /k === 'openclaw'/);
});

test('o balão de "digitando" ganha um aviso de progresso em tarefas longas', () => {
  const chat = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel-chat.js'), 'utf8');
  assert.match(chat, /WAIT_HINTS/);
  assert.match(chat, /cm-wait-hint/);
});

// ---------- skills: o que impedia o agente de trabalhar direito ----------
test('buildRequest: não manda max_tokens (o limite do modo FAST cortaria a tarefa do agente)', () => {
  const cfg = c({ provider: 'openclaw', openclaw: { apiKey: 'k' } });
  const req = AIC.buildRequest(cfg, msgs, 'SYS', true, 220);
  assert.ok(!('max_tokens' in req.body));
  assert.equal(req.body.stream, true);
});

test('buildRequest: agente padrão não manda o cabeçalho de agente; id específico manda', () => {
  const dflt = AIC.buildRequest(c({ provider: 'openclaw', openclaw: { apiKey: 'k' } }), msgs, 'S', false, 1);
  assert.equal(dflt.body.model, 'openclaw/default');
  assert.ok(!('x-openclaw-agent-id' in dflt.headers));
  const sp = AIC.buildRequest(c({ provider: 'openclaw', openclaw: { apiKey: 'k', model: 'openclaw/video' } }), msgs, 'S', false, 1);
  assert.equal(sp.body.model, 'openclaw/video');
  assert.equal(sp.headers['x-openclaw-agent-id'], 'video');
});

test('openclawTarget: todos os formatos do gateway', () => {
  const t = AIC.openclawTarget;
  assert.deepEqual(t('openclaw'), { model: 'openclaw', agentId: null });
  assert.deepEqual(t('openclaw/default'), { model: 'openclaw/default', agentId: null });
  assert.deepEqual(t('openclaw:main'), { model: 'openclaw:main', agentId: 'main' });
  assert.deepEqual(t('agent:video'), { model: 'agent:video', agentId: 'video' });
  assert.deepEqual(t('beta'), { model: 'openclaw/beta', agentId: 'beta' }); // só o id: completa o prefixo
  assert.deepEqual(t('  '), { model: 'openclaw/default', agentId: null });
});

test('buildRequest: o agente é avisado de que pode usar skills e que o limite de 2 frases não vale para o resultado', () => {
  const req = AIC.buildRequest(c({ provider: 'openclaw', openclaw: { apiKey: 'k' } }), msgs, 'SYS-BASE', false, 300, ' [TAIL]');
  const sys = req.body.messages[0];
  assert.equal(sys.role, 'system');
  assert.ok(sys.content.startsWith('SYS-BASE'));
  assert.match(sys.content, /skills/);
  assert.ok(sys.content.endsWith(' [TAIL]')); // o contexto de voz continua por último
  assert.equal(req.body.messages[1].content, 'oi');
});

test('outros provedores não recebem o aviso do OpenClaw nem perdem max_tokens', () => {
  const req = AIC.buildRequest(c({ provider: 'custom', custom: { model: 'm' } }), msgs, 'SYS', false, 222);
  assert.equal(req.body.max_tokens, 222);
  assert.ok(!/OpenClaw/.test(req.body.messages[0].content));
});

test('httpFail: 404/405 do OpenClaw explica que o endpoint está desligado; 401 fala do token', async () => {
  const resp = (status, body) => ({ status, text: async () => body, headers: { get: () => null } });
  const e404 = await AIC.httpFail('OpenClaw', resp(404, 'Not Found'));
  assert.match(e404.message, /chatCompletions\.enabled/);
  assert.match(e404.message, /setup:openclaw/);
  assert.equal(e404.http, 404);
  const e405 = await AIC.httpFail('OpenClaw', resp(405, 'Method Not Allowed'));
  assert.match(e405.message, /desligado/);
  const e401 = await AIC.httpFail('OpenClaw', resp(401, '{"error":{"message":"unauthorized"}}'));
  assert.match(e401.message, /token/i);
  const other = await AIC.httpFail('Servidor local', resp(404, 'x'));
  assert.doesNotMatch(other.message, /OpenClaw/); // só o OpenClaw ganha a dica própria
});

test('modo FAST do roteador não corta o OpenClaw (max_tokens nem é enviado)', () => {
  const routed = AIC.ROUTER.route(c({ provider: 'openclaw', openclaw: { apiKey: 'k' } }), 'oi', { maxTokens: 400 });
  assert.equal(routed.maxTokens, 220); // o roteador continua limitando...
  const req = AIC.buildRequest(routed.config, msgs, 'S', false, routed.maxTokens);
  assert.ok(!('max_tokens' in req.body)); // ...mas isso não chega no agente
});
