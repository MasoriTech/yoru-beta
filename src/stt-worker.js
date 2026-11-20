'use strict';
// Reconhecimento de fala (Whisper) rodando numa thread separada, para não travar o avatar.
// Usa o pacote @huggingface/transformers; o modelo é baixado uma vez e fica em cache.

const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const REPO = {
  tiny: 'Xenova/whisper-tiny',
  base: 'Xenova/whisper-base',
  small: 'Xenova/whisper-small',
  medium: 'Xenova/whisper-medium',
  'large-v3-turbo': 'onnx-community/whisper-large-v3-turbo',
  'large-v3': 'onnx-community/whisper-large-v3-ONNX',
};

let tf = null;
let pipe = null;
let pipeModel = null;
let loading = null; // { model, promise }: carga em andamento (só existe uma por vez)
let wanted = null;  // último modelo pedido (se pedirem outro durante a carga, vale o mais recente)
const uses = new WeakMap(); // pipeline -> transcrições em andamento
const retired = new WeakSet(); // pipelines trocados, a liberar quando ficarem ociosos

const send = (m) => parentPort.postMessage(m);

// threads do ONNX: deixa folga para o avatar (render) e o resto do sistema
const AUTO_THREADS = Math.max(2, Math.min(8, (require('os').cpus().length || 4) - 2));
const THREADS = (workerData && workerData.threads > 0) ? Math.min(workerData.threads, 16) : AUTO_THREADS; // escolhido no painel (Desempenho)

// GPU (placa de vídeo): no Windows o onnxruntime-node roda na GPU via DirectML. Se não carregar, não aceitar o modelo ou
// falhar no meio de uma frase, a voz volta sozinha para a CPU (e avisa com uma mensagem 'device').
let useGpu = !!(workerData && workerData.device === 'gpu') && (process.platform === 'win32' || !!process.env.YORU_TEST_GPU); // (a variável só existe nos testes)
let activeDevice = 'cpu';
const NETWORK_ERR = /ENOTFOUND|ECONN|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EPIPE|fetch failed|network|offline|socket|aborted|terminated|timed? ?out|stalled|\b(?:408|429|5\d\d)\b/i;
// Arquivo do modelo truncado/corrompido (download interrompido): apagar o cache desse modelo e baixar de novo resolve.
const CORRUPT_ERR = /protobuf|parsing failed|invalid (?:model|array buffer)|unexpected end of (?:json|data)|unexpected token .*json|load model .*failed|failed to load model|corrupt|truncated|not a valid (?:onnx|model)|RangeError: (?:offset|invalid typed array)/i;
const BACKOFF_MS = String(process.env.YORU_STT_BACKOFF_MS || '2000,6000,15000').split(',').map(Number).filter((n) => n >= 0);
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
const STALL_MS = Number(process.env.YORU_STT_STALL_MS) > 0 ? Number(process.env.YORU_STT_STALL_MS) : 180000; // sem nenhum progresso por 3 min = travado
let lastActivity = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errText = (e) => String((e && e.message) || e);

// O pacote do Whisper carrega o "sharp" (processamento de imagens) ao iniciar, mesmo sem usarmos imagens.
// Se o binário do sharp estiver quebrado no seu PC (ERR_DLOPEN_FAILED / "not a valid Win32 application"),
// isso derrubava o reconhecimento de voz. Aqui o sharp é trocado por um item vazio: áudio não precisa dele.
function loadTransformers() {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (request) {
    if (request === 'sharp') {
      const stub = function () { throw new Error('processamento de imagens desativado (o reconhecimento de voz não usa o sharp)'); };
      return stub;
    }
    return orig.apply(this, arguments);
  };
  try {
    return require('@huggingface/transformers'); // versão CommonJS, onde a troca funciona
  } catch (e) {
    if (e && e.code === 'ERR_REQUIRE_ESM') return import('@huggingface/transformers');
    throw e;
  } finally {
    Module._load = orig;
  }
}

