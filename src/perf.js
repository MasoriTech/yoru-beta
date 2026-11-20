'use strict';
// Regras de desempenho (sem Electron, para testar com `npm test`): qual FPS usar agora, nomes dos processos
// e resumo dos processos para a tabela do painel.

// FPS efetivo do loop do avatar. power: { battery: está na bateria?, away: você está longe do PC? }
function effectiveFps(S, power = {}, active = false) {
  let fps = active ? Number(S.fpsActive) || 60 : Number(S.fpsIdle) || 24;
  if (power.battery && S.batterySaver !== false) fps = Math.min(fps, Number(S.fpsBattery) || 30);
  if (power.away && Number(S.awayMin) > 0) fps = Math.min(fps, Number(S.fpsAway) || 5);
  return Math.max(1, fps);
}

// "longe do PC": parado há `awayMin` minutos (0 = recurso desligado)
const isAway = (idleSeconds, awayMin) => Number(awayMin) > 0 && idleSeconds >= Number(awayMin) * 60;

const PRIORITIES = ['normal', 'below', 'low'];
const PRIORITY_LABEL = { normal: 'Normal', below: 'Abaixo do normal', low: 'Baixa (cede CPU para jogos)' };

const PROC_LABEL = { Browser: 'Principal (inclui a voz)', Tab: 'Janela do avatar/painel', GPU: 'Placa de vídeo (GPU)', Utility: 'Serviço (rede, áudio...)' };
const procLabel = (type) => PROC_LABEL[type] || type || 'Outro';

// metrics: resultado de app.getAppMetrics(); devolve até `max` linhas, as mais pesadas em RAM primeiro
function summarizeProcs(metrics, max = 6) {
  return (metrics || []).map((m) => ({
    pid: m.pid,
    label: procLabel(m.type),
    cpu: Math.round(((m.cpu && m.cpu.percentCPUUsage) || 0) * 10) / 10,
    mem: Math.round(((m.memory && m.memory.workingSetSize) || 0) / 1024),
  })).sort((a, b) => b.mem - a.mem).slice(0, max);
}

module.exports = { effectiveFps, isAway, PRIORITIES, PRIORITY_LABEL, procLabel, summarizeProcs };
