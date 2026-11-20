'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerIaIpc } = require('../src/ipc-ia');

function setup(t, overrides = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yoru-masori-ipc-'));
  const workspace = path.join(temp, 'project'); fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'README.md'), 'README_DO_PROJETO');
  fs.writeFileSync(path.join(workspace, 'src.js'), 'SOURCE_DO_PROJETO');
  const dataFile = path.join(temp, 'masori-agents.json');
  const handlers = new Map(); const events = [];
  const sender = { isDestroyed: () => false, send: (name, value) => events.push({ name, value }) };
  let openResult = { canceled: false, filePaths: [workspace] };
  const dialog = {
    showOpenDialog: async () => openResult,
    showSaveDialog: async () => ({ canceled: true }),
  };
  const calls = [];
  const defaults = {
    ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    askAI: async (task, opts) => { calls.push({ type: 'synthesis', task, opts }); return { ok: true, text: 'RESPOSTA_FINAL', streamed: false }; },
    callModel: async (messages, cfg, system, tokens, tail, extra) => { calls.push({ type: 'specialist', messages, system, extra }); return 'RELATORIO_ESPECIALISTA'; },
    loadConfig: () => ({ provider: 'ollama', ollama: { model: 'qwen-local' } }),
    saveConfig: () => {}, logToPanel: () => {}, isPanelSender: () => true, getWin: () => null,
    broadcastPanels: () => {}, dialog,
    state: { memory: () => [], memChanged: () => {}, profile: () => ({}), setProfile: () => {}, profileFile: () => '', masoriFile: () => dataFile },
    ...overrides,
  };
  registerIaIpc(defaults);
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  return { handlers, sender, events, calls, dialog, setOpenResult: (value) => { openResult = value; }, workspace, dataFile };
}

test('workspace IPC: escolhe pasta, lista/lê arquivos e passa somente os selecionados ao especialista', async (t) => {
  const app = setup(t); const event = { sender: app.sender };
  const picked = await app.handlers.get('masori-workspace-pick')(event);
  assert.equal(picked.ok, true);
  const listing = await app.handlers.get('masori-workspace-list')(event, '');
  assert.ok(listing.entries.some((entry) => entry.name === 'README.md'));
  const preview = await app.handlers.get('masori-workspace-read')(event, 'README.md');
  assert.equal(preview.text, 'README_DO_PROJETO');
  const search = await app.handlers.get('masori-workspace-search')(event, 'SOURCE_DO');
  assert.equal(search.results[0].relativePath, 'src.js');
  const result = await app.handlers.get('masori-run')(event, 'Analise o código e pesquise o projeto', 'run-workspace-1', ['README.md']);
  assert.equal(result.ok, true);
  const specialistCalls = app.calls.filter((call) => call.type === 'specialist');
  assert.ok(specialistCalls.length >= 1);
  assert.ok(specialistCalls.every((call) => call.messages[0].content.includes('README_DO_PROJETO')));
  assert.deepEqual(result.workspaceFiles, ['README.md']);
  assert.ok(app.events.some((event) => event.name === 'masori-progress' && event.value.stage === 'completed'));
});

test('cancelamento aborta chamadas dos especialistas e não chama a síntese', async (t) => {
  let announceStarted; const started = new Promise((resolve) => { announceStarted = resolve; });
  let abortCount = 0;
  const app = setup(t, {
    callModel: (_messages, _cfg, _system, _tokens, _tail, extra) => new Promise((_resolve, reject) => {
      announceStarted();
      const abort = () => { abortCount++; const error = new Error('aborted'); error.name = 'AbortError'; reject(error); };
      if (extra.signal.aborted) abort(); else extra.signal.addEventListener('abort', abort, { once: true });
    }),
  });
  const event = { sender: app.sender };
  const running = app.handlers.get('masori-run')(event, 'Analise o código e pesquise o projeto', 'run-cancel-1', []);
  await started;
  const cancelled = await app.handlers.get('masori-cancel')(event, 'run-cancel-1');
  assert.equal(cancelled.ok, true);
  const result = await running;
  assert.equal(result.cancelled, true);
  assert.ok(abortCount >= 1);
  assert.equal(app.calls.some((call) => call.type === 'synthesis'), false);
  const saved = JSON.parse(fs.readFileSync(app.dataFile, 'utf8'));
  assert.equal(saved.history[0].status, 'cancelled');
});

test('exportação só grava depois de confirmação por diálogo de salvamento', async (t) => {
  const app = setup(t); const event = { sender: app.sender };
  const cancelled = await app.handlers.get('masori-export-report')(event, { task: 'Tarefa', text: 'Resultado' });
  assert.equal(cancelled.canceled, true);
  const output = path.join(path.dirname(app.dataFile), 'report.md');
  app.dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
  const saved = await app.handlers.get('masori-export-report')(event, { task: 'Tarefa', text: 'Resultado', specialists: [{ name: 'Masori-Dev', ok: true, text: 'Código analisado.' }] });
  assert.equal(saved.ok, true);
  const content = fs.readFileSync(output, 'utf8');
  assert.match(content, /# Relatório MASORI/);
  assert.match(content, /Código analisado/);
});

test('visão computacional IPC: exige listagem, captura autorizada e envio explícito ao Masori-Vision', async (t) => {
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 1280, height: 720 }),
    resize: () => image,
    toJPEG: () => Buffer.from('jpeg-capture-test'),
  };
  const captureCalls = [];
  const app = setup(t, {
    desktopCapturer: {
      getSources: async (options) => {
        captureCalls.push(options);
        if (options.thumbnailSize.width === 0) return [{ id: 'window:77:0', name: 'Janela de teste' }];
        return [{ id: 'window:77:0', name: 'Janela de teste', thumbnail: image }];
      },
    },
  });
  const event = { sender: app.sender };
  const listed = await app.handlers.get('masori-vision-sources')(event);
  assert.equal(listed.ok, true);
  assert.equal(listed.items.length, 1);
  assert.ok(!JSON.stringify(listed).includes('window:77:0'));
  const captured = await app.handlers.get('masori-vision-capture')(event, listed.items[0].token);
  assert.equal(captured.ok, true);
  assert.match(captured.previewUrl, /^data:image\/jpeg;base64,/);
  assert.equal(captureCalls[0].thumbnailSize.width, 0);
  assert.equal(captureCalls[1].thumbnailSize.width, 1600);
  const analyzed = await app.handlers.get('masori-vision-analyze')(event, captured.captureId, 'Explique o que está na janela.');
  assert.equal(analyzed.ok, true);
  assert.equal(analyzed.sourceName, 'Janela de teste');
  const visionCall = app.calls.find((call) => call.type === 'specialist');
  assert.ok(visionCall);
  assert.equal(visionCall.messages[0].content.includes('Explique o que está na janela.'), true);
  assert.deepEqual(visionCall.messages[0].images, [Buffer.from('jpeg-capture-test').toString('base64')]);
  assert.equal(app.events.some((entry) => entry.name === 'masori-progress'), false);
  assert.equal(fs.existsSync(app.dataFile), false, 'a imagem não deve ser gravada no histórico/configuração');
});

test('visão computacional IPC rejeita token de captura que não veio da listagem', async (t) => {
  const app = setup(t, { desktopCapturer: { getSources: async () => [] } });
  const result = await app.handlers.get('masori-vision-capture')({ sender: app.sender }, 'window:arbitrary');
  assert.equal(result.ok, false);
  assert.match(result.error, /Selecione uma janela/);
});
