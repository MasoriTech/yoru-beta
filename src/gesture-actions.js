'use strict';
// Executa a ação ligada a um gesto de mão. O painel só manda o NOME da ação; aqui ela é conferida contra uma lista fixa
// (nada de desligar, reiniciar, bloquear ou apagar por gesto: um movimento errado da mão não pode custar caro).
// Ações "talk" e "listen-toggle" são do próprio painel (clicam nos botões da aba Conversa) e não passam por aqui.
const GL = require('./gesture-logic');

const LABELS = Object.fromEntries(GL.ACTIONS);

// ctx: { pc, emoteIds, stopSpeak(), openChat(), rollDice(speak), playEmote(id) }
function createGestureActions(ctx) {
  const { pc } = ctx;
  const needsPc = new Set(['media-playpause', 'media-next', 'media-prev', 'volume-up', 'volume-down', 'volume-mute', 'slide-next', 'slide-prev', 'screenshot', 'desktop', 'switch-window', 'minimize-window']);

  async function run(action) {
    if (!GL.isValidAction(action, ctx.emoteIds)) return { ok: false, error: 'ação desconhecida' };
    if (action === 'none') return { ok: true, label: LABELS.none };
    if (needsPc.has(action) && !pc.supported) return { ok: false, error: 'esta ação só funciona no Windows' };
    let ok = true, extra = '';
    switch (action) {
      case 'media-playpause': ok = await pc.media('playpause'); break;
      case 'media-next': ok = await pc.media('next'); break;
      case 'media-prev': ok = await pc.media('prev'); break;
      case 'volume-up': ok = await pc.volume('up', 5); break;
      case 'volume-down': ok = await pc.volume('down', 5); break;
      case 'volume-mute': ok = await pc.volume('mute'); break;
      case 'slide-next': ok = await pc.arrow('right'); break;
      case 'slide-prev': ok = await pc.arrow('left'); break;
      case 'screenshot': { const r = await pc.screenshot(); ok = !!r.ok; if (ok && r.file) extra = r.file; break; }
      case 'desktop': ok = await pc.desktop(); break;
      case 'switch-window': ok = await pc.switchWindow(); break;
      case 'minimize-window': ok = !!(await pc.window('minimize', '')).ok; break;
      case 'air-mouse': break; // o painel cuida (precisa da câmera); aqui só é aceita
      case 'stop-speak': ctx.stopSpeak(); break;
      case 'toggle-chat': ctx.openChat(); break;
      case 'dice': ctx.rollDice(false); break;
      default:
        if (action.startsWith('emote:')) ctx.playEmote(action.slice(6));
        else return { ok: false, error: 'ação sem executor' };
    }
    const label = action.startsWith('emote:') ? '🙋 Gesto da Yoru: ' + action.slice(6) : LABELS[action];
    return ok ? { ok: true, label, extra } : { ok: false, label, error: 'o sistema não executou' };
  }
  return { run };
}

module.exports = { createGestureActions };
