'use strict';
// Respostas em tempo real (streaming).
// Funções puras, sem Electron, para poderem ser testadas com `npm test`.

// gestos disponíveis (nome -> como a IA deve entender). É a lista única: o app, o painel e o prompt da IA usam esta.
const EMOTE_LABELS = {
  wave: 'acenar', nod: 'concordar', shake: 'negar', bow: 'reverência', dance: 'dançar', spin: 'girar',
  stretch: 'espreguiçar', shy: 'tímida', happy: 'alegre', surprised: 'surpresa',
  cheer: 'comemorar', laugh: 'rir', sad: 'abatida', angry: 'brava', sleepy: 'sonolenta', think: 'pensar', jump: 'pular',
  disco: 'dançar disco', robot: 'dançar como robô', samba: 'sambar', ballet: 'dançar balé', hiphop: 'dançar hip hop',
  clap: 'bater palmas', pose: 'mãos na cintura', salute: 'continência', sit: 'sentar no chão', chair: 'sentar na cadeira',
  bed: 'dormir na cama', tent: 'dormir na barraca', duck: 'agachar e se abaixar',
  thumbs_up: 'fazer joinha', heart: 'fazer um coração com as mãos', blow_kiss: 'mandar um beijo',
  point: 'apontar', shrug: 'dar de ombros', facepalm: 'colocar a mão na testa',
};
const EMOTE_IDS = Object.keys(EMOTE_LABELS);
const NEW_EMOTES_V2 = ['cheer', 'laugh', 'sad', 'angry', 'sleepy', 'think', 'jump']; // entram no sorteio de quem já tinha configurações salvas
const NEW_EMOTES_V3 = ['disco', 'robot', 'samba', 'ballet', 'hiphop', 'clap', 'pose', 'salute', 'sit', 'chair'];
const NEW_EMOTES_V4 = ['duck'];
const NEW_EMOTES_V5 = ['thumbs_up', 'heart', 'blow_kiss', 'point', 'shrug', 'facepalm'];
const EMOTIONS = ['neutral', 'happy', 'relaxed', 'sad', 'angry', 'surprised'];

// separa tags de emoção [happy] e de gesto [emote:wave] do texto
function parseReply(raw) {
  let emotion = null;
  const emotes = [];
  const remember = [], forget = []; // tags [lembrar: ...] e [esquecer: ...] da memória de longo prazo
  const actions = [];               // tags [app:tema=oceano], [app:item=Katana]... (a IA mexe no próprio app)
  const text = String(raw)
    .replace(/\[app:\s*([a-zA-Zçã]{2,10})\s*=\s*([^\]]{1,80})\]\s*/gi, (m, kind, value) => {
      actions.push({ kind: kind.toLowerCase(), value: value.trim() });
      return '';
    })
    .replace(/\[(lembrar|esquecer):\s*([^\]]{1,400})\]\s*/gi, (m, kind, body) => {
      (kind.toLowerCase() === 'lembrar' ? remember : forget).push(body.replace(/\s+/g, ' ').trim());
      return '';
    })
    .replace(/\[(emote:)?([a-z]+)\]\s*/gi, (m, pre, tag) => {
      tag = tag.toLowerCase();
      if (pre && EMOTE_IDS.includes(tag)) { emotes.push(tag); return ''; }
      if (!pre && EMOTIONS.includes(tag)) { emotion = emotion || tag; return ''; }
      return m;
    })
    .trim();
  return { emotion, emotes, text, remember, forget, actions };
}