async function build(model, device = 'cpu') {
  tf = tf || (await loadTransformers());
  tf.env.cacheDir = workerData.cacheDir;
  tf.env.allowLocalModels = false;
  if (process.env.YORU_HF_ENDPOINT) tf.env.remoteHost = process.env.YORU_HF_ENDPOINT; // espelho do Hugging Face, se o site oficial estiver bloqueado

  const files = new Map();
  let lastPct = -1;
  const progress = (e) => {
    if (!e || !e.file) return;
    lastActivity = Date.now();
    if (e.status === 'progress' || e.status === 'download' || e.status === 'done') {
      const f = files.get(e.file) || { loaded: 0, total: 0 };
      if (typeof e.total === 'number') f.total = e.total;
      if (typeof e.loaded === 'number') f.loaded = e.loaded;
      if (e.status === 'done') f.loaded = f.total;
      files.set(e.file, f);
      let l = 0, t = 0;
      for (const v of files.values()) { l += v.loaded; t += v.total; }
      if (t > 0) {
        const pct = Math.min(100, Math.round((l / t) * 100));
        if (pct !== lastPct) { lastPct = pct; send({ type: 'progress', pct, mb: Math.round(t / 1e5) / 10 }); } // só avisa quando o % muda (evita inundar a interface)
      }
    }
  };

  if (device === 'gpu') {
    // codificador em fp32 (a placa não gosta de q8) e decodificador quantizado; o DirectML exige memória sem padrão e execução sequencial
    return await tf.pipeline('automatic-speech-recognition', REPO[model], {
      device: 'dml',
      dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
      session_options: { intraOpNumThreads: THREADS, enableMemPattern: false, executionMode: 'sequential' },
      progress_callback: progress,
    });
  }

  try {
    // versão quantizada (bem menor e mais rápida no CPU)
    return await tf.pipeline('automatic-speech-recognition', REPO[model], { dtype: 'q8', session_options: { intraOpNumThreads: THREADS }, progress_callback: progress });
  } catch (e1) {
    // sem internet não adianta tentar a versão completa (3x maior): só tenta se a quantizada não existe/não abre
    if (NETWORK_ERR.test(errText(e1)) || CORRUPT_ERR.test(errText(e1))) throw e1;
    try {
      return await tf.pipeline('automatic-speech-recognition', REPO[model], { session_options: { intraOpNumThreads: THREADS }, progress_callback: progress });
    } catch (e2) {
      throw new Error(String((e2 && e2.message) || e2) + ' | 1ª tentativa: ' + String((e1 && e1.message) || e1));
    }
  }
}

const WARM = { language: 'portuguese', task: 'transcribe', max_new_tokens: 4 };

// monta o pipeline e já "aquece" (a 1ª inferência inicializa os kernels e leva segundos: melhor agora que na sua 1ª frase)
async function buildWarm(model) {
  if (useGpu) {
    try {
      const p = await build(model, 'gpu');
      await p(new Float32Array(16000), WARM); // na GPU o aquecimento também é o teste: se falhar, cai para a CPU
      activeDevice = 'gpu';
      return p;
    } catch (e) {
      if (NETWORK_ERR.test(errText(e))) throw e; // sem internet não é culpa da placa: tenta de novo depois
      useGpu = false;
      send({ type: 'device', device: 'cpu', reason: 'GPU indisponível: ' + errText(e).slice(0, 160) });
    }
  }
  const p = await build(model, 'cpu');
  try { await p(new Float32Array(16000), WARM); } catch (_) {}
  activeDevice = 'cpu';
  return p;
}

// Apaga só a pasta deste modelo dentro do cache (nunca fora dele).
function purgeModelCache(model) {
  try {
    const root = path.resolve(workerData.cacheDir);
    const dir = path.resolve(root, REPO[model]);
    if (dir !== root && dir.startsWith(root + path.sep)) { fs.rmSync(dir, { recursive: true, force: true }); return true; }
  } catch (_) {}
  return false;
}

// Falha se a carga ficar parada (sem nenhum progresso) por STALL_MS: antes a barra ficava presa para sempre.
function withStallGuard(fn) {
  return new Promise((resolve, reject) => {
    lastActivity = Date.now();
    const iv = setInterval(() => {
      if (Date.now() - lastActivity > STALL_MS) { clearInterval(iv); reject(new Error('stalled: o download do modelo ficou parado por ' + Math.round(STALL_MS / 1000) + ' s')); }
    }, Math.min(5000, Math.max(50, STALL_MS / 4)));
    fn().then((v) => { clearInterval(iv); resolve(v); }, (e) => { clearInterval(iv); reject(e); });
  });
}

