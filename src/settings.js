'use strict';
// Configurações do app: valores padrão, validação do que vem do painel e migração de arquivos antigos.
// Sem Electron e sem disco: dá para testar com `npm test`.
const AS = require('./ai-stream');
const PERF = require('./perf');
const { LIB, LIB_NAME } = require('./library');
const GL = require('./gesture-logic');
const { EMOTE_IDS, EMOTIONS } = AS;

const DEFAULTS = {
  scale: 1,
  rotation: 0,
  opacity: 1,
  alwaysOnTop: true,
  visible: true,
  lookAtCamera: true,
  followCursor: true,     // olhos e cabeça acompanham o cursor do mouse
  followCursorHead: 0.6,  // quanto a cabeça acompanha (os olhos sempre seguem)
  breathing: true,
  blinking: true,
  lipSync: true,
  clickReact: true,
  baseEmotion: 'neutral',
  emotesEnabled: true,
  emoteMin: 8,
  emoteMax: 25,
  emoteSpeed: 1,
  chibi: 0,               // proporção chibi do avatar (0 = normal, 1 = cabeça grande e corpo curto)
  chibi2dScale: 1.12,      // tamanho do sprite Yoru Chibi 2D
  idleAmount: 1,          // intensidade da vida parada (respiração, olhar em volta, braços soltos)
  blinkRate: 1,           // frequência do piscar (1 = normal)
  speakGestures: true,    // mexe a cabeça, o tronco e os braços enquanto fala
  speakGestureAmount: 1,  // intensidade desses gestos
  hairSwayAmount: 0.5,    // força do vento suave no cabelo
  emotionStrength: 1,     // intensidade das expressões do rosto
  emoteList: [...EMOTE_IDS],
  emoteVer: 5,            // versão da lista de gestos (migra novos emotes uma única vez)
  aiEmotes: true,
  aiAppControl: true,     // a IA pode mudar tema, avatar e item na mão quando o usuário pedir
  voiceEnabled: false,
  bubbleEnabled: false,   // balão de fala: desligado por padrão (a pessoa liga em Comportamento)
  typeAnimation: true,
  bubbleSeconds: 0, // 0 = automático
  historyLimit: 20,
  memoryEnabled: true,    // memória de longo prazo: a IA recebe e pode guardar fatos sobre o usuário
  keepChat: true,         // lembra a conversa ao reabrir o app
  maxTokens: 400,
  streamReplies: true,    // mostra e fala a resposta da IA enquanto ela chega (streaming)
  startWithOS: false,
  panelTheme: 'auto',
  panelLayout: 'floatdock',
  panelLayoutVer: 1,
  panelDockPosition: 'bottom', // posição do Float Dock: top | right | bottom | left
  panelDockCollapsed: false, // mantém visível apenas a aba para reabrir o dock
  panelZoom: 1,           // zoom da interface do painel
  panelOnTop: false,      // painel sempre por cima
  panelOnStart: true,     // abrir o painel ao iniciar o app
  firstRunDone: false,    // a tela de primeiro lançamento já foi vista
  startGreeting: true,    // cumprimentar (bom dia/boa tarde/boa noite) quando o app abre
  renderRes: 0,           // resolução do avatar: 0 = automática (pela Qualidade) ou multiplicador da tela (0.5 .. 2)
  antialias: 'auto',      // suavização das bordas: auto | on | off
  panelAccent: '#ff7a2e',
  bubbleStyle: 'light',   // balão de fala: light | dark | accent (usa a cor de destaque)
  avatarMode: '3d',       // '3d' = modelo VRM/GLB (padrão) · '2d' = pack Yoru Chibi (reações em imagem)
  avatarVer: 2,           // migração do estilo: arquivos antigos (padrão era 2D) passam para o 3D uma única vez
  avatarFile: 'default', // 'default' ou nome de um arquivo da biblioteca de avatares
  item: 'none', // none | phone | dice | mug | book | custom:<arquivo.glb>
  itemScale: 1,
  itemHand: 'right',
  voiceEngine: 'neural', // neural (Edge, online) | system (Windows, offline)
  neuralVoice: 'pt-BR-FranciscaNeural', // padrão e voz de abertura: Francisca (feminina, Brasil)
  voiceVer: 1,            // migração da voz: arquivos antigos voltam uma vez para a Francisca
  voiceName: '',
  neuralLang: 'pt',       // idioma mostrado na lista de vozes neurais (pt, en, es...)
  speakSkipCode: true,    // não ler blocos de código nem links em voz alta
  speakSkipActions: false, // não ler ações entre asteriscos (*sorri*)
  speakMaxChars: 0,       // fala só o começo de respostas longas (0 = sem limite)
  voiceGapMs: 0,          // pausa entre as frases faladas
  voicePronounce: '',     // dicionário de pronúncia: "palavra = como falar", uma por linha
  voiceSink: '',          // saída de áudio da voz neural ('' = padrão do sistema)
  voiceRate: 1,
  voicePitch: 1,
  voiceVolume: 1,
  dropPhysics: true,
  bounce: 0.35,
  walkEnabled: true,      // ela passeia sozinha pela tela de vez em quando
  walkSpeed: 110,         // velocidade do passeio (px/s)
  walkEvery: 15,          // intervalo médio entre passeios (s)
  fpsActive: 60,
  fpsIdle: 24,
  quality: 'medium',
  textureSize: 1024,
  springBones: true,
  hairSway: true,         // cabelo balança de leve sozinho (vento suave), além de reagir aos movimentos
  lowPowerGpu: true,
  batterySaver: true,     // na bateria, limita o FPS (fpsBattery)
  fpsBattery: 30,
  awayMin: 0,             // minutos parado até entrar no modo "longe do PC" (0 = desligado)
  fpsAway: 5,             // FPS enquanto você está longe do PC
  processPriority: 'normal', // normal | below | low: prioridade do app no sistema
  sttThreads: 0,          // núcleos usados pelo reconhecimento de voz (0 = automático)
  sttDevice: 'cpu',       // cpu | gpu: onde o Whisper roda (gpu = placa de vídeo via DirectML no Windows; se falhar, volta sozinho para a CPU)
  sttUnloadMin: 0,        // libera o Whisper da memória após X min sem uso (0 = nunca)
  // conversa por voz
  convListening: false,   // microfone ligado
  convWake: 'Yoru',       // nome para chamar
  convAliases: '',        // outras grafias que a transcrição costuma gerar (separadas por vírgula)
  convMode: 'wake',       // wake = só quando chamar | always = ouve tudo
  convFollow: 25,         // segundos de conversa contínua depois de uma resposta
  convMic: '',            // id do microfone ('' = padrão)
  convSens: 3,            // sensibilidade do microfone (1-5)
  convModel: 'base',      // tiny | base | small | medium | large-v3-turbo | large-v3 (modelo Whisper)
  convClap: true,         // duas palmas acordam ela (nos dois modos)
  convOrb: true,          // bolinha no avatar que mostra se ela está ouvindo
  convBargeIn: false,     // falar alto por cima dela a faz parar (use com fone ou alto-falante baixo)
  convSpeak: true,        // responde falando
  yoruPersonality: 'balanced', // balanced | friendly | playful | professional | concise
  convComments: true,     // comenta a hora de vez em quando
  convChatter: false,     // fala sozinha de vez em quando (aba Comportamento)
  chatterMin: 25,         // intervalo mínimo entre falas espontâneas (minutos)
  chatterMax: 60,         // intervalo máximo (minutos)
  chatterIdleMin: 0,      // só fala se o PC estiver parado há X minutos (0 = a qualquer momento)
  chatterCheckin: true,   // "Oi, você tá aí?"
  chatterTime: true,      // diz as horas e comenta o período do dia
  chatterSleep: true,     // "Já é tarde, vai dormir!" (só à noite)
  chatterTalk: true,      // "Fala comigo!"
  chatterCare: true,      // água, pausa, descanso
  chatterSulk: true,      // "Me chamou pra nada, né?"
  chatterSmash: true,     // perde a paciência, soca a tela e ela racha (some sozinha)
  smashSound: true,       // barulho de vidro quebrando
  chatterSmashChance: 50, // % de chance de o tipo sorteado "socar a tela" virar mesmo soco
  crackSeconds: 5,        // quanto tempo a tela fica rachada antes de voltar ao normal
  chatterHourly: false,   // diz a hora quando dá a hora cheia
  chatterQuiet: false,    // horário de silêncio: sem falas espontâneas
  chatterQuietFrom: 23,
  chatterQuietTo: 7,
  idleSleepMin: 0,        // fica sonolenta se o PC ficar parado por X minutos (0 = nunca)
  idleSleepStyle: 'sleepy', // sleepy (cabeceia de pé) | bed (dorme na cama) | tent (dorme na barraca)
  idleWelcome: true,      // dá oi quando você volta depois de um bom tempo parado
  chatterCustom: '',      // frases do próprio usuário (uma por linha)
  convPcActions: true,    // pode abrir navegador/sites/programas
  aiKnowsCommands: true,  // ensina à IA (qualquer provedor, inclusive OpenRouter) os comandos que a Yoru já tem
  convCity: '',           // cidade do clima ('' = detectar pela internet)
  convReminders: true,    // avisa falando os compromissos da agenda na hora
  // gestos de mão pela webcam (aba Gestos)
  gestureAuto: false,     // liga a câmera sozinha ao abrir o app (por padrão só liga quando você pede)
  gestureArm: true,       // "estilo Jarvis": a palma aberta parada acorda os gestos; sem ela, nada executa
  gestureHold: 600,       // ms com o gesto parado até executar
  gestureCooldown: 1500,  // ms de pausa entre dois gestos
  gestureSound: true,     // bipe ao armar e ao executar
  gesturePreview: true,   // mostra a imagem da câmera na aba
  gestureMouseSens: 3,    // mouse no ar: 1 (braço grande, preciso) a 5 (movimento pequeno chega longe)
  gestureReact: true,     // a Yoru acena com a cabeça quando os gestos são armados
  gestureCam: '',         // id da câmera ('' = padrão)
  gestureDetect: 'normal', // sensibilidade da detecção da mão: 'strict' (poucos falsos alarmes), 'normal' ou 'sensitive' (pouca luz)
  gestureIdleOff: 0,      // desliga a câmera sozinha após N min sem nenhuma mão (0 = nunca)
  gestureMap: { ...GL.DEFAULT_MAP }, // gesto -> ação
  // mão livre (aba Gestos): mão virtual flutuante no lugar do cursor
  handFree: false,        // liga a mão virtual (segue o mouse; com a câmera e o mouse no ar, clica, agarra e rola)
  handSize: 1,            // tamanho da mão (0,6 a 2)
  handWander: true,       // passeia sozinha quando o cursor fica parado
};

