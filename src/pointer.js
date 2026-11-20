// Mouse no avatar: pegar e arrastar a janela, arremessar ao soltar, clique (ela reage), duplo clique (abre o chat),
// botão direito (menu) e deixar o mouse atravessar a janela fora do avatar e da interface.
// O renderer.js lê o estado em `ptr` (mouseDown, grabbed, falling, dragVx, lastMoveT, lastHoverT); `falling` vem da física do processo principal.

const GRAB_PX = 5;

export function createPointer({ api, S, input, bubble, chat, overAvatar, toggleChat, playEmote, hasEmote }) {
  const ptr = {
    mouseDown: false,
    grabbed: false,       // está sendo carregada
    falling: false,       // está caindo (física no processo principal)
    dragVx: 0,            // velocidade horizontal do arraste (px/s)
    lastMoveT: 0,
    lastHoverT: -1e9,     // última vez que o mouse esteve em cima dela
  };
  let downOnAvatar = false;
  let posReady = false;
  let fallingAtDown = false;
  let dragMoved = 0;
  let dragStart = null;
  let samples = [];       // últimas posições do mouse (para calcular o arremesso)
  let ignoring = true;

  function overUI(x, y) {
    const el = document.elementFromPoint(x, y);
    return !!el && (el === input || el === bubble || chat.contains(el));
  }

  window.addEventListener('mousemove', (e) => {
    if (ptr.mouseDown && downOnAvatar) {
      if (!dragStart || !posReady) return;
      const dx = e.screenX - dragStart.sx, dy = e.screenY - dragStart.sy;
      dragMoved = Math.max(dragMoved, Math.hypot(dx, dy));
      if (!ptr.grabbed && dragMoved >= GRAB_PX) ptr.grabbed = true;   // passou do limite: agora é arraste
      if (ptr.grabbed) {
        api.setPos(dragStart.wx + dx, dragStart.wy + dy);
        const nowT = performance.now();
        samples.push({ t: nowT, x: e.screenX, y: e.screenY });
        samples = samples.filter((p) => nowT - p.t <= 120);
        if (samples.length > 1) {
          const f = samples[0], l = samples[samples.length - 1];
          ptr.dragVx = ((l.x - f.x) / Math.max(1, l.t - f.t)) * 1000;
        }
        ptr.lastMoveT = nowT;
      }
      return;
    }
    const over = overAvatar(e.clientX, e.clientY) || overUI(e.clientX, e.clientY);
    if (over) ptr.lastHoverT = performance.now();
    if (over === ignoring) {
      ignoring = !over;
      api.setIgnore(ignoring);
    }
  });

  window.addEventListener('mousedown', async (e) => {
    if (e.button !== 0 || !overAvatar(e.clientX, e.clientY)) return;
    ptr.mouseDown = true;
    downOnAvatar = true;
    posReady = false;
    ptr.grabbed = false;
    dragMoved = 0;
    samples = [];
    fallingAtDown = ptr.falling;
    dragStart = { sx: e.screenX, sy: e.screenY, wx: 0, wy: 0 };
    api.physGrab();                 // agarra (para a queda, se estiver caindo)
    api.grabState(true);            // a mão virtual fecha o punho
    const [wx, wy] = await api.getPos();
    if (!ptr.mouseDown) return;
    dragStart.wx = wx;
    dragStart.wy = wy;
    posReady = true;
  });

  window.addEventListener('mouseup', () => {
    if (!downOnAvatar) { ptr.mouseDown = false; return; }
    api.grabState(false);
    const wasGrabbed = ptr.grabbed;
    const resume = fallingAtDown;
    ptr.mouseDown = false;
    downOnAvatar = false;
    ptr.grabbed = false;
    if (wasGrabbed) {
      // velocidade do arremesso = movimento do mouse nos últimos ~100 ms
      let vx = 0, vy = 0;
      const nowT = performance.now();
      if (samples.length > 1 && nowT - samples[samples.length - 1].t < 90) {
        const f = samples[0], l = samples[samples.length - 1];
        const dtMs = Math.max(16, l.t - f.t);
        vx = ((l.x - f.x) / dtMs) * 1000;
        vy = ((l.y - f.y) / dtMs) * 1000;
      }
      api.drop(vx, vy);             // solta: a física assume (queda, quique, pouso)
    } else if (resume) {
      api.drop(0, 0);               // só clicou durante a queda: retoma
    } else if (S.clickReact && !hasEmote()) {
      // clique simples no avatar (sem arrastar): ela reage
      const reactions = ['happy', 'shy', 'surprised', 'nod'];
      playEmote(reactions[Math.floor(Math.random() * reactions.length)]);
    }
    samples = [];
  });

  window.addEventListener('dblclick', (e) => {
    if (overAvatar(e.clientX, e.clientY)) toggleChat();
  });
  window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (overAvatar(e.clientX, e.clientY)) api.contextMenu();
  });

  return ptr;
}
