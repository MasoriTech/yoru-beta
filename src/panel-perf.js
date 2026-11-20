// Aba Desempenho: números, gráficos, processos e energia ao vivo.
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- desempenho ao vivo -----
// ----- desempenho ao vivo: números, gráficos, processos e estado de energia -----
const hist = { fps: [], cpu: [], mem: [] };
let lastPerf = null, sysInfo = null, runtimeInfo = null;
function spark(id, arr) {
  const c = document.getElementById(id); if (!c) return;
  const g = c.getContext('2d'), w = c.width, h = c.height;
  g.clearRect(0, 0, w, h);
  if (arr.length < 2) return;
  const max = Math.max(...arr, 1), min = Math.min(...arr, max), span = Math.max(max - min, max * 0.15, 1);
  g.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#ff7a2e';
  g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
  arr.forEach((v, i) => {
    const x = (i / 59) * w, y = h - 2 - ((v - min) / span) * (h - 4);
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  });
  g.stroke();
}
const pill = (id, text, on) => { const el = $(id); el.textContent = text; el.classList.toggle('on', !!on); };
const fmtUp = (s) => s >= 3600 ? Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min' : Math.floor(s / 60) + ' min';
panel.onPerf((d) => {
  lastPerf = d;
  $('#st-fps').textContent = d.fps;
  $('#st-cpu').textContent = d.cpu.toFixed(1);
  $('#st-mem').textContent = d.mem;
  const cpuPct = Number(d.hostCpu) || 0, ramPct = Number(d.ramUsedPercent) || 0;
  $('#host-cpu').textContent = cpuPct.toFixed(1) + '%';
  $('#host-cpu-bar').style.width = Math.max(0, Math.min(100, cpuPct)) + '%';
  $('#host-ram').textContent = ramPct + '%';
  $('#host-ram-bar').style.width = Math.max(0, Math.min(100, ramPct)) + '%';
  $('#host-ram-detail').textContent = `${Math.round((d.ramTotal || 0) / 1024 * (ramPct / 100) * 10) / 10} / ${Math.round((d.ramTotal || 0) / 1024 * 10) / 10} GB`;
  if (sysInfo && sysInfo.disk) {
    const used = Math.max(0, Math.min(100, sysInfo.disk.usedPercent));
    $('#host-disk').textContent = sysInfo.disk.freeGB + ' GB';
    $('#host-disk-bar').style.width = used + '%';
    $('#host-disk-detail').textContent = `${used}% ocupado · ${sysInfo.disk.totalGB} GB total`;
  }
  for (const k of ['fps', 'cpu', 'mem']) { hist[k].push(d[k]); if (hist[k].length > 60) hist[k].shift(); spark('sp-' + k, hist[k]); }
  const s = state || {};
  const capBat = d.battery && s.batterySaver !== false, capAway = d.away && Number(s.awayMin) > 0;
  pill('#st-mode', capAway ? '💤 Longe do PC' : capBat ? '🔋 Limitado pela bateria' : '⚡ Normal', capAway || capBat);
  pill('#st-power', d.battery ? '🔋 Na bateria' : '🔌 Na tomada / desktop', false);
  pill('#st-up', 'Aberto há ' + fmtUp(d.uptime || 0), false);
  const rows = $('#procRows');
  const maxMem = Math.max(...(d.procs || []).map((p) => p.mem), 1);
  rows.innerHTML = '';
  (d.procs || []).forEach((p) => {
    const tr = document.createElement('tr');
    const a = document.createElement('td'); a.textContent = p.label;
    const bar = document.createElement('i'); bar.className = 'bar'; bar.style.width = Math.max(3, Math.round((p.mem / maxMem) * 100)) + '%'; a.appendChild(bar);
    const b = document.createElement('td'); b.textContent = p.cpu.toFixed(1);
    const c = document.createElement('td'); c.textContent = p.mem;
    tr.append(a, b, c); rows.appendChild(tr);
  });
});
Promise.all([panel.perfInfo(), panel.runtimeDiagnostics().catch(() => null)]).then(([i, runtime]) => {
  runtimeInfo = runtime;
  sysInfo = i;
  const dl = $('#sysInfo'); dl.innerHTML = '';
  if (i.disk) { $('#host-disk').textContent = i.disk.freeGB + ' GB'; $('#host-disk-bar').style.width = Math.max(0, Math.min(100, i.disk.usedPercent)) + '%'; $('#host-disk-detail').textContent = `${i.disk.usedPercent}% ocupado · ${i.disk.totalGB} GB total`; }
  const rows = [['Sistema', i.os], ['Processador', `${i.cpuModel} (${i.cores} núcleos)`], ['Memória', i.ramGB + ' GB'], ['Disco', i.disk ? `${i.disk.freeGB} GB livres de ${i.disk.totalGB} GB` : 'Não disponível'], ['Placa de vídeo', i.gpu], ['Versão', `Yoru ${i.version} · Electron ${i.electron}`]];
  if (runtime) rows.push(['Runtime', `Node ${runtime.runtime.node || '?'} · Chromium ${runtime.runtime.chrome || '?'} · ${runtime.runtime.platform}/${runtime.runtime.arch}`], ['Memória do processo', `${runtime.process.rssMB} MB RSS · ${runtime.process.heapUsedMB} MB heap`]);
  rows.forEach(([k, v]) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dl.append(dt, dd); });
}).catch(() => {});
$('#perfCopy').addEventListener('click', async () => {
  const txt = [
    `Yoru ${sysInfo ? sysInfo.version : ''} · Electron ${sysInfo ? sysInfo.electron : '?'} · Chromium ${sysInfo ? sysInfo.chrome : '?'}`,
    `Sistema: ${sysInfo ? sysInfo.os : '?'} · ${sysInfo ? sysInfo.cores : '?'} núcleos · ${sysInfo ? sysInfo.ramGB : '?'} GB de RAM`,
    `CPU: ${sysInfo ? sysInfo.cpuModel : '?'}`, `GPU: ${sysInfo ? sysInfo.gpu : '?'}`,
    `Energia: ${lastPerf ? (lastPerf.battery ? 'na bateria' : 'na tomada') : '?'}`,
    `Agora: ${lastPerf ? lastPerf.fps : '–'} FPS · CPU do Yoru ${lastPerf ? lastPerf.cpu : '–'}% · CPU do PC ${lastPerf ? lastPerf.hostCpu : '–'}% · RAM do PC ${lastPerf ? lastPerf.ramUsedPercent : '–'}% (${lastPerf ? lastPerf.ramFree : '–'} MB livres) · RAM do Yoru ${lastPerf ? lastPerf.mem : '–'} MB`,
    `Disco: ${sysInfo && sysInfo.disk ? `${sysInfo.disk.freeGB} GB livres de ${sysInfo.disk.totalGB} GB` : 'não disponível'}`,
    ...(runtimeInfo ? [`Runtime: Node ${runtimeInfo.runtime.node} · Chromium ${runtimeInfo.runtime.chrome} · ${runtimeInfo.runtime.platform}/${runtimeInfo.runtime.arch}`, `Memória do processo: ${runtimeInfo.process.rssMB} MB RSS · ${runtimeInfo.process.heapUsedMB} MB heap`, `Memória do sistema: ${runtimeInfo.system.freeMemoryMB} MB livres de ${runtimeInfo.system.totalMemoryMB} MB`] : []), 
    `Ajustes: qualidade ${state.quality}, resolução ${state.renderRes || 'auto'}, bordas ${state.antialias}, texturas ${state.textureSize}, FPS ${state.fpsActive}/${state.fpsIdle}, física ${state.springBones ? 'on' : 'off'}, GPU integrada ${state.lowPowerGpu ? 'sim' : 'não'}`,
    `Economia: bateria ${state.batterySaver === false ? 'off' : 'on'} (${state.fpsBattery} FPS), longe do PC ${state.awayMin || 0} min (${state.fpsAway} FPS), prioridade ${state.processPriority || 'normal'}, núcleos da voz ${state.sttThreads || 'auto'}, liberar voz após ${state.sttUnloadMin || 0} min`,
    ...(lastPerf && lastPerf.procs ? ['Processos:', ...lastPerf.procs.map((p) => `  - ${p.label}: ${p.cpu}% CPU, ${p.mem} MB`)] : []),
  ].join('\n');
  await panel.copyText(txt);
  const o = $('#perfCopied'); o.textContent = 'Copiado! Cole numa conversa para pedir ajuda.'; setTimeout(() => (o.textContent = ''), 4000);
});
