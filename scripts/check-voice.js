'use strict';
// Diagnóstico de voz: npm run check. Faster-Whisper é opcional; ao menos um backend deve estar pronto.
const Module = require('module');
const { spawnSync } = require('child_process');

console.log('Node', process.version, '| sistema', process.platform, '| arquitetura', process.arch);
if (process.platform === 'win32' && process.arch !== 'x64') {
  console.log('⚠️  O Yoru recomenda Node.js 64 bits (x64) no Windows.');
}
function tryLoad(label, fn) {
  try { fn(); console.log('✅', label); return true; }
  catch (e) { console.log('❌', label, '\n    ', String(e.message || e).split('\n')[0]); return false; }
}
let integrated = true;
integrated = tryLoad('onnxruntime-node (backend integrado)', () => require('onnxruntime-node')) && integrated;
const orig = Module._load;
Module._load = function (r) { return r === 'sharp' ? function () {} : orig.apply(this, arguments); };
try { integrated = tryLoad('@huggingface/transformers (backend integrado)', () => require('@huggingface/transformers')) && integrated; }
finally { Module._load = orig; }
tryLoad('sharp (opcional; não é usado pela voz)', () => require('sharp'));

function pythonCheck() {
  const candidates = process.env.YORU_PYTHON
    ? [{ cmd: process.env.YORU_PYTHON, args: [] }]
    : (process.platform === 'win32'
      ? [{ cmd: 'py', args: ['-3'] }, { cmd: 'python', args: [] }]
      : [{ cmd: 'python3', args: [] }, { cmd: 'python', args: [] }]);
  for (const c of candidates) {
    try {
      const r = spawnSync(c.cmd, [...c.args, '-c', 'import faster_whisper, numpy; print("Faster-Whisper", faster_whisper.__version__ if hasattr(faster_whisper,"__version__") else "instalado")'], { encoding: 'utf8', timeout: 7000, windowsHide: true });
      if (r.status === 0) { console.log('✅', c.cmd, '- Faster-Whisper e NumPy disponíveis'); return true; }
    } catch (_) {}
  }
  console.log('ℹ️  Faster-Whisper não encontrado (opcional). Instale com: python -m pip install faster-whisper');
  return false;
}
const faster = pythonCheck();
console.log(integrated || faster
  ? '\nPelo menos um backend de reconhecimento está disponível.'
  : '\nNenhum backend completo foi detectado. Instale as dependências do backend integrado ou Python + faster-whisper + numpy.');
process.exit(integrated || faster ? 0 : 1);