// Carga com recuperação: falha de rede -> tenta de novo com espera crescente; arquivo corrompido -> apaga e baixa de novo.
async function buildWarmReliable(model) {
  let purged = false;
  for (let attempt = 1; ; attempt++) {
    try {
      return await withStallGuard(() => buildWarm(model));
    } catch (e) {
      const msg = errText(e);
      const corrupt = CORRUPT_ERR.test(msg) && !purged;
      const network = NETWORK_ERR.test(msg);
      if (attempt >= MAX_ATTEMPTS || (!corrupt && !network)) {
        if (network) throw new Error('Sem conexão estável com o servidor do modelo (huggingface.co) após ' + attempt + ' tentativa(s). Verifique internet/firewall/antivírus/VPN e tente de novo. Detalhe: ' + msg.slice(0, 160));
        throw e;
      }
      if (corrupt) { purged = true; purgeModelCache(model); }
      send({ type: 'retry', model, attempt, max: MAX_ATTEMPTS, reason: corrupt ? 'arquivo do modelo corrompido; baixando de novo' : 'falha de rede', detail: msg.slice(0, 160) });
      if (!corrupt) await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] || 0);
    }
  }
}

const norm = (m) => (REPO[m] ? m : 'base');

async function release(p) {
  if (!p) return;
  retired.add(p);
  if (!uses.get(p)) { // ninguém usando: libera a memória do modelo anterior já
    try { if (typeof p.dispose === 'function') await p.dispose(); } catch (_) {}
  }
}

function load(model) {
  model = norm(model);
  wanted = model;
  if (pipe && pipeModel === model && !loading) return Promise.resolve(pipe);
  if (loading) {
    if (loading.model === model) return loading.promise;
    // pediram OUTRO modelo no meio da carga: espera esta terminar e carrega só o mais recente (pula os do meio)
    return loading.promise.then(() => null, () => null).then(() => load(wanted));
  }
  send({ type: 'loading', model });
  const job = { model, promise: null };
  job.promise = (async () => {
    try {
      const p = await buildWarmReliable(model);
      const old = pipe;
      pipe = p;
      pipeModel = model;
      if (wanted === model) send({ type: 'ready', model, device: activeDevice }); // se já pediram outro, ele avisa quando terminar
      if (old) await release(old); // não deixa o modelo antigo na memória
      return p;
    } finally {
      loading = null;
    }
  })();
  loading = job;
  return job.promise;
}

// Enquanto o modelo novo carrega, o atual continua transcrevendo (sem travar a conversa).
async function acquire(model) {
  model = norm(model);
  const p = pipe && (pipeModel === model || loading) ? pipe : await load(model);
  uses.set(p, (uses.get(p) || 0) + 1);
  return p;
}
async function unacquire(p) {
  const n = (uses.get(p) || 1) - 1;
  uses.set(p, n);
  if (n === 0 && retired.has(p)) { try { if (typeof p.dispose === 'function') await p.dispose(); } catch (_) {} }
}

async function transcribe(m, retried = false) {
  const p = await acquire(m.model);
  try {
    const raw = new Float32Array(m.audio.buffer, m.audio.byteOffset, m.audio.byteLength / 4);
    // 0,25 s de silêncio antes e depois: o Whisper costuma "comer" a primeira palavra quando o áudio começa seco
    const PAD = 4000;
    const audio = new Float32Array(raw.length + PAD * 2);
    audio.set(raw, PAD);
    const secs = audio.length / 16000;
    const out = await p(audio, {
      language: 'portuguese',
      task: 'transcribe',
      num_beams: 1,                                   // busca gulosa: bem mais rápida
      do_sample: false,
      return_timestamps: false,
      max_new_tokens: Math.min(220, Math.ceil(secs * 6) + 12), // corta alucinações em loop
      ...(secs > 30 ? { chunk_length_s: 30, stride_length_s: 5 } : {}), // falas longas: sem isso o Whisper ignora o que passa de 30 s
    });
    const text = Array.isArray(out) ? out.map((o) => o.text).join(' ') : out && out.text;
    send({ type: 'result', id: m.id, text: String(text || '').trim() });
  } catch (e) {
    // a placa falhou no meio da transcrição: descarta o modelo da GPU, volta para a CPU e tenta esta fala de novo
    if (activeDevice !== 'gpu' || retried) throw e;
    useGpu = false;
    activeDevice = 'cpu';
    send({ type: 'device', device: 'cpu', reason: 'GPU falhou: ' + errText(e).slice(0, 160) });
    const old = pipe;
    pipe = null; pipeModel = null;
    await unacquire(p);
    await release(old);
    return transcribe(m, true);
  } finally {
    if (uses.get(p)) await unacquire(p);
  }
}

parentPort.on('message', async (m) => {
  try {
    if (m.type === 'prepare') {
      await load(m.model);
      send({ type: 'prepared', id: m.id });
    } else if (m.type === 'transcribe') {
      await transcribe(m);
    }
  } catch (e) {
    send({ type: 'error', id: m.id, message: String((e && e.message) || e) });
  }
});
