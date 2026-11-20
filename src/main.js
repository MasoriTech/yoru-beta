const { app, BrowserWindow, ipcMain, screen, globalShortcut, Menu, Tray, nativeImage, dialog, shell, systemPreferences, nativeTheme, powerMonitor, clipboard, safeStorage, desktopCapturer } = require('electron');
const { createVoice } = require('./voice-main');
const { createPc } = require('./pc-control');
const { createOptimizer } = require('./pc-optimize');
const { createGestureActions } = require('./gesture-actions');
const { createAirMouse } = require('./air-mouse');
const { createHandOverlay } = require('./hand-window');
const AS = require('./ai-stream');
const AIC = require('./ai-core');
const OCC = require('./openclaw-connect');
const SECRETS = require('./secrets');
const SET = require('./settings');
const LIBRARY = require('./library');
const STORE = require('./store');
const { createChatStore } = require('./chat-store');
const CRIASVC = require('./criacao-service');
const MEM = require('./memory');
const PROF = require('./profile');
const { startupGreeting } = require('./voice-logic');
const APPACT = require('./app-actions');
const { createWindows } = require('./windows');
const { createMovement } = require('./movement');
const { createSystemStats } = require('./system-stats');
const { createIpcSecurity } = require('./ipc-security');
const RUNTIME_DIAGNOSTICS = require('./runtime-diagnostics');
const { createHealthChecks } = require('./health-checks');
const BACKUP = require('./backup-manager');
const { createSupportReport } = require('./support-report');
const { createLogger } = require('./logger');
const { registerCriacaoIpc } = require('./ipc-criacao');
const { registerLibraryIpc } = require('./ipc-library');
const { registerIaIpc } = require('./ipc-ia');
const { createWhatsAppBot } = require('./whatsapp-bot');
const { createHubService } = require('./hub-service');
const { createRemoteServer } = require('./remote-server');
const { createNeuralTts } = require('./neural-tts');
const CRIA = require('./criacao');
const ATT = require('./attachments');
const CMDS = require('./commands-catalog');
const path = require('path');
const fs = require('fs');
const os = require('os');

let win;
// a janela do avatar pode já ter sido destruída quando chega um pedido do painel (fechando, reiniciando a GPU...):
// usar `win` direto estoura "TypeError: Object has been destroyed" no processo principal
const alive = () => !!win && !win.isDestroyed() && !win.webContents.isDestroyed();
const toAvatar = (channel, ...args) => { if (alive()) win.webContents.send(channel, ...args); };
let panel;
let bluetoothPickerWindow = null;
let bluetoothPickerReady = false;
let bluetoothPickerPayload = null;
const chatBuf = [];         // últimas mensagens do chat, para janelas de chat abertas depois
let tray;
let voice = null; // conversa por voz (voice-main.js)
let quitting = false;
let hubService = null;
let waBot = null;

const BASE_W = 420;
const BASE_H = 640;
const ASSETS = path.join(__dirname, '..', 'assets');
const { EMOTIONS } = AS;
const { DEFAULTS, clamp, sanitize } = SET; // valores padrão e validação: ver settings.js
let settings = { ...DEFAULTS };

// ---------- Fallbacks (cache negado / GPU com problema) ----------
function pickWritableDir() {
  // Programa instalado: a pasta do app (Program Files) não aceita escrita, então os dados ficam na pasta do usuário
  // (%APPDATA%\\Yoru). A versão "portátil" guarda tudo ao lado do .exe, na pasta YoruData.
  if (app.isPackaged) {
    const base = process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'YoruData') : app.getPath('userData');
    try { fs.mkdirSync(path.join(base, 'cache'), { recursive: true }); fs.accessSync(base, fs.constants.W_OK); return base; } catch (_) { /* cai para a pasta temporária */ }
    const tmp = path.join(os.tmpdir(), 'yoru');
    try { fs.mkdirSync(path.join(tmp, 'cache'), { recursive: true }); return tmp; } catch (_) { return null; }
  }
  const candidates = [path.join(__dirname, '..', '.userdata'), path.join(os.tmpdir(), 'avatar-desktop')];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(path.join(dir, 'cache'), { recursive: true });
      fs.accessSync(dir, fs.constants.W_OK);
      return dir;
    } catch (_) { /* tenta o próximo */ }
  }
  return null;
}

const dataDir = pickWritableDir();
if (dataDir) {
  app.setPath('userData', dataDir);
  app.commandLine.appendSwitch('disk-cache-dir', path.join(dataDir, 'cache'));
}
const logger = createLogger({ directory: path.join(app.getPath('userData'), 'logs') });
app.on('web-contents-created', (_event, contents) => {
  contents.on('render-process-gone', (_e, details) => logger.error('renderer', 'Processo de renderização encerrado', details || {}));
  contents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== -3) logger.warn('navigation', 'Falha ao carregar a interface', { code, description });
  });
});
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
loadSettings(); // cedo: algumas opções (GPU) precisam ser definidas antes do app iniciar
if (settings.lowPowerGpu) app.commandLine.appendSwitch('force_low_power_gpu'); // usa a GPU integrada (menos energia)
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const noGpu = process.argv.includes('--no-gpu');
if (noGpu) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('enable-unsafe-swiftshader');
  app.commandLine.appendSwitch('use-angle', 'swiftshader');
}

// Se a GPU quebrar, reinicia sozinho em modo software
app.on('child-process-gone', (_e, details) => {
  logger.error('child-process', 'Processo auxiliar encerrado', details || {});
  if (details.type === 'GPU' && !noGpu) {
    app.relaunch({ args: process.argv.slice(1).concat('--no-gpu') });
    app.exit(0);
  }
});

// Evita abrir duas instâncias (uma trava o cache da outra)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
if (process.platform === 'win32') app.setAppUserModelId('com.yoru.app'); // ícone e notificações corretos na barra de tarefas

// ---------- Configurações do app (settings.json) ----------
function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}
function loadSettings() {
  try { settings = SET.migrateSettings(JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))); }
  catch (e) {
    settings = { ...DEFAULTS };
    if (e && e.code !== 'ENOENT') { try { fs.copyFileSync(settingsFile(), settingsFile() + '.bad'); } catch (_) {} } // arquivo ilegível: guarda uma cópia antes de o próximo salvamento sobrescrever
  }
}
// grava num arquivo temporário e renomeia: uma queda de energia no meio não corrompe o settings.json
function writeSettingsNow() { STORE.writeAtomic(settingsFile(), JSON.stringify(settings)); }
const settingsSaver = STORE.createDebouncedSaver(writeSettingsNow, { delay: 200 });
const saveSettings = settingsSaver.save;
const flushSettings = settingsSaver.flush;

// ---------- Janelas, movimento e energia: módulos próprios (windows.js, movement.js, system-stats.js) ----------
const WIN = createWindows({
  BrowserWindow, screen, shell, nativeTheme, assetsDir: ASSETS, base: { w: BASE_W, h: BASE_H }, chatBuf,
  getSettings: () => settings, saveSettings: () => saveSettings(),
  getWin: () => win, setWin: (w) => { win = w; }, getPanel: () => panel, setPanel: (p) => { panel = p; },
  isQuitting: () => quitting,
});
const { allPanels, broadcastPanels, isPanelSender, panelBg, createWindow, createPanel, createWelcome, closeWelcome, openSolo, showPanel,
  smashScreen, setPanelSize, centerPanel, zoomFor, applyBar, SOLO_TABS, PANEL_PRESETS, voicePanel, ensureVoiceWindow, dockFit, setDockDrag, setDockHit, syncPanelMode, placeDock } = WIN;
// Toda chamada IPC exige uma janela do app, frame principal e origem local confiável.
const secureIpcMain = createIpcSecurity({ ipcMain, BrowserWindow, appDir: __dirname });
const fromPanel = (e) => isPanelSender(e.sender);
const DENIED = { ok: false, error: 'remetente não autorizado' };