// Texto visível de uma resposta ainda incompleta: esconde uma tag que ainda está sendo escrita ("[hap")
function visibleText(raw) {
  let s = String(raw);
  const open = s.lastIndexOf('[');
  if (open !== -1 && s.indexOf(']', open) === -1) {
    // tag de memória ainda sendo escrita pode ser longa: esconde até fechar
    const memTag = /^\[(lembrar|esquecer|app)/i.test(s.slice(open)) && s.length - open <= 420;
    if (memTag || s.length - open <= 16) s = s.slice(0, open);
  }
  return parseReply(s).text;
}

// Procura o fim da primeira frase completa em `text` a partir de `from`.
// Retorna o índice logo depois da frase, ou -1 se ainda não há uma frase completa.
// Frases muito curtas ("Oi!") são juntadas com a seguinte para a voz não picotar.
// first=true (1ª frase da resposta): a voz começa mais cedo — frase a partir de 14 letras, ou quebra numa vírgula/dois-pontos
// depois de 30 (só "vírgula + espaço + letra": "3,5" não quebra). Reduz o tempo até ouvir a primeira palavra.
function sentenceEnd(text, from, minLen = 24, first = false) {
  const re = first
    ? /[.!?…]+["')\]”]*(?=\s)|\n+|[,;:](?=\s+\p{L})/gu
    : /[.!?…]+["')\]”]*(?=\s)|\n+/g;
  if (first) minLen = 14;
  re.lastIndex = from;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    const piece = text.slice(from, end).trim();
    const soft = /^[,;:]$/.test(m[0]);
    // "3.5", "Sr." ou "etc." não terminam frase: exige espaço depois e um pedaço com tamanho razoável
    if (soft ? piece.length >= 30 : (piece.length >= minLen || /\n/.test(m[0]))) return end;
  }
  return -1;
}

/**
 * Acumula o texto que chega aos pedaços e avisa quando há novidade.
 * emit({type:'start', emotion, emotes}) na primeira vez que há texto visível
 * emit({type:'text', text})            texto visível até agora
 * emit({type:'sentence', text})        uma frase completa (para a voz começar antes do fim)
 * emit({type:'end', text, emotion, emotes})
 */
function createReplyStreamer(emit) {
  let raw = '';
  let started = false;
  let spoken = 0;     // quanto do texto visível já foi enviado como frase
  let firstSent = false; // já saiu a 1ª frase (a partir daí, tamanho normal)
  let lastText = '';
  let emotion = null;
  const emotes = [];

  function scan() {
    // tags completas vão aparecendo no começo; guarda a primeira emoção e os gestos
    const p = parseReply(raw.replace(/\[[^\]]*$/, ''));
    if (p.emotion && !emotion) emotion = p.emotion;
    for (const e of p.emotes) if (!emotes.includes(e)) emotes.push(e);
  }

  function flushSentences(final) {
    const vis = visibleText(raw);
    if (vis.length < spoken) spoken = 0; // o texto encolheu (tag que se completou): recomeça por segurança
    for (;;) {
      const end = sentenceEnd(vis, spoken, 24, !firstSent);
      if (end === -1) break;
      const s = vis.slice(spoken, end).trim();
      spoken = end;
      if (s) { firstSent = true; emit({ type: 'sentence', text: s }); }
    }
    if (final) {
      const rest = vis.slice(spoken).trim();
      spoken = vis.length;
      if (rest) emit({ type: 'sentence', text: rest });
    }
  }

  return {
    get started() { return started; },
    get raw() { return raw; },
    push(delta) {
      if (!delta) return;
      raw += delta;
      scan();
      const vis = visibleText(raw);
      if (!vis) return; // ainda só tags
      if (!started) { started = true; emit({ type: 'start', emotion, emotes: [...emotes] }); }
      if (vis !== lastText) { lastText = vis; emit({ type: 'text', text: vis }); }
      flushSentences(false);
    },
    end() {
      if (!started) return null;
      scan();
      flushSentences(true);
      const text = visibleText(raw);
      emit({ type: 'end', text, emotion, emotes: [...emotes] });
      return text;
    },
  };
}

// Conversa por voz: só as últimas mensagens vão para a IA (prompt menor = resposta começa antes).
// Sempre começa numa fala do usuário (a API exige alternância) e mantém a última pergunta.
const VOICE_HISTORY = 10;
const VOICE_MAX_TOKENS = 260; // 2 frases faladas cabem folgado
function trimForVoice(msgs, keep = VOICE_HISTORY) {
  if (msgs.length <= keep) return msgs;
  let out = msgs.slice(-keep);
  while (out.length > 1 && out[0].role !== 'user') out = out.slice(1);
  return out;
}

// ---------- leitura dos fluxos de rede ----------

// Alguns modelos (DeepSeek R1, Qwen...) escrevem o raciocínio entre <think> e </think> dentro do próprio texto.
// Este filtro tira esse trecho do que vai para o balão e para a voz, mesmo quando a tag chega partida ao meio.
function createThinkFilter(emit) {
  const OPEN = '<think>', CLOSE = '</think>';
  let buf = '', inThink = false;
  const partial = (tag, final) => { // fim do texto que pode ser o começo da tag: espera o próximo pedaço
    if (final) return 0;
    for (let k = Math.min(tag.length - 1, buf.length); k > 0; k--) if (tag.startsWith(buf.slice(-k))) return k;
    return 0;
  };
  function drain(final) {
    for (;;) {
      if (!inThink) {
        const i = buf.indexOf(OPEN);
        if (i !== -1) { if (i) emit(buf.slice(0, i)); buf = buf.slice(i + OPEN.length); inThink = true; continue; }
        const keep = partial(OPEN, final);
        const out = buf.slice(0, buf.length - keep);
        if (out) emit(out);
        buf = buf.slice(buf.length - keep);
        return;
      }
      const i = buf.indexOf(CLOSE);
      if (i !== -1) { buf = buf.slice(i + CLOSE.length).replace(/^\s+/, ''); inThink = false; continue; }
      buf = buf.slice(buf.length - partial(CLOSE, final)); // descarta o raciocínio, guarda só um possível começo de </think>
      if (final) buf = '';
      return;
    }
  }
  return { push(d) { buf += d; drain(false); }, end() { drain(true); } };
}


// lê um corpo de resposta (ReadableStream) e entrega linhas de texto
async function* readLines(body) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body) {
    buf += typeof chunk === 'string' ? chunk : dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      yield line;
    }
  }
  buf += dec.decode();
  if (buf.trim()) yield buf.replace(/\r$/, '');
}

