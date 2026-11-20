'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupportReport } = require('../src/support-report');

test('relatório técnico inclui versão, saúde e runtime sem conversas ou segredos', () => {
  const report = createSupportReport({
    generatedAt: '2026-11-14T00:00:00.000Z',
    health: { app: 'Yoru', version: '0.17.0', summary: 'ok', counts: { ok: 1, warning: 0, error: 0 }, checks: [{ id: 'ram', title: 'Memória', status: 'ok', detail: '16 GB' }] },
    runtime: { app: { version: '0.17.0' }, system: { platform: 'win32' } },
  });
  assert.equal(report.format, 'yoru-support-report');
  assert.equal(report.app.version, '0.17.0');
  assert.equal(report.health.checks[0].status, 'ok');
  assert.equal(JSON.stringify(report).includes('conversations'), false);
  assert.equal(JSON.stringify(report).includes('apiKey'), false);
});

test('relatório rejeita diagnóstico incompleto e limita campos de texto', () => {
  assert.throws(() => createSupportReport({ health: {}, runtime: {} }), /incompletos/);
  const report = createSupportReport({ health: { checks: [{ id: 'x'.repeat(100), title: 'T'.repeat(200), status: 'unknown', detail: 'd'.repeat(800) }] }, runtime: {} });
  assert.equal(report.health.checks[0].id.length, 80);
  assert.equal(report.health.checks[0].title.length, 120);
  assert.equal(report.health.checks[0].status, 'warning');
  assert.equal(report.health.checks[0].detail.length, 500);
});
