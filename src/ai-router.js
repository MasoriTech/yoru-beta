'use strict';
// Roteamento determinístico e leve: não faz chamadas de rede nem tenta adivinhar disponibilidade.
const MODES = Object.freeze(['auto', 'fast', 'think', 'local']);
function classify(text, opts = {}) {
  if (opts.voice) return 'fast';
  const s = String(text || '').trim();
  if (s.length > 700 || /\b(analise|analisa|compare|comparar|planeje|planejar|estruture|explique detalhadamente|passo a passo|debug|arquitetura|relat[oó]rio|pesquise)\b/i.test(s)) return 'think';
  if ((s.match(/[?!.]/g) || []).length > 3 || s.split(/\s+/).length > 65) return 'think';
  return 'fast';
}
function route(config, text, opts = {}) {
  const cfg = structuredClone(config || {});
  const routing = cfg.routing && typeof cfg.routing === 'object' ? cfg.routing : {};
  let mode = MODES.includes(routing.mode) ? routing.mode : 'auto';
  if (mode === 'auto') mode = classify(text, opts);
  if (mode === 'local') {
    if (cfg.provider === 'kobold') cfg.kobold = { ...(cfg.kobold || {}) }; // o KoboldCpp já é local: continua nele
    else { cfg.provider = 'ollama'; cfg.ollama = { ...(cfg.ollama || {}) }; }
  } else if (mode === 'fast' && routing.fastModel) {
    const p = cfg.provider;
    if (cfg[p]) cfg[p].model = String(routing.fastModel).trim().slice(0, 160);
  } else if (mode === 'think' && routing.thinkModel) {
    const p = cfg.provider;
    if (cfg[p]) cfg[p].model = String(routing.thinkModel).trim().slice(0, 160);
  }
  return { config: cfg, mode, maxTokens: mode === 'fast' ? Math.min(Number(opts.maxTokens) || 400, 220) : (Number(opts.maxTokens) || 400) };
}
module.exports = { MODES, classify, route };
