'use strict';
// O que a Yoru fala em voz alta (sem Electron, para testar com `npm test`): limpa o texto (markdown, emojis,
// links, código, ações entre asteriscos), aplica o dicionário de pronúncia e limita respostas muito longas.
// Arquivo único para os dois mundos: no Node (`npm test`) sai por module.exports; no navegador, carregado por um <script>
// comum no index.html, vira globalThis.YoruSpeech e o renderer.js usa de lá. Sem cópia.

// "palavra = como falar", uma por linha (também vale "=>"). Linhas vazias e as que começam com # são ignoradas.
function parsePronunciations(text) {
  const rules = [];
  for (const line of String(text || '').split(/\r?\n/).slice(0, 200)) {
    const m = line.match(/^\s*([^=#][^=]*?)\s*(?:=>|=)\s*(.+?)\s*$/);
    if (!m) continue;
    const from = m[1].trim(), to = m[2].trim();
    if (!from || from.length > 40 || to.length > 80) continue;
    const esc = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rules.push({ re: new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), to });
    if (rules.length >= 100) break;
  }
  return rules;
}

// o: { skipCode (padrão ligado), skipActions, rules }
function cleanForSpeech(text, o = {}) {
  let s = String(text || '');
  if (o.skipCode !== false) s = s.replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ');
  if (o.skipActions) s = s.replace(/\*[^*\n]{1,80}\*/g, ' ');
  for (const r of o.rules || []) s = s.replace(r.re, () => r.to);
  return s.replace(/[*_`#~]/g, '').replace(/\p{Extended_Pictographic}/gu, '').replace(/\s+/g, ' ').trim();
}

// corta no fim de uma frase antes de `max` caracteres (0 = sem limite)
function limitSpeech(text, max) {
  max = Number(max) || 0;
  if (!max || text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('…'));
  if (end >= max * 0.4) return cut.slice(0, end + 1).trim();
  const sp = cut.lastIndexOf(' ');
  return (sp > 0 ? cut.slice(0, sp) : cut).trim();
}

const speechExports = { parsePronunciations, cleanForSpeech, limitSpeech };
// sempre publica no global (o renderer lê de lá); no Node também exporta para o `npm test`
globalThis.YoruSpeech = speechExports;
if (typeof module !== 'undefined' && module.exports) module.exports = speechExports;
