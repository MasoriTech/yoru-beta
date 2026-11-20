'use strict';
// Voz neural (Edge TTS), sem Electron e sem rede para testar: o cliente do serviço entra por injeção
// (`lib` = { MsEdgeTTS, OUTPUT_FORMAT }, o mesmo formato do pacote msedge-tts). Aqui ficam a montagem do texto
// (escape, ritmo, tom), a fila de uma síntese por vez, o cache de falas curtas e a lista de vozes.

const NEURAL_FALLBACK = [
  { id: 'pt-BR-FranciscaNeural', lang: 'pt', label: 'Francisca (feminina, Brasil)' },
  { id: 'pt-BR-ThalitaMultilingualNeural', lang: 'pt', label: 'Thalita (feminina, Brasil)' },
  { id: 'pt-BR-AntonioNeural', lang: 'pt', label: 'Antônio (masculino, Brasil)' },
  { id: 'pt-PT-RaquelNeural', lang: 'pt', label: 'Raquel (feminina, Portugal)' },
  { id: 'pt-PT-DuarteNeural', lang: 'pt', label: 'Duarte (masculino, Portugal)' },
];
const DEFAULT_VOICE = 'pt-BR-FranciscaNeural';
const MAX_CHARS = 1500;         // o que vai para o serviço por fala
const CACHE_MAX_TEXT = 400;     // só falas curtas entram no cache
const DEFAULT_CACHE_BYTES = 12 * 1024 * 1024;

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v)}%`;

// texto + opções que o serviço recebe: ritmo (rate 1 = normal) e tom (pitch 1 = normal, metade do efeito)
function buildSpeech(text, rate, pitch) {
  return {
    text: xmlEscape(String(text).slice(0, MAX_CHARS)),
    options: { rate: pct((rate - 1) * 100), pitch: pct((pitch - 1) * 50) },
  };
}

// a mesma fala com outra voz, ritmo ou tom é outro áudio
const cacheKey = (voice, rate, pitch, text) => [voice, rate, pitch, text].join('|');

// converte a lista do serviço no formato do painel; quem tem pt vem primeiro. Sem nenhuma voz pt, devolve null.
function formatVoices(all, regionName) {
  const country = regionName || ((loc) => {
    try { return new Intl.DisplayNames(['pt-BR'], { type: 'region' }).of(loc.split('-')[1]); } catch (_) { return loc; }
  });
  const list = (all || []).filter((v) => v && /^[a-z]{2,3}-[A-Z]{2}/.test(v.Locale)).map((v) => ({
    id: v.ShortName,
    lang: v.Locale.split('-')[0].toLowerCase(),
    label: `${v.ShortName.replace(/^[a-z]{2,3}-[A-Z]{2}(-[A-Za-z]+)?-/, '').replace(/(Multilingual)?Neural$/, '')} (${v.Gender === 'Male' ? 'masculino' : 'feminina'}, ${country(v.Locale)})`,
    multi: /Multilingual/.test(v.ShortName),
  })).sort((a, b) => (a.lang === 'pt' ? 0 : 1) - (b.lang === 'pt' ? 0 : 1) || a.id.localeCompare(b.id));
  return list.some((v) => v.lang === 'pt') ? list : null;
}

// settings: () => { neuralVoice, voiceRate, voicePitch, voiceEngine }
function createNeuralTts({ lib, settings, cacheMaxBytes = DEFAULT_CACHE_BYTES, regionName } = {}) {
  const MsEdgeTTS = lib && lib.MsEdgeTTS, OUTPUT_FORMAT = lib && lib.OUTPUT_FORMAT;
  let client = null, clientVoice = '', opening = null, voiceListCache = null;
  const cache = new Map();
  let cacheBytes = 0;
  let chain = Promise.resolve();

  const voiceName = () => settings().neuralVoice || DEFAULT_VOICE;
  const keyOf = (text) => { const s = settings(); return cacheKey(s.neuralVoice || DEFAULT_VOICE, s.voiceRate, s.voicePitch, text); };

  // abre a conexão (a 1ª fala não paga o handshake). Uma só em andamento por vez.
  function ensureClient() {
    const voice = voiceName();
    if (client && clientVoice === voice) return Promise.resolve();
    if (opening && opening.voice === voice) return opening.p;
    const p = (async () => {
      try { if (client) client.close(); } catch (_) {}
      client = null;
      const c = new MsEdgeTTS({ connectionTimeoutMs: 8000, synthesisTimeoutMs: 20000 });
      await c.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      client = c;
      clientVoice = voice;
    })();
    opening = { voice, p };
    const clear = () => { if (opening && opening.p === p) opening = null; };
    p.then(clear, clear);
    return p;
  }

  function warm() {
    if (!MsEdgeTTS || settings().voiceEngine !== 'neural') return;
    ensureClient().catch(() => {}); // sem rede: a 1ª fala tenta de novo e cai na voz do sistema se precisar
  }

  async function rawSynth(text) {
    if (!MsEdgeTTS) throw new Error('pacote msedge-tts não instalado (rode: npm install)');
    try {
      await ensureClient();
      const s = settings();
      const sp = buildSpeech(text, s.voiceRate, s.voicePitch);
      const { audioStream } = client.toStream(sp.text, sp.options);
      const chunks = [];
      await new Promise((resolve, reject) => {
        audioStream.on('data', (c) => chunks.push(c));
        audioStream.on('end', resolve);
        audioStream.on('close', resolve);
        audioStream.on('error', reject);
      });
      const buf = Buffer.concat(chunks);
      if (buf.length < 200) throw new Error('áudio vazio');
      return buf;
    } catch (e) {
      try { if (client) client.close(); } catch (_) {}
      client = null; // recria a conexão na próxima fala
      throw e;
    }
  }

  // Uma síntese por vez (o cliente do Edge não aceita pedidos em paralelo), com cache das falas curtas
  // que se repetem e uma nova tentativa se a conexão caiu.
  function synth(text) {
    const key = keyOf(text);
    const hit = cache.get(key);
    if (hit) { cache.delete(key); cache.set(key, hit); return Promise.resolve(hit); } // mais recente no fim
    const job = chain.then(() => rawSynth(text).catch(() => rawSynth(text)));
    chain = job.catch(() => {});
    return job.then((buf) => {
      if (text.length <= CACHE_MAX_TEXT) {
        const old = cache.get(key);
        if (old) cacheBytes -= old.length;
        cache.set(key, buf);
        cacheBytes += buf.length;
        for (const [k, v] of cache) { // descarta as mais antigas
          if (cacheBytes <= cacheMaxBytes) break;
          cache.delete(k);
          cacheBytes -= v.length;
        }
      }
      return buf;
    });
  }

  async function voices() {
    if (voiceListCache) return voiceListCache;
    try {
      if (!MsEdgeTTS) throw new Error('sem pacote');
      const list = formatVoices(await new MsEdgeTTS().getVoices(), regionName);
      if (list) return (voiceListCache = list);
    } catch (_) { /* usa a lista fixa */ }
    return NEURAL_FALLBACK;
  }

  return {
    available: !!MsEdgeTTS,
    warm, synth, voices,
    hasCached: (text) => cache.has(keyOf(text)),
    clearCache: () => { cache.clear(); cacheBytes = 0; },
    cacheInfo: () => ({ cacheItems: cache.size, cacheKB: Math.round(cacheBytes / 1024) }),
  };
}

module.exports = { createNeuralTts, buildSpeech, cacheKey, formatVoices, xmlEscape, pct, NEURAL_FALLBACK };
