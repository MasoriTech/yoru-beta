'use strict';
// Gestos de mão pela webcam: transforma os 21 pontos da mão (MediaPipe Hand Landmarker) num gesto
// (punho, polegar, "paz"...), exige que ele fique parado por um tempo e decide quando executar.
// Estilo "Jarvis": a mão aberta parada por ~1 s ARMA o sistema; só então os outros gestos valem (por 8 s),
// para um movimento qualquer da mão não mexer no computador.
// Função pura, sem Electron e sem navegador: roda no painel (script comum, window.GestureLogic) e nos testes (`npm test`).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GestureLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // id, ícone, nome, como fazer
  const GESTURES = [
    ['open_palm', '🖐️', 'Palma aberta', 'Todos os dedos esticados. Segura 1 s para ARMAR (acordar) os gestos.'],
    ['fist', '✊', 'Punho fechado', 'Mão fechada, polegar fora ou recolhido.'],
    ['point', '☝️', 'Indicador', 'Só o dedo indicador esticado.'],
    ['victory', '✌️', 'Paz e amor', 'Indicador e médio esticados.'],
    ['three', '🤟', 'Três dedos', 'Indicador, médio e anelar esticados.'],
    ['thumbs_up', '👍', 'Joinha', 'Punho com o polegar para cima.'],
    ['thumbs_down', '👎', 'Polegar para baixo', 'Punho com o polegar para baixo.'],
    ['ok', '👌', 'OK', 'Polegar encostado no indicador, outros três esticados.'],
    ['rock', '🤘', 'Rock', 'Indicador e mindinho esticados.'],
    ['shaka', '🤙', 'Hang loose', 'Polegar e mindinho esticados.'],
    ['swipe_left', '⬅️', 'Deslizar para a esquerda', 'Palma aberta passando rápido para a SUA esquerda.'],
    ['swipe_right', '➡️', 'Deslizar para a direita', 'Palma aberta passando rápido para a SUA direita.'],
  ];
  const GESTURE_IDS = GESTURES.map((g) => g[0]);

  // ações que o app sabe executar (as de gesto de emote são "emote:<id>")
  const ACTIONS = [
    ['none', '— nada —'],
    ['media-playpause', '⏯ Tocar / pausar a mídia'],
    ['media-next', '⏭ Próxima faixa'],
    ['media-prev', '⏮ Faixa anterior'],
    ['volume-up', '🔊 Aumentar o volume'],
    ['volume-down', '🔉 Diminuir o volume'],
    ['volume-mute', '🔇 Silenciar'],
    ['stop-speak', '🤐 Calar a Yoru'],
    ['air-mouse', '🖱️ Ligar/desligar o mouse no ar'],
    ['hand-free', '✋ Ligar/desligar a mão livre'],
    ['talk', '🎤 Falar com a Yoru agora'],
    ['listen-toggle', '🎙️ Ligar/desligar a escuta'],
    ['toggle-chat', '💬 Abrir o chat'],
    ['dice', '🎲 Rolar os dados'],
    ['slide-next', '▶️ Próximo slide (seta →)'],
    ['slide-prev', '◀️ Slide anterior (seta ←)'],
    ['screenshot', '📸 Print da tela'],
    ['desktop', '🖥️ Mostrar área de trabalho'],
    ['switch-window', '🪟 Trocar de janela (Alt+Tab)'],
    ['minimize-window', '➖ Minimizar a janela em foco'],
  ];
  const ACTION_IDS = ACTIONS.map((a) => a[0]);
  // ações resolvidas no próprio painel (clicam em botões da aba Conversa)
  const UI_ACTIONS = ['talk', 'listen-toggle', 'air-mouse', 'hand-free'];

  const DEFAULT_MAP = {
    open_palm: 'stop-speak',
    fist: 'media-playpause',
    point: 'toggle-chat',
    victory: 'screenshot',
    three: 'switch-window',
    thumbs_up: 'volume-up',
    thumbs_down: 'volume-down',
    ok: 'talk',
    rock: 'desktop',
    shaka: 'emote:wave',
    swipe_left: 'media-prev',
    swipe_right: 'media-next',
  };

  // predefinições da tabela (completam o que faltar com o padrão)
  const PRESETS = {
    padrao: { ...DEFAULT_MAP },
    midia: { ...DEFAULT_MAP, fist: 'media-playpause', thumbs_up: 'volume-up', thumbs_down: 'volume-down', ok: 'volume-mute', point: 'media-next', victory: 'media-prev', swipe_right: 'media-next', swipe_left: 'media-prev', open_palm: 'none', three: 'none', rock: 'none', shaka: 'none' },
    apresentacao: { ...DEFAULT_MAP, swipe_right: 'slide-next', swipe_left: 'slide-prev', point: 'slide-next', victory: 'slide-prev', thumbs_up: 'volume-up', thumbs_down: 'volume-down', ok: 'screenshot', fist: 'none', open_palm: 'none', rock: 'none', three: 'switch-window', shaka: 'emote:wave' },
  };

  const isValidAction = (v, emoteIds) => typeof v === 'string' &&
    (ACTION_IDS.includes(v) || (/^emote:[a-z0-9_]{1,24}$/.test(v) && (!emoteIds || emoteIds.includes(v.slice(6)))));

  // só gestos e ações conhecidos entram (vem do painel: não é de confiança)
  function sanitizeMap(m, emoteIds) {
    const out = {};
    if (!m || typeof m !== 'object') return out;
    for (const id of GESTURE_IDS) if (id in m && isValidAction(m[id], emoteIds)) out[id] = m[id];
    return out;
  }

  // ---------- pontos da mão -> gesto ----------
  // lm: 21 pontos { x, y } (0..1, y cresce para baixo); aspect = largura/altura do vídeo (x e y têm escalas diferentes).
  const T = { wrist: 0, thumbMcp: 2, thumbIp: 3, thumbTip: 4, indexMcp: 5, midMcp: 9, pinkyMcp: 17 };
  const FINGERS = { index: [5, 6, 8], middle: [9, 10, 12], ring: [13, 14, 16], pinky: [17, 18, 20] }; // mcp, pip, tip

  function classify(lm, aspect = 4 / 3) {
    if (!Array.isArray(lm) || lm.length < 21) return null;
    const P = (i) => ({ x: lm[i].x * aspect, y: lm[i].y });
    const d = (a, b) => { const p = P(a), q = P(b); return Math.hypot(p.x - q.x, p.y - q.y); };
    const palm = d(T.wrist, T.midMcp);
    if (!(palm > 0.02)) return null; // mão pequena demais / longe demais

    // dedo esticado: a ponta está bem mais longe do pulso do que a articulação do meio (vale com a mão girada)
    const ext = {};
    for (const [name, [, pip, tip]] of Object.entries(FINGERS)) ext[name] = d(tip, T.wrist) > d(pip, T.wrist) * 1.18;
    const thumbOut = d(T.thumbTip, T.pinkyMcp) > d(T.thumbIp, T.pinkyMcp) * 1.05 && d(T.thumbTip, T.indexMcp) > palm * 0.5;
    // direção do polegar (do 1º osso à ponta): vertical = joinha
    const tv = { x: (lm[4].x - lm[2].x) * aspect, y: lm[4].y - lm[2].y };
    const tl = Math.hypot(tv.x, tv.y) || 1;
    const up = tv.y / tl < -0.6, down = tv.y / tl > 0.6;

    const n = ['index', 'middle', 'ring', 'pinky'].filter((k) => ext[k]).length;
    const { index: i, middle: m, ring: r, pinky: p } = ext;

    if (d(T.thumbTip, 8) < palm * 0.3 && m && r && p) return 'ok';
    if (n === 0) {
      if (thumbOut && up) return 'thumbs_up';
      if (thumbOut && down) return 'thumbs_down';
      return 'fist';
    }
    if (n === 4) return 'open_palm';
    if (i && !m && !r && !p) return 'point';
    if (i && m && !r && !p) return 'victory';
    if (i && m && r && !p) return 'three';
    if (i && p && !m && !r) return 'rock';
    if (p && thumbOut && !i && !m && !r) return 'shaka';
    return null;
  }

  // ---------- estabilizar o gesto ----------
  // O reconhecimento quadro a quadro pisca entre gestos parecidos. Aqui vale o gesto que aparece em pelo menos `min` dos últimos `size` quadros.
  function createSmoother({ size = 5, min = 3 } = {}) {
    let w = [];
    return {
      push(g) {
        w.push(g || null);
        if (w.length > size) w.shift();
        const c = {};
        for (const x of w) if (x) c[x] = (c[x] || 0) + 1;
        const best = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
        return best && c[best] >= min ? best : null;
      },
      reset() { w = []; },
    };
  }

  // ---------- mouse no ar ----------
  // Ponta do indicador -> posição na tela (0..1, espelhada, só uma janela central da imagem para o braço não precisar esticar tudo).
  // Pinça polegar+indicador = botão esquerdo (segurar = arrastar); polegar+médio = clique direito.
  // Enquanto os dedos se aproximam para a pinça, o cursor fica parado (senão o clique cairia ao lado do alvo).
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  function createPointer({ now = Date.now, sens = 3 } = {}) {
    let cfg = { sens };
    let s = null;
    let pinchL = false, pinchR = false, since = 0;
    let grab = false, grabOff = null;   // punho fechado = agarrar (segura o botão esquerdo e arrasta pelo centro da palma)
    const margin = () => [0.07, 0.12, 0.18, 0.24, 0.3][Math.min(5, Math.max(1, Math.round(cfg.sens))) - 1];
    return {
      configure(o) { cfg = { ...cfg, ...o }; },
      // opts: { fist } punho agarra · { hold } congela o cursor (ex.: ✌️ rolando a página)
      update(lm, aspect = 4 / 3, opts = {}) {
        const d = (a, b) => Math.hypot((lm[a].x - lm[b].x) * aspect, lm[a].y - lm[b].y);
        const palm = d(0, 9) || 1e-6;
        const rI = d(4, 8) / palm, rM = d(4, 12) / palm;
        // pinça de verdade tem a ponta do dedo longe da palma; punho fechado ou polegar apoiado num dedo dobrado não contam
        const far = (i) => d(i, 0) > palm;
        const t = now(), events = [];
        if (!pinchL && rI < 0.3 && far(8)) { pinchL = true; since = t; events.push('down'); } else if (pinchL && rI > 0.45) { pinchL = false; events.push('up'); }
        if (!pinchR && rM < 0.3 && rI > 0.45 && far(12)) { pinchR = true; events.push('right'); } else if (pinchR && rM > 0.45) pinchR = false;
        const dragging = pinchL && t - since > 350;
        const m = margin(), k = 1 - 2 * m;
        const map = (p) => ({ x: clamp01((1 - p.x - m) / k), y: clamp01((p.y - m) / k) });
        const fist = !!opts.fist && !pinchL;
        if (fist && !grab) {            // começou a agarrar: o cursor fica onde estava (guarda a diferença entre a ponta do dedo e a palma)
          grab = true; events.push('down');
          const q = map(lm[9]);
          grabOff = s ? { x: s.x - q.x, y: s.y - q.y } : { x: 0, y: 0 };
        } else if (!fist && grab) { grab = false; grabOff = null; events.push('up'); }
        if (opts.hold && !grab) { /* ✌️ rolando: cursor parado */ }
        else if (grab) {
          const q = map(lm[9]);
          s = { x: clamp01(q.x + grabOff.x), y: clamp01(q.y + grabOff.y) };
        } else if (rI >= 0.55 || dragging) {
          const { x: tx, y: ty } = map(lm[8]);
          if (!s) s = { x: tx, y: ty };
          else {
            const dist = Math.hypot(tx - s.x, ty - s.y);
            if (dist > 0.002) { const a = Math.min(0.85, 0.12 + dist * 6); s = { x: s.x + (tx - s.x) * a, y: s.y + (ty - s.y) * a }; } // devagar = firme, rápido = acompanha
          }
        }
        if (!s) s = { x: 0.5, y: 0.5 };
        return { x: s.x, y: s.y, pinch: pinchL, grab, events, ratio: rI };
      },
      // ao sair do modo: se estava apertando, devolve o "soltar"
      release() { const ev = pinchL || grab ? ['up'] : []; pinchL = false; pinchR = false; grab = false; grabOff = null; return ev; },
      reset() { s = null; pinchL = false; pinchR = false; grab = false; grabOff = null; },
    };
  }

  // ---------- deslizar a mão ----------
  // Recebe a posição do pulso (x já espelhado: direita = direita de quem usa) e diz quando houve um "passar de mão".
  function createSwipe({ now = Date.now, windowMs = 550, minDx = 0.28, lockMs = 900 } = {}) {
    let s = [];
    let lockUntil = 0;
    return {
      feed(x, y) {
        const t = now();
        s.push({ x, y, t });
        s = s.filter((q) => t - q.t <= windowMs);
        if (t < lockUntil || s.length < 4) return null;
        const a = s[0], b = s[s.length - 1];
        const dx = b.x - a.x, dy = b.y - a.y;
        if (Math.abs(dx) >= minDx && Math.abs(dy) < Math.abs(dx) * 0.6) {
          s = [];
          lockUntil = t + lockMs;
          return dx > 0 ? 'swipe_right' : 'swipe_left';
        }
        return null;
      },
      reset() { s = []; },
    };
  }

  // ---------- quando executar ----------
  // update(hand) a cada quadro: hand = null (sem mão) ou { gesture, x, y }. Devolve eventos:
  //   { type: 'arm' } | { type: 'disarm' } | { type: 'gesture', id }
  function createEngine({ now = Date.now, holdMs = 600, cooldownMs = 1500, arm = true, armHoldMs = 1000, armWindowMs = 8000, repeatMs = 700, repeat = null } = {}) {
    const swipe = createSwipe({ now });
    let armedUntil = 0, armed = false;
    let cand = null; // { id, since, fired }
    let lastFire = 0;
    let cfg = { holdMs, cooldownMs, arm, armHoldMs, armWindowMs, repeatMs, repeat }; // repeat(id): o gesto segurado repete a ação (ex.: volume)

    const isArmed = (t) => !cfg.arm || t < armedUntil;

    return {
      configure(o) { cfg = { ...cfg, ...o }; },
      update(hand) {
        const t = now();
        const ev = [];
        if (cfg.arm && armed && t >= armedUntil) { armed = false; ev.push({ type: 'disarm' }); }

        if (!hand || !hand.gesture) {
          cand = null;
          if (!hand) swipe.reset();
          return ev;
        }
        // deslizar só vale com a palma aberta e o sistema armado
        if (hand.gesture === 'open_palm' && typeof hand.x === 'number') {
          const sw = swipe.feed(1 - hand.x, hand.y);
          if (sw && isArmed(t) && t - lastFire >= 300) {
            lastFire = t;
            if (cfg.arm) armedUntil = t + cfg.armWindowMs;
            if (cand) cand.fired = true; // a palma que passou não conta como "palma parada"
            ev.push({ type: 'gesture', id: sw });
            return ev;
          }
        } else swipe.reset();

        if (!cand || cand.id !== hand.gesture) cand = { id: hand.gesture, since: t, fired: false };
        if (cand.fired) {
          // segurar um gesto "repetível" (volume) repete a ação enquanto durar
          if (cand.acted && cfg.repeat && cfg.repeat(cand.id) && t - lastFire >= cfg.repeatMs) {
            lastFire = t;
            if (cfg.arm) armedUntil = t + cfg.armWindowMs;
            ev.push({ type: 'gesture', id: cand.id, repeat: true });
          }
          return ev;
        }
        const waiting = t - cand.since;

        if (cfg.arm && !isArmed(t)) {
          // desarmado: só a palma aberta parada acorda o sistema
          if (cand.id === 'open_palm' && waiting >= cfg.armHoldMs) {
            cand.fired = true; armed = true; armedUntil = t + cfg.armWindowMs;
            ev.push({ type: 'arm', until: armedUntil });
          }
          return ev;
        }
        if (waiting >= cfg.holdMs && t - lastFire >= cfg.cooldownMs) {
          cand.fired = true; cand.acted = true; lastFire = t;
          if (cfg.arm) { armed = true; armedUntil = t + cfg.armWindowMs; }
          ev.push({ type: 'gesture', id: cand.id });
        }
        return ev;
      },
      // para a interface: está armado? quanto falta do gesto atual?
      status() {
        const t = now();
        const on = isArmed(t);
        const need = cfg.arm && !on ? cfg.armHoldMs : cfg.holdMs;
        const wantId = cand && (!cfg.arm || on || cand.id === 'open_palm') ? cand.id : null;
        return {
          armed: on, armRequired: cfg.arm, leftMs: cfg.arm && on ? Math.max(0, armedUntil - t) : 0,
          candidate: cand ? cand.id : null,
          progress: wantId && !cand.fired ? Math.min(1, (t - cand.since) / need) : cand && cand.fired ? 1 : 0,
        };
      },
      disarm() { armed = false; armedUntil = 0; cand = null; },
    };
  }

  // sensibilidade da detecção da mão: confiança mínima para achar a mão, para ela "estar presente" e para seguir o rastreio
  const DETECT = { strict: [0.75, 0.75, 0.6], normal: [0.6, 0.6, 0.5], sensitive: [0.4, 0.4, 0.35] };
  const DETECT_IDS = Object.keys(DETECT);
  function detectConfig(level) {
    const [det, pres, track] = DETECT[level] || DETECT.normal;
    return { minHandDetectionConfidence: det, minHandPresenceConfidence: pres, minTrackingConfidence: track };
  }
  // desligar a câmera sozinha: passou `minutes` sem nenhuma mão? (0 = nunca)
  function idleExpired(sinceMs, minutes) { return Number(minutes) > 0 && sinceMs >= Number(minutes) * 60000; }

  // contornos para desenhar a mão na prévia
  const CONNECTIONS = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

  return { GESTURES, GESTURE_IDS, ACTIONS, ACTION_IDS, UI_ACTIONS, DEFAULT_MAP, PRESETS, CONNECTIONS, DETECT_IDS, detectConfig, idleExpired, isValidAction, sanitizeMap, classify, createSmoother, createPointer, createSwipe, createEngine };
});
