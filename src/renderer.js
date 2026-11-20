// Janela do avatar: liga os módulos e roda o loop de quadros. Cada parte mora no seu arquivo:
//   stage.js (cena/câmera) · avatar.js (carregar modelo, proporção chibi e aplicar pose) · emote-player.js + emotes.js (gestos)
//   body-pose.js (carregada, vida parada, fala, item) · face.js (piscar, expressão, boca) · sleep-props.js (banquinho, cama, barraca)
//   voice.js · pointer.js · walk.js · held-item.js · cursor-follow.js · hair.js · orb.js · bubble.js · ai-reply.js · chat-box.js
import * as THREE from 'three';
import { DEFAULT_SETTINGS } from './settings-defaults.js';
import { createStage } from './stage.js';
import { createAvatar } from './avatar.js';
import { createBubble } from './bubble.js';
import { createBubbleStyle } from './bubble-style.js';
import { createChatBox } from './chat-box.js';
import { createSleepProps } from './sleep-props.js';
import { createIdleLife } from './idle-life.js';
import { createHitTest } from './hit-test.js';
import { createVoice } from './voice.js';
import { createHeldItem } from './held-item.js';
import { createOrb } from './orb.js';
import { createPointer } from './pointer.js';
import { createHair } from './hair.js';
import { createWalk } from './walk.js';
import { createCursorFollow } from './cursor-follow.js';
import { createAiReply } from './ai-reply.js';
import { createAvatar2d } from './avatar2d.js';
import { createEmotes, PUNCH } from './emotes.js';
import { createEmotePlayer } from './emote-player.js';
import { createBodyPose } from './body-pose.js';
import { createFace } from './face.js';
import { effectiveFps, createFpsReporter } from './frame-limit.js';
import { installDebugHooks } from './debug-hooks.js';
import './speech.js'; // publica globalThis.YoruSpeech (não depende do <script> do index.html)

const canvas = document.getElementById('c');
const bubble = document.getElementById('bubble');
const chat = document.getElementById('chat');
const input = document.getElementById('input');

// ---------- configurações (vindas do painel) ----------
const S = { ...DEFAULT_SETTINGS, emoteList: [...DEFAULT_SETTINGS.emoteList] };
try { Object.assign(S, await window.api.getSettings()); } catch (_) { /* usa os padrões */ }

// ---------- modo 2D (pack Yoru Chibi) ou 3D (VRM) ----------
const is2d = () => S.avatarMode === '2d';
const a2d = createAvatar2d({ S });
const playEmote = (id) => (is2d() ? a2d.react(id) : player.play(id));        // `player` nasce mais abaixo; só é lido quando alguém pede um gesto
const emoteActive = () => (is2d() ? a2d.active() : player.active());

// ---------- cena, balão e peças do avatar ----------
const { scene, camera, applyPixelRatio, resize, render } = createStage({ THREE, canvas, S, api: window.api });

const bub = createBubble({ el: bubble, settings: () => S });
const { say, typeSay } = bub;
const applyBubbleStyle = createBubbleStyle({ S, bubble, chat });

let emotion = 'neutral';
let hiddenAt = 0;
let power = { battery: false, away: false }; // bateria / "longe do PC": o processo principal avisa; o limite de FPS usa isso

// cabelo: balanço leve e física (src/hair.js)
const hair = createHair({ S, getVrm: () => av.vrm, getSpringMgr: () => av.springMgr });
const sleepProps = createSleepProps({ THREE, scene, getFitScale: () => av.fitScale });
// leitor de modelos .vrm/.glb: baixado só quando for preciso (no 2D, que é o padrão, nunca é)
let libs3d = null;
const loadLibs = () => (libs3d ||= Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('@pixiv/three-vrm')])
  .then(([g, v]) => ({ GLTFLoader: g.GLTFLoader, VRMLoaderPlugin: v.VRMLoaderPlugin, VRMUtils: v.VRMUtils })));
if (!is2d()) loadLibs().catch(() => {}); // no 3D começa a baixar já, junto com o resto da abertura
const av = createAvatar({
  THREE, loadLibs, scene, S, api: window.api, say, hair, sleepProps,
  onReset: () => player.reset(),
  onLoaded: () => applySettings({}),
});

// estado e funções da voz: src/voice.js (V.ttsSpeaking, V.ttsLevel, V.speakingUntil... são lidos no loop da boca)
const V = createVoice({ S, api: window.api });
const { stopSpeech, speak, applySink } = V;

// seguir o cursor, olhar e carinho na cabeça: src/cursor-follow.js (cur.k = quanto ela está seguindo o mouse)
const getHead = () => (av.vrm ? av.boneNodes.get('head') : null);
const cur = createCursorFollow({
  THREE, S, scene, camera, api: window.api,
  getVrm: () => av.vrm,
  getHeadNode: getHead,
  getHipsNode: () => av.hipsNode,
  playEmote,
  isBusy: () => ptr.mouseDown || emoteActive() || ptr.grabbed || ptr.falling, // sem carinho enquanto pegam ou ela faz um gesto
});

