// Central de Saúde: diagnóstico local sob demanda, sem alterar configurações ou processos.
(() => {
  const btn = document.getElementById('healthRefresh');
  const list = document.getElementById('healthList');
  const summary = document.getElementById('healthSummary');
  const stamp = document.getElementById('healthStamp');
  if (!btn || !list || !summary) return;
  const labels = { ok: 'OK', warning: 'Atenção', error: 'Problema' };
  async function refresh() {
    btn.disabled = true; btn.textContent = 'Verificando…';
    summary.textContent = 'Executando verificações locais…';
    list.replaceChildren();
    try {
      const result = await panel.systemHealth();
      summary.textContent = result.summary === 'ok' ? 'Tudo certo: nenhuma falha encontrada.' : result.summary === 'warning' ? 'Verificação concluída com recomendações.' : 'Foram encontrados itens que precisam de atenção.';
      for (const item of result.checks) {
        const row = document.createElement('article'); row.className = `health-row health-${item.status}`;
        const head = document.createElement('div'); head.className = 'health-head';
        const title = document.createElement('strong'); title.textContent = item.title;
        const badge = document.createElement('span'); badge.className = 'health-badge'; badge.textContent = labels[item.status] || '—';
        head.append(title, badge);
        const detail = document.createElement('p'); detail.textContent = item.detail;
        row.append(head, detail);
        if (item.action) { const action = document.createElement('small'); action.textContent = `Como resolver: ${item.action}`; row.append(action); }
        list.append(row);
      }
      stamp.textContent = `Yoru ${result.version} · Verificado em ${new Date(result.checkedAt).toLocaleString('pt-BR')}`;
    } catch (error) { summary.textContent = `Não foi possível concluir o diagnóstico: ${String(error.message || error)}`; }
    finally { btn.disabled = false; btn.textContent = '↻ Verificar novamente'; }
  }
  btn.addEventListener('click', refresh);
  refresh();
})();

// Exportação explícita de relatório para suporte; nada é enviado pela rede.
(() => {
  const btn = document.getElementById('healthExport');
  const status = document.getElementById('healthExportStatus');
  if (!btn || !status || !window.panel?.supportReportExport) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Preparando relatório técnico…';
    try {
      const result = await panel.supportReportExport();
      status.textContent = result.ok
        ? `Relatório salvo (${(result.bytes / 1024).toFixed(1)} KB). Você pode anexá-lo ao solicitar suporte.`
        : result.canceled ? 'Exportação cancelada.' : (result.error || 'Não foi possível exportar o relatório.');
    } catch (error) {
      status.textContent = `Falha ao exportar: ${String(error.message || error)}`;
    } finally { btn.disabled = false; }
  });
})();


// Logs locais rotacionados: exportação somente após ação explícita da pessoa.
(() => {
  const btn = document.getElementById('healthLogs');
  const status = document.getElementById('healthLogsStatus');
  if (!btn || !status || !window.panel?.appLogsExport) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    status.textContent = 'Preparando os registros técnicos…';
    try {
      const result = await panel.appLogsExport();
      status.textContent = result.ok
        ? `Logs exportados (${(result.bytes / 1024).toFixed(1)} KB). Revise o conteúdo antes de compartilhar.`
        : result.canceled ? 'Exportação cancelada.' : (result.error || 'Não foi possível exportar os logs.');
    } catch (error) {
      status.textContent = `Falha ao exportar: ${String(error.message || error)}`;
    } finally { btn.disabled = false; }
  });
})();
