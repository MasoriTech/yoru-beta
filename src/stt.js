'use strict';
// Gerencia a thread do Whisper (stt-worker.js): carregar o modelo e transcrever trechos de áudio.

const { Worker } = require('worker_threads');
const { EventEmitter } = require('events');
const path = require('path');
const { FasterWhisper } = require('./stt-faster');

class Stt extends EventEmitter {
  constructor({ cacheDir, workerFile = path.join(__dirname, 'stt-worker.js'), threads = () => 0, device = () => 'cpu' }) {
    super();
    this.threads = threads; // () => núcleos do reconhecimento (0 = automático)
    this.device = device; // () => 'cpu' | 'gpu'
    this.cacheDir = cacheDir;
    this.workerFile = workerFile;
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
    this.ready = false;
    this.faster = null;
    this.backend = 'auto'; // Faster-Whisper quando instalado; fallback Transformers.js sem quebrar instalações antigas
    this.fasterChecked = false;
    this.fasterAvailable = false;
    this.lastModel = null;
  }

  _worker() {
    if (this.worker) return this.worker;
    const w = new Worker(this.workerFile, { workerData: { cacheDir: this.cacheDir, threads: Number(this.threads()) || 0, device: this.device() === 'gpu' ? 'gpu' : 'cpu' } });
    w.on('message', (m) => {
      if (m.type === 'progress' || m.type === 'loading' || m.type === 'device' || m.type === 'retry') return this.emit(m.type, m);
      if (m.type === 'ready') { this.ready = true; return this.emit('ready', m); }
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.type === 'error') p.reject(new Error(m.message));
      else p.resolve(m);
    });
    // Só mexe no que é DESTA thread: o 'exit' de uma thread descartada chega depois, e não pode
    // derrubar a thread nova (ex.: trocar de modelo/núcleos logo após dispose()).
    const fail = (err) => {
      if (this.worker === w) { this.worker = null; this.ready = false; }
      for (const [id, p] of this.pending) {
        if (p.w === w) { this.pending.delete(id); p.reject(err); }
      }
    };
    w.on('error', (e) => fail(e));
    w.on('exit', (code) => fail(new Error('o reconhecimento de voz parou (código ' + code + ')')));
    this.worker = w;
    return w;
  }

  _call(msg, transfer) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      try {
        const w = this._worker();
        this.pending.set(id, { resolve, reject, w });
        w.postMessage({ ...msg, id }, transfer || []);
      }
      catch (e) { this.pending.delete(id); reject(e); }
    });
  }

  async _useFaster() {
    if (process.env.YORU_TEST_GPU) { this.fasterChecked = true; this.fasterAvailable = false; return false; }
    // Todas as chamadas esperam a MESMA detecção. Antes, quem chamava durante a detecção recebia "não" na hora e
    // passava na frente de quem chamou primeiro (pedidos de modelo chegavam fora de ordem ao worker).
    if (!this._detecting) {
      this._detecting = Promise.resolve().then(() => FasterWhisper.detect({ timeout: 5000 })).then(
        (r) => { this.fasterAvailable = !!r; this.fasterChecked = true; },
        () => { this.fasterAvailable = false; this.fasterChecked = true; });
    }
    await this._detecting;
    return this.fasterAvailable;
  }

  async _prepareFaster(model) {
    if (!this.faster) {
      this.faster = new FasterWhisper({ cacheDir: this.cacheDir, threads: Number(this.threads()) || 2 });
      this.faster.on('ready', (m) => { this.ready = true; this.emit('ready', m); });
    }
    try {
      const r = await this.faster.prepare(model); this.ready = true; this.lastModel = model;
      this.emit('device', { device: 'cpu', backend: 'faster-whisper', reason: this.device() === 'gpu' ? 'Faster-Whisper está configurado em CPU (INT8); DirectML não é suportado por este backend.' : '' });
      return r;
    } catch (e) {
      this.faster.dispose(); this.faster = null; this.fasterAvailable = false;
      this.emit('device', { device: 'cpu', backend: 'transformers', reason: 'Faster-Whisper indisponível; usando o mecanismo integrado: ' + String(e.message || e).slice(0, 150) });
      return this._call({ type: 'prepare', model });
    }
  }

  async prepare(model) {
    // Primeiro descobre se o Faster-Whisper existe (resultado fica em cache). Antes o download do modelo integrado
    // começava em paralelo e era cancelado quando o Faster-Whisper vencia, deixando arquivo pela metade no cache
    // (o "modelo" passava a falhar sempre) e baixando duas vezes.
    if (await this._useFaster()) {
      const r = await this._prepareFaster(model);
      this.disposeWorkerOnly();
      return r;
    }
    if (!process.env.YORU_TEST_GPU) this.emit('device', { device: this.device() === 'gpu' ? 'gpu' : 'cpu', backend: 'transformers', reason: 'Faster-Whisper não detectado; usando o backend integrado.' });
    return this._call({ type: 'prepare', model });
  }

  disposeWorkerOnly() {
    const w = this.worker; this.worker = null; this.ready = !!this.faster;
    if (w) { for (const [id, p] of this.pending) if (p.w === w) { this.pending.delete(id); p.reject(new Error('Backend de voz substituído.')); } w.terminate(); }
  }

  async transcribe(audio, model) {
    if (await this._useFaster() && !this.faster) {
      try { await this._prepareFaster(model); } catch (_) { /* _prepareFaster já aciona o fallback */ }
    }
    if (this.fasterAvailable && this.faster) {
      try { if (this.lastModel !== model) await this._prepareFaster(model); return await this.faster.transcribe(audio); }
      catch (e) {
        this.emit('device', { device: 'cpu', backend: 'transformers', reason: 'Falha no Faster-Whisper; repetindo a frase no mecanismo integrado: ' + String(e.message || e).slice(0, 150) });
        this.faster.dispose(); this.faster = null; this.fasterAvailable = false;
        await this._call({ type: 'prepare', model });
      }
    }
    // o buffer é transferido para a thread; só copia se ele for fatia de um buffer maior (evita copiar à toa)
    const own = audio.byteOffset === 0 && audio.byteLength === audio.buffer.byteLength;
    const send = own ? audio : new Float32Array(audio);
    const r = await this._call({ type: 'transcribe', model, audio: send }, [send.buffer]);
    return r.text;
  }

  dispose() {
    if (this.faster) { this.faster.dispose(); this.faster = null; }
    const w = this.worker;
    this.worker = null;
    this.ready = false;
    if (w) {
      for (const [id, p] of this.pending) if (p.w === w) { this.pending.delete(id); p.reject(new Error('o reconhecimento de voz foi reiniciado')); }
      w.terminate();
    }
  }
}

module.exports = { Stt };
