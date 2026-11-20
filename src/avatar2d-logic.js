// Avatar 2D: a lógica pura (sem DOM), para poder ser testada. Quem desenha é o src/avatar2d.js.
// Cada gesto/emoção do app vira uma das 50 reações do pack Yoru Chibi (src/avatar2d-data.js + assets/reactions/*.webp).

// emoção de fundo (a que a IA escolhe e a que o painel define) -> reação
export const EMOTION_REACTION = {
  neutral: 'ola', happy: 'muito_bom', relaxed: 'beleza', sad: 'triste', angry: 'irritada', surprised: 'uau',
};

// gesto (os mesmos nomes do avatar 3D) -> { r: reação, fx: movimento, d: duração em s (Infinity = até "stand") }
export const EMOTE_REACTION = {
  wave: { r: 'ola', fx: 'wave', d: 2.6 },          nod: { r: 'perfeito', fx: 'nod', d: 2.2 },
  shake: { r: 'serio', fx: 'shake', d: 2.2 },      bow: { r: 'obrigada', fx: 'bow', d: 2.6 },
  dance: { r: 'ouvindo', fx: 'dance', d: 5 },      spin: { r: 'uau', fx: 'spin', d: 1.8 },
  stretch: { r: 'cansada', fx: 'stretch', d: 3 },  shy: { r: 'fofo', fx: 'sway', d: 3 },
  happy: { r: 'muito_bom', fx: 'bounce', d: 2.6 }, surprised: { r: 'uau', fx: 'pop', d: 2.2 },
  cheer: { r: 'incrivel', fx: 'jump', d: 2.6 },    laugh: { r: 'haha', fx: 'laugh', d: 3 },
  sad: { r: 'triste', fx: 'droop', d: 3.5 },       angry: { r: 'irritada', fx: 'shake', d: 3 },
  sleepy: { r: 'cansada', fx: 'droop', d: 4 },     think: { r: 'hmm', fx: 'sway', d: 3.5 },
  jump: { r: 'uau', fx: 'jump', d: 1.6 },          disco: { r: 'ouvindo', fx: 'dance', d: 5 },
  robot: { r: 'processando', fx: 'shake', d: 4 },  samba: { r: 'ouvindo', fx: 'dance', d: 5 },
  ballet: { r: 'ouvindo', fx: 'spin', d: 4 },      hiphop: { r: 'bora', fx: 'dance', d: 5 },
  clap: { r: 'beleza', fx: 'bounce', d: 3 },       pose: { r: 'to_pronta', fx: 'pop', d: 3.5 },
  salute: { r: 'foco', fx: 'nod', d: 2.6 },        sit: { r: 'pausa', fx: 'sway', d: 6 },
  chair: { r: 'trabalhando', fx: 'sway', d: 8 },   bed: { r: 'dormindo', fx: 'sleep', d: Infinity },
  tent: { r: 'dormindo', fx: 'sleep', d: Infinity }, duck: { r: 'pausa', fx: 'crouch', d: 3.2 },
  thumbs_up: { r: 'perfeito', fx: 'thumbs', d: 2.8 },
  heart: { r: 'amei', fx: 'heart', d: 3.4 },
  blow_kiss: { r: 'gratidao', fx: 'kiss', d: 3.1 },
  point: { r: 'atencao', fx: 'point', d: 2.7 },
  shrug: { r: 'como', fx: 'shrug', d: 3.0 },
  facepalm: { r: 'ops', fx: 'facepalm', d: 3.0 },
  land: { r: 'ops', fx: 'pop', d: 0.7 },
};

// o que mostrar agora (prioridade: nos braços > caindo > gesto > emoção de fundo)
export function pickReaction({ emotion, emote, grabbed, falling }) {
  if (grabbed) return 'ops';
  if (falling) return 'uau';
  if (emote && EMOTE_REACTION[emote]) return EMOTE_REACTION[emote].r;
  return EMOTION_REACTION[emotion] || EMOTION_REACTION.neutral;
}

