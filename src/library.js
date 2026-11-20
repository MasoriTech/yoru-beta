'use strict';
// Biblioteca de avatares e itens (arquivos .vrm / .glb na pasta de dados do usuário).
// Sem Electron: quem chama diz onde ficam os dados (userDataDir) e os modelos que vêm no projeto (assetsDir).
const fs = require('fs');
const path = require('path');

const LIB_MAX_BYTES = 300 * 1024 * 1024; // modelos maiores que isso travariam o app
const LIB_NAME = /^[\w\-. ()]{1,120}$/;
const LIB = {
  avatars: { dir: 'avatars', ext: /\.(vrm|glb)$/i, label: 'Modelos 3D (.vrm, .glb)', exts: ['vrm', 'glb'] },
  items: { dir: 'items', ext: /\.glb$/i, label: 'Modelos 3D (.glb)', exts: ['glb'] },
};

// userDataDir: () => pasta de dados do app | assetsDir: pasta assets do projeto
function createLibrary({ userDataDir, assetsDir }) {
  function libDir(kind) {
    const d = path.join(userDataDir(), LIB[kind].dir);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  function libList(kind) {
    try {
      const dir = libDir(kind);
      return fs.readdirSync(dir).filter((f) => LIB[kind].ext.test(f)).map((f) => ({
        id: f,
        name: f.replace(/\.[^.]+$/, '').replace(/_/g, ' '),
        ext: path.extname(f).slice(1).toLowerCase(),
        mb: Math.round(fs.statSync(path.join(dir, f)).size / 1e5) / 10,
      })).sort((a, b) => a.name.localeCompare(b.name));
    } catch (_) { return []; }
  }
  // Modelos que já vêm no projeto (assets/library/avatars e /items): copiados para a biblioteca do usuário
  // na primeira execução. O que o usuário remover depois não volta (guardamos o que já foi copiado).
  function libSeed() {
    try {
      const mark = path.join(userDataDir(), 'library-seeded.json');
      let done = [];
      try { done = JSON.parse(fs.readFileSync(mark, 'utf8')); } catch (_) {}
      if (!Array.isArray(done)) done = [];
      let changed = false;
      for (const kind of ['avatars', 'items']) {
        const src = path.join(assetsDir, 'library', kind);
        let files = [];
        try { files = fs.readdirSync(src).filter((f) => LIB[kind].ext.test(f) && LIB_NAME.test(f)); } catch (_) { continue; }
        for (const f of files) {
          const key = kind + '/' + f;
          if (done.includes(key)) continue;
          const dest = path.join(libDir(kind), f);
          if (!fs.existsSync(dest)) fs.copyFileSync(path.join(src, f), dest);
          done.push(key); changed = true;
        }
      }
      if (changed) fs.writeFileSync(mark, JSON.stringify(done));
    } catch (_) { /* biblioteca é opcional: o app abre mesmo assim */ }
  }
  const libAll = () => ({ avatars: libList('avatars'), items: libList('items') });
  function libPath(kind, id) {
    if (!LIB[kind] || typeof id !== 'string' || !LIB_NAME.test(id) || !LIB[kind].ext.test(id)) return null;
    const p = path.join(libDir(kind), id);
    return fs.existsSync(p) ? p : null;
  }
  return { libDir, libList, libSeed, libAll, libPath };
}

function uniqueName(dir, base) {
  const ext = path.extname(base);
  const stem = base.slice(0, base.length - ext.length).replace(/[^\w\-. ()]/g, '_').slice(0, 80) || 'modelo';
  let name = stem + ext.toLowerCase(), n = 2;
  while (fs.existsSync(path.join(dir, name))) name = `${stem} (${n++})${ext.toLowerCase()}`;
  return name;
}

module.exports = { LIB_MAX_BYTES, LIB_NAME, LIB, createLibrary, uniqueName };