// itens (celular, dados, caneca, livro ou .glb próprio): src/held-item.js
const held = createHeldItem({
  THREE, scene, loader: av.loader, S,
  say, typeSay, speak,
  getVrm: () => av.vrm,
  getGlb: () => av.glb,
  getFitScale: () => av.fitScale,
});
const { setItem, updateItem } = held;

// bolinha de escuta ao lado da cabeça: src/orb.js
const { paintOrb, placeOrb } = createOrb({ THREE, camera, S, getVrm: () => av.vrm, getGlb: () => av.glb, getHeadNode: getHead });

// ---------- gestos, corpo e rosto ----------
// gestos: src/emotes.js define cada um (P é a pose do quadro; resetPose() a esvazia no começo de cada quadro); src/emote-player.js toca
const player = createEmotePlayer({
  S,
  getEmotes: () => EMOTES,
  canPlay: () => av.ready(),
  isCarried: () => ptr.grabbed || ptr.falling, // nos braços ou caindo: sem gestos
});
const { EMOTES, P, add, resetPose } = createEmotes({
  getItemObj: () => held.obj,
  getLandK: () => player.landK,
  getSitDrop: () => av.sitDrop,
  getChairDrop: () => av.chairDrop,
  getFitScale: () => av.fitScale,
  getBaseHipsY: () => av.hipsBase(),
});
// mouse: pegar, arrastar, arremessar, clique e menu (src/pointer.js). ptr guarda o que o loop lê: mouseDown, grabbed, falling, dragVx, lastMoveT, lastHoverT
const ptr = createPointer({
  api: window.api, S, input, bubble, chat,
  overAvatar: (x, y) => overAvatar(x, y),   // o hit-test é criado mais abaixo
  toggleChat: () => chatBox.toggle(),       // a caixa de chat é criada mais abaixo
  playEmote,
  hasEmote: emoteActive,
});
// caminhada (a janela é movida pelo processo principal; aqui só a animação): src/walk.js
const walk = createWalk({
  THREE, S, P, add,
  armHold: (hand) => (held.obj && S.itemHand === hand ? 1 - body.itemW * 0.8 : 1), // o braço que segura o item balança menos
});
const idle = createIdleLife(); // respiração, braços soltos e balanço (src/idle-life.js)
const body = createBodyPose({ S, P, add, idle, held, walk, cur, V, ptr, getVrm: () => av.vrm });
const face = createFace({ S, V });

window.api.onPlayEmote((id) => playEmote(id));
window.api.onPhys((state, impact) => {
  if (state === 'fall') ptr.falling = true;
  if (state === 'rest') ptr.falling = false;
  if (state === 'land') (is2d() ? a2d.land() : player.land(impact));
});

// ---------- configurações vindas do painel ----------
function applySettings(s) {
  const prev = { ...S };
  Object.assign(S, s);
  canvas.style.opacity = S.visible && !is2d() ? S.opacity : 0;
  a2d.setVisible(S.visible && is2d(), S.opacity);
  if (!S.visible && prev.visible) hiddenAt = performance.now();
  if (!S.visible) {
    bubble.style.display = 'none';
    chat.style.display = 'none';
    stopSpeech();
  }
  if (av.vrm) {
    av.vrm.lookAt.target = S.lookAtCamera ? camera : null;
    av.vrm.springBoneManager = S.springBones ? av.springMgr : null; // física do cabelo/roupa (custa CPU)
  }
  if (S.renderRes !== prev.renderRes || S.quality !== prev.quality) {
    applyPixelRatio();
    window.dispatchEvent(new Event('resize')); // refaz o tamanho do canvas na próxima imagem
  }
  if (S.bubbleStyle !== prev.bubbleStyle || S.panelAccent !== prev.panelAccent) applyBubbleStyle();
  if (S.baseEmotion !== prev.baseEmotion) emotion = S.baseEmotion;
  if (S.avatarMode !== prev.avatarMode) { player.reset(); a2d.reset(); if (!is2d()) { av.load(); setItem(S.item); } }
  else if (S.avatarFile !== prev.avatarFile && !is2d()) av.load();
  if (S.chibi !== prev.chibi) av.applyChibi();
  if (S.item !== prev.item && !is2d()) setItem(S.item);
  if (S.voiceSink !== prev.voiceSink) applySink();
  if (S.emoteMin !== prev.emoteMin || S.emoteMax !== prev.emoteMax || S.emotesEnabled !== prev.emotesEnabled) player.reschedule();
}

applyBubbleStyle();
// só agora: applySettings pode chamar stopSpeech, que usa as variáveis de voz declaradas acima
applySettings(S);
window.api.onSettings((s) => { applySettings(s); paintOrb(); });
window.api.onPower((p) => { power = p || power; });

// ---------- loop ----------
let last = 0;
let time = 0;
let frameNo = 0;
let resizePending = false;
let walkBusyLast = null;
const fpsReporter = createFpsReporter(window.api);

