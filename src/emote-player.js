// Toca os gestos (emotes): qual está tocando, o peso suave (sobe no começo, desce no fim), o gesto anterior saindo aos poucos,
// o sorteio de gestos aleatórios e a queda ("land"). As definições dos gestos estão em src/emotes.js.
// O renderer.js chama step() a cada quadro e play() quando algo pede um gesto.

const rand = (a, b) => a + Math.random() * (b - a);

// getEmotes: tabela EMOTES (lida na hora, porque ela é criada depois do player)
// canPlay: há avatar na tela? · isCarried: está nos braços ou caindo?
export function createEmotePlayer({ S, getEmotes, canPlay, isCarried }) {
  let emote = null;     // { id, t }
  let emoteOut = null;  // gesto anterior saindo aos poucos: { id, t, k, w0 }
  let landK = 1;
  let lastEmote = null;
  let nextEmoteIn = 4;

  // peso suave (0→1→0) do gesto: sobe no começo e desce no fim
  function weight(e) {
    const def = getEmotes()[e.id];
    const k = e.id === 'land' ? 0.08 : (def.ramp || 0.45);
    const w = Math.max(0, Math.min(1, e.t / k, (def.dur - e.t) / k));
    return w * w * (3 - 2 * w);
  }
  // quando um gesto é trocado ou interrompido, o antigo some em 0,3 s em vez de "estalar" para a pose seguinte
  function fadeOut() {
    if (emote && emote.id !== 'land' && emote.id !== 'spin') emoteOut = { id: emote.id, t: emote.t, k: 0, w0: weight(emote) };
  }

  function play(id) {
    const EMOTES = getEmotes();
    if (!canPlay() || !S.visible) return;
    if (isCarried() && id !== 'land') return; // nos braços ou caindo: sem gestos
    if (id === 'random') {
      const pool = S.emoteList.filter((e) => EMOTES[e] && e !== 'land' && e !== 'bed' && e !== 'tent'); // dormir não entra no sorteio
      if (!pool.length) return;
      const options = pool.length > 1 ? pool.filter((e) => e !== lastEmote) : pool;
      id = options[Math.floor(Math.random() * options.length)];
    }
    if (id === 'stand') { if (emote && emote.id !== 'land') { fadeOut(); emote = null; } return; } // levanta / para a dança
    if (!EMOTES[id]) return;
    if (emote && emote.id === 'spin' && emote.t < 1.7) return; // termina a volta antes de trocar de gesto
    fadeOut();
    emote = { id, t: 0 };
    lastEmote = id;
  }

  // chão: o tamanho do impacto define a força do amortecimento (landK); o gesto só toca com avatar visível
  function land(impact) {
    landK = Math.max(0.35, Math.min(1, impact / 1800));
    if (canPlay() && S.visible) emote = { id: 'land', t: 0 };
  }

  // avança os gestos em dt segundos e soma a pose deles em P. baseExpr: expressão de quando não há gesto.
  // Devolve { expr, ew (peso do atual), ewOut (peso do que está saindo), bedW, tentW (quanto está deitada) }
  function step(dt, baseExpr) {
    const EMOTES = getEmotes();
    let expr = baseExpr;
    let bedW = 0, tentW = 0, ew = 0, ewOut = 0;
    if (emote && emote.id !== 'land' && isCarried()) { fadeOut(); emote = null; } // pegaram ela: o gesto sai suave
    if (emote) {
      const def = EMOTES[emote.id];
      emote.t += dt * (emote.id === 'land' ? 1 : S.emoteSpeed);
      if (emote.t >= def.dur) {
        emote = null;
      } else {
        const w = weight(emote);
        ew = w;
        def.fn(emote.t, w);
        expr = def.expr;
        if (emote.id === 'bed') bedW = w; else if (emote.id === 'tent') tentW = w;
      }
    }
    if (emoteOut) {
      const def = EMOTES[emoteOut.id];
      emoteOut.t += dt * S.emoteSpeed;
      emoteOut.k += dt / 0.3;
      if (emoteOut.k >= 1 || emoteOut.t >= def.dur) emoteOut = null;
      else {
        const f = 1 - emoteOut.k;
        const wo = emoteOut.w0 * f * f * (3 - 2 * f);
        def.fn(emoteOut.t, wo);
        ewOut = wo;
        if (emoteOut.id === 'bed') bedW = Math.max(bedW, wo); else if (emoteOut.id === 'tent') tentW = Math.max(tentW, wo);
      }
    }
    return { expr, ew, ewOut, bedW, tentW };
  }

  // gesto aleatório de tempos em tempos. allowed: nada mais está mandando no corpo (falando, arrastando, andando...)
  function tickRandom(dt, allowed) {
    if (!(S.emotesEnabled && S.visible && !emote && allowed)) return;
    nextEmoteIn -= dt;
    if (nextEmoteIn <= 0) {
      play('random');
      nextEmoteIn = rand(S.emoteMin, S.emoteMax);
    }
  }
  const reschedule = () => { nextEmoteIn = rand(S.emoteMin, S.emoteMax); };

  return {
    play, land, step, tickRandom, reschedule,
    reset() { emote = null; emoteOut = null; },                       // avatar trocado: sem gesto pendurado
    active: () => !!emote,
    id: () => (emote ? emote.id : null),
    wantsChair: () => !!((emote && emote.id === 'chair') || (emoteOut && emoteOut.id === 'chair')),
    get landK() { return landK; },
    playAt(id, t) { if (getEmotes()[id]) { fadeOut(); emote = { id, t }; } }, // só para testes (?debug=1)
  };
}
