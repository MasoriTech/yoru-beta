'use strict';
// Conversa salva em disco: histórico enviado à IA + as últimas mensagens mostradas no chat.
// Sem Electron: o arquivo e as opções chegam por parâmetro.
const fs = require('fs');
const { writeAtomic, createDebouncedSaver } = require('./store');

const CHAT_KEEP = 100;

// ai: { getHistory, setHistory } | chatBuf: array compartilhado com o app | file(): caminho | enabled(): "guardar conversa" ligado?
function createChatStore({ ai, chatBuf, file, enabled = () => true, delay = 600 }) {
  const saver = createDebouncedSaver(() => {
    writeAtomic(file(), JSON.stringify({ history: ai.getHistory(), chat: chatBuf }));
  }, { delay, enabled });

  function load() {
    if (!enabled()) return false;
    try {
      const j = JSON.parse(fs.readFileSync(file(), 'utf8'));
      ai.setHistory(j.history);
      if (Array.isArray(j.chat)) {
        const c = j.chat.filter((e) => e && typeof e.text === 'string' && ['user', 'assistant', 'error'].includes(e.role)).slice(-CHAT_KEEP);
        while (c.length && c[c.length - 1].role === 'user') c.pop(); // pergunta que ficou sem resposta
        chatBuf.push(...c);
      }
      return true;
    } catch (_) { return false; }
  }

  return { persist: saver.save, writeNow: saver.flush, load, get pending() { return saver.pending; } };
}

module.exports = { createChatStore, CHAT_KEEP };