function animate(now) {
  requestAnimationFrame(animate);

  // limitador de FPS: rápido quando algo acontece, econômico quando está parada
  const speakingNow = V.ttsSpeaking || performance.now() < V.speakingUntil;
  const active = emoteActive() || ptr.grabbed || ptr.falling || body.heldW > 0.01 || speakingNow || ptr.mouseDown || walk.on || walk.w > 0.01;
  const target = effectiveFps(S, power, active);
  if (now - last < 1000 / target - 3) return;
  if (!S.visible && performance.now() - hiddenAt > 700) { last = now; return; } // oculta: não desenha
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  time += dt;
  const t = time;

  // avisa o processo principal quando ela não deve passear (falando, balão, chat, gesto, sendo pega, mouse em cima...)
  const busyNow = !(av.ready() || is2d()) || !S.visible || speakingNow || emoteActive() || ptr.grabbed || ptr.falling || ptr.mouseDown || body.heldW > 0.01
    || bubble.style.display === 'block' || chat.style.display === 'block' || performance.now() - ptr.lastHoverT < 1500;
  if (busyNow !== walkBusyLast) { walkBusyLast = busyNow; window.api.walkBusy(busyNow); }

  if (resizePending) { resizePending = false; resize(); }

  if (is2d()) { // avatar 2D: troca a reação e mexe o desenho (não há cena 3D para desenhar)
    a2d.update(dt, t, { emotion, speaking: speakingNow, level: V.ttsLevel, grabbed: ptr.grabbed, falling: ptr.falling, walking: walk.on, walkDir: walk.dir });
    a2d.placeOrb();
    walk.w += ((walk.on ? 1 : 0) - walk.w) * Math.min(dt * 7, 1); // walk.update() não roda no 2D: sem isto o peso ficava preso ao voltar do 3D e o limite de FPS ficava alto
    frameNo++;
    fpsReporter.tick();
    return;
  }

  if (av.ready()) {
    resetPose();
    body.trackCarry(dt);
    walk.update(dt); // andar: pernas e braços em oposição, quadril balançando, corpo girado para o lado do passeio

    // gesto atual (e o anterior saindo); banquinho, cama, barraca e Z z z
    const fx = player.step(dt, emotion);
    const sleepW = sleepProps.update(dt, t, { wantChair: player.wantsChair(), bedW: fx.bedW, tentW: fx.tentW });
    av.setSleepScale(sleepW);

    let expr = fx.expr;
    if (body.carriedPose(t)) expr = 'surprised';

    // gesto aleatório
    player.tickRandom(dt, !speakingNow && !ptr.mouseDown && !ptr.falling && body.heldW < 0.01 && !walk.on && walk.w < 0.05);

    // camadas do corpo: vida parada, fala (e olhar para o cursor) e item na mão
    const w = { ew: fx.ew, ewOut: fx.ewOut, sleepW };
    body.idleLayer(dt, t, w);
    body.speechGestures(dt, t, { ...w, speaking: speakingNow });
    body.itemPose(dt, player.active());

    if (av.vrm) {
      av.applyPose(P);
      face.update(dt, t, { em: av.vrm.expressionManager, expr, sleepW, speaking: speakingNow });
      hair.wind(t);
      // olhos: seguem o cursor enquanto ele se mexe; senão olham para a tela (se a opção estiver ligada)
      cur.aimEyes(sleepW);
      av.vrm.update(dt);
    } else {
      av.applyGlbPose(dt, t, P, { ew: fx.ew, swing: body.swing, heldW: body.heldW, walk });
    }
    updateItem(dt, t);
  }
  render();
  placeOrb();
  frameNo++;
  fpsReporter.tick();
}
requestAnimationFrame(animate);

window.addEventListener('resize', () => (resizePending = true));

window.api.onStopSpeak(stopSpeech);
window.api.onSpeakTest((txt) => {
  if (!S.visible) return;
  const t = txt || 'Oi! Essa é a minha voz.';
  typeSay(t);
  speak(t, true); // o teste fala mesmo com a voz desligada
});

// ---------- resposta da IA e resposta em tempo real (src/ai-reply.js) e chat ----------
const { showReply } = createAiReply({
  api: window.api, S, V, bubble, bub, say, typeSay,
  setEmotion: (e) => { emotion = e; },
  playEmote,
});
const chatBox = createChatBox({ api: window.api, chat, input, say, showReply });

// ---------- cliques que atravessam a janela (src/hit-test.js) ----------
const hit3d = createHitTest(THREE, {
  camera,
  getVrm: () => av.vrm,
  getGlb: () => av.glb,
  isVisible: () => S.visible,
  getFrame: () => frameNo,
});

const overAvatar = (x, y) => (is2d() ? a2d.over(x, y) : hit3d.overAvatar(x, y));

installDebugHooks({ THREE, camera, S, av, ptr, body, player, EMOTES, PUNCH, overAvatar, getFrame: () => frameNo });

if (!is2d()) { av.load(); setItem(S.item); }