function showBluetoothPicker(payload = {}) {
  bluetoothPickerPayload = payload;
  if (bluetoothPickerWindow && !bluetoothPickerWindow.isDestroyed()) {
    if (bluetoothPickerReady && !bluetoothPickerWindow.webContents.isDestroyed()) bluetoothPickerWindow.webContents.send('bluetooth-picker-data', bluetoothPickerPayload);
    if (bluetoothPickerWindow.isMinimized()) bluetoothPickerWindow.restore();
    bluetoothPickerWindow.show();
    bluetoothPickerWindow.focus();
    return;
  }
  bluetoothPickerReady = false;
  bluetoothPickerWindow = new BrowserWindow({
    width:560, height:680, minWidth:420, minHeight:520, resizable:true, show:false, center:true,
    title:'Yoru · Dispositivos Bluetooth', backgroundColor:'#070913',
    alwaysOnTop:true, autoHideMenuBar:true,
    webPreferences:{ preload:path.join(__dirname,'bluetooth-picker-preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true }
  });
  const current = bluetoothPickerWindow;
  current.setMenu(null);
  WIN.lockNavigation(current);
  current.once('ready-to-show', () => { if (!current.isDestroyed()) current.show(); });
  current.webContents.once('did-finish-load', () => {
    if (current.isDestroyed()) return;
    bluetoothPickerReady = true;
    current.webContents.send('bluetooth-picker-data', bluetoothPickerPayload || {});
    current.show();
    current.focus();
  });
  current.on('closed', () => {
    if (voice && bluetoothPickerPayload && ['list','confirm'].includes(bluetoothPickerPayload.stage) && !quitting) voice.typed('cancelar');
    if (bluetoothPickerWindow === current) { bluetoothPickerWindow = null; bluetoothPickerReady = false; bluetoothPickerPayload = null; }
  });
  current.loadFile(path.join(__dirname,'bluetooth-picker.html'));
}
function updateBluetoothPicker(payload = {}) {
  bluetoothPickerPayload = payload;
  if (bluetoothPickerWindow && !bluetoothPickerWindow.isDestroyed()) {
    if (bluetoothPickerReady && !bluetoothPickerWindow.webContents.isDestroyed()) bluetoothPickerWindow.webContents.send('bluetooth-picker-data', payload);
    if (bluetoothPickerWindow.isMinimized()) bluetoothPickerWindow.restore();
    bluetoothPickerWindow.show();
    bluetoothPickerWindow.focus();
  }
}
function isBluetoothPickerSender(sender) {
  return !!bluetoothPickerWindow && !bluetoothPickerWindow.isDestroyed() && sender === bluetoothPickerWindow.webContents;
}
ipcMain.on('bluetooth-picker-select', (event, index) => {
  if (!isBluetoothPickerSender(event.sender) || !voice) return;
  const n = Number(index);
  if (Number.isInteger(n) && n >= 0 && n < 20) voice.typed(String(n + 1));
});
ipcMain.on('bluetooth-picker-confirm', (event) => { if (isBluetoothPickerSender(event.sender) && voice) voice.typed('sim'); });
ipcMain.on('bluetooth-picker-rescan', (event) => { if (isBluetoothPickerSender(event.sender) && voice) voice.typed('buscar dispositivos bluetooth'); });
ipcMain.on('bluetooth-picker-cancel', (event) => { if (isBluetoothPickerSender(event.sender) && voice) voice.typed('não'); });
ipcMain.on('bluetooth-picker-close', (event) => {
  if (!isBluetoothPickerSender(event.sender)) return;
  if (voice && bluetoothPickerPayload && ['list','confirm'].includes(bluetoothPickerPayload.stage)) voice.typed('cancelar');
  bluetoothPickerPayload = { ...(bluetoothPickerPayload || {}), stage:'cancelled', message:'Janela fechada.' };
  if (bluetoothPickerWindow && !bluetoothPickerWindow.isDestroyed()) bluetoothPickerWindow.close();
});
const handOverlay = createHandOverlay({ BrowserWindow, screen, lockNavigation: (w) => WIN.lockNavigation(w), getSettings: () => settings });
const MOVE = createMovement({ screen, getWin: () => win, getSettings: () => settings, saveSettings: () => saveSettings(), base: { w: BASE_W, h: BASE_H } });
const { scheduleWalk, startWalk, stopWalk, startFall, stopFall, setWinPos, applyScale, moveToCorner, setWalkBusy } = MOVE;
const SYS = createSystemStats({ app, powerMonitor, getSettings: () => settings, getWin: () => win, allPanels });
const { pushPower, startPriorityWatch, applyPriority } = SYS;

// ---------- voz neural (Edge TTS: grátis, sem chave, precisa de internet) ----------
let msedge = {};
try { msedge = require('msedge-tts'); } catch (_) { /* sem npm install: cai na voz do sistema */ }
const neural = createNeuralTts({ lib: msedge, settings: () => settings });
const warmTts = neural.warm;
const synth = neural.synth;
const neuralVoices = neural.voices;

// ---------- biblioteca de avatares e itens (arquivos .vrm / .glb) ----------
const { libDir, libSeed, libAll, libPath } = LIBRARY.createLibrary({ userDataDir: () => app.getPath('userData'), assetsDir: ASSETS });

// ---------- IA (config.json) ----------
// instalado: a chave e as opções da IA ficam na pasta de dados do usuário; em desenvolvimento, ao lado do projeto
const CONFIG_FILE = app.isPackaged ? path.join(app.getPath('userData'), 'config.json') : path.join(__dirname, '..', 'config.json');

const secretCodec = () => SECRETS.createCodec(safeStorage);
let cfgCache = null; // { mtime, value }
function loadConfig() {
  let mtime = 0;
  try { mtime = fs.statSync(CONFIG_FILE).mtimeMs; } catch (_) {}
  if (cfgCache && cfgCache.mtime === mtime) return structuredClone(cfgCache.value);
  let c = {};
  try { c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (_) {}
  const rev = SECRETS.reveal(c, secretCodec()); // chaves cifradas em disco (secrets.js): aqui já voltam abertas
  const out = AIC.normalizeConfig(rev.cfg);
  if (rev.needsMigration) { try { saveConfig(rev.cfg); mtime = fs.statSync(CONFIG_FILE).mtimeMs; } catch (_) {} } // chave antiga em texto puro: cifra agora
  cfgCache = { mtime, value: out };
  return structuredClone(out);
}
function saveConfig(c) {
  cfgCache = null;
  STORE.writeAtomic(CONFIG_FILE, JSON.stringify(SECRETS.protect(c, secretCodec()), null, 2)); // atômico: uma queda no meio não apaga a chave da IA
  try { fs.chmodSync(CONFIG_FILE, 0o600); } catch (_) {} // só o seu usuário lê (no Windows é ignorado)
}
function buildSystem(cfg) {
  let s = cfg.systemPrompt || '';
  const personality = {
    balanced: 'Mantenha uma personalidade equilibrada: acolhedora, natural, bem-humorada quando couber e objetiva.',
    friendly: 'Seja especialmente acolhedora, gentil e próxima, sem exagerar na intimidade nem presumir sentimentos do usuário.',
    playful: 'Use humor leve, espontaneidade e um toque de irreverência quando o contexto permitir; nunca atrapalhe assuntos sérios.',
    professional: 'Adote postura profissional, clara e respeitosa. Priorize precisão, organização e linguagem direta.',
    concise: 'Seja extremamente objetiva: responda primeiro ao pedido, evite introduções e mantenha apenas os detalhes necessários.'
  }[settings.yoruPersonality || 'balanced'];
  s += '\n\nEstilo de personalidade: ' + personality;
  s += `\n\nComece SEMPRE a resposta com uma tag de emoção entre colchetes, uma destas: ${EMOTIONS.map((e) => `[${e}]`).join(' ')}.`;
  if (settings.aiEmotes) {
    s +=
      ' Quando fizer sentido (cumprimentar, concordar, comemorar, se despedir...), adicione logo depois UMA tag de gesto no formato [emote:nome], ' +
      'com nome entre: ' + Object.entries(AS.EMOTE_LABELS).map(([id, label]) => `${id} (${label})`).join(', ') + '. Não use gesto em toda resposta. ' +
      'Exemplo: "[happy] [emote:wave] Oi, tudo bem?"';
  } else {
    s += ' Exemplo: "[happy] Oi, tudo bem?"';
  }
  if (settings.aiKnowsCommands !== false) s += CMDS.promptBlock({ wake: settings.convWake, pcActions: settings.convPcActions });
  if (settings.aiAppControl !== false) s += APPACT.promptBlock(libAll(), settings);
  s += PROF.promptBlock(profile);
  if (settings.memoryEnabled !== false) s += MEM.promptBlock(memory);
  return s;
}

// ---------- memória de longo prazo e conversa salva ----------
let memory = [];
let profile = PROF.empty();
const profileFile = () => path.join(app.getPath('userData'), 'profile.json');
const memFile = () => path.join(app.getPath('userData'), 'memory.json');
const chatFile = () => path.join(app.getPath('userData'), 'chat-state.json');
function memChanged(list) {
  memory = list;
  try { MEM.save(memFile(), memory); } catch (_) {}
  broadcastPanels('mem-changed', memory);
}
// aplica no app o que foi decidido (tema, cor, avatar, item na mão): passa pelo mesmo filtro do painel
function applyAppPartial(partial) {
  if (!partial || !Object.keys(partial).length) return false;
  const p = sanitize(partial, settings);
  if (!Object.keys(p).length) return false;
  settings = { ...settings, ...p };
  applySettings(p);
  saveSettings();
  return true;
}
// pedido por voz ("pega a katana", "muda o tema para escuro"): devolve { ok, say }
function appAction(intent) {
  const r = APPACT.handleIntent(intent, libAll(), settings);
  if (r.ok) applyAppPartial(r.partial);
  return r;
}
// a IA mexe no app com tags [app:tema=oceano], [app:item=Katana]... (só se a opção estiver ligada)
function applyAiAppTags(pr) {
  if (settings.aiAppControl === false || !pr.actions || !pr.actions.length) return;
  const { partial, errors } = APPACT.resolveAll(pr.actions, libAll(), settings);
  applyAppPartial(partial);
  for (const e of errors) logToPanel({ role: 'error', text: `Não consegui aplicar “${e}”: esse nome não existe na biblioteca.` });
}
// a IA guarda/esquece fatos com [lembrar: ...] / [esquecer: ...]
function applyMemoryTags(pr) {
  if (settings.memoryEnabled === false || (!pr.remember.length && !pr.forget.length)) return;
  let list = memory;
  for (const t of pr.remember) list = MEM.add(list, t).list;
  for (const t of pr.forget) list = MEM.forget(list, t).list;
  if (list !== memory) memChanged(list);
}
function persistChat() { chatStore.persist(); }
function writeChatNow() { chatStore.writeNow(); }
function loadChatState() {
  memory = MEM.load(memFile());
  profile = PROF.load(profileFile());
  chatStore.load();
}

// IA: histórico, fila, streaming e provedores vivem em ai-core.js (sem Electron, com testes em test/ai-core.test.js).
// Aqui só ligamos o núcleo ao app: janela, config no disco, tags de memória/app e salvamento da conversa.
// OpenClaw: reconecta sozinha quando o token muda, o gateway reinicia ou o app abre com a conexão quebrada (openclaw-connect.js).
const ocConnector = OCC.createConnector({ deep: (o) => require('./openclaw-repair').repairAll({ ...o, exec: require('./openclaw-skills').defaultExec }), loadConfig: () => loadConfig(), saveConfig: (c) => saveConfig(c), log: (...a) => console.log(...a) });
const ai = AIC.createAI({
  reconnectOpenclaw: () => ocConnector.reconnect(),
  getSettings: () => settings,
  loadConfig,
  buildSystem,
  canStream: () => alive(),
  emitStream: (ev) => toAvatar('ai-stream', ev),
  persist: persistChat,
  onTags: (pr) => { applyMemoryTags(pr); applyAiAppTags(pr); },
  mediaMessage: (provider, content, media) => ATT.mediaMessage(provider, content, media),
  log: (...a) => console.log(...a),
});
const { askAI, remember, callModel } = ai;
// conversa salva em disco: ver chat-store.js
const chatStore = createChatStore({ ai, chatBuf, file: chatFile, enabled: () => settings.keepChat !== false });

function logToPanel(entry) {
  if (!entry.t) entry.t = Date.now(); // hora da mensagem (o painel mostra no balão)
  chatBuf.push(entry);
  if (chatBuf.length > 100) chatBuf.shift();
  broadcastPanels('chat-log', entry);
  persistChat();
}

function menuItems() {
  return [
    { label: 'Abrir painel', click: showPanel },
    { label: 'Abrir em janela separada', submenu: Object.entries(SOLO_TABS).map(([id, name]) => ({ label: name, click: () => openSolo(id) })) },
    { label: 'Levantar / parar dança', click: () => toAvatar('play-emote', 'stand') },
    { label: 'Emote aleatório', click: () => toAvatar('play-emote', 'random') },
    { label: 'Passear pela tela agora', click: () => { if (!startWalk(true)) scheduleWalk(1500); } },
    { label: 'Mostrar/ocultar avatar', click: toggleVisible },
    { label: 'Abrir chat', click: openChat },
    { label: 'Ligar/desligar a escuta (conversa por voz)', click: toggleListening },
    { label: 'Limpar conversa', click: clearHistory },
    { type: 'separator' },
    { label: 'Sair', click: () => app.quit() },
  ];
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'tray.png')).resize({ width: 16, height: 16 });
    tray = new Tray(img);
    tray.setToolTip('Avatar Desktop');
    tray.setContextMenu(Menu.buildFromTemplate(menuItems()));
    tray.on('click', showPanel);
  } catch (e) {
    console.log('[tray] indisponível:', e.message);
  }
}

