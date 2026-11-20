'use strict';
// Copia para src/vendor/ os arquivos do three.js e do three-vrm que o avatar carrega no navegador.
// Motivo: o electron-builder NUNCA empacota pastas chamadas "examples" dentro de node_modules, e o
// GLTFLoader fica em node_modules/three/examples/jsm — por isso o avatar sumia no .exe (mas funcionava no "npm start").
// Roda sozinho no "npm install" (postinstall) e antes de "npm run pack/dist".
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const nm = path.join(root, 'node_modules');
const out = path.join(root, 'src', 'vendor');

const FILES = [
  ['three/build/three.module.js', 'three/three.module.js'],
  ['three/build/three.core.js', 'three/three.core.js'],
  ['three/examples/jsm/loaders/GLTFLoader.js', 'three/addons/loaders/GLTFLoader.js'],
  ['three/examples/jsm/utils/BufferGeometryUtils.js', 'three/addons/utils/BufferGeometryUtils.js'],
  ['three/examples/jsm/utils/SkeletonUtils.js', 'three/addons/utils/SkeletonUtils.js'],
  ['@pixiv/three-vrm/lib/three-vrm.module.js', 'three-vrm/three-vrm.module.js'],
];

let missing = 0;
for (const [from, to] of FILES) {
  const src = path.join(nm, from);
  const dest = path.join(out, to);
  if (!fs.existsSync(src)) {
    if (fs.existsSync(dest)) continue; // já existe em src/vendor (veio no pacote): não precisa do node_modules
    console.error('[vendor] não achei ' + from + ' — rode "npm install" (com "s": install) primeiro.');
    missing++; continue;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
if (missing) process.exit(1);
console.log('[vendor] src/vendor pronto (' + FILES.length + ' arquivos)');

// ---------- gestos de mão (aba Gestos): MediaPipe ----------
// Opcional: se faltar, o app abre normalmente e só a aba Gestos avisa o que fazer. O runtime vem do pacote
// @mediapipe/tasks-vision; o modelo da mão (~8 MB) é baixado UMA vez e fica em src/vendor/mediapipe (depois funciona offline).
const MP_DIR = path.join(out, 'mediapipe');
const MP_MODEL = path.join(MP_DIR, 'hand_landmarker.task');
const MP_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function copyMediapipe() {
  const pkg = path.join(nm, '@mediapipe', 'tasks-vision');
  if (!fs.existsSync(pkg)) {
    if (!fs.existsSync(path.join(MP_DIR, 'vision_bundle.mjs'))) console.warn('[vendor] aviso: @mediapipe/tasks-vision não instalado — a aba Gestos não vai funcionar até rodar "npm install".');
    return;
  }
  fs.mkdirSync(path.join(MP_DIR, 'wasm'), { recursive: true });
  fs.copyFileSync(path.join(pkg, 'vision_bundle.mjs'), path.join(MP_DIR, 'vision_bundle.mjs'));
  for (const f of fs.readdirSync(path.join(pkg, 'wasm'))) fs.copyFileSync(path.join(pkg, 'wasm', f), path.join(MP_DIR, 'wasm', f));
  console.log('[vendor] MediaPipe copiado para src/vendor/mediapipe');
}

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    require('node:https').get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) { res.resume(); return resolve(download(res.headers.location, dest, redirects - 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      const tmp = dest + '.part';
      const f = fs.createWriteStream(tmp);
      res.pipe(f);
      f.on('finish', () => f.close(() => { fs.renameSync(tmp, dest); resolve(); }));
      f.on('error', reject);
    }).on('error', reject);
  });
}

async function mediapipe() {
  try { copyMediapipe(); } catch (e) { console.warn('[vendor] MediaPipe: ' + e.message); }
  if (fs.existsSync(MP_MODEL)) return;
  try {
    fs.mkdirSync(MP_DIR, { recursive: true });
    console.log('[vendor] baixando o modelo da mão (~8 MB)...');
    await download(MP_URL, MP_MODEL);
    console.log('[vendor] modelo da mão pronto');
  } catch (e) {
    console.warn('[vendor] aviso: não consegui baixar o modelo da mão (' + e.message + '). Rode "npm run vendor" com internet, ou baixe ' + MP_URL + ' e salve em src/vendor/mediapipe/hand_landmarker.task');
  }
}
mediapipe();
