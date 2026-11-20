'use strict';
// Todas as janelas do app: avatar, painel, abas destacadas, boas-vindas e o "vidro rachado".
// O main.js guarda `win` e `panel` (muita coisa depende deles); aqui eles chegam por getters/setters.
const path = require('path');
const { pathToFileURL } = require('url');
const MOTION = require('./motion');
const { THEME_BG, THEME_BAR, clamp } = require('./settings');

// abas em janelas separadas. A "conversa" é especial: o microfone fica em UMA janela só (duas ouviriam em dobro).
// Fora do Float Dock é o painel principal; no Float Dock (a janela principal é só a barra) é a janela solo da Conversa.
const SOLO_TABS = {
  avatar: 'Avatar', perfil: 'Perfil', itens: 'Itens',
  chat: 'Chat', conversa: 'Conversa', gestos: 'Gestos', ia: 'IA', masori: 'Masori-Sama',
  criacao: 'Criação', hub: 'Conectividade', bots: 'Bots', celular: 'Celular', geral: 'Configurações',
};
const PANEL_PRESETS = { compact: [880, 620], default: [1040, 760], large: [1280, 860], tall: [1100, 960] };

function createWindows({ BrowserWindow, screen, shell, nativeTheme, assetsDir, base, chatBuf, getSettings, saveSettings, getWin, setWin, getPanel, setPanel, isQuitting }) {
  // Escala do Windows (120%, 150%...): a interface do painel encolhe um pouco e as janelas abrem menores,
  // para o painel não ocupar a tela inteira. Em 100% nada muda. Soma-se ao "Zoom da interface" das configurações.
  const autoZoom = (display) => {
    const sf = (display && display.scaleFactor) || 1;
    return sf <= 1.05 ? 1 : clamp(Math.pow(sf, -0.6), 0.7, 1, 1);
  };
  const zoomFor = (win) => {
    let d = null;
    try { d = screen.getDisplayMatching(win.getBounds()); } catch (_) { /* usa 100% */ }
    return clamp((getSettings().panelZoom || 1) * autoZoom(d), 0.5, 1.5, 1);
  };
  const applyZoom = (win) => { try { if (!win.isDestroyed()) win.webContents.setZoomFactor(zoomFor(win)); } catch (_) { /* a janela pode estar fechando */ } };
  const soloWins = new Map(); // aba -> janela própria ("destacada" do painel)
  let crackWin = null;
  let welcomeWin = null;
  const floorTop = MOTION.floorTop;

  // temas do painel (as cores ficam em panel.html; aqui só o fundo da janela, para não piscar ao abrir)
  function panelBg() {
    const t = getSettings().panelTheme;
    return THEME_BG[t] || (nativeTheme.shouldUseDarkColors ? THEME_BG.dark : THEME_BG.light);
  }
  // Barra de título própria (só no Windows): o sistema continua desenhando minimizar/maximizar/fechar (com o menu de
  // encaixe do Win11), mas nas cores do tema; o resto da barra é o `.tb` do panel.html (logo, nome, versão e área de arrastar).
  const TB_H = 40;
  const customBar = process.platform === 'win32';
  function barColors() {
    const t = getSettings().panelTheme;
    return THEME_BAR[t] || (nativeTheme.shouldUseDarkColors ? THEME_BAR.dark : THEME_BAR.light);
  }
  const barOptions = () => (customBar
    ? { titleBarStyle: 'hidden', titleBarOverlay: { color: barColors().color, symbolColor: barColors().symbol, height: TB_H } }
    : {});
  // cor do tema e altura (acompanha o zoom do painel, senão os botões não alinham com a barra)
  function applyBar(win) {
    if (!customBar || !win || win.isDestroyed() || typeof win.setTitleBarOverlay !== 'function') return;
    try { win.setTitleBarOverlay({ color: barColors().color, symbolColor: barColors().symbol, height: Math.round(TB_H * zoomFor(win)) }); } catch (_) { /* janela fechando */ }
  }
  const panelQuery = (extra = {}) => { const s = getSettings(); return { theme: s.panelTheme || 'auto', accent: s.panelAccent || '#ff7a2e', ...(customBar ? { tb: '1' } : {}), ...extra }; };

  // janelas do painel que estão vivas: a principal e as destacadas
  function allPanels() {
    return [getPanel(), ...soloWins.values()].filter((w) => w && !w.isDestroyed());
  }
  function broadcastPanels(channel, ...args) {
    for (const w of allPanels()) w.webContents.send(channel, ...args);
  }
  const isPanelSender = (wc) => allPanels().some((w) => w.webContents === wc);

  // as janelas só mostram as páginas do próprio app: links e novas janelas abrem no navegador (https) ou são ignorados
  function lockNavigation(w) {
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
    const appUrl = pathToFileURL(__dirname).href;
    w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(appUrl)) e.preventDefault(); });
  }

  // ---------- janela do avatar ----------
  function createWindow() {
    const settings = getSettings();
    const { workArea } = screen.getPrimaryDisplay();
    const W = Math.round(base.w * settings.scale);
    const H = Math.round(base.h * settings.scale);
    let x = workArea.x + workArea.width - W;
    let y = floorTop(workArea, H);

    // lembra a última posição (se ainda estiver numa tela existente)
    const pos = settings.pos;
    if (pos && screen.getAllDisplays().some((d) => {
      const a = d.workArea, cx = pos.x + W / 2, cy = pos.y + H / 2;
      return cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height;
    })) { x = pos.x; y = pos.y; }
    { // posição salva um pouco acima do chão (versões antigas): encosta os pés na barra de tarefas
      const fl = floorTop(screen.getDisplayMatching({ x, y, width: W, height: H }).workArea, H);
      if (y < fl && fl - y <= H * 0.08) y = fl;
    }

    const win = new BrowserWindow({
      width: W,
      height: H,
      x,
      y,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      hasShadow: false,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    setWin(win);
    lockNavigation(win);

    win.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
    win.setIgnoreMouseEvents(true, { forward: true });

    let moveTimer;
    win.on('move', () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        const [px, py] = win.getPosition();
        getSettings().pos = { x: px, y: py };
        saveSettings();
      }, 500);
    });

    // Diagnóstico: mostra no terminal os erros da página
    win.webContents.on('console-message', (e, level, message) =>
      console.log('[renderer]', e && e.message !== undefined ? e.message : message)
    );
    win.webContents.on('did-fail-load', (_e, code, desc) => console.log('[did-fail-load]', code, desc));
    win.webContents.on('render-process-gone', (_e, d) => console.log('[render-process-gone]', d.reason));
    if (process.argv.includes('--debug')) win.webContents.openDevTools({ mode: 'detach' });

    const dbg = process.argv.includes('--debug') || process.env.AVATAR_TEST;
    win.loadFile(path.join(__dirname, 'index.html'), dbg ? { query: { debug: '1' } } : undefined);
  }

  // ---------- soco na tela: a Yoru bate no "vidro" e a tela racha, depois volta ao normal ----------
  function openCrack() {
    const win = getWin(), settings = getSettings();
    const CRACK_MS = Math.round((Number(settings.crackSeconds) || 5) * 1000);
    if (!win || win.isDestroyed() || (crackWin && !crackWin.isDestroyed())) return;
    const b = win.getBounds();
    const d = screen.getDisplayMatching(b);
    const ix = Math.round(Math.min(Math.max(b.x + b.width / 2 - d.bounds.x, 0), d.bounds.width));
    const iy = Math.round(Math.min(Math.max(b.y + b.height * 0.36 - d.bounds.y, 0), d.bounds.height));
    crackWin = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, focusable: false,
      skipTaskbar: true, show: false, alwaysOnTop: true,
      webPreferences: { contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
    });
    const w = crackWin;
    lockNavigation(w);
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true);                // nunca atrapa o mouse: dá pra clicar através do vidro
    w.webContents.once('did-finish-load', () => { if (!w.isDestroyed()) w.showInactive(); });
    w.on('closed', () => { if (crackWin === w) crackWin = null; });
    w.loadFile(path.join(__dirname, 'crack.html'), { query: { x: String(ix), y: String(iy), ms: String(CRACK_MS), sound: settings.smashSound !== false ? '1' : '0' } });
    setTimeout(() => { if (!w.isDestroyed()) w.close(); }, CRACK_MS + 600);
  }
  function smashScreen() {
    const win = getWin();
    if (!win || win.isDestroyed() || !getSettings().visible) return false;
    win.webContents.send('play-emote', 'punch');
    setTimeout(openCrack, 640);                  // o punho encosta no "vidro" um pouquinho depois da deixa do gesto
    return true;
  }

  // ---------- primeiro lançamento (tela de boas-vindas) ----------
  function createWelcome() {
    if (welcomeWin && !welcomeWin.isDestroyed()) { welcomeWin.focus(); return; }
    welcomeWin = new BrowserWindow({
      width: 900, height: 520, resizable: false, maximizable: false, minimizable: false, show: false,
      title: 'Yoru', backgroundColor: '#0b0907', autoHideMenuBar: true,
      icon: path.join(__dirname, '..', 'assets', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'welcome-preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    welcomeWin.setMenu(null);
    lockNavigation(welcomeWin);
    welcomeWin.once('ready-to-show', () => { if (welcomeWin && !welcomeWin.isDestroyed()) welcomeWin.show(); });
    welcomeWin.on('closed', () => { welcomeWin = null; });
    welcomeWin.loadFile(path.join(__dirname, 'welcome.html'));
  }
  function closeWelcome() { if (welcomeWin && !welcomeWin.isDestroyed()) welcomeWin.close(); }

  // ---------- painel ----------
  function sendPanelBounds() {
    const panel = getPanel();
    if (!panel || panel.isDestroyed() || !panel.webContents) return;
    const b = panel.getBounds();
    panel.webContents.send('panel-bounds', { w: b.width, h: b.height, max: panel.isMaximized() });
  }

  // ---------- Float Dock exclusivo ----------
  // A janela do dock é transparente e justa ao conteúdo: o painel (panel-dock.js) mede a barra e pede o tamanho
  // com a ação `dock-fit`; aqui ela é encaixada na borda escolhida. A área transparente deixa os cliques passarem
  // (só no Windows/macOS, onde `forward` existe) e, durante o arraste do símbolo Y, a janela cobre a área útil
  // inteira para as zonas de encaixe poderem ser desenhadas.
  const canPassThrough = process.platform === 'win32' || process.platform === 'darwin';
  let dockSize = { w: 520, h: 130 };
  let dockDragging = false;
  const dockWin = () => { const p = getPanel(); return p && !p.isDestroyed() && p.isDockOnly ? p : null; };
  function placeDock() {
    const panel = dockWin();
    if (!panel) return;
    const wa = screen.getPrimaryDisplay().workArea;
    if (dockDragging) { panel.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height }); return; }
    const z = zoomFor(panel);
    const w = clamp(Math.ceil(dockSize.w * z), 60, wa.width, 520);
    const h = clamp(Math.ceil(dockSize.h * z), 60, wa.height, 130);
    const pos = getSettings().panelDockPosition || 'bottom';
    const x = pos === 'left' ? wa.x : pos === 'right' ? wa.x + wa.width - w : wa.x + Math.round((wa.width - w) / 2);
    const y = pos === 'top' ? wa.y : pos === 'bottom' ? wa.y + wa.height - h : wa.y + Math.round((wa.height - h) / 2);
    const b = panel.getBounds();
    if (b.x !== x || b.y !== y || b.width !== w || b.height !== h) panel.setBounds({ x, y, width: w, height: h });
  }
  function dockFit(size) {
    if (!dockWin() || !size) return;
    const w = Number(size.w), h = Number(size.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    dockSize = { w: clamp(Math.round(w), 60, 4000, 520), h: clamp(Math.round(h), 60, 4000, 130) };
    placeDock();
  }
  function setDockDrag(on) {
    const panel = dockWin();
    if (!panel) return;
    dockDragging = !!on;
    if (dockDragging && canPassThrough) panel.setIgnoreMouseEvents(false);
    placeDock();
  }
  function setDockHit(inside) {
    const panel = dockWin();
    if (!panel || !canPassThrough || dockDragging) return;
    panel.setIgnoreMouseEvents(!inside, { forward: true });
  }
  // trocar entre Float Dock e os outros layouts recria o painel principal (um é janela sem moldura, o outro é normal)
  function syncPanelMode() {
    const old = getPanel();
    if (!old || old.isDestroyed()) return;
    const wantDock = getSettings().panelLayout === 'floatdock';
    if (!!old.isDockOnly === wantDock) return;
    old.removeAllListeners('close');
    old.destroy();
    dockDragging = false;
    const v = soloWins.get('conversa');
    if (v && !v.isDestroyed() && !wantDock) { v.removeAllListeners('close'); v.destroy(); soloWins.delete('conversa'); }
    createPanel({ show: true });
  }

  function createPanel(opts = {}) {
    const settings = getSettings();
    const dockOnly = settings.panelLayout === 'floatdock';
    const display = screen.getPrimaryDisplay();
    const wa = display.workArea;
    const sb = settings.panelBounds || {};
    const az = autoZoom(screen.getPrimaryDisplay());
    const w = dockOnly ? dockSize.w : Math.min(sb.width || Math.round(1040 * az), Math.round(wa.width * 0.85));
    const h = dockOnly ? dockSize.h : Math.min(sb.height || Math.round(760 * az), Math.round(wa.height * 0.85));
    const onScreen = !dockOnly && sb.x != null && screen.getAllDisplays().some((d) => {
      const r = d.workArea;
      return sb.x < r.x + r.width - 80 && sb.x + w > r.x + 80 && sb.y >= r.y - 10 && sb.y < r.y + r.height - 60;
    });
    const panel = new BrowserWindow({
      width: w,
      height: h,
      ...(dockOnly ? { frame: false, transparent: true, hasShadow: false, thickFrame: false, focusable: true, skipTaskbar: true } : {}),
      show: dockOnly ? false : opts.show !== false, // o dock só aparece depois do primeiro ajuste de tamanho (sem "pulo")
      alwaysOnTop: dockOnly || !!settings.panelOnTop,
      ...(onScreen ? { x: sb.x, y: sb.y } : {}),
      ...(dockOnly ? {} : { minWidth: Math.round(780 * az), minHeight: Math.round(560 * az) }),
      title: 'Painel do Avatar',
      icon: path.join(assetsDir, 'icon.png'),
      resizable: !dockOnly,
      maximizable: !dockOnly,
      minimizable: !dockOnly,
      autoHideMenuBar: true,
      backgroundColor: dockOnly ? '#00000000' : panelBg(),
      ...(dockOnly ? {} : barOptions()),
      webPreferences: {
        preload: path.join(__dirname, 'panel-preload.js'),
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false, // a conversa por voz continua ouvindo com o painel fechado/escondido
      },
    });
    panel.isDockOnly = dockOnly;
    if (dockOnly) {
      placeDock();
      if (canPassThrough) panel.setIgnoreMouseEvents(true, { forward: true });
      // se o painel não responder, mostra mesmo assim (nunca deixa o dock invisível)
      const reveal = () => { if (!panel.isDestroyed() && opts.show !== false && !panel.isVisible()) panel.showInactive(); };
      panel.once('ready-to-show', () => setTimeout(reveal, 450));
    }
    setPanel(panel);
    // lembra tamanho e posição do painel
    let boundsTimer;
    const keepBounds = () => {
      clearTimeout(boundsTimer);
      boundsTimer = setTimeout(() => {
        if (dockOnly || panel.isDestroyed() || panel.isMaximized() || panel.isMinimized()) return;
        getSettings().panelBounds = panel.getBounds();
        saveSettings();
      }, 400);
    };
    panel.on('resize', keepBounds);
    panel.on('resize', sendPanelBounds);
    panel.on('move', keepBounds);
    panel.on('moved', () => { applyZoom(panel); applyBar(panel); if (dockOnly) placeDock(); }); // levada para outro monitor (outra escala): reajusta
    panel.webContents.on('did-finish-load', () => {
      applyZoom(panel);
      if (dockOnly) placeDock(); else applyBar(panel);
      sendPanelBounds();
      for (const e of chatBuf) panel.webContents.send('chat-log', e); // conversa restaurada ao abrir o app
    });
    panel.setMenu(null);
    lockNavigation(panel);
    panel.loadFile(path.join(__dirname, 'panel.html'), { query: panelQuery(dockOnly ? { dockOnly: '1', tb: '0' } : {}) });
    if (dockOnly && settings.convListening) setImmediate(() => openSolo('conversa', { show: false })); // continua ouvindo desde a abertura do app
    // fechar o painel só esconde (reabra pelo ícone da bandeja, Ctrl+Shift+P ou botão direito no avatar)
    panel.on('close', (e) => {
      if (!isQuitting()) { e.preventDefault(); panel.hide(); }
    });
  }

  // Janela que ouve o microfone e recebe os eventos de voz: a solo da Conversa no Float Dock; senão o painel principal.
  function voicePanel() {
    if (dockWin()) { const v = soloWins.get('conversa'); return v && !v.isDestroyed() ? v : null; }
    return getPanel();
  }

  // Float Dock: se alguém liga a escuta (atalho, bandeja, configuração) e a janela que ouve ainda não existe, cria escondida.
  function ensureVoiceWindow() {
    if (dockWin() && !voicePanel()) openSolo('conversa', { show: false });
  }

  function openSolo(tab, { show = true } = {}) {
    if (!Object.prototype.hasOwnProperty.call(SOLO_TABS, tab)) return;
    // Fora do Float Dock o painel principal já tem a Conversa (e o microfone): só leva até ela.
    if (tab === 'conversa' && !dockWin()) {
      showPanel();
      const p = getPanel();
      if (p && !p.isDestroyed()) p.webContents.send('go-tab', 'conversa');
      return;
    }
    const old = soloWins.get(tab);
    if (old && !old.isDestroyed()) { if (!show) return; if (old.isMinimized()) old.restore(); old.show(); old.focus(); return; }
    const settings = getSettings();
    const wa = screen.getPrimaryDisplay().workArea;
    const sb = (settings.soloBounds && settings.soloBounds[tab]) || {};
    const az = autoZoom(screen.getPrimaryDisplay());
    const w = Math.min(sb.width || Math.round(640 * az), Math.round(wa.width * 0.85));
    const h = Math.min(sb.height || Math.round(740 * az), Math.round(wa.height * 0.85));
    const n = soloWins.size; // cada janela nova abre um pouco deslocada para não cobrir a anterior
    const onScreen = sb.x != null && screen.getAllDisplays().some((d) => {
      const r = d.workArea;
      return sb.x < r.x + r.width - 80 && sb.x + w > r.x + 80 && sb.y >= r.y - 10 && sb.y < r.y + r.height - 60;
    });
    const win2 = new BrowserWindow({
      width: w,
      height: h,
      ...(onScreen ? { x: sb.x, y: sb.y } : { x: wa.x + 80 + n * 32, y: wa.y + 60 + n * 32 }),
      minWidth: Math.round(400 * az),
      minHeight: Math.round(360 * az),
      title: `Avatar — ${SOLO_TABS[tab]}`,
      show,
      icon: path.join(assetsDir, 'icon.png'),
      alwaysOnTop: !!settings.panelOnTop,
      autoHideMenuBar: true,
      backgroundColor: panelBg(),
      ...barOptions(),
      webPreferences: {
        preload: path.join(__dirname, 'panel-preload.js'),
        contextIsolation: true,
        sandbox: true,
        ...(tab === 'conversa' ? { backgroundThrottling: false } : {}), // a escuta continua com a janela escondida
      },
    });
    soloWins.set(tab, win2);
    // Conversa: fechar só esconde, para ela continuar ouvindo (reabre pelo ícone do dock)
    if (tab === 'conversa') win2.on('close', (e) => { if (!isQuitting()) { e.preventDefault(); win2.hide(); } });
    win2.webContents.on('did-finish-load', () => applyBar(win2));
    win2.setMenu(null);
    lockNavigation(win2);
    let t;
    const keep = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        if (win2.isDestroyed() || win2.isMaximized() || win2.isMinimized()) return;
        const s = getSettings();
        s.soloBounds = { ...(s.soloBounds || {}), [tab]: win2.getBounds() };
        saveSettings();
      }, 400);
    };
    win2.on('resize', keep);
    win2.on('move', keep);
    win2.on('moved', () => applyZoom(win2));
    win2.webContents.on('did-finish-load', () => {
      applyZoom(win2);
      if (tab === 'chat') for (const e of chatBuf) win2.webContents.send('chat-log', e); // histórico até agora
    });
    win2.on('closed', () => { clearTimeout(t); if (soloWins.get(tab) === win2) soloWins.delete(tab); });
    win2.loadFile(path.join(__dirname, 'panel.html'), { query: panelQuery({ solo: tab }) });
  }

  // tamanho do painel: mantém dentro da área útil da tela
  function setPanelSize(w, h, preset) {
    const panel = getPanel();
    if (!panel || panel.isDestroyed()) return;
    if (panel.isMaximized()) panel.unmaximize();
    if (panel.isMinimized()) panel.restore();
    const b = panel.getBounds();
    const disp = screen.getDisplayMatching(b);
    const wa = disp.workArea;
    const az = autoZoom(disp);
    if (preset) { w = Number(w) * az; h = Number(h) * az; } // os tamanhos prontos acompanham a escala do Windows; os números digitados valem como estão
    const minW = Math.round(780 * az), minH = Math.round(560 * az);
    w = Math.round(clamp(w, minW, Math.max(minW, wa.width), Math.round(1040 * az)));
    h = Math.round(clamp(h, minH, Math.max(minH, wa.height), Math.round(760 * az)));
    const x = Math.min(Math.max(b.x, wa.x), wa.x + wa.width - w);
    const y = Math.min(Math.max(b.y, wa.y), wa.y + wa.height - h);
    panel.setBounds({ x, y, width: w, height: h });
  }

  function centerPanel() {
    const panel = getPanel();
    if (!panel || panel.isDestroyed()) return;
    if (panel.isMaximized()) panel.unmaximize();
    panel.center();
  }

  function showPanel() {
    const panel = getPanel();
    if (!panel || panel.isDestroyed()) return createPanel();
    if (panel.isMinimized()) panel.restore();
    panel.show();
    panel.focus();
  }

  return {
    createWindow, createPanel, createWelcome, closeWelcome, openSolo, voicePanel, ensureVoiceWindow, showPanel, dockFit, setDockDrag, setDockHit, syncPanelMode, placeDock, smashScreen, setPanelSize, centerPanel,
    sendPanelBounds, zoomFor, applyBar, allPanels, broadcastPanels, isPanelSender, panelBg, lockNavigation, SOLO_TABS, PANEL_PRESETS,
  };
}

module.exports = { createWindows, SOLO_TABS, PANEL_PRESETS };
