'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const P = require('../src/perf');
const mainSource = require('./helpers/main-source');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

const S = { fpsActive: 60, fpsIdle: 24, batterySaver: true, fpsBattery: 30, awayMin: 5, fpsAway: 5 };

test('FPS efetivo: tomada, bateria e longe do PC', () => {
  assert.equal(P.effectiveFps(S, {}, true), 60);
  assert.equal(P.effectiveFps(S, {}, false), 24);
  assert.equal(P.effectiveFps(S, { battery: true }, true), 30);          // na bateria nunca passa do limite
  assert.equal(P.effectiveFps(S, { battery: true }, false), 24);          // parada já era menor
  assert.equal(P.effectiveFps(S, { away: true }, true), 5);
  assert.equal(P.effectiveFps({ ...S, batterySaver: false }, { battery: true }, true), 60);
  assert.equal(P.effectiveFps({ ...S, awayMin: 0 }, { away: true }, true), 60); // recurso desligado
  assert.equal(P.effectiveFps({ ...S, fpsAway: 0, fpsIdle: 0 }, { away: true }, false) >= 1, true);
});

test('"longe do PC" só liga com tempo configurado', () => {
  assert.equal(P.isAway(299, 5), false);
  assert.equal(P.isAway(300, 5), true);
  assert.equal(P.isAway(9999, 0), false);
});

test('tabela de processos: nomes em português, mais pesados primeiro', () => {
  const rows = P.summarizeProcs([
    { pid: 1, type: 'Browser', cpu: { percentCPUUsage: 1.234 }, memory: { workingSetSize: 100 * 1024 } },
    { pid: 2, type: 'GPU', cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 300 * 1024 } },
    { pid: 3, type: 'Tab', cpu: { percentCPUUsage: 0.5 }, memory: { workingSetSize: 200 * 1024 } },
  ], 2);
  assert.deepEqual(rows.map((r) => r.pid), [2, 3]);
  assert.match(rows[0].label, /GPU/);
  assert.equal(rows[0].mem, 300);
});

test('a regra do avatar (frame-limit.js, módulo do navegador) é a mesma de perf.js (CommonJS do processo principal)', () => {
  const r = rd('frame-limit.js');
  const fn = r.slice(r.indexOf('export function effectiveFps'), r.indexOf('// conta os quadros')).replace('export ', '');
  const local = new Function(fn + '; return effectiveFps;')();
  for (const pw of [{}, { battery: true }, { away: true }, { battery: true, away: true }]) {
    for (const active of [true, false]) {
      for (const s of [S, { ...S, batterySaver: false }, { ...S, awayMin: 0 }, { ...S, fpsBattery: 15, fpsAway: 2 }]) {
        assert.equal(local(s, pw, active), P.effectiveFps(s, pw, active));
      }
    }
  }
});

test('tudo ligado de ponta a ponta (main, preloads, painel, voz)', () => {
  const main = mainSource(), panel = require('./helpers/panel-source')();
  for (const k of ['batterySaver', 'fpsBattery', 'awayMin', 'fpsAway', 'processPriority', 'sttThreads', 'sttDevice', 'sttUnloadMin']) {
    assert.match(main, new RegExp(k + ':'), 'padrão de ' + k);
    assert.match(main, new RegExp(`'${k}' in p|p\\.${k}|'${k}',`), 'sanitize de ' + k);
    assert.match(panel, new RegExp(`data-key="${k}"`), 'controle de ' + k);
  }
  assert.match(main, /'batterySaver'/);
  assert.match(main, /secureIpcMain\.handle\('perf-info'/);
  assert.match(main, /secureIpcMain\.handle\('copy-text'/);
  assert.match(main, /win\.webContents\.send\('power-state'/);
  assert.match(main, /os\.setPriority/);
  assert.match(rd('preload.js'), /onPower/);
  assert.match(rd('panel-preload.js'), /perfInfo/);
  assert.match(rd('stt.js'), /threads: Number\(this\.threads\(\)\)/);
  assert.match(rd('stt-worker.js'), /workerData\.threads/);
  assert.match(rd('voice-main.js'), /reloadStt/);
  assert.match(panel, /id="procRows"/);
  assert.match(panel, /id="perfCopy"/);
});

test('o painel aceita só valores válidos (sanitize)', () => {
  const main = mainSource();
  const body = main.slice(main.indexOf('function sanitize'), main.indexOf('function sanitize') + 6000);
  assert.match(body, /PERF\.PRIORITIES\.includes\(p\.processPriority\)/);
  assert.match(body, /\[0, 1, 2, 3, 4, 6, 8\]\.includes\(Number\(p\.sttThreads\)\)/);
});
