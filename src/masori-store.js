'use strict';
const PROVIDERS = Object.freeze(['inherit', 'kobold', 'anthropic', 'openrouter', 'ollama', 'custom', 'openclaw']);
const AGENT_IDS = Object.freeze(['masori-dev', 'masori-research', 'masori-vision', 'masori-memory', 'masori-voice', 'masori-agent']);
function sanitizeConfig(input = {}) {
  const out = {};
  for (const id of AGENT_IDS) {
    const row = input && typeof input[id] === 'object' ? input[id] : {};
    const provider = PROVIDERS.includes(row.provider) ? row.provider : 'inherit';
    out[id] = { provider, model: String(row.model || '').trim().slice(0, 160), enabled: row.enabled !== false };
  }
  return out;
}
function agentConfig(base, row) {
  const p = row && row.provider && row.provider !== 'inherit' ? row.provider : base.provider;
  const cfg = { ...base, provider: p, [p]: { ...(base[p] || {}) } };
  if (row && row.model) cfg[p].model = String(row.model).slice(0, 160);
  return cfg;
}
function appendHistory(history, item) {
  const status = ['completed', 'failed', 'cancelled'].includes(item.status) ? item.status : (item.ok ? 'completed' : 'failed');
  const clean = {
    id: String(item.id || Date.now()).slice(0, 120), task: String(item.task || '').slice(0, 4000), ok: !!item.ok, status,
    createdAt: Number(item.createdAt) || Date.now(),
    specialists: Array.isArray(item.specialists) ? item.specialists.slice(0, 6).map((r) => ({ agent: String(r.agent || '').slice(0, 80), ok: !!r.ok, cancelled: !!r.cancelled, text: String(r.text || '').slice(0, 3500) })) : [],
    text: String(item.text || '').slice(0, 7000),
    workspaceFiles: Array.isArray(item.workspaceFiles) ? [...new Set(item.workspaceFiles.map((v) => String(v || '').slice(0, 500)).filter(Boolean))].slice(0, 8) : [],
  };
  return [clean, ...(Array.isArray(history) ? history : [])].slice(0, 30);
}
function memoryFor(history, agentId) {
  return (Array.isArray(history) ? history : []).filter((h) => Array.isArray(h.specialists) && h.specialists.some((r) => r.agent === agentId && r.ok)).slice(0, 3).map((h) => {
    const report = h.specialists.find((r) => r.agent === agentId && r.ok);
    return `Tarefa anterior: ${h.task.slice(0, 500)}\nAprendizado/relatório: ${report.text.slice(0, 1200)}`;
  }).join('\n\n');
}
module.exports = { PROVIDERS, AGENT_IDS, sanitizeConfig, agentConfig, appendHistory, memoryFor };
