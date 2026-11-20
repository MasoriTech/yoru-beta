'use strict';

// Monta um relatório técnico limitado a diagnósticos já coletados pelo próprio Yoru.
function createSupportReport({ health, runtime, generatedAt = new Date().toISOString() } = {}) {
  if (!health || !Array.isArray(health.checks) || !runtime || typeof runtime !== 'object') {
    throw new TypeError('Diagnósticos incompletos para gerar o relatório.');
  }
  return {
    format: 'yoru-support-report',
    schemaVersion: 1,
    generatedAt,
    app: { name: String(health.app || 'Yoru'), version: String(health.version || 'desconhecida') },
    health: {
      summary: health.summary,
      counts: health.counts,
      checks: health.checks.map((item) => ({
        id: String(item.id || '').slice(0, 80),
        title: String(item.title || '').slice(0, 120),
        status: ['ok', 'warning', 'error'].includes(item.status) ? item.status : 'warning',
        detail: String(item.detail || '').slice(0, 500),
        action: String(item.action || '').slice(0, 500),
      })),
    },
    runtime,
    privacy: 'Relatório técnico local. Não inclui conversas, memória, chaves de API ou conteúdo de arquivos pessoais.',
  };
}

module.exports = { createSupportReport };