// movimento do desenho: devolve { x, y (px), rot (graus), sx, sy } no instante t (s) do gesto; k = 0..1 é o peso (entra/sai suave)
export function motionFor(fx, t, k = 1) {
  const s = Math.sin, c = Math.cos, PI = Math.PI;
  let x = 0, y = 0, rot = 0, sx = 1, sy = 1;
  switch (fx) {
    case 'crouch': y = Math.max(0, s(Math.min(1, t / 0.38) * PI / 2)) * 15; sy = 0.92 + Math.max(0, s(Math.min(1, t / 0.38) * PI / 2)) * 0.08; rot = 4; break;
    case 'thumbs': y = -Math.max(0, s(t * 5)) * 3.5; rot = s(t * 2.2) * 1.2; break;
    case 'heart': y = -Math.abs(s(t * 4.5)) * 4; sy = 1 + Math.max(0, s(t * 5)) * 0.012; break;
    case 'kiss': x = s(t * 3.4) * 3; y = -Math.max(0, s(t * 4)) * 4; rot = -1.5 + s(t * 2) * 1.2; break;
    case 'point': x = s(t * 2.3) * 2.5; rot = s(t * 2.3) * 1.2; break;
    case 'shrug': x = s(t * 2.2) * 4; rot = s(t * 2.2) * 2.8; y = -Math.max(0, s(t * 2.2)) * 2; break;
    case 'facepalm': y = 3 + s(t * 2) * 1.5; rot = -3.5 + s(t * 1.5) * 0.8; sy = 0.985; break;
    case 'wave': rot = s(t * 7) * 3.5; y = -Math.abs(s(t * 3.5)) * 4; break;
    case 'nod': y = Math.max(0, s(t * 6)) * 12; sy = 1 - Math.max(0, s(t * 6)) * 0.03; break;
    case 'shake': rot = s(t * 16) * 4.5; x = s(t * 16) * 4; break;
    case 'bow': y = s(Math.min(t, 1.2) / 1.2 * PI) * 26; rot = s(Math.min(t, 1.2) / 1.2 * PI) * 5; break;
    case 'dance': x = s(t * 4.2) * 12; y = -Math.abs(c(t * 4.2)) * 12; rot = s(t * 4.2) * 6; break;
    case 'spin': sx = Math.max(0.09, Math.abs(c(t / 1.4 * 2 * PI))); break; // nunca deixa a escala negativa: preserva hit-test e evita espelhamento acidental
    case 'stretch': sy = 1 + s(Math.min(t / 1.5, 1) * PI) * 0.07; y = -s(Math.min(t / 1.5, 1) * PI) * 8; break;
    case 'sway': rot = s(t * 1.6) * 3; x = s(t * 1.6) * 5; break;
    case 'bounce': y = -Math.abs(s(t * 6)) * 10; break;
    case 'pop': sx = sy = 1 + Math.max(0, s(t * 9)) * Math.exp(-t * 2) * 0.12; break;
    case 'jump': y = -Math.abs(s(t * 5.2)) * 46 * Math.exp(-t * 0.35); break;
    case 'laugh': y = -Math.abs(s(t * 14)) * 5; rot = s(t * 9) * 2; break;
    case 'droop': y = 8 + s(t * 1.2) * 2; rot = -2; sy = 0.985; break;
    case 'sleep': y = 12 + s(t * 1.1) * 3; rot = s(t * 0.7) * 1.5; sy = 1 + s(t * 1.1) * 0.01; break;
    default: break;
  }
  return { x: x * k + 0, y: y * k + 0, rot: rot * k + 0, sx: 1 + (sx - 1) * k, sy: 1 + (sy - 1) * k }; // "+ 0" troca -0 por 0
}

// a máscara 32×32 (base64, 1 = desenho) diz se o ponto (u, v), de 0 a 1 dentro do desenho, cai em cima dele
export function decodeMask(b64) {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) out[i] = (bin.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
  return out;
}
export function maskHit(mask, u, v) {
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
  return mask[Math.floor(v * 32) * 32 + Math.floor(u * 32)] === 1;
}

// tamanho de tela de um desenho: todos usam a mesma escala (a cabeça não muda de tamanho ao trocar de reação)
export const REF_SIZE = 330; // lado, em px do arquivo, do maior desenho (com adereços): cabe inteiro na janela
export function layout(W, H, [w, h, ax], userScale = 1.12) {
  // O pack é composto por stickers de busto. Reserva espaço para o balão,
  // mas usa melhor a altura da janela e mantém a mesma escala entre reações.
  const scale = Math.min(1.5, Math.max(0.65, Number(userScale) || 1.12));
  const fit = Math.min((W * 0.94) / REF_SIZE, (H * 0.66) / REF_SIZE);
  // A escala é calculada pelo quadro de referência comum, não pela reação atual:
  // assim a cabeça não muda de tamanho quando a expressão troca.
  const k = Math.min(fit * scale, (W * 0.98) / REF_SIZE, (H * 0.88) / REF_SIZE);
  const left = Math.min(Math.max(W / 2 - ax * k, 0), Math.max(0, W - w * k));
  return { k, w: w * k, h: h * k, left, top: H - h * k };
}
