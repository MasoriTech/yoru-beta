'use strict';
// Energia (bateria / "longe do PC"), prioridade do processo e estatísticas de desempenho para o painel.
// Sem estado do app: tudo chega por getters.
const os = require('os');
const fs = require('fs');
const path = require('path');
const PERF = require('./perf');

function createSystemStats({ app, powerMonitor, getSettings, getWin, allPanels }) {
  const powerState = { battery: false, away: false };
  let lastFps = 0;
  let lastCpuSnapshot = null;

  function cpuSnapshot() {
    return (os.cpus() || []).reduce((sum, cpu) => {
      const t = cpu.times || {};
      return { total: sum.total + Object.values(t).reduce((a, n) => a + (Number(n) || 0), 0), idle: sum.idle + (Number(t.idle) || 0) };
    }, { total: 0, idle: 0 });
  }
  function hostCpuPercent() {
    const now = cpuSnapshot();
    const prev = lastCpuSnapshot; lastCpuSnapshot = now;
    if (!prev) return 0;
    const total = now.total - prev.total, idle = now.idle - prev.idle;
    return total > 0 ? Math.max(0, Math.min(100, Math.round((1 - idle / total) * 1000) / 10)) : 0;
  }
  function diskInfo() {
    try {
      const root = path.parse(os.homedir()).root || process.cwd();
      const st = fs.statfsSync(root);
      const total = Number(st.blocks) * Number(st.bsize);
      const free = Number(st.bavail) * Number(st.bsize);
      if (total > 0 && Number.isFinite(total) && Number.isFinite(free)) return { totalGB: Math.round(total / 1073741824 * 10) / 10, freeGB: Math.round(free / 1073741824 * 10) / 10, usedPercent: Math.round((1 - free / total) * 100) };
    } catch (_) {}
    return null;
  }

  // ---------- Energia: o avatar desenha menos quando não precisa ----------
  function onBattery() { try { return !!powerMonitor.isOnBatteryPower(); } catch (_) { return false; } }
  function pushPower(idleSec) {
    if (typeof idleSec !== 'number') { try { idleSec = powerMonitor.getSystemIdleTime(); } catch (_) { idleSec = 0; } }
    powerState.battery = onBattery();
    powerState.away = PERF.isAway(idleSec, getSettings().awayMin);
    const win = getWin();
    if (win && !win.isDestroyed()) win.webContents.send('power-state', { ...powerState }); // mensagem minúscula; reenviada a cada 5 s
  }

  // ---------- Prioridade do app no sistema ("baixa" cede CPU para jogos e outros programas) ----------
  function applyPriority() {
    const level = { normal: os.constants.priority.PRIORITY_NORMAL, below: os.constants.priority.PRIORITY_BELOW_NORMAL, low: os.constants.priority.PRIORITY_LOW }[getSettings().processPriority || 'normal'];
    const pids = new Set([process.pid]);
    try { for (const m of app.getAppMetrics()) pids.add(m.pid); } catch (_) {}
    for (const pid of pids) { try { os.setPriority(pid, level); } catch (_) { /* sem permissão para esse processo */ } }
  }
  let prioTimer = null;
  function startPriorityWatch() {
    applyPriority();
    clearInterval(prioTimer);
    // processos novos (GPU, serviços) nascem com prioridade normal: reaplica de vez em quando
    prioTimer = setInterval(() => { if ((getSettings().processPriority || 'normal') !== 'normal') applyPriority(); }, 20000);
    prioTimer.unref();
  }

  // ---------- Desempenho (estatísticas para o painel) ----------
  function startStats() {
    setInterval(() => {
      const targets = allPanels().filter((w) => w.isVisible() && !w.isMinimized());
      if (!targets.length) return;
      const m = app.getAppMetrics();
      const cpu = m.reduce((a, x) => a + ((x.cpu && x.cpu.percentCPUUsage) || 0), 0);
      const mem = m.reduce((a, x) => a + ((x.memory && x.memory.workingSetSize) || 0), 0) / 1024;
      const totalRam = os.totalmem(), freeRam = os.freemem();
      const stats = { fps: lastFps, cpu: Math.round(cpu * 10) / 10, mem: Math.round(mem), hostCpu: hostCpuPercent(), ramTotal: Math.round(totalRam / 1048576), ramFree: Math.round(freeRam / 1048576), ramUsedPercent: Math.round((1 - freeRam / totalRam) * 100), procs: PERF.summarizeProcs(m), battery: onBattery(), away: powerState.away, uptime: Math.round(process.uptime()) };
      for (const w of targets) w.webContents.send('perf', stats);
    }, 2000);
  }
  const setFps = (f) => { lastFps = f; };

  async function perfInfo() {
    let gpu = '?';
    try {
      const g = await app.getGPUInfo('basic');
      const aux = g.auxAttributes || {};
      const dev = (g.gpuDevice || []).find((d) => d.active) || (g.gpuDevice || [])[0] || {};
      gpu = aux.glRenderer || dev.deviceString || (dev.vendorId ? `vendor 0x${dev.vendorId.toString(16)} device 0x${(dev.deviceId || 0).toString(16)}` : '?');
    } catch (_) {}
    const cpus = os.cpus() || [];
    return {
      version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome,
      os: `${os.type()} ${os.release()} (${process.arch})`, cores: cpus.length, cpuModel: (cpus[0] && cpus[0].model || '?').trim(),
      ramGB: Math.round(os.totalmem() / 1e8) / 10, disk: diskInfo(), gpu, battery: (() => { try { return powerMonitor.isOnBatteryPower(); } catch (_) { return null; } })(),
      hwAccel: !process.argv.includes('--disable-gpu'),
    };
  }

  return { powerState, onBattery, pushPower, applyPriority, startPriorityWatch, startStats, setFps, perfInfo };
}

module.exports = { createSystemStats };
