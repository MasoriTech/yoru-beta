'use strict';
// Conexão automática com o OpenClaw: a Yoru se reconecta sozinha quando o token muda, o gateway reinicia ou o app abre
// com a conexão quebrada. Aqui é o jeito LEVE (só lê e testa, no máximo inicia/reinicia o serviço do gateway, o que não
// mexe em arquivo nenhum). O jeito PESADO (reescrever o openclaw.json) continua só no botão "Reparar", com confirmação.
// Sem Electron: dependências injetáveis, testado em test/openclaw-connect.test.js.
const OCD = require('./openclaw-detect');
const { defaultExec } = require('./openclaw-skills');
const { openclawTarget } = require('./ai-core');

function createConnector({
  detect = OCD.detect, probe = OCD.probe, exec = defaultExec, loadConfig, saveConfig, log = () => {},
  deep = null, deepCooldownMs = 10 * 60000, now = () => Date.now(), wait = (ms) => new Promise((r) => setTimeout(r, ms)), cooldownMs = 30000, file,
} = {}) {
  let inflight = null;
  let lastFail = 0;
  let lastFailRes = null;
  let lastDeep = -Infinity;

  // Guarda a conexão detectada (endereço, token, agente). Mantém o agente que a pessoa já escolheu, se ele ainda existir.
  function saveDetected(r) {
    const c = loadConfig();
    c.provider = 'openclaw';
    c.openclaw.url = r.url;
    if (r.token) c.openclaw.apiKey = r.token;
    const cur = String(c.openclaw.model || '').trim();
    const t = openclawTarget(cur);
    const keep = cur && (!t.agentId || r.agents.includes(`openclaw/${t.agentId}`));
    if (!keep) c.openclaw.model = r.model;
    saveConfig(c);
  }

  async function attempt() {
    const before = loadConfig().openclaw || {};
    const opts = { enable: false, exec, ...(file ? { file } : {}) };
    let d = await detect(opts);
    if (d.status === 'down') { // gateway parado: tenta iniciar o serviço (não muda arquivo) e espera ele subir
      await exec(['gateway', 'start'], { timeout: 60000 });
      for (let n = 0; n < 6 && d.status === 'down'; n++) { await wait(1500); d = await detect(opts); }
    }
    if (d.status === 'bad-token') { // o serviço pode estar com o token antigo na memória: reinicia e testa de novo
      await exec(['gateway', 'restart'], { timeout: 60000 });
      await wait(3000);
      d = await detect(opts);
    }
    if (d.status !== 'ok' && ['bad-token', 'no-config'].includes(d.status) && typeof deep === 'function' && now() - lastDeep > deepCooldownMs) {
      // a leitura/teste leves não resolveram: reparo completo (config válida, token novo definido, gateway no ar). Com cópia de segurança.
      lastDeep = now();
      log('[openclaw] reconexão leve falhou; rodando o reparo completo');
      let got = null;
      const res = await deep({ save: (x) => { got = x; saveDetected(x); } });
      if (res && res.ok && got) return { ok: true, status: 'ok', changed: true, url: got.url, apiKey: got.token, deep: true };
    }
    if (d.status !== 'ok') return { ok: false, status: d.status, changed: false };
    const changed = d.token !== before.apiKey || d.url !== before.url;
    if (changed) saveDetected(d);
    return { ok: true, status: 'ok', changed, url: d.url, apiKey: d.token };
  }

  // Várias falas com 401 ao mesmo tempo viram UMA tentativa; depois de falhar, espera um pouco antes de insistir.
  async function reconnect() {
    if (inflight) return inflight;
    if (lastFailRes && now() - lastFail < cooldownMs) return lastFailRes;
    inflight = attempt().catch((e) => ({ ok: false, status: 'error', changed: false, error: String(e && e.message || e) }))
      .then((r) => { if (!r.ok) { lastFail = now(); lastFailRes = r; } else { lastFailRes = null; log('[openclaw] reconectado sozinha'); } return r; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  // Ao abrir o app: se o OpenClaw é o provedor e a conexão guardada não funciona, reconecta em segundo plano.
  async function ensure() {
    const c = loadConfig();
    if (c.provider !== 'openclaw' || !c.openclaw) return { ok: true, skipped: true };
    let port = 18789;
    try { const u = new URL(c.openclaw.url); port = Number(u.port) || 18789; } catch (_) { /* usa a padrão */ }
    const p = await probe({ port, secret: c.openclaw.apiKey || '' });
    if (p.status === 'ok') return { ok: true, changed: false };
    return reconnect();
  }

  return { reconnect, ensure, saveDetected };
}

module.exports = { createConnector };
