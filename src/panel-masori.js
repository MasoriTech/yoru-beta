'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const names = {
    'masori-sama': 'Masori-Sama', 'masori-dev': 'Masori-Dev',
    'masori-research': 'Masori-Research', 'masori-vision': 'Masori-Vision',
    'masori-memory': 'Masori-Memory', 'masori-voice': 'Masori-Voice',
    'masori-agent': 'Masori-Agent',
  };
  const agentIds = ['masori-dev', 'masori-research', 'masori-vision', 'masori-memory', 'masori-voice', 'masori-agent'];
  const providerOptions = [['inherit', 'Herdar aba IA'], ['kobold', 'KoboldCpp'], ['anthropic', 'Anthropic'], ['openrouter', 'OpenRouter'], ['ollama', 'Ollama'], ['custom', 'Servidor compatível'], ['openclaw', 'OpenClaw']];
  const selectedWorkspaceFiles = new Set();
  let currentWorkspaceDir = '';
  let activeRunId = '';
  let lastReport = null;
  let agentConfig = {};

  function showPlan(plan) {
    const host = $('masoriSteps');
    if (!host) return;
    host.replaceChildren();
    if (!plan || !plan.ok) return;
    for (const step of plan.steps) {
      const row = document.createElement('div'); row.className = 'ms-step';
      const n = document.createElement('b'); n.textContent = String(step.order).padStart(2, '0');
      const body = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = names[step.agent] || step.agent;
      const desc = document.createElement('div'); desc.className = 'hint'; desc.textContent = step.action;
      body.append(title, desc); row.append(n, body); host.append(row);
    }
  }
  async function plan() {
    const task = $('masoriTask').value.trim();
    $('masoriStatus').textContent = 'Masori-Sama está organizando a tarefa…';
    try {
      const result = await window.panel.masoriPlan(task);
      if (!result.ok) { $('masoriStatus').textContent = result.error || 'Não foi possível montar o plano.'; return null; }
      showPlan(result);
      $('masoriStatus').textContent = `Plano preparado · ${result.agents.length} agentes selecionados`;
      return result;
    } catch (e) { $('masoriStatus').textContent = String(e.message || e); return null; }
  }
  async function loadAgentSettings() {
    try { agentConfig = await window.panel.masoriConfigGet() || {}; } catch (_) { agentConfig = {}; }
    const host = $('masoriAgentSettings'); if (!host) return;
    host.replaceChildren();
    for (const id of agentIds) {
      const row = agentConfig[id] || { provider: 'inherit', model: '', enabled: true };
      const card = document.createElement('div'); card.className = 'ms-agent';
      const title = document.createElement('strong'); title.textContent = names[id];
      const enabledLabel = document.createElement('label');
      const enabled = document.createElement('input'); enabled.type = 'checkbox'; enabled.checked = row.enabled !== false; enabled.dataset.agent = id; enabled.dataset.field = 'enabled';
      enabledLabel.append(enabled, document.createTextNode(' Ativo'));
      const select = document.createElement('select'); select.dataset.agent = id; select.dataset.field = 'provider';
      for (const [value, label] of providerOptions) { const opt = document.createElement('option'); opt.value = value; opt.textContent = label; select.append(opt); }
      select.value = row.provider || 'inherit';
      const model = document.createElement('input'); model.type = 'text'; model.maxLength = 160; model.placeholder = 'Modelo (vazio = padrão do provedor)'; model.value = row.model || ''; model.dataset.agent = id; model.dataset.field = 'model';
      card.append(title, enabledLabel, select, model); host.append(card);
    }
  }
  $('masoriSaveAgents')?.addEventListener('click', async () => {
    const next = {};
    for (const id of agentIds) next[id] = { provider: 'inherit', model: '', enabled: true };
    $('masoriAgentSettings')?.querySelectorAll('[data-agent]').forEach((el) => { next[el.dataset.agent][el.dataset.field] = el.type === 'checkbox' ? el.checked : el.value; });
    try {
      const result = await window.panel.masoriConfigSet(next);
      $('masoriConfigStatus').textContent = result && result.ok ? 'Configurações salvas.' : 'Não foi possível salvar.';
      if (result && result.ok) agentConfig = result.config;
    } catch (error) { $('masoriConfigStatus').textContent = String(error.message || error); }
  });

  function renderWorkspaceEntries(result) {
    const host = $('masoriWorkspaceFiles'); if (!host) return;
    host.replaceChildren();
    $('masoriWorkspaceUp').disabled = !currentWorkspaceDir;
    $('masoriWorkspaceCount').textContent = `${(result.entries || []).length} item(ns)${result.truncated ? ' · lista limitada' : ''}`;
    if (currentWorkspaceDir) {
      const crumb = document.createElement('div'); crumb.className = 'hint'; crumb.textContent = `/${currentWorkspaceDir}`; host.append(crumb);
    }
    for (const item of result.entries || []) {
      const row = document.createElement('div'); row.className = 'ms-file-row';
      const open = document.createElement('button'); open.type = 'button'; open.textContent = `${item.type === 'directory' ? '📁' : '📄'} ${item.name}`;
      open.title = item.relativePath;
      if (item.type === 'directory') open.addEventListener('click', () => loadWorkspaceList(item.relativePath));
      else open.addEventListener('click', () => previewWorkspaceFile(item.relativePath));
      row.append(open);
      if (item.type === 'file') {
        const label = document.createElement('label');
        const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selectedWorkspaceFiles.has(item.relativePath); check.disabled = !item.readable || (!check.checked && selectedWorkspaceFiles.size >= 8);
        check.addEventListener('change', () => {
          if (check.checked) selectedWorkspaceFiles.add(item.relativePath); else selectedWorkspaceFiles.delete(item.relativePath);
          updateSelectedWorkspaceLabel();
          renderWorkspaceEntries(result);
        });
        label.append(check, document.createTextNode(' Usar contexto')); row.append(label);
        const size = document.createElement('span'); size.className = 'hint'; size.textContent = item.readable ? `${Math.ceil(item.size / 1024)} KB` : 'Arquivo grande'; row.append(size);
      }
      host.append(row);
    }
    if (!(result.entries || []).length) { const empty = document.createElement('div'); empty.className = 'hint'; empty.textContent = 'Nenhum arquivo de texto ou pasta nesta localização.'; host.append(empty); }
    updateSelectedWorkspaceLabel();
  }
  function updateSelectedWorkspaceLabel() {
    const el = $('masoriWorkspaceSelected');
    if (el) el.textContent = selectedWorkspaceFiles.size ? `${selectedWorkspaceFiles.size}/8 arquivo(s) selecionado(s): ${[...selectedWorkspaceFiles].join(', ')}` : 'Selecione arquivos de texto para fornecer contexto aos especialistas (máximo de 8).';
  }
  function renderWorkspaceSearch(result) {
    const host = $('masoriWorkspaceFiles'); host.replaceChildren();
    $('masoriWorkspaceUp').disabled = true;
    $('masoriWorkspaceCount').textContent = `${result.results.length} resultado(s) · ${result.scanned} arquivo(s) verificado(s)${result.truncated ? ' · busca limitada' : ''}`;
    for (const item of result.results) {
      const row = document.createElement('div'); row.className = 'ms-file-row';
      const open = document.createElement('button'); open.type = 'button'; open.textContent = `📄 ${item.relativePath} · linha ${item.line} — ${item.snippet}`; open.title = item.relativePath;
      open.addEventListener('click', () => previewWorkspaceFile(item.relativePath)); row.append(open);
      const label = document.createElement('label'); const check = document.createElement('input');
      check.type = 'checkbox'; check.checked = selectedWorkspaceFiles.has(item.relativePath); check.disabled = !check.checked && selectedWorkspaceFiles.size >= 8;
      check.addEventListener('change', () => { if (check.checked) selectedWorkspaceFiles.add(item.relativePath); else selectedWorkspaceFiles.delete(item.relativePath); updateSelectedWorkspaceLabel(); renderWorkspaceSearch(result); });
      label.append(check, document.createTextNode(' Usar contexto')); row.append(label); host.append(row);
    }
    if (!result.results.length) { const empty = document.createElement('div'); empty.className = 'hint'; empty.textContent = 'Nenhuma ocorrência encontrada nos arquivos permitidos.'; host.append(empty); }
    updateSelectedWorkspaceLabel();
  }
  async function loadWorkspaceInfo() {
    try {
      const info = await window.panel.masoriWorkspaceInfo();
      $('masoriWorkspaceStatus').textContent = info && info.selected ? (info.valid ? `Pasta selecionada: ${info.name}` : `Pasta indisponível: ${info.name}`) : 'Nenhuma pasta selecionada.';
      if (info && info.selected && info.valid) await loadWorkspaceList('');
      else $('masoriWorkspaceFiles').replaceChildren();
    } catch (error) { $('masoriWorkspaceStatus').textContent = String(error.message || error); }
  }
  async function loadWorkspaceList(relative = '') {
    currentWorkspaceDir = String(relative || '');
    $('masoriWorkspaceStatus').textContent = 'Carregando arquivos…';
    try {
      const result = await window.panel.masoriWorkspaceList(currentWorkspaceDir);
      if (!result || !result.ok) throw new Error(result && result.error || 'Não foi possível listar a pasta.');
      $('masoriWorkspaceStatus').textContent = 'Leitura local somente · arquivos selecionados serão enviados ao provedor de IA configurado.';
      renderWorkspaceEntries(result);
    } catch (error) { $('masoriWorkspaceStatus').textContent = String(error.message || error); $('masoriWorkspaceFiles').replaceChildren(); }
  }
  async function previewWorkspaceFile(relative) {
    $('masoriFilePreview').value = 'Lendo arquivo…';
    try {
      const result = await window.panel.masoriWorkspaceRead(relative);
      $('masoriFilePreview').value = result && result.ok ? result.text : (result && result.error || 'Não foi possível ler o arquivo.');
    } catch (error) { $('masoriFilePreview').value = String(error.message || error); }
  }
  $('masoriWorkspacePick')?.addEventListener('click', async () => {
    try {
      const result = await window.panel.masoriWorkspacePick();
      if (result && result.ok) { selectedWorkspaceFiles.clear(); currentWorkspaceDir = ''; $('masoriFilePreview').value = ''; await loadWorkspaceInfo(); }
      else if (!result.canceled) $('masoriWorkspaceStatus').textContent = result.error || 'Não foi possível selecionar a pasta.';
    } catch (error) { $('masoriWorkspaceStatus').textContent = String(error.message || error); }
  });
  $('masoriWorkspaceRefresh')?.addEventListener('click', () => loadWorkspaceInfo());
  async function searchWorkspace() {
    const query = $('masoriWorkspaceQuery').value.trim();
    if (query.length < 2) { $('masoriWorkspaceStatus').textContent = 'Digite pelo menos dois caracteres para pesquisar.'; return; }
    $('masoriWorkspaceStatus').textContent = 'Pesquisando arquivos de texto…';
    try {
      const result = await window.panel.masoriWorkspaceSearch(query);
      if (!result || !result.ok) throw new Error(result && result.error || 'Busca indisponível.');
      $('masoriWorkspaceStatus').textContent = `Busca por “${result.query}” concluída. Os resultados são somente leitura.`;
      renderWorkspaceSearch(result);
    } catch (error) { $('masoriWorkspaceStatus').textContent = String(error.message || error); }
  }
  $('masoriWorkspaceSearch')?.addEventListener('click', searchWorkspace);
  $('masoriWorkspaceQuery')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') searchWorkspace(); });
  $('masoriWorkspaceUp')?.addEventListener('click', () => {
    const parts = currentWorkspaceDir.split('/').filter(Boolean); parts.pop(); loadWorkspaceList(parts.join('/'));
  });

  // Visão computacional: fonte escolhida pelo usuário, prévia local e envio separado para o modelo.
  let visionCaptureId = '';
  let visionExpiryTimer = null;
  function clearVisionPreview() {
    if (visionExpiryTimer) { clearTimeout(visionExpiryTimer); visionExpiryTimer = null; }
    const image = $('masoriVisionPreview');
    if (image) image.removeAttribute('src');
    $('masoriVisionPreviewArea')?.setAttribute('hidden', '');
    visionCaptureId = '';
  }
  async function discardVisionCapture() {
    const id = visionCaptureId;
    clearVisionPreview();
    if (id) { try { await window.panel.masoriVisionDiscard(id); } catch (_) {} }
  }
  $('masoriVisionSource')?.addEventListener('change', () => {
    $('masoriVisionCapture').disabled = !$('masoriVisionSource').value;
  });
  $('masoriVisionRefresh')?.addEventListener('click', async () => {
    const button = $('masoriVisionRefresh'); button.disabled = true;
    $('masoriVisionStatus').textContent = 'Carregando janelas e telas disponíveis…';
    try {
      const result = await window.panel.masoriVisionSources();
      if (!result || !result.ok) throw new Error(result && result.error || 'Não foi possível listar as fontes de captura.');
      const select = $('masoriVisionSource'); select.replaceChildren();
      const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = result.items.length ? 'Selecione uma janela ou tela…' : 'Nenhuma fonte disponível'; select.append(placeholder);
      for (const item of result.items || []) {
        const option = document.createElement('option'); option.value = item.token; option.textContent = item.label; select.append(option);
      }
      $('masoriVisionCapture').disabled = true;
      $('masoriVisionStatus').textContent = `${result.items.length} fonte(s) encontrada(s). Nenhuma imagem foi capturada ainda.`;
    } catch (error) { $('masoriVisionStatus').textContent = String(error.message || error); }
    finally { button.disabled = false; }
  });
  $('masoriVisionCapture')?.addEventListener('click', async () => {
    const token = $('masoriVisionSource').value;
    if (!token) return;
    await discardVisionCapture();
    $('masoriVisionCapture').disabled = true;
    $('masoriVisionStatus').textContent = 'Capturando a janela escolhida…';
    try {
      const result = await window.panel.masoriVisionCapture(token);
      if (!result || !result.ok) throw new Error(result && result.error || 'Falha ao capturar a fonte selecionada.');
      visionCaptureId = result.captureId;
      const thisCaptureId = visionCaptureId;
      if (visionExpiryTimer) clearTimeout(visionExpiryTimer);
      visionExpiryTimer = setTimeout(() => {
        if (visionCaptureId !== thisCaptureId) return;
        clearVisionPreview();
        $('masoriVisionStatus').textContent = 'A prévia expirou após 3 minutos e foi removida. Faça uma nova captura.';
      }, Math.max(0, Number(result.expiresAt || 0) - Date.now()));
      $('masoriVisionPreview').src = result.previewUrl;
      $('masoriVisionPreviewArea').hidden = false;
      $('masoriVisionSourceName').textContent = result.sourceName;
      $('masoriVisionDimensions').textContent = `${result.width} × ${result.height}`;
      $('masoriVisionAnalyze').disabled = false;
      $('masoriVisionStatus').textContent = 'Prévia pronta. Confira a imagem e clique em “Enviar captura para análise” para autorizar o envio ao provedor configurado.';
    } catch (error) {
      $('masoriVisionStatus').textContent = String(error.message || error);
      clearVisionPreview();
    } finally { $('masoriVisionCapture').disabled = !$('masoriVisionSource').value; }
  });
  $('masoriVisionAnalyze')?.addEventListener('click', async () => {
    if (!visionCaptureId) return;
    const id = visionCaptureId;
    $('masoriVisionAnalyze').disabled = true;
    $('masoriVisionDiscard').disabled = true;
    $('masoriVisionStatus').textContent = 'Enviando a captura escolhida ao Masori-Vision e analisando…';
    $('masoriVisionResult').textContent = 'Analisando janela, elementos visíveis e possíveis mensagens de erro…';
    try {
      const result = await window.panel.masoriVisionAnalyze(id, $('masoriVisionQuestion').value.trim());
      visionCaptureId = '';
      clearVisionPreview();
      if (!result || !result.ok) throw new Error(result && result.error || 'A análise visual não foi concluída.');
      $('masoriVisionStatus').textContent = `Análise concluída · ${result.sourceName} · ${result.provider} / ${result.model}. A captura foi removida da memória temporária.`;
      $('masoriVisionResult').textContent = result.text || 'O modelo não retornou uma análise em texto.';
    } catch (error) {
      visionCaptureId = '';
      clearVisionPreview();
      $('masoriVisionStatus').textContent = 'A captura foi descartada após a tentativa de análise.';
      $('masoriVisionResult').textContent = String(error.message || error);
    } finally { $('masoriVisionDiscard').disabled = false; $('masoriVisionAnalyze').disabled = true; }
  });
  $('masoriVisionDiscard')?.addEventListener('click', async () => {
    await discardVisionCapture();
    $('masoriVisionStatus').textContent = 'Captura descartada. Nenhuma imagem será enviada.';
    $('masoriVisionResult').textContent = 'O relatório visual aparecerá aqui.';
  });

  async function loadHistory() {
    const host = $('masoriHistory'); if (!host) return;
    host.replaceChildren();
    try {
      const history = await window.panel.masoriHistory();
      for (const item of history.slice(0, 10)) {
        const row = document.createElement('div'); row.className = 'ms-step';
        const status = item.status === 'cancelled' ? 'Cancelada' : item.status === 'failed' ? 'Com falhas' : (item.ok ? 'Concluída' : 'Com falhas');
        const title = document.createElement('strong'); title.textContent = `${status} · ${new Date(item.createdAt).toLocaleString('pt-BR')}`;
        const desc = document.createElement('div'); desc.className = 'hint'; desc.textContent = `${item.task}${Array.isArray(item.workspaceFiles) && item.workspaceFiles.length ? ` · Arquivos: ${item.workspaceFiles.join(', ')}` : ''}`;
        row.append(title, desc); host.append(row);
      }
      if (!history.length) host.textContent = 'Nenhuma execução registrada.';
    } catch (_) { host.textContent = 'Histórico indisponível.'; }
  }
  function renderReports(result) {
    const host = $('masoriSteps');
    if (!host || !result || !Array.isArray(result.specialists)) return;
    const heading = document.createElement('h3'); heading.textContent = 'Relatórios dos especialistas'; host.append(heading);
    for (const report of result.specialists) {
      const row = document.createElement('div'); row.className = 'ms-step';
      const body = document.createElement('div');
      const title = document.createElement('strong'); title.textContent = `${names[report.agent] || report.agent} · ${report.ok ? 'respondeu' : report.cancelled ? 'não iniciado' : 'falhou'}`;
      const desc = document.createElement('div'); desc.className = 'hint'; desc.textContent = report.text || 'Sem relatório.';
      body.append(title, desc); row.append(body); host.append(row);
    }
  }

  window.panel.onMasoriProgress?.((event) => {
    if (!event || event.runId !== activeRunId) return;
    $('masoriProgress').textContent = event.message || event.stage || 'Executando…';
  });
  loadAgentSettings(); loadHistory(); loadWorkspaceInfo();
  $('masoriPlan')?.addEventListener('click', plan);
  $('masoriRun')?.addEventListener('click', async () => {
    const task = $('masoriTask').value.trim();
    const p = await plan();
    if (!p) return;
    const runId = `masori-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    activeRunId = runId; lastReport = null;
    $('masoriExport').disabled = true; $('masoriExportStatus').textContent = '';
    $('masoriRun').disabled = true; $('masoriCancel').disabled = false;
    $('masoriResult').textContent = 'Masori-Sama está processando a tarefa com os especialistas…';
    $('masoriStatus').textContent = 'Executando…'; $('masoriProgress').textContent = 'Preparando execução…';
    try {
      const result = await window.panel.masoriRun(task, runId, [...selectedWorkspaceFiles].slice(0, 8));
      $('masoriResult').textContent = result && result.text ? result.text : 'A tarefa terminou sem texto de resposta.';
      $('masoriStatus').textContent = result && result.cancelled ? 'Execução cancelada.' : result && result.ok ? 'Concluído.' : 'A execução não foi concluída.';
      if (result && result.plan) showPlan(result.plan);
      renderReports(result);
      if (result && result.text && !result.cancelled) {
        lastReport = { task, text: result.text, specialists: result.specialists || [] };
        $('masoriExport').disabled = false;
      }
      await loadHistory();
    } catch (error) {
      $('masoriResult').textContent = String(error.message || error); $('masoriStatus').textContent = 'Erro na execução.';
    } finally {
      activeRunId = ''; $('masoriRun').disabled = false; $('masoriCancel').disabled = true;
    }
  });
  $('masoriCancel')?.addEventListener('click', async () => {
    if (!activeRunId) return;
    $('masoriCancel').disabled = true; $('masoriProgress').textContent = 'Solicitando cancelamento…';
    try { const result = await window.panel.masoriCancel(activeRunId); if (!result || !result.ok) $('masoriProgress').textContent = result && result.error || 'Não foi possível cancelar.'; }
    catch (error) { $('masoriProgress').textContent = String(error.message || error); }
  });
  $('masoriExport')?.addEventListener('click', async () => {
    if (!lastReport) return;
    $('masoriExportStatus').textContent = 'Abrindo janela para salvar…';
    try {
      const result = await window.panel.masoriExportReport(lastReport);
      $('masoriExportStatus').textContent = result && result.ok ? `Relatório salvo: ${result.name}` : result && result.canceled ? 'Exportação cancelada.' : (result && result.error || 'Falha ao exportar.');
    } catch (error) { $('masoriExportStatus').textContent = String(error.message || error); }
  });
})();
