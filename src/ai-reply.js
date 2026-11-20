// Resposta da IA: mostrar no balão, trocar a emoção, tocar o gesto sugerido e falar.
// Vem inteira (showReply) ou em pedaços (streaming): o balão cresce na hora e cada frase completa entra na fila de voz.
// A voz em si (tocar, parar, fila) mora em src/voice.js (V); o renderer.js só diz como mudar a emoção e tocar gestos.

export function createAiReply({ api, S, V, bubble, bub, say, typeSay, setEmotion, playEmote }) {
  let emotionReset;
  // a emoção da resposta vale por 9 s e depois volta à emoção base
  function applyEmotion(e) {
    setEmotion(e);
    clearTimeout(emotionReset);
    emotionReset = setTimeout(() => setEmotion(S.baseEmotion), 9000);
  }

  // resposta da IA (vem do chat do avatar ou do painel)
  function showReply(res) {
    if (res.ok && res.streamed) return; // já apareceu (e foi falada) aos poucos
    if (!res.ok) { say(res.text, 9000); bubble.classList.add('err'); return; }
    if (res.emotion) applyEmotion(res.emotion);
    if (S.aiEmotes && res.emotes && res.emotes.length) playEmote(res.emotes[0]);
    if (!S.visible && !res.speak) return;
    if (S.visible) typeSay(res.text);
    V.speak(res.text, !!res.speak); // res.speak: resposta da conversa por voz, fala mesmo com a voz desligada na aba Voz
  }
  api.onAiReply(showReply);

  // resposta em tempo real (streaming)
  // O texto chega aos pedaços: o balão cresce na hora e cada frase completa vai para a fila de voz.
  // A síntese da frase seguinte (no main, em fila) acontece enquanto a atual toca.

  api.onAiStream((ev) => {
    if (ev.type === 'start') {
      V.curStream = null;
      if (!S.visible && !ev.speak) return;
      V.stopSpeech(); // calar a fala anterior e invalidar o que estava pendente
      V.curStream = { seq: V.speakSeq, voice: !!(ev.speak || S.voiceEnabled), items: [], finished: false, running: false, bubble: S.visible && S.bubbleEnabled };
      if (ev.emotion) applyEmotion(ev.emotion);
      if (S.aiEmotes && ev.emotes && ev.emotes.length) playEmote(ev.emotes[0]);
      if (V.curStream.bubble) bub.open();
      return;
    }
    const q = V.curStream;
    if (!q || q.seq !== V.speakSeq) return;
    if (ev.type === 'text') {
      if (q.bubble) bubble.textContent = ev.text;
    } else if (ev.type === 'sentence') {
      let raw = ev.text;
      if (S.speakSkipCode !== false) { // bloco de código que se estende por várias frases: pula tudo entre os ```
        const f = (raw.match(/```/g) || []).length;
        if (q.inCode) { if (f % 2) { q.inCode = false; raw = raw.slice(raw.indexOf('```') + 3); } else raw = ''; }
        else if (f % 2) { q.inCode = true; raw = raw.slice(0, raw.indexOf('```')); }
      }
      let clean = V.speechText(raw);
      if (S.speakMaxChars > 0 && clean) { // respostas longas: fala só o começo (o balão mostra tudo)
        const left = S.speakMaxChars - (q.spokenChars || 0);
        clean = (left < 20 && q.spokenChars) ? '' : V.limitSpeech(clean, left);
        q.spokenChars = (q.spokenChars || 0) + clean.length;
      }
      if (q.voice && clean) {
        if (!q.items.length && !q.running) V.setTtsSpeaking(true); // a boca já se prepara enquanto a voz é sintetizada
        q.items.push({ text: clean, p: V.prepareSentence(clean) });
        V.runStreamQueue(q);
      }
    } else if (ev.type === 'end') {
      q.finished = true;
      if (q.bubble) bub.finish(ev.text);
      if (!q.voice) V.speakingUntil = performance.now() + Math.min(ev.text.length * 60, 8000); // boca mexe mesmo sem voz
      else if (!q.running && !q.items.length) { V.setTtsSpeaking(false); V.ttsLevel = 0; }
    }
  });

  return { showReply };
}
