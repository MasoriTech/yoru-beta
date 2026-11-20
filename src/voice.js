// Voz do avatar: falar (voz neural tocada aqui ou voz do sistema), medir o volume para a boca,
// parar a fala e tocar em fila as frases de uma resposta em streaming.
// O renderer.js lê o estado em V (ttsSpeaking, ttsLevel, audioEl, analyser, anaBuf, speakingUntil, speakSeq, curStream)
// e decide quando falar. Funções de texto vêm de src/speech.js (carregado antes, como <script> comum e pelo import do renderer;
// o mesmo arquivo é usado pelo `npm test` via require). Nada de cópia aqui.

export function createVoice({ S, api }) {
  const { parsePronunciations, cleanForSpeech, limitSpeech } = globalThis.YoruSpeech;
  let pronKey = null, pronRules = [];
  let audioCtx = null;
  const V = {
    ttsSpeaking: false,
    speakingUntil: 0,   // a boca mexe até esse instante mesmo sem voz
    ttsLevel: 0,        // volume atual da voz (0..1), usado na boca
    audioEl: null,      // áudio da voz neural em reprodução
    analyser: null,
    anaBuf: null,
    speakSeq: 0,        // descarta falas antigas que chegam atrasadas
    curStream: null,    // resposta em streaming em andamento
    limitSpeech,
  };
  let reportedSpeaking = false;
  function setTtsSpeaking(v) {
    V.ttsSpeaking = v;
    if (v !== reportedSpeaking) { reportedSpeaking = v; api.reportSpeaking(v); }
  }

  function stopSpeech() {
    V.speakSeq++;
    V.curStream = null;
    if (V.audioEl) {
      const a = V.audioEl;
      V.audioEl = null;
      a.pause();
      URL.revokeObjectURL(a.src);
    }
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    setTtsSpeaking(false);
    V.ttsLevel = 0;
  }

  // texto pronto para falar: limpa, aplica o dicionário de pronúncia (Painel › Voz) e pula código/links/ações conforme as opções
  function speechText(text) {
    if (pronKey !== S.voicePronounce) { pronKey = S.voicePronounce; pronRules = parsePronunciations(pronKey || ''); }
    return cleanForSpeech(text, { skipCode: S.speakSkipCode !== false, skipActions: !!S.speakSkipActions, rules: pronRules });
  }

  // saída de áudio escolhida no painel (Voz › Saída de áudio); se o aparelho sumiu, volta ao padrão
  function applySink() {
    if (!audioCtx || typeof audioCtx.setSinkId !== 'function') return;
    const want = S.voiceSink || '';
    if (audioCtx._sink === want) return;
    audioCtx._sink = want;
    audioCtx.setSinkId(want).catch(() => { audioCtx._sink = null; audioCtx.setSinkId('').catch(() => {}); });
  }

  // voz neural: o main sintetiza (mp3) e aqui tocamos, medindo o volume para a boca
  function playNeural(bytes, seq, keep = false) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
      const a = new Audio(url);
      if (!audioCtx) audioCtx = new AudioContext();
      audioCtx.resume();
      applySink();
      const src = audioCtx.createMediaElementSource(a);
      V.analyser = audioCtx.createAnalyser();
      V.analyser.fftSize = 512;
      V.anaBuf = new Uint8Array(V.analyser.fftSize);
      const gain = audioCtx.createGain();
      gain.gain.value = S.voiceVolume;
      src.connect(V.analyser);
      V.analyser.connect(gain);
      gain.connect(audioCtx.destination);
      const done = () => {
        if (V.audioEl === a) { V.audioEl = null; if (!keep) setTtsSpeaking(false); V.ttsLevel = 0; }
        URL.revokeObjectURL(url);
        resolve();
      };
      a.onended = done;
      a.onerror = done;
      if (seq !== V.speakSeq) return done();
      V.audioEl = a;
      setTtsSpeaking(true);
      a.play().catch(done);
    });
  }

  function speakSystem(clean, keep = false) {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    const u = new SpeechSynthesisUtterance(clean);
    const voices = speechSynthesis.getVoices();
    // reserva (sem internet): a escolhida; senão uma voz feminina pt-BR (Francisca/Maria...), nunca a primeira que aparecer
    const FEM = /francisca|maria|luciana|vit[oó]ria|thalita|female|feminin/i;
    const v = voices.find((x) => x.name === S.voiceName) ||
      voices.find((x) => /^pt-BR/i.test(x.lang) && /francisca/i.test(x.name)) ||
      voices.find((x) => /^pt-BR/i.test(x.lang) && FEM.test(x.name)) ||
      voices.find((x) => /^pt/i.test(x.lang) && FEM.test(x.name)) ||
      voices.find((x) => /^pt-BR/i.test(x.lang)) || voices.find((x) => /^pt/i.test(x.lang));
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'pt-BR'; }
    u.rate = S.voiceRate;
    u.pitch = S.voicePitch;
    u.volume = S.voiceVolume;
    u.onstart = () => setTtsSpeaking(true);
    return new Promise((resolve) => {
      u.onend = u.onerror = () => { if (!keep) { setTtsSpeaking(false); V.speakingUntil = 0; } resolve(); };
      speechSynthesis.speak(u);
    });
  }

  async function speak(text, force = false) {
    if (!force && !S.voiceEnabled) {
      V.speakingUntil = performance.now() + Math.min(text.length * 60, 8000); // boca mexe mesmo sem voz
      return;
    }
    const clean = limitSpeech(speechText(text), S.speakMaxChars);
    if (!clean) return;
    stopSpeech();
    const seq = V.speakSeq;
    if (S.voiceEngine === 'neural') {
      try {
        const res = await api.tts(clean);
        if (seq !== V.speakSeq) return; // chegou outra fala (ou ocultou) enquanto sintetizava
        if (res && res.ok) return await playNeural(res.data, seq);
        console.warn('Voz neural indisponível, usando a do sistema:', res && res.error);
      } catch (e) {
        console.warn('Voz neural falhou, usando a do sistema:', e);
      }
      if (seq !== V.speakSeq) return;
    }
    speakSystem(clean);
  }

  // síntese da próxima frase enquanto a atual toca (o main sintetiza em fila)
  function prepareSentence(clean) {
    if (S.voiceEngine !== 'neural') return Promise.resolve(null);
    return api.tts(clean).catch(() => null);
  }

  async function runStreamQueue(q) {
    if (q.running) return;
    q.running = true;
    try {
      while (q.items.length) {
        const it = q.items.shift();
        if (q.seq !== V.speakSeq) return;
        const res = await it.p;
        if (q.seq !== V.speakSeq) return;
        if (res && res.ok) await playNeural(res.data, q.seq, true);
        else await speakSystem(it.text, true);
        if (S.voiceGapMs > 0 && q.items.length && q.seq === V.speakSeq) await new Promise((r) => setTimeout(r, S.voiceGapMs)); // pausa entre frases
      }
    } finally {
      q.running = false;
      // acabou a fila: só "desliga" a fala se a resposta também terminou e nada novo chegou
      if (q.seq === V.speakSeq && q.finished && !q.items.length) { setTtsSpeaking(false); V.ttsLevel = 0; }
    }
    if (q.seq === V.speakSeq && q.items.length) runStreamQueue(q); // chegou frase nova no último instante
  }

  Object.assign(V, { setTtsSpeaking, stopSpeech, speechText, applySink, playNeural, speakSystem, speak, prepareSentence, runStreamQueue });
  return V;
}
