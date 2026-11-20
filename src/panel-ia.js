// Aba IA: conexão, personalidade e comandos que a IA conhece.
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- configuração da IA -----
const status = (text, ok) => { const s = $('#cfgStatus'); s.textContent = text; s.className = 'status ' + (ok === undefined ? '' : ok === 'warn' ? 'warn' : ok ? 'ok' : 'bad'); };
let cfg = null;
const INFO = {
  kobold: { key: true, url: true, urlLabel: 'Endereço do KoboldCpp (termina em /v1)', keyOptional: true, keyHelp: 'Opcional: só se você abriu o KoboldCpp com --password.', model: 'koboldcpp', modelHelp: 'Pode deixar como está: o KoboldCpp usa o modelo que você carregou nele. Buscar mostra qual é.' },
  anthropic: { key: true, url: false, keyHelp: 'Crie em console.anthropic.com. Fica salva só neste PC (config.json).', model: 'claude-sonnet-5-5', modelHelp: '' },
  openrouter: { key: true, url: false, extras: true, keyHelp: 'Crie em openrouter.ai/keys. Fica salva só neste PC (config.json).', model: 'openrouter/auto', modelHelp: 'Clique em Buscar para listar. Modelos terminados em :free não custam nada. "openrouter/auto" escolhe sozinho.' },
  ollama: { key: false, url: true, urlLabel: 'Endereço do Ollama', model: 'llama3.1', modelHelp: 'Instale o Ollama e rode: ollama pull llama3.1. Use Buscar para listar os modelos instalados.' },
  custom: { key: true, url: true, urlLabel: 'Endereço do servidor (termina em /v1)', keyOptional: true, keyHelp: 'Opcional: só se o seu servidor exigir chave.', model: '', modelHelp: 'Ligue o servidor local no programa e use Buscar para escolher o modelo carregado.' },
  openclaw: { key: true, url: true, urlLabel: 'Endereço do gateway do OpenClaw (termina em /v1)', keyHelp: 'Token do gateway: gateway.auth.token no ~/.openclaw/openclaw.json. Fica salvo só neste PC.', model: 'openclaw/default', modelHelp: 'Agente a chamar: openclaw/default (o padrão do gateway) ou openclaw/<id>. As skills são as desse agente; use Buscar para listar os agentes.' },
};
function fillProvider() {
  const p = $('#provider').value;
  const i = INFO[p], c = (cfg && cfg.providers[p]) || {};
  $('#f-baseUrl').style.display = i.url ? '' : 'none';
  $('#presets').style.display = (p === 'custom' || p === 'openclaw' || p === 'kobold') ? '' : 'none';
  $('#openclawHint').hidden = p !== 'openclaw';
  $('#openclawTools').hidden = p !== 'openclaw';
  if (p === 'openclaw') $('#ocBackendModel').value = String(c.backendModel || '').replace(/^openrouter\//, '');
  if (i.url) { $('#baseUrlLabel').textContent = i.urlLabel; $('#baseUrl').value = c.url || ''; }
  $('#f-key').style.display = i.key ? '' : 'none';
  $('#keyLabel').textContent = 'Chave da API' + (i.keyOptional ? ' (opcional)' : '');
  $('#keyHelp').textContent = i.keyHelp || '';
  $('#apiKey').value = '';
  $('#apiKey').placeholder = c.hasKey ? `Chave salva (${c.keyHint}) — deixe em branco para manter` : (p === 'openrouter' ? 'sk-or-...' : p === 'anthropic' ? 'sk-ant-...' : '');
  $('#keyClear').style.display = c.hasKey ? '' : 'none';
  $('#model').value = c.model || '';
  $('#model').placeholder = i.model || 'nome do modelo';
  $('#modelHelp').textContent = i.modelHelp || '';
  $('#modelList').innerHTML = '';
  $('#orExtra').hidden = !i.extras; // opções só do OpenRouter: modelos reserva, ordem do provedor e raciocínio
  if (i.extras) { $('#orFallbacks').value = c.fallbacks || ''; $('#orSort').value = c.sort || ''; $('#orThinking').value = c.thinking || 'fast'; }
}
$('#provider').addEventListener('change', () => { fillProvider(); paintHero(); });
$('#keyEye').addEventListener('click', () => { const k = $('#apiKey'); k.type = k.type === 'password' ? 'text' : 'password'; });
document.querySelectorAll('#presets [data-url]').forEach((b) => b.addEventListener('click', () => ($('#baseUrl').value = b.dataset.url)));
async function loadConfig() {
  cfg = await panel.getConfig();
  if (!$('#provider').dataset.init) { $('#provider').value = cfg.provider; $('#provider').dataset.init = '1'; }
  $('#systemPrompt').value = cfg.systemPrompt;
  const routing = cfg.routing || {};
  $('#routingMode').value = routing.mode || 'auto';
  $('#fastModel').value = routing.fastModel || '';
  $('#thinkModel').value = routing.thinkModel || '';
  fillProvider();
  paintPromptCount();
  paintHero();
}
const formValues = (extra = {}) => ({
  provider: $('#provider').value,
  apiKey: $('#apiKey').value,
  model: $('#model').value,
  baseUrl: $('#baseUrl').value,
  systemPrompt: $('#systemPrompt').value,
  routing: { mode: $('#routingMode').value, fastModel: $('#fastModel').value.trim(), thinkModel: $('#thinkModel').value.trim() },
  ...($('#provider').value === 'openrouter' ? { fallbacks: $('#orFallbacks').value, sort: $('#orSort').value, thinking: $('#orThinking').value } : {}),
  ...extra,
});
async function saveConfig(extra) {
  await panel.setConfig(formValues(extra));
  await loadConfig();
  setDirty(false);
}
$('#keyClear').addEventListener('click', async () => {
  await saveConfig({ clearKey: true });
  status('Chave apagada.', true);
});
$('#modelsBtn').addEventListener('click', async () => {
  status('Buscando modelos...');
  const r = await panel.listModels(formValues());
  if (!r.ok) return status('Falhou: ' + r.text, false);
  const dl = $('#modelList');
  dl.innerHTML = '';
  r.ids.forEach((id) => { const o = document.createElement('option'); o.value = id; if (r.labels && r.labels[id]) o.label = r.labels[id]; dl.appendChild(o); }); // no OpenRouter: "128k · grátis" ao lado do nome
  status(`${r.ids.length} modelos encontrados — clique no campo Modelo e escolha (ou digite para filtrar).`, true);
  $('#model').focus();
  $('#model').select();
});
$('#cfgSave').addEventListener('click', async () => { await saveConfig(); status('Salvo ✔ (config.json)', true); });
$('#cfgTest').addEventListener('click', async () => {
  await saveConfig();
  status('Testando...');
  const r = await panel.testConfig();
  status(r.ok ? 'Conexão ok ✔ — resposta: ' + r.text : 'Falhou: ' + r.text, r.ok);
});

// ----- OpenClaw: detectar sozinha e listar as skills -----
const ocStatus = (text, ok) => { const s = $('#ocStatus'); s.textContent = text; s.className = 'status ' + (ok === undefined ? '' : ok ? 'ok' : 'bad'); };
async function ocDetect(enable) {
  ocStatus('Procurando o OpenClaw neste PC...');
  const r = await panel.openclawDetect({ enable: !!enable });
  if (r.status === 'endpoint-off' && r.canEnable && !enable) {
    ocStatus(r.text);
    if (confirm('O endpoint de chat do OpenClaw está desligado. Posso ligá-lo no ~/.openclaw/openclaw.json? Faço uma cópia de segurança do arquivo antes.')) return ocDetect(true);
    return;
  }
  if (r.ok) {
    $('#provider').value = 'openclaw';
    await loadConfig(); // a detecção já salvou endereço, token e agente: só mostra na tela
    setDirty(false);
    $('#apiKey').placeholder = r.tokenHint ? `Token salvo (${r.tokenHint})` : $('#apiKey').placeholder;
  }
  ocStatus(r.text, !!r.ok);
  if (!r.ok && ['bad-token', 'down', 'not-json', 'error'].includes(r.status) && confirm('Não consegui conectar ao OpenClaw. Quer que eu tente consertar sozinha (config, gateway e token)?')) ocRepair();
}
$('#ocDetect').addEventListener('click', () => ocDetect(false));
panel.onOpenclawRepairStep((t) => ocStatus(t)); // passos ao vivo do reparo
async function ocRepair() {
  if (!confirm('Vou deixar o OpenClaw pronto para uso: arrumar o ~/.openclaw/openclaw.json (ou criar um novo se faltar), iniciar o gateway se estiver parado e, se nenhum token servir, definir um token novo no OpenClaw e guardar o mesmo aqui. Faço cópia de segurança do arquivo antes. Posso continuar?')) return;
  ocStatus('Reparando o OpenClaw...');
  const r = await panel.openclawRepair();
  if (r.ok) { await loadConfig(); setDirty(false); }
  ocStatus(r.text || r.error || 'Falhou.', !!r.ok);
}
$('#ocRepair').addEventListener('click', ocRepair);
async function ocFree(clear) {
  if (!clear && !confirm('Vou colocar a chave do OpenRouter no ~/.openclaw/openclaw.json (com cópia de segurança do arquivo antes) e usar um modelo gratuito no agente. Posso continuar?')) return;
  ocStatus(clear ? 'Voltando ao modelo do OpenClaw...' : 'Enviando a chave ao OpenClaw...');
  const r = await panel.openclawOpenRouter(clear ? { clear: true } : { key: $('#ocOrKey').value, model: $('#ocBackendModel').value });
  if (r.ok) { $('#ocOrKey').value = ''; $('#ocBackendModel').value = r.model ? r.model.replace(/^openrouter\//, '') : ''; }
  ocStatus(r.text, !!r.ok);
}
$('#ocFree').addEventListener('click', () => ocFree(false));
$('#ocFreeOff').addEventListener('click', () => ocFree(true));
$('#ocSkills').addEventListener('click', async () => {
  const box = $('#ocSkillList');
  box.hidden = true;
  ocStatus('Perguntando ao agente quais skills ele tem... (pode levar um pouco)');
  const r = await panel.openclawSkills();
  if (!r.ok) return ocStatus('Falhou: ' + r.text, false);
  box.textContent = r.text;
  box.hidden = false;
  ocStatus('Skills informadas pelo próprio agente:', true);
});

// ----- OpenClaw: buscar e instalar skills -----
const SRC_OK = /^(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|git:[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(@\S+)?|skills-sh:[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*)$/i;
async function ocInstall(source) {
  if (!confirm(`Instalar "${source}" no OpenClaw?\n\nSkill é código que o agente passa a poder executar. O OpenClaw varre a skill antes, mas instale só de fontes em que você confia.`)) return;
  ocStatus(`Instalando ${source}... (pode levar um pouco)`);
  const r = await panel.openclawSkillsInstall(source, false);
  ocStatus(r.text || r.error || 'Falhou.', !!r.ok);
}
function ocRenderResults(list) {
  const box = $('#ocSkillResults');
  box.textContent = '';
  for (const s of list) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;align-items:center';
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;font-size:12px';
    const t = document.createElement('b'); t.textContent = s.name;
    const d = document.createElement('div'); d.textContent = s.description || s.source; d.style.opacity = '.75';
    info.append(t, d);
    row.append(info);
    if (SRC_OK.test(s.source)) {
      const b = document.createElement('button');
      b.className = 'b'; b.style.flex = 'none'; b.textContent = '⬇ Instalar';
      b.addEventListener('click', () => ocInstall(s.source));
      row.append(b);
    }
    box.append(row);
  }
}
$('#ocSkillSearch').addEventListener('click', async () => {
  ocStatus('Buscando skills no ClawHub...');
  const r = await panel.openclawSkillsSearch($('#ocSkillQuery').value);
  ocRenderResults(r.ok ? r.skills : []);
  ocStatus(r.text || r.error || 'Falhou.', !!r.ok);
});
$('#ocSkillQuery').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#ocSkillSearch').click(); });
$('#ocSkillInstall').addEventListener('click', () => {
  const src = $('#ocSkillQuery').value.trim();
  if (!SRC_OK.test(src)) return ocStatus('Para instalar direto, digite @dono/skill, git:dono/repo ou skills-sh:dono/repo/skill. Ou use Buscar e clique em Instalar no resultado.', false);
  ocInstall(src);
});
$('#ocSkillInstalled').addEventListener('click', async () => {
  ocStatus('Listando as skills instaladas...');
  const r = await panel.openclawSkillsInstalled();
  const box = $('#ocSkillList');
  if (r.ok) { box.textContent = r.skills.map((s) => `${s.name}${s.description ? ' — ' + s.description : ''}`).join('\n') || 'Nenhuma skill instalada.'; box.hidden = false; }
  ocStatus(r.text || r.error || 'Falhou.', !!r.ok);
});
$('#ocSkillUpdate').addEventListener('click', async () => {
  if (!confirm('Atualizar todas as skills instaladas pelo ClawHub?')) return;
  ocStatus('Atualizando as skills...');
  const r = await panel.openclawSkillsUpdate();
  ocStatus(r.text || r.error || 'Falhou.', !!r.ok);
});


// ----- página da IA: cabeçalho, alterações não salvas, comandos que a IA conhece -----
const PROV_NAME = { kobold: 'KoboldCpp (no seu PC)', openrouter: 'OpenRouter', anthropic: 'Anthropic (Claude)', ollama: 'Ollama (no seu PC)', custom: 'Servidor local', openclaw: 'OpenClaw (agente)' };
const setTag = (el, text, kind) => { el.textContent = text; el.className = 'tag' + (kind ? ' ' + kind : ''); };
let cmdInfo = null;
function paintHero() {
  if (!cfg) return;
  const p = $('#provider').value, c = cfg.providers[p] || {}, i = INFO[p];
  $('#iaName').textContent = PROV_NAME[p] || p;
  $('#iaModel').textContent = c.model ? 'Modelo: ' + c.model : (i && i.model ? 'Modelo padrão: ' + i.model : 'Nenhum modelo escolhido ainda');
  if (!i.key) setTag($('#iaKey'), 'Sem chave necessária', '');
  else if (c.hasKey) setTag($('#iaKey'), '🔑 Chave salva ' + c.keyHint, 'ok');
  else if (i.keyOptional) setTag($('#iaKey'), 'Chave opcional', '');
  else setTag($('#iaKey'), '⚠ Falta a chave', 'warn');
  paintCmds();
}
function paintCmds() {
  const on = !state || state.aiKnowsCommands !== false;
  setTag($('#iaCmds'), on ? '⚡ Conhece os comandos' : 'Comandos desligados', on ? 'on' : '');
  const cost = $('#cmdCost');
  if (!on) cost.textContent = 'Desligado: a IA não sabe quais comandos existem e economiza esse texto em cada mensagem.';
  else if (cmdInfo) cost.textContent = `Ligado: a IA recebe ${cmdInfo.commands.length} grupos de comandos e ${cmdInfo.sites.length} sites/programas (cerca de ${cmdInfo.tokens} tokens a mais por mensagem).`;
}
function paintCmdList() {
  const box = $('#cmdList');
  box.textContent = '';
  if (!cmdInfo) return;
  for (const [area, examples] of cmdInfo.commands) {
    const it = document.createElement('div'); it.className = 'cmd-item';
    const b = document.createElement('b'); b.textContent = area; it.appendChild(b);
    const row = document.createElement('div');
    for (const e of examples) { const em = document.createElement('em'); em.textContent = e; row.appendChild(em); }
    it.appendChild(row); box.appendChild(it);
  }
  const sites = document.createElement('div'); sites.className = 'cmd-item';
  const sb = document.createElement('b'); sb.textContent = 'Sites e programas que ela conhece'; sites.appendChild(sb);
  const sp = document.createElement('div'); sp.className = 'cmd-sites'; sp.textContent = cmdInfo.sites.join(', '); sites.appendChild(sp);
  box.appendChild(sites);
  const keys = document.createElement('div'); keys.className = 'cmd-item';
  const kb = document.createElement('b'); kb.textContent = 'Atalhos'; keys.appendChild(kb);
  const kp = document.createElement('div'); kp.className = 'cmd-sites'; kp.textContent = cmdInfo.shortcuts; keys.appendChild(kp);
  box.appendChild(keys);
}
async function loadCmdInfo() {
  try { cmdInfo = await panel.commandsInfo(); } catch (_) { cmdInfo = null; }
  paintCmdList(); paintCmds();
}
function paintPromptCount() {
  const n = $('#systemPrompt').value.length;
  $('#promptCount').textContent = n + ' caracteres';
}
let dirty = false;
function setDirty(on) {
  dirty = on;
  $('#cfgSave').classList.toggle('pulse', on);
  if (on) status('Alterações não salvas', 'warn');
  else if ($('#cfgStatus').classList.contains('warn')) status('');
}
['#provider', '#apiKey', '#model', '#baseUrl', '#systemPrompt', '#orFallbacks', '#orSort', '#orThinking'].forEach((q) =>
  $(q).addEventListener('input', () => { setDirty(true); if (q === '#systemPrompt') paintPromptCount(); }));
$('#provider').addEventListener('change', () => setDirty(true));
document.querySelectorAll('#presets [data-url]').forEach((b) => b.addEventListener('click', () => setDirty(true)));
let cmdKey = '';
panel.onSettings((st) => {   // ligar/desligar comandos ou "pode controlar o PC" muda o texto enviado à IA
  paintCmds();
  const k = [st.aiKnowsCommands, st.convPcActions, st.convWake].join('|');
  if (k !== cmdKey) { cmdKey = k; loadCmdInfo(); }
});
$('#cmdDetails').addEventListener('toggle', () => { if ($('#cmdDetails').open) loadCmdInfo(); });
loadCmdInfo();