function applySettings(partial) {
  if ('scale' in partial) applyScale(settings.scale);
  if ('alwaysOnTop' in partial && alive()) win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
  if ('handFree' in partial || 'handSize' in partial || 'handWander' in partial) handOverlay.sync();
  if ('panelTheme' in partial) for (const w of allPanels()) { w.setBackgroundColor(panelBg()); applyBar(w); }
  if ('keepChat' in partial) { if (settings.keepChat) persistChat(); else { try { fs.unlinkSync(chatFile()); } catch (_) {} } }
  if ('panelLayout' in partial) setTimeout(syncPanelMode, 60);   // Float Dock <-> painel normal: recria a janela principal
  if ('panelDockPosition' in partial || 'panelZoom' in partial) setTimeout(placeDock, 30); // reencaixa o dock na borda/escala nova
  for (const w of allPanels()) {
    if ('panelZoom' in partial) { try { w.webContents.setZoomFactor(zoomFor(w)); } catch (_) {} applyBar(w); }
    if ('panelOnTop' in partial) w.setAlwaysOnTop(!!settings.panelOnTop);
  }
  if ('walkEnabled' in partial || 'walkEvery' in partial || ('visible' in partial && !settings.visible)) {
    stopWalk(false);
    scheduleWalk(); // (não agenda nada se o passeio estiver desligado)
  }
  if ('visible' in partial && alive()) {
    if (settings.visible) win.showInactive();
    else setTimeout(() => { if (!settings.visible && alive()) win.hide(); }, 500); // espera o fade-out
  }
  if ('startWithOS' in partial) {
    try {
      app.setLoginItemSettings({
        openAtLogin: !!settings.startWithOS,
        path: process.execPath,
        args: app.isPackaged ? [] : [app.getAppPath()], // em desenvolvimento, abre este projeto (e não o Electron vazio)
      });
    } catch (_) {}
  }
  if ('processPriority' in partial) applyPriority();
  if (('sttThreads' in partial || 'sttDevice' in partial) && voice && voice.reloadStt) voice.reloadStt();
  if ('convModel' in partial && voice && voice.modelChanged) voice.modelChanged();
  if (['batterySaver', 'fpsBattery', 'awayMin', 'fpsAway'].some((k) => k in partial)) pushPower();
  if ('convListening' in partial && settings.convListening) ensureVoiceWindow(); // Float Dock: a janela da Conversa é quem ouve
  if ('convListening' in partial && settings.convListening) warmTts(); // microfone ligado: já abre a conexão da voz
  if ('convListening' in partial && tray) tray.setToolTip(settings.convListening ? 'Avatar Desktop — 🎙️ ouvindo' : 'Avatar Desktop');
  toAvatar('settings', settings);
  broadcastPanels('settings', settings);
}

function toggleVisible() {
  settings.visible = !settings.visible;
  applySettings({ visible: true });
  saveSettings();
}

function openChat() {
  if (!settings.visible) toggleVisible();
  if (!alive()) return;
  win.webContents.send('toggle-chat');
  win.setIgnoreMouseEvents(false);
  win.focus();
}

function toggleListening() {
  settings = { ...settings, convListening: !settings.convListening };
  applySettings({ convListening: true });
  saveSettings();
}

function rollDiceNow(speak) {
  if (settings.avatarMode === '2d') { // no 2D não há dado na mão: rola aqui e fala o resultado
    const a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
    if (voice) voice.say({ text: `Tirei ${a} e ${b}. Total: ${a + b}!`, emotion: 'happy', emote: null });
    return;
  }
  const wait = settings.visible ? 450 : 900;
  if (!settings.visible) toggleVisible(); // os dados precisam do avatar na tela
  if (settings.item !== 'dice') { settings = { ...settings, item: 'dice' }; applySettings({ item: 'dice' }); saveSettings(); }
  setTimeout(() => toAvatar('item-roll', !!speak), wait);
}

function clearHistory() {
  ai.clearHistory();
  chatBuf.length = 0;
  broadcastPanels('chat-clear');
  persistChat();
}

// ---------- Aba Criação: imagens, textos e vídeos guardados como projetos (pasta "criacao" dos dados do app) ----------
// a lógica (geração de imagem/texto, projetos em disco) vive em criacao-service.js; aqui só ligamos ao Electron
const criaSvc = CRIASVC.createCriaService({
  dataDir: () => app.getPath('userData'),
  loadConfig,
  callModel,
  cropToRatio: (buf, ratio) => { // FLUX sai quadrado: recorta ao centro (nativeImage só existe no Electron)
    const img = nativeImage.createFromBuffer(buf), sz = img.getSize();
    return sz.width > 0 ? img.crop(CRIA.cropRect(sz.width, sz.height, ratio.w, ratio.h)).toPNG() : null;
  },
});
// ---------- Início ----------
// rede de segurança: uma janela que fechou no meio de um pedido não deve derrubar o app com a caixa de erro do Electron
process.on('uncaughtException', (err) => {
  logger.error('main', 'Exceção não tratada', err);
  if (err && /Object has been destroyed/.test(String(err.message))) { console.warn('ignorado (janela já fechada):', err.stack || err); return; }
  try { dialog.showErrorBox('Erro no Yoru', String((err && err.stack) || err)); } catch (_) {}
});