const PANEL_THEMES = ['auto', 'dark', 'light', 'midnight', 'ocean', 'forest', 'sakura', 'sepia', 'contrast'];
const THEME_BG = { dark: '#140f1c', light: '#f1f2f7', midnight: '#000000', ocean: '#0d1b2a', forest: '#111c17', sakura: '#fff3f7', sepia: '#f4ecd8', contrast: '#000000' };

function clamp(v, min, max, def) {
  v = Number(v);
  if (!isFinite(v)) v = def;
  return Math.min(max, Math.max(min, v));
}

function sanitize(p, cur) {
  const o = {};
  if ('scale' in p) o.scale = clamp(p.scale, 0.3, 1.6, 1);
  if ('rotation' in p) o.rotation = clamp(p.rotation, -180, 180, 0);
  if ('opacity' in p) o.opacity = clamp(p.opacity, 0.2, 1, 1);
  if ('emoteSpeed' in p) o.emoteSpeed = clamp(p.emoteSpeed, 0.5, 2, 1);
  if ('followCursorHead' in p) o.followCursorHead = clamp(p.followCursorHead, 0, 1, 0.6);
  if ('idleAmount' in p) o.idleAmount = clamp(p.idleAmount, 0, 1.5, 1);
  if ('chibi' in p) o.chibi = clamp(p.chibi, 0, 1, 0);
  if ('chibi2dScale' in p) o.chibi2dScale = clamp(p.chibi2dScale, 0.65, 1.5, 1.12);
  if ('blinkRate' in p) o.blinkRate = clamp(p.blinkRate, 0.5, 2, 1);
  if ('speakGestureAmount' in p) o.speakGestureAmount = clamp(p.speakGestureAmount, 0, 1.5, 1);
  if ('hairSwayAmount' in p) o.hairSwayAmount = clamp(p.hairSwayAmount, 0, 1, 0.5);
  if ('emotionStrength' in p) o.emotionStrength = clamp(p.emotionStrength, 0.2, 1, 1);
  if ('voiceRate' in p) o.voiceRate = clamp(p.voiceRate, 0.5, 2, 1);
  if ('voicePitch' in p) o.voicePitch = clamp(p.voicePitch, 0, 2, 1);
  if ('voiceVolume' in p) o.voiceVolume = clamp(p.voiceVolume, 0, 1, 1);
  if ('bounce' in p) o.bounce = clamp(p.bounce, 0, 0.8, 0.35);
  if ('walkSpeed' in p) o.walkSpeed = Math.round(clamp(p.walkSpeed, 40, 300, 110));
  if ('walkEvery' in p) o.walkEvery = Math.round(clamp(p.walkEvery, 3, 300, 15));
  if ('fpsActive' in p) o.fpsActive = Math.round(clamp(p.fpsActive, 15, 60, 60));
  if ('fpsIdle' in p) o.fpsIdle = Math.round(clamp(p.fpsIdle, 5, 30, 24));
  if ('fpsBattery' in p) o.fpsBattery = Math.round(clamp(p.fpsBattery, 10, 60, 30));
  if ('awayMin' in p) o.awayMin = Math.round(clamp(p.awayMin, 0, 60, 0));
  if ('fpsAway' in p) o.fpsAway = Math.round(clamp(p.fpsAway, 1, 15, 5));
  if ('sttUnloadMin' in p) o.sttUnloadMin = Math.round(clamp(p.sttUnloadMin, 0, 60, 0));
  if (PERF.PRIORITIES.includes(p.processPriority)) o.processPriority = p.processPriority;
  if (['cpu', 'gpu'].includes(p.sttDevice)) o.sttDevice = p.sttDevice;
  if ('sttThreads' in p && [0, 1, 2, 3, 4, 6, 8].includes(Number(p.sttThreads))) o.sttThreads = Number(p.sttThreads);
  if (['low', 'medium', 'high'].includes(p.quality)) o.quality = p.quality;
  if ('panelZoom' in p) o.panelZoom = Math.round(clamp(p.panelZoom, 0.7, 1.5, 1) * 20) / 20;
  if ('renderRes' in p && [0, 0.5, 0.75, 1, 1.5, 2].includes(Number(p.renderRes))) o.renderRes = Number(p.renderRes);
  if (['auto', 'on', 'off'].includes(p.antialias)) o.antialias = p.antialias;
  if ('textureSize' in p && [0, 512, 1024, 2048].includes(Number(p.textureSize))) o.textureSize = Number(p.textureSize);
  for (const k of ['dropPhysics', 'springBones', 'hairSway', 'speakGestures', 'followCursor', 'lowPowerGpu', 'alwaysOnTop', 'visible', 'lookAtCamera', 'breathing', 'blinking', 'lipSync',
    'clickReact', 'emotesEnabled', 'aiEmotes', 'voiceEnabled', 'bubbleEnabled', 'typeAnimation', 'startWithOS', 'panelOnTop', 'panelOnStart', 'panelDockCollapsed', 'startGreeting', 'firstRunDone', 'streamReplies', 'walkEnabled', 'memoryEnabled', 'keepChat', 'aiKnowsCommands', 'aiAppControl', 'batterySaver', 'speakSkipCode', 'speakSkipActions',
    'chatterCheckin', 'chatterTime', 'chatterSleep', 'chatterTalk', 'chatterCare', 'chatterSulk', 'chatterSmash', 'smashSound', 'chatterHourly', 'chatterQuiet', 'idleWelcome', 'handFree', 'handWander']) {
    if (k in p) o[k] = !!p[k];
  }
  if ('historyLimit' in p) o.historyLimit = 2 * Math.round(clamp(p.historyLimit, 2, 40, 20) / 2);
  if ('maxTokens' in p) o.maxTokens = Math.round(clamp(p.maxTokens, 100, 1500, 400) / 50) * 50;
  if ('bubbleSeconds' in p) o.bubbleSeconds = Math.round(clamp(p.bubbleSeconds, 0, 30, 0));
  if (PANEL_THEMES.includes(p.panelTheme)) o.panelTheme = p.panelTheme;
  if (['floatdock', 'iconsidebar', 'discord'].includes(p.panelLayout)) o.panelLayout = p.panelLayout;
  if (['top', 'right', 'bottom', 'left'].includes(p.panelDockPosition)) o.panelDockPosition = p.panelDockPosition;
  if (['light', 'dark', 'accent'].includes(p.bubbleStyle)) o.bubbleStyle = p.bubbleStyle;
  if (typeof p.panelAccent === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.panelAccent)) o.panelAccent = p.panelAccent;
  if (['2d', '3d'].includes(p.avatarMode)) o.avatarMode = p.avatarMode;
  if (typeof p.avatarFile === 'string' && (p.avatarFile === 'default' || (LIB_NAME.test(p.avatarFile) && LIB.avatars.ext.test(p.avatarFile)))) o.avatarFile = p.avatarFile;
  if (typeof p.item === 'string' && (['none', 'phone', 'dice', 'mug', 'book', 'flower', 'balloon', 'lollipop'].includes(p.item) ||
    (p.item.startsWith('custom:') && LIB_NAME.test(p.item.slice(7)) && LIB.items.ext.test(p.item)))) o.item = p.item;
  if ('itemScale' in p) o.itemScale = clamp(p.itemScale, 0.3, 3, 1);
  if (['left', 'right'].includes(p.itemHand)) o.itemHand = p.itemHand;
  if (['neural', 'system'].includes(p.voiceEngine)) o.voiceEngine = p.voiceEngine;
  if (typeof p.neuralVoice === 'string') o.neuralVoice = /^[a-z]{2,3}-[A-Za-z0-9-]{2,60}$/.test(p.neuralVoice) ? p.neuralVoice : DEFAULTS.neuralVoice;
  if (typeof p.voiceName === 'string') o.voiceName = p.voiceName.slice(0, 200);
  if (typeof p.neuralLang === 'string' && /^[a-z]{2,3}$/.test(p.neuralLang)) o.neuralLang = p.neuralLang;
  if (typeof p.voiceSink === 'string' && p.voiceSink.length <= 300 && !/[\u0000-\u001f]/.test(p.voiceSink)) o.voiceSink = p.voiceSink;
  if (typeof p.voicePronounce === 'string') o.voicePronounce = p.voicePronounce.slice(0, 4000);
  if ('speakMaxChars' in p) o.speakMaxChars = Math.round(clamp(p.speakMaxChars, 0, 1500, 0) / 50) * 50;
  if ('voiceGapMs' in p) o.voiceGapMs = Math.round(clamp(p.voiceGapMs, 0, 1000, 0) / 50) * 50;
  if (['balanced', 'friendly', 'playful', 'professional', 'concise'].includes(p.yoruPersonality)) o.yoruPersonality = p.yoruPersonality;
  for (const k of ['convListening', 'convClap', 'convOrb', 'convBargeIn', 'convSpeak', 'convComments', 'convChatter', 'convPcActions', 'convReminders']) {
    if (k in p) o[k] = !!p[k];
  }
  for (const k of ['gestureAuto', 'gestureArm', 'gestureSound', 'gesturePreview', 'gestureReact']) if (k in p) o[k] = !!p[k];
  if ('handSize' in p) o.handSize = Math.round(clamp(p.handSize, 0.6, 2, 1) * 10) / 10;
  if ('gestureMouseSens' in p) o.gestureMouseSens = Math.round(clamp(p.gestureMouseSens, 1, 5, 3));
  if ('gestureHold' in p) o.gestureHold = Math.round(clamp(p.gestureHold, 300, 2000, 600) / 50) * 50;
  if ('gestureCooldown' in p) o.gestureCooldown = Math.round(clamp(p.gestureCooldown, 500, 5000, 1500) / 100) * 100;
  if (GL.DETECT_IDS.includes(p.gestureDetect)) o.gestureDetect = p.gestureDetect;
  if ('gestureIdleOff' in p) o.gestureIdleOff = Math.round(clamp(p.gestureIdleOff, 0, 60, 0) / 5) * 5;
  if (typeof p.gestureCam === 'string' && p.gestureCam.length <= 300 && !/[\u0000-\u001f]/.test(p.gestureCam)) o.gestureCam = p.gestureCam;
  if (p.gestureMap && typeof p.gestureMap === 'object') o.gestureMap = { ...GL.DEFAULT_MAP, ...GL.sanitizeMap(p.gestureMap, EMOTE_IDS) };
  if (typeof p.convWake === 'string') {
    const w = p.convWake.replace(/[^\p{L}\p{N} '\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 24);
    o.convWake = w || DEFAULTS.convWake;
  }
  if (typeof p.convAliases === 'string') o.convAliases = p.convAliases.replace(/[^\p{L}\p{N} ,;'\-]/gu, '').slice(0, 160);
  if (typeof p.convCity === 'string') o.convCity = p.convCity.replace(/[^\p{L}\p{N} ,'.\-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (['wake', 'always'].includes(p.convMode)) o.convMode = p.convMode;
  if (['tiny', 'base', 'small', 'medium', 'large-v3-turbo', 'large-v3'].includes(p.convModel)) o.convModel = p.convModel;
  if (typeof p.convMic === 'string') o.convMic = p.convMic.slice(0, 300);
  if ('convFollow' in p) o.convFollow = Math.round(clamp(p.convFollow, 5, 60, 25));
  if ('convSens' in p) o.convSens = Math.round(clamp(p.convSens, 1, 5, 3));
  if (EMOTIONS.includes(p.baseEmotion)) o.baseEmotion = p.baseEmotion;
  if (Array.isArray(p.emoteList)) o.emoteList = p.emoteList.filter((id) => EMOTE_IDS.includes(id));
  if ('chatterMin' in p || 'chatterMax' in p) {
    let min = 'chatterMin' in p ? clamp(p.chatterMin, 1, 240, 25) : cur.chatterMin;
    let max = 'chatterMax' in p ? clamp(p.chatterMax, 1, 240, 60) : cur.chatterMax;
    if (max < min) { if ('chatterMin' in p) max = min; else min = max; }
    o.chatterMin = Math.round(min);
    o.chatterMax = Math.round(max);
  }
  if (typeof p.chatterCustom === 'string') o.chatterCustom = p.chatterCustom.replace(/[^\P{C}\n]/gu, '').replace(/\r/g, '').slice(0, 2400);
  if ('chatterSmashChance' in p) o.chatterSmashChance = Math.round(clamp(p.chatterSmashChance, 0, 100, 50));
  if ('crackSeconds' in p) o.crackSeconds = Math.round(clamp(p.crackSeconds, 2, 15, 5));
  if ('chatterQuietFrom' in p) o.chatterQuietFrom = Math.round(clamp(p.chatterQuietFrom, 0, 23, 23));
  if ('chatterQuietTo' in p) o.chatterQuietTo = Math.round(clamp(p.chatterQuietTo, 0, 23, 7));
  if (['sleepy', 'bed', 'tent'].includes(p.idleSleepStyle)) o.idleSleepStyle = p.idleSleepStyle;
  if ('idleSleepMin' in p) o.idleSleepMin = Math.round(clamp(p.idleSleepMin, 0, 120, 0));
  if ('chatterIdleMin' in p) o.chatterIdleMin = Math.round(clamp(p.chatterIdleMin, 0, 30, 0));
  if ('emoteMin' in p || 'emoteMax' in p) {
    let min = 'emoteMin' in p ? clamp(p.emoteMin, 3, 300, 8) : cur.emoteMin;
    let max = 'emoteMax' in p ? clamp(p.emoteMax, 3, 300, 25) : cur.emoteMax;
    if (max < min) { if ('emoteMin' in p) max = min; else min = max; }
    o.emoteMin = min;
    o.emoteMax = max;
  }
  return o;
}

// junta o settings.json lido do disco com os padrões; gestos novos entram uma vez no sorteio de quem tinha a lista antiga.
// A versão que conta é a do arquivo salvo (não a mesclada com os padrões: o padrão já é a mais nova e pularia a migração).
function migrateSettings(saved) {
  const file = saved && typeof saved === 'object' ? saved : {};
  const s = { ...DEFAULTS, ...file };
  // Migra instalações existentes para Float Dock uma única vez; depois respeita a escolha manual.
  if ((Number(file.panelLayoutVer) || 0) < 1) s.panelLayout = 'floatdock';
  s.panelLayoutVer = 1;
  const ver = Number(file.emoteVer) || 1;
  if (ver < 2) s.emoteList = [...new Set([...(s.emoteList || []), ...AS.NEW_EMOTES_V2])];
  if (ver < 3) s.emoteList = [...new Set([...(s.emoteList || []), ...AS.NEW_EMOTES_V3])];
  if (ver < 4) s.emoteList = [...new Set([...(s.emoteList || []), ...AS.NEW_EMOTES_V4])];
  if (ver < 5) s.emoteList = [...new Set([...(s.emoteList || []), ...AS.NEW_EMOTES_V5])];
  if (ver < 5) s.emoteVer = 5;
  // voz: vazia/inválida ou salva antes da v0.10.24 volta para a Francisca (uma única vez; depois vale a escolha da pessoa)
  const validVoice = typeof s.neuralVoice === 'string' && /^[a-z]{2,3}-[A-Za-z0-9-]{2,60}$/.test(s.neuralVoice);
  if (!validVoice || (Number(file.voiceVer) || 0) < 1) s.neuralVoice = DEFAULTS.neuralVoice;
  if (!['neural', 'system'].includes(s.voiceEngine)) s.voiceEngine = DEFAULTS.voiceEngine;
  s.voiceVer = 1;
  // estilo do avatar: o padrão passou do 2D para o 3D (VRM). Quem tem arquivo antigo muda uma única vez; depois vale a escolha da pessoa.
  if ((Number(file.avatarVer) || 0) < 2) s.avatarMode = DEFAULTS.avatarMode;
  s.avatarVer = 2;
  return s;
}

// barra de título do painel (Windows): fundo = --side e símbolos = --text de cada tema em panel.html
const THEME_BAR = {
  dark: { color: '#0e0a15', symbol: '#f2eef6' }, light: { color: '#e6e8f0', symbol: '#1d1f27' },
  midnight: { color: '#000000', symbol: '#f2f3f7' }, ocean: { color: '#0a1522', symbol: '#e3eef8' },
  forest: { color: '#0d1612', symbol: '#e6f1ea' }, sakura: { color: '#ffe6ee', symbol: '#3a2230' },
  sepia: { color: '#eadfc4', symbol: '#3b3126' }, contrast: { color: '#000000', symbol: '#ffffff' },
};

module.exports = { DEFAULTS, PANEL_THEMES, THEME_BG, THEME_BAR, clamp, sanitize, migrateSettings };
