'use strict';

function snapshot({ app, os, processRef = process, now = Date.now } = {}) {
  const mem = processRef.memoryUsage();
  let systemMemory = null;
  try {
    const m = processRef.getSystemMemoryInfo?.();
    if (m) systemMemory = { totalMB: Math.round(m.total / 1024), freeMB: Math.round(m.free / 1024), swapTotalMB: Math.round((m.swapTotal || 0) / 1024), swapFreeMB: Math.round((m.swapFree || 0) / 1024) };
  } catch (_) {}
  let cpu = [];
  try { cpu = os.cpus().map((c) => c.model).filter(Boolean); } catch (_) {}
  return {
    generatedAt: new Date(now()).toISOString(),
    app: { name: app?.getName?.() || 'Yoru', version: app?.getVersion?.() || 'unknown', packaged: !!app?.isPackaged },
    runtime: { platform: processRef.platform, arch: processRef.arch, electron: processRef.versions?.electron || null, node: processRef.versions?.node || null, chrome: processRef.versions?.chrome || null, uptimeSeconds: Math.round(processRef.uptime()) },
    process: { rssMB: Math.round(mem.rss / 1048576), heapUsedMB: Math.round(mem.heapUsed / 1048576), heapTotalMB: Math.round(mem.heapTotal / 1048576), externalMB: Math.round(mem.external / 1048576) },
    system: { cpuCount: cpu.length, cpuModel: cpu[0] || null, totalMemoryMB: Math.round(os.totalmem() / 1048576), freeMemoryMB: Math.round(os.freemem() / 1048576), systemMemory },
  };
}

module.exports = { snapshot };
