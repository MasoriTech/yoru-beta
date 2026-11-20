// Detector simples de voz: corta o áudio contínuo do microfone em frases.
// Funciona no navegador (painel) e no Node (testes). Áudio: mono, 16 kHz, Float32.
(function (root) {
  'use strict';
  const SR = 16000;
  const FRAME = 320;        // 20 ms
  const PRE = 15;           // 300 ms guardados antes da fala começar (o nome no início da frase não é cortado)
  const START_RUN = 3;      // 60 ms seguidos acima do limite para começar
  const HANG_SHORT = 20;    // 400 ms de silêncio terminam frases curtas (comandos) -> responde mais rápido
  const HANG_LONG = 30;     // 600 ms para frases longas (pausas no meio do raciocínio)
  const LONG_AFTER = 75;    // a partir de 1,5 s de voz a frase conta como longa
  const MIN_SPEECH = 10;    // frases com menos de 200 ms de voz são descartadas (estalos)
  const MIN_RATIO = 0.22;   // pelo menos 22% dos quadros precisam ser voz (descarta ruído com um pico)
  const MAX_FRAMES = 1000;  // 20 s no máximo por trecho
  const KEEP_SIL = 8;       // 160 ms de silêncio no fim (o Whisper erra menos com um respiro no final)
  // palmas e estalos de dedo: DUAS batidas secas (som curto, de banda larga) com 0,16–0,9 s entre elas
  const CLAP_MIN_RMS = 0.04;   // palma: volume mínimo (depois do filtro de graves)
  const SNAP_MIN_RMS = 0.012;  // estalo de dedo é bem mais fraco que a palma
  const CLAP_NOISE_K = 8;      // e pelo menos 8x o ruído de fundo (estalo: 6x)
  const CLAP_HF = 0.5;         // "brilho": voz fica abaixo de ~0,3; palma passa de 0,5
  const SNAP_HF = 0.65;        // estalo é ainda mais agudo; exige mais para não confundir com tecla/mouse
  const CLAP_RISE = 3;         // o quadro anterior precisa ser 3x mais fraco (começo seco)
  const CLAP_REFRACT = 6;      // 120 ms: o "toque" da batida não conta como a segunda
  const CLAP_GAP_MIN = 8;      // 160 ms
  const CLAP_GAP_MAX = 45;     // 900 ms
  const CLAP_ISO = 25;         // a 1ª batida precisa vir depois de 500 ms sem outras (digitação tem várias seguidas)
  const CLAP_CONFIRM = 15;     // e não pode vir uma 3ª em 300 ms (aí é digitação/ruído, não o par)
  const CLAP_COOLDOWN = 75;    // 1,5 s depois de disparar
  const HYST = 0.7;         // depois de começar, o limite cai para 70% (não corta o fim das palavras)

  // sensibilidade 1 (só voz alta) .. 5 (pega voz baixa, mas também ruído)
  const TABLE = {
    1: { k: 5.0, abs: 0.030 },
    2: { k: 4.0, abs: 0.020 },
    3: { k: 3.2, abs: 0.014 },
    4: { k: 2.6, abs: 0.010 },
    5: { k: 2.1, abs: 0.007 },
  };

  function Segmenter(opts) {
    opts = opts || {};
    this.onSegment = opts.onSegment || function () {};
    this.onLevel = opts.onLevel || function () {};
    this.onClap = opts.onClap || function () {};
    this.clapOn = opts.clap !== false;
    this.setSensitivity(opts.sensitivity || 3);
    this.noise = 0.004;
    this.buf = new Float32Array(FRAME);
    this.fill = 0;
    this.hx = 0; this.hy = 0; // filtro passa-alta (tira rumble/DC)
    this.reset();
  }

  Segmenter.prototype.setSensitivity = function (n) {
    this.sens = TABLE[Math.min(5, Math.max(1, Math.round(n) || 3))];
  };

  Segmenter.prototype.reset = function () {
    this.pre = [];
    this.active = false;
    this.frames = [];
    this.run = 0;
    this.speech = 0;
    this.silence = 0;
    this.fill = 0;
    this.hx = 0; this.hy = 0;
    this.prevRms = 0; this.fr = 0; this.lastImp = -1e9; this.first = null; this.pend = -1; this.cool = -1e9;
  };

  Segmenter.prototype.push = function (samples) {
    let i = 0;
    while (i < samples.length) {
      const n = Math.min(FRAME - this.fill, samples.length - i);
      this.buf.set(samples.subarray(i, i + n), this.fill);
      this.fill += n;
      i += n;
      if (this.fill === FRAME) {
        this._frame(this._hpf(this.buf));
        this.fill = 0;
      }
    }
  };

  // passa-alta de 1 polo (~80 Hz): y[n] = x[n] - x[n-1] + 0.995*y[n-1]
  Segmenter.prototype._hpf = function (src) {
    const out = new Float32Array(src.length);
    let x1 = this.hx, y1 = this.hy;
    for (let i = 0; i < src.length; i++) {
      const x = src[i];
      const y = x - x1 + 0.995 * y1;
      out[i] = y;
      x1 = x; y1 = y;
    }
    this.hx = x1; this.hy = y1;
    return out;
  };

  Segmenter.prototype._frame = function (f) {
    let sum = 0;
    for (let i = 0; i < f.length; i++) sum += f[i] * f[i];
    const rms = Math.sqrt(sum / f.length);
    const thr = Math.max(this.sens.abs, this.noise * this.sens.k);
    this.onLevel(rms, thr);
    if (this.clapOn) this._clap(f, rms);
    const isSpeech = rms > (this.active ? thr * HYST : thr);

    if (!this.active) {
      if (!isSpeech) this.noise = this.noise * 0.97 + rms * 0.03; // acompanha o ruído de fundo
      else this.noise = Math.min(0.05, this.noise * 0.998 + rms * 0.002); // ruído constante alto (ventilador) sobe o piso aos poucos
      this.pre.push(f);
      if (this.pre.length > PRE) this.pre.shift();
      this.run = isSpeech ? this.run + 1 : 0;
      if (this.run >= START_RUN) {
        this.active = true;
        this.frames = this.pre;
        this.pre = [];
        this.speech = this.run;
        this.silence = 0;
      }
      return;
    }

    this.frames.push(f);
    if (isSpeech) { this.speech++; this.silence = 0; } else this.silence++;
    const hang = this.speech >= LONG_AFTER ? HANG_LONG : HANG_SHORT;
    if (this.silence >= hang || this.frames.length >= MAX_FRAMES) this._finish();
  };

  // batida seca (palma ou estalo): começo brusco e muito "brilho" (energia nas altas frequências)
  Segmenter.prototype._impulse = function (f, rms, prev) {
    if (prev * CLAP_RISE > rms) return 0;
    const floor = this.noise * CLAP_NOISE_K;
    const maybeClap = rms >= Math.max(CLAP_MIN_RMS, floor);
    const maybeSnap = rms >= Math.max(SNAP_MIN_RMS, this.noise * 6);
    if (!maybeSnap) return 0;
    let d = 0;
    for (let i = 1; i < f.length; i++) { const x = f[i] - f[i - 1]; d += x * x; }
    const hf = d / (2 * rms * rms * f.length);
    if (maybeClap && hf >= CLAP_HF) return 1;
    return hf >= SNAP_HF ? 2 : 0;
  };

  Segmenter.prototype._clap = function (f, rms) {
    const n = ++this.fr;
    const prev = this.prevRms;
    this.prevRms = rms;
    if (this.pend >= 0 && n >= this.pend) { // par confirmado: ninguém bateu de novo nos 300 ms seguintes
      this.pend = -1;
      this.cool = n;
      this.onClap();
    }
    if (this.active || n - this.lastImp < CLAP_REFRACT) return; // falando, ou ainda é o "toque" da batida anterior
    if (!this._impulse(f, rms, prev)) return;
    const gap = n - this.lastImp;
    this.lastImp = n;
    if (n - this.cool < CLAP_COOLDOWN) { this.first = null; return; }
    if (this.pend >= 0) { this.pend = -1; this.first = null; return; } // 3ª batida: era digitação/ruído
    const f1 = this.first;
    if (f1 && gap >= CLAP_GAP_MIN && gap <= CLAP_GAP_MAX && rms / f1 < 5 && f1 / rms < 5) {
      this.first = null;
      this.pend = n + CLAP_CONFIRM;
    } else {
      this.first = gap >= CLAP_ISO ? rms : null; // só vale como 1ª se vier isolada
    }
  };

  Segmenter.prototype._finish = function () {
    const cut = Math.max(0, Math.min(this.silence, this.frames.length) - KEEP_SIL);
    const frames = cut ? this.frames.slice(0, this.frames.length - cut) : this.frames;
    const speech = this.speech;
    const ratio = frames.length ? speech / frames.length : 0;
    this.active = false;
    this.frames = [];
    this.run = 0;
    this.speech = 0;
    this.silence = 0;
    if (speech < MIN_SPEECH || ratio < MIN_RATIO) return;
    const out = new Float32Array(frames.length * FRAME);
    frames.forEach((fr, k) => out.set(fr, k * FRAME));
    this.onSegment(normalize(out));
  };

  // normaliza o volume (voz baixa rende bem mais no Whisper). Mira num volume médio (RMS), não no pico:
  // assim um estalo isolado não impede de amplificar a voz. Nunca amplifica mais de 8x nem passa de 0,9 de pico.
  function normalize(a) {
    let peak = 0, sum = 0;
    for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > peak) peak = v; sum += v * v; }
    if (peak < 0.003) return a;
    const rms = Math.sqrt(sum / a.length) || 1e-6;
    const g = Math.min(8, 0.9 / peak, 0.1 / rms);
    if (g > 1.05) for (let i = 0; i < a.length; i++) a[i] *= g;
    return a;
  }

  // reamostragem linear (caso o navegador não entregue 16 kHz)
  function resample(input, from, to) {
    if (from === to) return input;
    const ratio = from / to;
    const n = Math.floor(input.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * ratio, i0 = Math.floor(p), i1 = Math.min(i0 + 1, input.length - 1), t = p - i0;
      out[i] = input[i0] * (1 - t) + input[i1] * t;
    }
    return out;
  }

  const api = { Segmenter, resample, normalize, SR, FRAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VAD = api;
})(typeof self !== 'undefined' ? self : this);
