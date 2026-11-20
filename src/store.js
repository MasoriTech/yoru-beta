'use strict';
// Gravação segura em disco: arquivo temporário + rename (uma queda de energia no meio não corrompe o original)
// e um "salvador" com atraso, para juntar várias alterações seguidas numa gravação só.
const fs = require('fs');

function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

// write(): faz a gravação de fato | enabled(): false = não grava nada (ex.: "guardar conversa" desligado)
function createDebouncedSaver(write, { delay = 200, enabled = () => true, setTimeout: st = setTimeout, clearTimeout: ct = clearTimeout } = {}) {
  let timer = null;
  const run = () => { ct(timer); timer = null; try { write(); } catch (_) {} };
  return {
    save() { if (!enabled()) return; ct(timer); timer = st(run, delay); },
    flush() { ct(timer); timer = null; if (!enabled()) return; try { write(); } catch (_) {} },
    get pending() { return timer !== null; },
  };
}

module.exports = { writeAtomic, createDebouncedSaver };