process.on('unhandledRejection', (r) => { logger.error('main', 'Promessa rejeitada sem tratamento', r); console.warn('promessa rejeitada sem tratamento:', (r && r.stack) || r); }); // só registra

app.whenReady().then(() => {
  if (!gotLock) return;
  logger.info('app', 'Yoru iniciado', { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged }); // segunda instância: já está saindo, não cria janelas (piscava uma janela antes de fechar)
  libSeed();
  loadSettings();
  loadChatState();
  setTimeout(() => ocConnector.ensure().catch(() => {}), 4000); // conexão do OpenClaw quebrada? conserta em segundo plano
  createWindow();
  // saudação de abertura: espera o avatar carregar e fala/mostra no balão (usa o nome do perfil, se houver).
  // O balão segue a opção "Mostrar as respostas num balão": só some se a pessoa desligar.
  const lastOpenFile = path.join(app.getPath('userData'), 'last-open.json');
  let lastSeen = 0;
  try { lastSeen = Number(JSON.parse(fs.readFileSync(lastOpenFile, 'utf8')).t) || 0; } catch (_) {}
  try { fs.writeFileSync(lastOpenFile, JSON.stringify({ t: Date.now() })); } catch (_) {}
  if (settings.startGreeting !== false) {
    win.webContents.once('did-finish-load', () => setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      const g = startupGreeting(profile, new Date(), Math.random, lastSeen);
      toAvatar('ai-reply', { ok: true, text: g.text, emotion: g.emotion, emotes: g.emote ? [g.emote] : [], speak: true });
    }, 4000));
  }
  // O painel (uma página grande, com ~25 scripts) abre logo depois do avatar, não ao mesmo tempo: assim a Yoru aparece
  // mais rápido. Se o avatar demorar, um limite de 3 s garante que o painel não fique de fora; se a pessoa abrir
  // o painel antes (Ctrl+Shift+P ou bandeja), `panel` já existe e nada é criado de novo.
  const makePanel = () => { if (!panel) createPanel({ show: settings.panelOnStart !== false }); };
  win.webContents.once('did-finish-load', () => setTimeout(makePanel, 50));
  setTimeout(makePanel, 3000).unref();
  if (!settings.firstRunDone) setTimeout(createWelcome, 600);
  createTray();
  startPriorityWatch();
  SYS.startStats();
  setInterval(pushPower, 5000).unref();
  try { powerMonitor.on('on-battery', () => pushPower()); powerMonitor.on('on-ac', () => pushPower()); } catch (_) {}
  if (win) win.webContents.once('did-finish-load', () => setTimeout(() => pushPower(), 800));
  scheduleWalk(6000);
  // seguir o cursor: o avatar é uma janela transparente que não recebe o mouse fora dela,
  // então o processo principal lê o cursor e manda a posição (relativa à janela) para o avatar acompanhar com os olhos e a cabeça
  let lastCur = '';
  setInterval(() => {
    if (!(settings.followCursor || settings.handFree) || !settings.visible || !win || win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = win.getBounds();
    const key = p.x + ',' + p.y + ',' + b.x + ',' + b.y + ',' + b.width + ',' + b.height;
    if (key === lastCur) return;
    lastCur = key;
    win.webContents.send('cursor-pos', { x: p.x - b.x, y: p.y - b.y, w: b.width, h: b.height });
  }, 50).unref();
  if (!settings.visible) win.hide();
  if (settings.convListening && tray) tray.setToolTip('Avatar Desktop — 🎙️ ouvindo');

  voice = createVoice({
    moveAvatar: (direction) => MOVE.moveAside(direction),
    settings: () => settings,
    panel: () => voicePanel(), // quem ouve o microfone (no Float Dock, a janela da Conversa)
    avatar: () => win,
    askAI,
    remember,
    logToPanel,
    rollDice: rollDiceNow,
    library: libAll,
    appAction,
    tapoControl: async (action, args = {}) => {
      if (!hubService) throw new Error('O serviço MASORI Smart Home ainda não está pronto.');
      return hubService.tapoControl(action, args);
    },
    openSmartHome: () => showPanel('hub'),
    hubBluetoothScan: async () => {
      if (!hubService) return { devices: [], error: 'Serviço Bluetooth indisponível.' };
      const result = await hubService.bluetoothDiscover(8);
      return { devices: result.devices || [], error: result.error || '', bleError: result.bleError || '', total: result.total || 0 };
    },
    bluetoothConnect: async (device) => {
      if (!hubService) throw new Error('Serviço Bluetooth indisponível.');
      return hubService.bluetoothConnect(device);
    },
    bluetoothConnectNow: async (device) => {
      if (!hubService) throw new Error('Serviço Bluetooth indisponível.');
      return hubService.bluetoothConnectNow(device);
    },
    openBluetoothPicker: (payload) => showBluetoothPicker(payload),
    updateBluetoothPicker: (payload) => updateBluetoothPicker(payload),
    openBluetoothDevice: (device) => {
      showBluetoothPicker({ stage:'confirm', device, message:`Você escolheu ${device?.FriendlyName || 'o dispositivo'}. Confirma a conexão?` });
    },
    smash: smashScreen,
    stopSpeak: () => toAvatar('stop-speak'),
    // Windows: abre pelo próprio sistema, num processo solto, sem esperar o navegador subir (o shell.openExternal
    // pode prender o app por segundos quando o navegador está fechado). Só https; o endereço vai como argumento, não como comando.
    openExternal: (url) => {
      if (!/^https:\/\//.test(url)) return;
      const t0 = Date.now();
      if (process.platform === 'win32') {
        try {
          const p = require('child_process').spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
          p.on('error', () => shell.openExternal(url));
          p.unref();
          console.log('[abrir] pedido enviado ao sistema em', Date.now() - t0, 'ms');
          return;
        } catch (_) { /* cai para o shell.openExternal */ }
      }
      shell.openExternal(url);
    },
    idleSeconds: () => { try { return powerMonitor.getSystemIdleTime(); } catch (_) { return 0; } },
    cacheDir: path.join(app.getPath('userData'), 'models'),
    agendaFile: path.join(app.getPath('userData'), 'agenda.json'),
  });
  // parada do PC: fica sonolenta e, quando você volta, dá oi
  let sleptIdle = false, peakIdle = 0;
  const WELCOME = ['Voltou! Achei que tinha me abandonado.', 'Oi de novo! Senti sua falta.', 'Ah, você voltou! Demorou, hein.', 'Bem-vindo de volta!'];
  const idleTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !settings.visible) return;
    let sec = 0;
    try { sec = powerMonitor.getSystemIdleTime(); } catch (_) { return; }
    peakIdle = Math.max(peakIdle, sec);
    const m = Number(settings.idleSleepMin) || 0;
    if (m > 0 && !sleptIdle && sec >= m * 60) { sleptIdle = true; toAvatar('play-emote', ['bed', 'tent'].includes(settings.idleSleepStyle) ? settings.idleSleepStyle : 'sleepy'); }
    if (sec < 10) {
      const wasInBed = sleptIdle && ['bed', 'tent'].includes(settings.idleSleepStyle);
      if (wasInBed) toAvatar('play-emote', 'stand');   // levanta da cama/barraca
      if (settings.idleWelcome && peakIdle >= 600 && voice) {
        const line = { text: WELCOME[Math.floor(Math.random() * WELCOME.length)], emotion: 'happy', emote: 'wave' };
        setTimeout(() => { if (voice) voice.say(line); }, wasInBed ? 900 : 0);
      }
      sleptIdle = false; peakIdle = 0;
    }
  }, 5000);
  idleTimer.unref();
  // se a escuta já estava ligada, carrega e aquece o Whisper em segundo plano (sem esperar a 1ª frase)
  if (settings.convListening) setTimeout(() => { voice.prepare().catch(() => {}); }, 4000);
  if (settings.convListening || settings.voiceEnabled) setTimeout(warmTts, 2500); // abre a conexão da voz antes da 1ª fala

  globalShortcut.register('CommandOrControl+Shift+Space', openChat);
  globalShortcut.register('CommandOrControl+Shift+M', toggleListening);
  globalShortcut.register('CommandOrControl+Shift+P', showPanel);
  globalShortcut.register('CommandOrControl+Shift+H', toggleVisible);

  // ----- painel de controle -----
  secureIpcMain.handle('get-settings', (e) => (fromPanel(e) || (alive() && e.sender === win.webContents) ? settings : DENIED));
  secureIpcMain.handle('get-version', (e) => (fromPanel(e) ? app.getVersion() : DENIED));
  // ----- Criação (imagens, textos, vídeos) -----
  hubService = createHubService({ userDataDir: app.getPath('userData'), safeStorage });

  // ----- app do celular (PWA): modo 1 = conversar com a Yoru; modo 2 = controlar o PC com senha (ver remote-server.js) -----
  const remote = createRemoteServer({
    userDataDir: app.getPath('userData'),
    webDir: path.join(__dirname, 'remote'),
    vendorDir: path.join(__dirname, 'vendor'),
    // o mesmo modelo VRM que o avatar do PC está usando agora
    avatarModel: async () => {
      const id = settings.avatarFile || 'default';
      const f = id === 'default' ? path.join(ASSETS, 'avatar.vrm') : libPath('avatars', id);
      return f && fs.existsSync(f) ? f : null;
    },
    version: app.getVersion(),
    pc: createPc(),
    // conversa pelo celular: vai direto para a IA (sem os comandos locais de voz, para o modo 1 nunca mexer no PC)
    chat: async (text, opts = {}) => {
      logToPanel({ role: 'user', text: `📱 ${text}` });
      const res = await askAI(text, {});
      logToPanel({ role: res.ok ? 'assistant' : 'error', text: res.text });
      if (opts.avatar && !res.streamed) toAvatar('ai-reply', res);
      return { ok: !!res.ok, text: String(res.text || '') };
    },
    captureScreen: async () => {
      const d = screen.getPrimaryDisplay();
      const width = 1280;
      const height = Math.max(1, Math.round(width * d.size.height / d.size.width));
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
      const src = sources.find((x) => String(x.display_id) === String(d.id)) || sources[0];
      return src ? src.thumbnail.toJPEG(60) : null;
    },
    isVisible: () => !!settings.visible,
    setVisible: (v) => { if (!!settings.visible !== !!v) toggleVisible(); },
    onEvent: (evt) => { logger.info('remote', `evento: ${evt.type}`, { device: evt.device || '', action: evt.action || '' }); broadcastPanels('remote-event', evt); },
    log: (m) => console.log(m),
  });
  secureIpcMain.handle('remote-status', (e) => (fromPanel(e) ? remote.status() : DENIED));
  secureIpcMain.handle('remote-set', async (e, patch = {}) => {
    if (!fromPanel(e)) return DENIED;
    const p = patch && typeof patch === 'object' ? patch : {};
    return { ok: true, status: await remote.configure({ enabled: p.enabled, port: p.port, lan: p.lan, controlEnabled: p.controlEnabled, controlTtlMin: p.controlTtlMin }) };
  });
  secureIpcMain.handle('remote-new-pairing', (e) => { if (!fromPanel(e)) return DENIED; remote.newPairing(); return { ok: true, status: remote.status() }; });
  secureIpcMain.handle('remote-revoke', (e, id) => (fromPanel(e) ? remote.revoke(String(id || '')) : DENIED));
  secureIpcMain.handle('remote-revoke-all', (e) => (fromPanel(e) ? remote.revokeAll() : DENIED));
  secureIpcMain.handle('remote-set-password', (e, password, confirm) => (fromPanel(e) ? remote.setPassword(password, confirm) : DENIED));
  secureIpcMain.handle('remote-clear-password', (e) => (fromPanel(e) ? remote.clearPassword() : DENIED));
  setTimeout(() => { remote.autoStart().catch(() => {}); }, 3500);
  app.on('will-quit', () => { remote.stop().catch(() => {}); });

  // WhatsApp pelo WhatsApp Web (QR code), sem conta Business. A IA é chamada direto (callModel), sem misturar com o chat do Yoru.
  waBot = createWhatsAppBot({
    userDataDir: app.getPath('userData'),
    callModel,
    routeConfig: (text) => AIC.ROUTER.route(loadConfig(), text, { maxTokens: settings.maxTokens }),
    log: (...a) => console.log(...a),
    onStatus: (snap) => broadcastPanels('wa-web-status', snap),
  });
  secureIpcMain.handle('wa-web-status', (e) => (fromPanel(e) ? waBot.status() : DENIED));
  secureIpcMain.handle('wa-web-start', (e) => (fromPanel(e) ? waBot.start() : DENIED));
  secureIpcMain.handle('wa-web-stop', (e) => (fromPanel(e) ? waBot.stop() : DENIED));
  secureIpcMain.handle('wa-web-logout', (e) => (fromPanel(e) ? waBot.logout() : DENIED));
  secureIpcMain.handle('wa-web-config-set', (e, config) => (fromPanel(e) ? waBot.setConfig(config || {}) : DENIED));
  setTimeout(() => { waBot.autoStartIfWanted().catch(() => {}); }, 6000);

  secureIpcMain.handle('bot-wa-test', async (e, c = {}) => {
    if (!fromPanel(e)) return DENIED;
    const phoneId=String(c.phoneId||'').trim(), token=String(c.token||'').trim(), version=String(c.version||'v23.0').trim();
    if (!/^\d{5,30}$/.test(phoneId) || !token || !/^v\d+\.\d+$/.test(version)) return {ok:false,error:'Informe Phone Number ID, token e versão válida.'};
    try { const r=await fetch(`https://graph.facebook.com/${version}/${phoneId}?fields=verified_name,display_phone_number,quality_rating,code_verification_status`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)}); const data=await r.json(); return r.ok?{ok:true,name:data.verified_name||data.display_phone_number||'Número localizado',displayPhone:data.display_phone_number||'',quality:data.quality_rating||'Indisponível',verification:data.code_verification_status||'Indisponível'}:{ok:false,error:data.error?.message||`Meta HTTP ${r.status}`,code:data.error?.code||null}; }
    catch(err){ return {ok:false,error:err.message}; }
  });
  secureIpcMain.handle('bot-wa-send', async (e, c = {}) => {
    if (!fromPanel(e)) return DENIED;
    const phoneId=String(c.phoneId||'').trim(), token=String(c.token||'').trim(), to=String(c.to||'').replace(/\D/g,''), version=String(c.version||'v23.0').trim();
    if (!/^\d{5,30}$/.test(phoneId) || !token || !/^\d{10,15}$/.test(to) || !/^v\d+\.\d+$/.test(version)) return {ok:false,error:'Confira Phone Number ID, token, versão e telefone com código do país.'};
    const body={messaging_product:'whatsapp',to,type:'text',text:{preview_url:false,body:'Olá! Esta é uma mensagem de teste enviada pelo Yoru.'}};
    try { const r=await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)}); const data=await r.json(); return r.ok?{ok:true,id:data.messages?.[0]?.id||'',status:data.messages?.[0]?.message_status||'accepted'}:{ok:false,error:data.error?.message||`Meta HTTP ${r.status}`,code:data.error?.code||null}; }
    catch(err){ return {ok:false,error:err.message}; }
  });
  secureIpcMain.handle('hub-scan', (e) => fromPanel(e) ? hubService.scan() : DENIED);
  secureIpcMain.handle('hub-connectivity-status', (e) => fromPanel(e) ? hubService.connectivityStatus() : DENIED);
  secureIpcMain.handle('hub-open-wifi-settings', (e) => fromPanel(e) ? hubService.openWifiSettings() : DENIED);
  secureIpcMain.handle('hub-tapo-config-get', (e) => fromPanel(e) ? hubService.tapoConfigGet() : DENIED);
  secureIpcMain.handle('hub-tapo-config-set', (e, config) => fromPanel(e) ? hubService.tapoConfigSet(config || {}) : DENIED);
  secureIpcMain.handle('hub-tapo-config-clear', (e) => fromPanel(e) ? hubService.tapoConfigClear() : DENIED);
  secureIpcMain.handle('hub-tapo-runtime', (e) => fromPanel(e) ? hubService.tapoRuntimeStatus() : DENIED);
  secureIpcMain.handle('hub-tapo-discover', (e) => fromPanel(e) ? hubService.tapoDiscover() : DENIED);
  secureIpcMain.handle('hub-tapo-select-host', (e, host) => fromPanel(e) ? hubService.tapoSelectHost(host) : DENIED);
  secureIpcMain.handle('hub-tapo-control', (e, action, args) => fromPanel(e) ? hubService.tapoControl(action, args || {}) : DENIED);
  secureIpcMain.handle('hub-discover-agents', (e) => fromPanel(e) ? hubService.discoverAgents() : DENIED);
  secureIpcMain.handle('hub-iphone-usb-status', (e) => fromPanel(e) ? hubService.iphoneUsbStatus() : DENIED);
  secureIpcMain.handle('hub-iphone-photos-import', (e) => fromPanel(e) ? hubService.openWindowsPhotosImport() : DENIED);
  secureIpcMain.handle('hub-airplay-configure', async (e) => { if (!fromPanel(e)) return DENIED; const r=await dialog.showOpenDialog(panel && !panel.isDestroyed()?panel:undefined,{title:'Selecionar receptor AirPlay instalado',properties:['openFile'],filters:[{name:'Aplicativo Windows',extensions:['exe']}]}); if(r.canceled||!r.filePaths[0])return {ok:false,canceled:true}; return hubService.setAirplayExecutable(r.filePaths[0]); });
  secureIpcMain.handle('hub-airplay-status', (e) => fromPanel(e) ? hubService.airplayStatus() : DENIED);
  secureIpcMain.handle('hub-airplay-start', (e) => fromPanel(e) ? hubService.airplayStart() : DENIED);
  secureIpcMain.handle('hub-airplay-stop', (e) => fromPanel(e) ? hubService.airplayStop() : DENIED);
  secureIpcMain.handle('hub-volume-eject', (e, drive) => fromPanel(e) ? hubService.ejectVolume(drive) : DENIED);
  secureIpcMain.handle('hub-bluetooth-open-settings', (e) => fromPanel(e) ? hubService.bluetoothOpenSettings() : DENIED);
  secureIpcMain.handle('hub-bluetooth-nearby-scan', (e, seconds) => fromPanel(e) ? hubService.bluetoothNearbyScan(seconds) : DENIED);
  secureIpcMain.handle('hub-bluetooth-discover', (e, seconds) => fromPanel(e) ? hubService.bluetoothDiscover(seconds) : DENIED);
  secureIpcMain.handle('hub-bluetooth-connect', (e, device) => fromPanel(e) ? hubService.bluetoothConnect(device) : DENIED);
  secureIpcMain.handle('hub-bluetooth-gatt-inspect', (e, address) => fromPanel(e) ? hubService.bluetoothGattInspect(address) : DENIED);
  secureIpcMain.handle('hub-bluetooth-details', (e, id) => fromPanel(e) ? hubService.bluetoothDeviceDetails(id) : DENIED);
  secureIpcMain.handle('hub-bluetooth-volume', (e, value) => fromPanel(e) ? hubService.setSystemVolume(value) : DENIED);
  secureIpcMain.handle('hub-start', (e) => fromPanel(e) ? hubService.start() : DENIED);
  secureIpcMain.handle('hub-stop', (e) => fromPanel(e) ? hubService.stop() : DENIED);
  secureIpcMain.handle('hub-select-files', async (e) => { if (!fromPanel(e)) return DENIED; const result = await dialog.showOpenDialog(panel && !panel.isDestroyed() ? panel : undefined, { title: 'Escolher arquivos para compartilhar no Yoru Hub', properties: ['openFile', 'multiSelections'] }); return result.canceled ? { ok: false, canceled: true } : { ok: true, files: hubService.setSharedFiles(result.filePaths) }; });
  secureIpcMain.handle('hub-status', (e) => fromPanel(e) ? hubService.status() : DENIED);
  secureIpcMain.handle('hub-local-folder', async (e) => { if (!fromPanel(e)) return DENIED; const r=await dialog.showOpenDialog(panel && !panel.isDestroyed()?panel:undefined,{title:'Escolher pasta local do Yoru Hub',properties:['openDirectory']}); if(r.canceled||!r.filePaths[0])return {ok:false,canceled:true}; return {ok:true,path:hubService.setLocalFolder(r.filePaths[0])}; });
  secureIpcMain.handle('hub-local-list', (e, rel) => fromPanel(e) ? hubService.localList(rel) : DENIED);
  secureIpcMain.handle('hub-agent-connect', (e, url, token) => fromPanel(e) ? hubService.connectAgent(url,token) : DENIED);
  secureIpcMain.handle('hub-agent-list', (e, rel) => fromPanel(e) ? hubService.agentList(rel) : DENIED);
  secureIpcMain.handle('hub-agent-send', (e, file, rel) => fromPanel(e) ? hubService.transferToAgent(file,rel) : DENIED);
  secureIpcMain.handle('hub-agent-receive', (e, file, rel) => fromPanel(e) ? hubService.receiveFromAgent(file,rel) : DENIED);
  secureIpcMain.handle('hub-agent-disconnect', (e) => fromPanel(e) ? hubService.disconnectAgent() : DENIED);
  secureIpcMain.handle('hub-android-status', (e) => fromPanel(e) ? hubService.androidStatus() : DENIED);
  secureIpcMain.handle('hub-android-connect-wifi', (e, target) => fromPanel(e) ? hubService.androidConnectWifi(target) : DENIED);
  secureIpcMain.handle('hub-android-screen-status', (e) => fromPanel(e) ? hubService.scrcpyStatus() : DENIED);
  secureIpcMain.handle('hub-android-screen-start', (e, serial, options) => fromPanel(e) ? hubService.androidScreenStart(serial, options) : DENIED);
  secureIpcMain.handle('hub-android-screen-stop', (e) => fromPanel(e) ? hubService.androidScreenStop() : DENIED);
  secureIpcMain.handle('hub-android-list', (e, serial, remote) => fromPanel(e) ? hubService.androidList(serial, remote) : DENIED);
  secureIpcMain.handle('hub-android-pull', (e, serial, remote, local) => fromPanel(e) ? hubService.androidPull(serial, remote, local) : DENIED);
  secureIpcMain.handle('hub-android-push', (e, serial, local, remote) => fromPanel(e) ? hubService.androidPush(serial, local, remote) : DENIED);
  registerCriacaoIpc({ ipcMain: secureIpcMain, shell, dialog, BrowserWindow, loadConfig, saveConfig, svc: criaSvc, asMsg: CRIASVC.asMsg, isPanelSender });
  secureIpcMain.handle('copy-text', (_e, t) => { clipboard.writeText(String(t || '').slice(0, 20000)); return true; });
  secureIpcMain.handle('perf-info', (e) => (fromPanel(e) ? SYS.perfInfo() : DENIED));
  secureIpcMain.handle('runtime-diagnostics', (e) => (fromPanel(e) ? RUNTIME_DIAGNOSTICS.snapshot({ app, os }) : DENIED));
  const runSystemHealth = createHealthChecks({ app, os, fsRef: fs, pathRef: path, rootDir: __dirname, userDataDir: app.getPath('userData') });
  secureIpcMain.handle('system-health', (e) => (fromPanel(e) ? runSystemHealth() : DENIED));
  secureIpcMain.handle('app-logs-export', async (e) => {
    if (!fromPanel(e)) return DENIED;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const result = await dialog.showSaveDialog(panel && !panel.isDestroyed() ? panel : undefined, { title: 'Exportar logs técnicos do Yoru', defaultPath: `Yoru-Logs-${stamp}.log`, filters: [{ name: 'Logs de texto', extensions: ['log', 'txt'] }] });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const data = Buffer.from(logger.exportText(2000), 'utf8');
      await fs.promises.writeFile(result.filePath, data);
      logger.info('support', 'Logs técnicos exportados', { bytes: data.length });
      return { ok: true, bytes: data.length };
    } catch (err) { logger.error('support', 'Falha ao exportar logs', err); return { ok: false, error: String(err.message || err).slice(0, 240) }; }
  });
  secureIpcMain.handle('support-report-export', async (e) => {
    if (!fromPanel(e)) return DENIED;
    try {
      const health = await runSystemHealth();
      const runtime = RUNTIME_DIAGNOSTICS.snapshot({ app, os });
      const report = createSupportReport({ health, runtime });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const result = await dialog.showSaveDialog(panel && !panel.isDestroyed() ? panel : undefined, { title: 'Exportar relatório técnico do Yoru', defaultPath: `Yoru-Diagnostico-${stamp}.json`, filters: [{ name: 'Relatório JSON', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      const data = Buffer.from(JSON.stringify(report, null, 2), 'utf8');
      await fs.promises.writeFile(result.filePath, data, { flag: 'wx' });
      return { ok: true, bytes: data.length };
    } catch (err) { return { ok: false, error: String(err.message || err).slice(0, 240) }; }
  });
  secureIpcMain.handle('backup-create', async (e) => {
    if (!fromPanel(e)) return DENIED;
    try {
      flushSettings();
      try { MEM.save(memFile(), memory); PROF.save(profileFile(), profile); persistChat(); } catch (_) {}
      const buffer = await BACKUP.createBackup({ userDataDir: app.getPath('userData'), configFile: CONFIG_FILE });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const result = await dialog.showSaveDialog(panel && !panel.isDestroyed() ? panel : undefined, { title: 'Salvar backup do Yoru', defaultPath: `Yoru-Backup-${stamp}.yorubackup`, filters: [{ name: 'Backup do Yoru', extensions: ['yorubackup'] }] });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fs.promises.writeFile(result.filePath, buffer);
      return { ok: true, path: result.filePath, bytes: buffer.length };
    } catch (err) { return { ok: false, error: String(err.message || err).slice(0, 240) }; }
  });
  secureIpcMain.handle('backup-restore', async (e) => {
    if (!fromPanel(e)) return DENIED;
    try {
      const pick = await dialog.showOpenDialog(panel && !panel.isDestroyed() ? panel : undefined, { title: 'Selecionar backup do Yoru', properties: ['openFile'], filters: [{ name: 'Backup do Yoru', extensions: ['yorubackup'] }] });
      if (pick.canceled || !pick.filePaths.length) return { ok: false, canceled: true };
      const confirm = await dialog.showMessageBox(panel && !panel.isDestroyed() ? panel : undefined, { type: 'warning', buttons: ['Cancelar', 'Restaurar'], defaultId: 0, cancelId: 0, title: 'Restaurar backup', message: 'Os dados atuais correspondentes serão substituídos.', detail: 'Recomendamos criar um backup antes de continuar. O Yoru será reiniciado para carregar os dados restaurados.' });
      if (confirm.response !== 1) return { ok: false, canceled: true };
      flushSettings();
      const buffer = await fs.promises.readFile(pick.filePaths[0]);
      const restored = await BACKUP.restoreBackup({ buffer, userDataDir: app.getPath('userData'), configFile: CONFIG_FILE });
      setTimeout(() => { app.relaunch(); app.exit(0); }, 500);
      return { ok: true, ...restored };
    } catch (err) { return { ok: false, error: String(err.message || err).slice(0, 240) }; }
  });
  // ----- Otimizar o PC (limpeza, energia, Modo de Jogo, programas da inicialização): só o painel pode pedir -----
  const OPT = createOptimizer();
  secureIpcMain.handle('optimize-catalog', (e) => (fromPanel(e) ? { supported: OPT.supported, actions: OPT.catalog() } : DENIED));
  secureIpcMain.handle('optimize-info', (e) => (fromPanel(e) ? OPT.info() : DENIED));
  secureIpcMain.handle('optimize-run', (e, id) => (fromPanel(e) ? OPT.run(String(id || '').slice(0, 40)) : DENIED));
  secureIpcMain.handle('optimize-startup-list', (e) => (fromPanel(e) ? OPT.startupList() : DENIED));
  secureIpcMain.handle('optimize-startup-set', (e, name, on) => (fromPanel(e) ? OPT.startupSet(String(name || '').slice(0, 200), !!on) : DENIED));
  secureIpcMain.handle('chatter-now', () => (voice ? voice.chatterNow() : false));
  secureIpcMain.handle('smash-now', () => smashScreen());
  // lista de comandos que a IA recebe no prompt (para o painel mostrar o que ela sabe e quanto isso pesa)
  secureIpcMain.handle('commands-info', () => {
    const block = CMDS.promptBlock({ wake: settings.convWake, pcActions: settings.convPcActions });
    return { commands: CMDS.COMMANDS, sites: CMDS.siteLabels(), shortcuts: CMDS.SHORTCUTS, chars: block.length, tokens: Math.round(block.length / 3.6) };
  });
  // medição da última voz neural (aparece na aba Voz): tempo, tamanho, se veio da memória e se a conexão falhou
  let lastTts = null;
  const ttsInfo = () => ({ ...(lastTts || {}), ...neural.cacheInfo() });
  const reportTts = (r) => { lastTts = { ...r, at: Date.now() }; broadcastPanels('tts-stat', ttsInfo()); };
  secureIpcMain.handle('tts-stat', () => ttsInfo());
  secureIpcMain.handle('tts-clear', () => { neural.clearCache(); broadcastPanels('tts-stat', ttsInfo()); return true; });
  secureIpcMain.handle('tts', async (_e, text) => {
    const t0 = Date.now();
    try {
      const clean = String(text || '').trim();
      if (!clean) return { ok: false, error: 'texto vazio' };
      const cached = neural.hasCached(clean);
      const data = await synth(clean);
      reportTts({ ok: true, ms: Date.now() - t0, bytes: data.length, cached, chars: clean.length, voice: settings.neuralVoice });
      return { ok: true, data };
    } catch (e) {
      const error = String((e && e.message) || e);
      reportTts({ ok: false, error, ms: Date.now() - t0 });
      return { ok: false, error };
    }
  });
  secureIpcMain.handle('tts-voices', () => neuralVoices());
  secureIpcMain.on('panel-set', (e, partial) => {
    if (!fromPanel(e)) return;
    partial = sanitize(partial || {}, settings);
    const reload = ('quality' in partial && partial.quality !== settings.quality) ||
      ('textureSize' in partial && partial.textureSize !== settings.textureSize) ||
      ('antialias' in partial && partial.antialias !== settings.antialias);
    settings = { ...settings, ...partial };
    applySettings(partial);
    saveSettings();
    if (reload) setTimeout(() => { if (alive()) win.webContents.reload(); }, 150); // aplica qualidade/texturas
  });
  secureIpcMain.on('panel-action', (e, name, arg) => {
    if (!fromPanel(e)) return;
    if (name === 'emote') toAvatar('play-emote', arg || 'random');
    if (name === 'speak-test') toAvatar('speak-test', typeof arg === 'string' ? arg.slice(0, 300) : '');
    if (name === 'stop-speak') toAvatar('stop-speak');
    if (name === 'voice-orb') toAvatar('voice-orb', ['off', 'listening', 'hearing', 'busy', 'muted'].includes(arg) ? arg : 'off');
    if (name === 'walk-now') { if (!startWalk(true)) scheduleWalk(1500); }
    if (name === 'item-roll') rollDiceNow(false); // garante que os dados estejam na mão e rola
    if (name === 'toggle-chat') openChat();
    if (name === 'clear-history') clearHistory();
    if (name === 'panel-preset' && PANEL_PRESETS[arg]) setPanelSize(...PANEL_PRESETS[arg], true);
    if (name === 'panel-size' && arg && typeof arg === 'object') setPanelSize(arg.w, arg.h);
    if (name === 'panel-center') centerPanel();
    if (name === 'open-tab') openSolo(String(arg || ''));
    if (name === 'dock-fit' && arg && typeof arg === 'object') dockFit(arg);   // Float Dock: janela justa ao conteúdo
    if (name === 'dock-drag') setDockDrag(arg === true);                        // arraste do símbolo Y: janela cobre a tela
    if (name === 'dock-hit') setDockHit(arg === true);                          // mouse sobre o dock (senão o clique atravessa)
    if (name === 'panel-max' && panel && !panel.isDestroyed()) { panel.isMaximized() ? panel.unmaximize() : panel.maximize(); }
    if (name === 'corner' && ['tl', 'tr', 'bl', 'br'].includes(arg)) moveToCorner(arg);
    if (name === 'reset') {
      const keep = { alwaysOnTop: settings.alwaysOnTop, visible: settings.visible, pos: settings.pos, avatarFile: settings.avatarFile, avatarMode: settings.avatarMode, firstRunDone: settings.firstRunDone, panelBounds: settings.panelBounds,
        panelTheme: settings.panelTheme, panelAccent: settings.panelAccent, startWithOS: settings.startWithOS,
        panelZoom: settings.panelZoom, panelOnTop: settings.panelOnTop, panelOnStart: settings.panelOnStart };
      settings = { ...DEFAULTS, ...keep };
      applySettings({ scale: 1, rotation: 0, handFree: false, walkEnabled: settings.walkEnabled });
      saveSettings();
    }
    if (name === 'restart') { saveSettings(); setTimeout(() => { app.relaunch(); app.exit(0); }, 250); }
    if (name === 'quit') app.quit();
  });

  // ----- gestos de mão (a câmera e o reconhecimento rodam no painel; aqui só se executa a ação, de uma lista fixa) -----
  const gestures = createGestureActions({
    pc: createPc(),
    emoteIds: AS.EMOTE_IDS,
    stopSpeak: () => toAvatar('stop-speak'),
    openChat,
    rollDice: rollDiceNow,
    playEmote: (id) => toAvatar('play-emote', id),
  });
  secureIpcMain.handle('gesture-action', (e, action) => (isPanelSender(e.sender) ? gestures.run(String(action || '').slice(0, 40)) : { ok: false, error: 'remetente não autorizado' }));
  const airMouse = createAirMouse();
  app.on('will-quit', () => airMouse.stop());
  secureIpcMain.on('air-mouse', (e, msg) => { if (isPanelSender(e.sender)) airMouse.handle(msg); });
  // mão livre: a mão virtual (janela transparente que não pega o mouse). A pose vem da câmera pelo painel; a posição, do cursor do sistema.
  secureIpcMain.on('hand-pose', (e, pose) => { if (isPanelSender(e.sender)) handOverlay.setPose(pose); });
  // avatar <-> mão: punho enquanto ela é agarrada, cabeça dela para a mão ir fazer carinho, e a mão avisa quando fez
  const fromAvatar = (e) => !!win && !win.isDestroyed() && e.sender === win.webContents;
  secureIpcMain.on('avatar-grab', (e, on) => { if (fromAvatar(e)) handOverlay.setHold(on ? 'fist' : 'none'); });
  secureIpcMain.on('avatar-head', (e, x, y, r) => {
    if (!fromAvatar(e) || !settings.handFree) return;
    const b = win.getBounds();
    handOverlay.setFriend(b.x + Number(x), b.y + Number(y), Number(r));
  });
  let lastPat = 0;
  secureIpcMain.on('hand-pat', (e) => {
    if (!handOverlay.isSender(e.sender) || !win || win.isDestroyed() || !settings.visible || Date.now() - lastPat < 8000) return;
    lastPat = Date.now();
    toAvatar('play-emote', Math.random() < 0.6 ? 'happy' : 'shy');
  });
  app.on('will-quit', () => handOverlay.stop());
  if (settings.handFree) handOverlay.sync();
  // fetch() de file:// não funciona no navegador: o painel pede os arquivos do MediaPipe por aqui (só nomes simples, dentro de vendor/mediapipe)
  secureIpcMain.handle('gesture-file', (e, name) => {
    if (!isPanelSender(e.sender) || typeof name !== 'string' || !/^[\w.-]{1,80}$/.test(name) || !/\.(task|wasm)$/.test(name)) return null;
    const dir = path.join(__dirname, 'vendor', 'mediapipe');
    const f = name.endsWith('.task') ? path.join(dir, name) : path.join(dir, 'wasm', name);
    try { return fs.readFileSync(f); } catch (_) { return null; }
  });
  secureIpcMain.handle('gesture-model', () => {
    const dir = path.join(__dirname, 'vendor', 'mediapipe');
    return { mouse: airMouse.supported, model: fs.existsSync(path.join(dir, 'hand_landmarker.task')), runtime: fs.existsSync(path.join(dir, 'vision_bundle.mjs')) && fs.existsSync(path.join(dir, 'wasm')) };
  });

  // ----- conversa por voz -----
  secureIpcMain.handle('voice-mic-access', async (e) => { if (!fromPanel(e)) return false;
    if (process.platform !== 'darwin') return true; // Windows/Linux: o sistema pergunta sozinho
    try { return await systemPreferences.askForMediaAccess('microphone'); } catch (_) { return false; }
  });
  secureIpcMain.handle('voice-prepare', (e) => (fromPanel(e) ? voice.prepare() : DENIED));
  secureIpcMain.handle('panel-bounds', (e) => { if (!fromPanel(e)) return DENIED; if (!panel || panel.isDestroyed()) return null; const b = panel.getBounds(); return { w: b.width, h: b.height, max: panel.isMaximized() }; });
  secureIpcMain.handle('agenda-list', (e) => (fromPanel(e) ? voice.agendaList() : DENIED));
  secureIpcMain.handle('agenda-remove', (e, id) => (fromPanel(e) ? voice.agendaRemove(String(id || '')) : DENIED));
  secureIpcMain.handle('agenda-add', (e, text) => (fromPanel(e) ? voice.agendaAddText(String(text || '').slice(0, 200)) : DENIED));
  secureIpcMain.handle('voice-audio', (e, audio, force) => (fromPanel(e) ? voice.onAudio(audio, !!force) : DENIED));
  secureIpcMain.handle('voice-clap', (e) => (fromPanel(e) ? voice.clap() : DENIED));
  secureIpcMain.handle('voice-text', (e, text) => (fromPanel(e) ? voice.typed(String(text || '').slice(0, 500)).then(() => true) : DENIED));
  secureIpcMain.on('speaking-state', (e, on) => { if (fromPanel(e) || (alive() && e.sender === win.webContents)) voice.speakingState(!!on); });

  // ----- biblioteca -----
  // miniaturas dos itens: quem desenha é a janela do avatar (ela tem o three.js); aqui só se pede e se recebe
  const thumbWait = new Map();
  let thumbSeq = 0;
  const renderItemThumb = (key) => new Promise((resolve) => {
    if (!win || win.isDestroyed() || win.webContents.isLoading()) return resolve(null);
    const id = ++thumbSeq;
    const timer = setTimeout(() => { thumbWait.delete(id); resolve(null); }, 15000);
    thumbWait.set(id, (u) => { clearTimeout(timer); resolve(u); });
    win.webContents.send('item-thumb', id, key);
  });
  secureIpcMain.on('item-thumb-done', (e, id, url) => {
    if (!win || win.isDestroyed() || e.sender !== win.webContents) return;
    const done = thumbWait.get(id);
    if (!done) return;
    thumbWait.delete(id);
    done(typeof url === 'string' && url.length < 3e6 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url) ? url : null); // só PNG, nada além
  });
  registerLibraryIpc({
    renderItemThumb,
    ipcMain: secureIpcMain, dialog, shell, BrowserWindow, nativeImage, isPanelSender, assetsDir: ASSETS, lib: { libDir, libAll, libPath }, getSettings: () => settings,
    commit: (partial) => { settings = { ...settings, ...partial }; applySettings(partial); saveSettings(); },
  });

  // ----- IA, perfil e memória -----
  registerIaIpc({
    ocConnector,
    ipcMain: secureIpcMain, ai, askAI, callModel, loadConfig, saveConfig, logToPanel, isPanelSender, getWin: () => win, broadcastPanels, dialog, desktopCapturer,
    tryLocal: (t) => (voice ? voice.tryLocal(t) : false),
    state: { memory: () => memory, memChanged, profile: () => profile, setProfile: (p) => { profile = p; }, profileFile, masoriFile: () => path.join(app.getPath('userData'), 'masori-agents.json') },
  });
  secureIpcMain.on('welcome-go', (_e, tab) => {
    const ok = ['perfil', 'ia', 'voz', 'avatar'].includes(tab);
    showPanel();
    if (ok && panel && !panel.isDestroyed()) panel.webContents.send('go-tab', tab);
  });
  secureIpcMain.on('welcome-done', () => {
    settings.firstRunDone = true;
    saveSettings();
    closeWelcome();
  });

  // ----- avatar -----
  // WebGL falhou na GPU: reinicia em modo software
  secureIpcMain.on('relaunch-no-gpu', () => {
    if (noGpu) return;
    app.relaunch({ args: process.argv.slice(1).concat('--no-gpu') });
    app.exit(0);
  });
  secureIpcMain.on('set-ignore', (_e, ignore) => {
    if (alive()) win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
  });
  secureIpcMain.handle('get-pos', () => (alive() ? win.getPosition() : [0, 0]));
  secureIpcMain.on('phys-grab', () => { stopFall(false); stopWalk(); });
  secureIpcMain.on('walk-busy', (_e, busy) => setWalkBusy(busy));
  secureIpcMain.on('drop', (_e, vx, vy) => {
    vx = clamp(vx, -4000, 4000, 0);
    vy = clamp(vy, -4000, 4000, 0);
    if (!settings.dropPhysics) { stopFall(true); return; }
    startFall(vx, vy);
  });
  secureIpcMain.on('perf-fps', (_e, f) => SYS.setFps(f));
  secureIpcMain.on('set-pos', (_e, x, y) => setWinPos(x, y));
  secureIpcMain.on('context-menu', () => { if (alive()) Menu.buildFromTemplate(menuItems()).popup({ window: win }); });

  // Teste automático: salva uma captura da janela e fecha
  if (process.env.AVATAR_SNAPSHOT) {
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.AVATAR_SNAPSHOT, img.toPNG());
      const pimg = await panel.webContents.capturePage();
      fs.writeFileSync(process.env.AVATAR_SNAPSHOT + '.panel.png', pimg.toPNG());
      app.quit();
    }, 9000);
  }
});

nativeTheme.on('updated', () => { if (settings.panelTheme === 'auto') for (const w of allPanels()) { w.setBackgroundColor(panelBg()); applyBar(w); } });
app.on('before-quit', () => {
  logger.info('app', 'Encerrando Yoru');
  try { if (typeof hubService !== 'undefined') hubService.stop(); } catch (error) { logger.warn('shutdown', 'Falha ao encerrar o Hub', error); }
  try { if (waBot) waBot.dispose(); } catch (error) { logger.warn('shutdown', 'Falha ao encerrar WhatsApp', error); }
  quitting = true; flushSettings(); writeChatNow();
});
app.on('second-instance', () => showPanel());
app.on('will-quit', () => { globalShortcut.unregisterAll(); if (voice) voice.dispose(); });
app.on('window-all-closed', () => app.quit());
