'use strict';
// Adaptador opcional para Faster-Whisper. Se Python/pacote não estiver disponível, o STT nativo segue ativo.
const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');

function candidates() {
  if (process.env.YORU_PYTHON) return [{ cmd: process.env.YORU_PYTHON, args: [] }];
  return process.platform === 'win32'
    ? [{ cmd: 'py', args: ['-3'] }, { cmd: 'python', args: [] }, { cmd: 'python3', args: [] }]
    : [{ cmd: 'python3', args: [] }, { cmd: 'python', args: [] }];
}
let detectionPromise = null;
let detectionResult;
function detect({ timeout = 5000 } = {}) {
  if (detectionResult !== undefined) return Promise.resolve(detectionResult);
  if (detectionPromise) return detectionPromise;
  detectionPromise = (async () => {
    for (const c of candidates()) {
      const ok = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => { if (settled) return; settled = true; clearTimeout(timer); resolve(value); };
        let child;
        const timer = setTimeout(() => { if (child) child.kill(); finish(false); }, timeout);
        try {
          child = spawn(c.cmd, [...c.args, '-c', 'import faster_whisper, numpy'], { stdio: 'ignore', windowsHide: true });
          child.once('error', () => finish(false));
          child.once('exit', (code) => finish(code === 0));
        } catch (_) { finish(false); }
      });
      if (ok) { detectionResult = c; return c; }
    }
    detectionResult = null;
    return null;
  })().finally(() => { detectionPromise = null; });
  return detectionPromise;
}

class FasterWhisper extends EventEmitter {
  constructor({ cacheDir, threads = 2, script = path.join(__dirname, 'stt-faster.py') }) {
    super(); this.cacheDir = cacheDir; this.threads = threads; this.script = script;
    this.python = null; this.proc = null; this.pending = new Map(); this.nextId = 1; this.buffer = ''; this.stderr = '';
  }
  static detect(options) { return detect(options); }
  start() {
    if (this.proc && !this.proc.killed) return;
    if (!this.python) throw new Error('Faster-Whisper não instalado. Instale Python 3, faster-whisper e numpy para ativar esse backend.');
    const p = spawn(this.python.cmd, [...this.python.args, '-u', this.script, this.cacheDir, String(this.threads)], { stdio: ['pipe','pipe','pipe'], windowsHide: true });
    this.proc = p; this.buffer = ''; this.stderr = '';
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', chunk => { this.buffer += chunk; let i; while ((i = this.buffer.indexOf('\n')) >= 0) { const line = this.buffer.slice(0,i); this.buffer = this.buffer.slice(i+1); try { this._message(JSON.parse(line)); } catch (_) {} } });
    p.stderr.setEncoding('utf8'); p.stderr.on('data', s => { this.stderr = (this.stderr + s).slice(-4000); });
    const fail = err => { if (this.proc !== p) return; this.proc = null; for (const [id, q] of this.pending) { this.pending.delete(id); q.reject(err); } };
    p.on('error', fail); p.on('exit', code => fail(new Error('Faster-Whisper encerrou ('+code+'): '+this.stderr.slice(-500))));
  }
  _message(m) {
    if (m.type === 'fatal') { this.emit('fatal', m); return; }
    const q = this.pending.get(m.id); if (!q) return;
    this.pending.delete(m.id);
    if (m.type === 'error') q.reject(new Error(m.message || 'Falha no Faster-Whisper'));
    else { if (m.type === 'ready') this.emit('ready', m); q.resolve(m); }
  }
  async call(msg) {
    if (!this.python) this.python = await detect();
    if (!this.python) throw new Error('Python 3 com faster-whisper e numpy não foi encontrado. Configure YORU_PYTHON ou instale as dependências.');
    this.start(); const id = this.nextId++;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const err = new Error('Tempo limite do Faster-Whisper excedido; o processo foi reiniciado para evitar ficar preso.');
        this.dispose(err);
        reject(err);
      }, msg.type === 'prepare' ? 600000 : 120000);
      this.pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});
      try { this.proc.stdin.write(JSON.stringify({...msg,id})+'\n'); } catch(e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  prepare(model) { return this.call({type:'prepare',model}); }
  async transcribe(audio) {
    if (!(audio instanceof Float32Array) || audio.length < 3200 || audio.length > 16000 * 90) throw new Error('Áudio inválido ou longo demais para transcrição (limite de 90 segundos).');
    const b = Buffer.from(audio.buffer,audio.byteOffset,audio.byteLength).toString('base64');
    const r = await this.call({type:'transcribe',audio:b}); return r.text || '';
  }
  dispose(reason) { const p=this.proc; this.proc=null; if(p) p.kill(); for(const [id,q] of this.pending){this.pending.delete(id);q.reject(reason || new Error('Faster-Whisper reiniciado.'));} }
}
module.exports = { FasterWhisper };
