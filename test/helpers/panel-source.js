'use strict';
// O painel é o panel.html mais os scripts que ele carrega (panel-*.js, vad.js...). Vários testes conferem, lendo o código,
// que painel, preload e processo principal estão ligados: este ajudante junta o HTML e os scripts locais num texto só.
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');

module.exports = () => {
  const html = fs.readFileSync(path.join(SRC, 'panel.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="\.\/([\w.-]+\.js)"><\/script>/g)].map((m) => m[1]);
  return [html, ...scripts.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8'))].join('\n');
};
module.exports.scripts = () => [...fs.readFileSync(path.join(SRC, 'panel.html'), 'utf8').matchAll(/<script src="\.\/([\w.-]+\.js)"><\/script>/g)].map((m) => m[1]);