// Server-Sent Events: entrega { event, data } (data já como string)
async function* parseSSE(body) {
  let event = '';
  let data = [];
  for await (const line of readLines(body)) {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') };
      event = ''; data = [];
    } else if (line.startsWith(':')) {
      continue; // comentário/keep-alive
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length) yield { event, data: data.join('\n') };
}

// Extratores de texto de cada provedor. Cada um chama onDelta(texto) e retorna o texto completo.
async function readAnthropicStream(body, onDelta) {
  let full = '';
  for await (const ev of parseSSE(body)) {
    let j;
    try { j = JSON.parse(ev.data); } catch (_) { continue; }
    if (j.type === 'error') throw new Error((j.error && j.error.message) || 'erro no streaming');
    if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta' && j.delta.text) {
      full += j.delta.text;
      onDelta(j.delta.text);
    }
    if (j.type === 'message_stop') break;
  }
  return full;
}

async function readOpenAIStream(body, onDelta, onMeta = () => {}) {
  let full = '';
  for await (const ev of parseSSE(body)) {
    if (ev.data.trim() === '[DONE]') break;
    let j;
    try { j = JSON.parse(ev.data); } catch (_) { continue; }
    if (j.error) { // erro no meio do fluxo (a OpenRouter manda { error: { code, message } } e finish_reason "error")
      const e = new Error(j.error.message || String(j.error));
      e.apiError = j.error;
      throw e;
    }
    const c = j.choices && j.choices[0];
    if (c && c.finish_reason) onMeta({ finish: c.finish_reason });
    const t = c && c.delta && c.delta.content;
    if (typeof t === 'string' && t) { full += t; onDelta(t); }
  }
  return full;
}

async function readOllamaStream(body, onDelta) {
  let full = '';
  for await (const line of readLines(body)) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch (_) { continue; }
    if (j.error) throw new Error(String(j.error));
    const t = j.message && j.message.content;
    if (t) { full += t; onDelta(t); }
    if (j.done) break;
  }
  return full;
}

module.exports = {
  trimForVoice, VOICE_MAX_TOKENS, EMOTE_IDS, EMOTE_LABELS, NEW_EMOTES_V2, NEW_EMOTES_V3, NEW_EMOTES_V4, NEW_EMOTES_V5, EMOTIONS, parseReply, visibleText, sentenceEnd, createReplyStreamer,
  createThinkFilter, readLines, parseSSE, readAnthropicStream, readOpenAIStream, readOllamaStream,
};
