'use strict';
// Vários testes conferem, lendo o código, que painel, preload e processo principal estão ligados entre si.
// O "processo principal" agora é o main.js mais os módulos que saíram dele: este ajudante junta tudo num texto só.
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', '..', 'src');
const MAIN_PARTS = ['main.js', 'settings.js', 'library.js', 'ai-core.js', 'store.js', 'chat-store.js', 'criacao-service.js', 'motion.js', 'neural-tts.js', 'windows.js', 'movement.js', 'system-stats.js', 'ipc-criacao.js', 'ipc-library.js', 'ipc-ia.js'];

module.exports = () => MAIN_PARTS.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
