'use strict';
// Arquivos enviados no chat: texto/código entram como texto na mensagem; imagens e PDF vão como mídia.
// Funções puras (sem Electron) para poderem ser testadas com `npm test`.

const MAX_FILES = 5;
const MAX_TEXT_CHARS = 30000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // limite da API da Anthropic por imagem
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'xml', 'html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx',
  'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'sh', 'bat', 'ps1', 'sql', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'env', 'log', 'tex', 'srt', 'vtt', 'rtf', 'kt', 'swift', 'lua', 'r', 'vue', 'svelte', 'gitignore']);
const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

const extOf = (name) => (String(name).match(/\.([A-Za-z0-9]+)$/) || [, ''])[1].toLowerCase();
const safeName = (n) => String(n || 'arquivo').replace(/[\r\n`]/g, ' ').slice(0, 120);

// 'image' | 'pdf' | 'text' | null (formato não suportado)
function classify(name, mime) {
  const e = extOf(name);
  if (IMAGE_MIME[e] || /^image\/(png|jpeg|gif|webp)$/.test(mime || '')) return 'image';
  if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (TEXT_EXT.has(e) || /^text\//.test(mime || '') || (!e && /^text/.test(mime || ''))) return 'text';
  return null;
}

const rawBytes = (b64) => Math.floor((b64.length * 3) / 4);
const mb = (n) => Math.round(n / 1048576);

/**
 * files: [{ name, mime, b64 }]   provider: 'anthropic' | 'openrouter' | 'ollama' | 'custom'
 * Devolve { text, media:[{kind,name,mime,b64}], names, errors }.
 * `text` é o que se acrescenta à mensagem (conteúdo dos arquivos de texto + aviso dos anexos de mídia).
 */
function prepare(files, provider) {
  const out = { text: '', media: [], names: [], errors: [] };
  if (!Array.isArray(files)) return out;
  if (files.length > MAX_FILES) out.errors.push(`Máximo de ${MAX_FILES} arquivos por mensagem; os demais foram ignorados.`);
  for (const f of files.slice(0, MAX_FILES)) {
    const name = safeName(f && f.name);
    const b64 = f && typeof f.b64 === 'string' ? f.b64 : '';
    if (!b64) { out.errors.push(`${name}: arquivo vazio.`); continue; }
    const kind = classify(name, f.mime);
    if (!kind) { out.errors.push(`${name}: formato não suportado (use texto, código, imagem ou PDF).`); continue; }
    const size = rawBytes(b64);
    if (kind === 'image') {
      if (size > MAX_IMAGE_BYTES) { out.errors.push(`${name}: imagem maior que ${mb(MAX_IMAGE_BYTES)} MB.`); continue; }
      const mime = IMAGE_MIME[extOf(name)] || f.mime;
      out.media.push({ kind, name, mime, b64 });
      out.names.push(name);
      out.text += `\n[imagem anexada: ${name}]`;
    } else if (kind === 'pdf') {
      if (provider !== 'anthropic' && provider !== 'openrouter') { out.errors.push(`${name}: PDF só funciona com a Anthropic ou o OpenRouter. Com outros provedores, envie o texto (.txt) ou prints como imagem.`); continue; }
      if (size > MAX_PDF_BYTES) { out.errors.push(`${name}: PDF maior que ${mb(MAX_PDF_BYTES)} MB.`); continue; }
      out.media.push({ kind, name, mime: 'application/pdf', b64 });
      out.names.push(name);
      out.text += `\n[PDF anexado: ${name}]`;
    } else {
      if (size > MAX_TEXT_BYTES) { out.errors.push(`${name}: arquivo de texto maior que ${mb(MAX_TEXT_BYTES)} MB.`); continue; }
      const buf = Buffer.from(b64, 'base64');
      if (buf.subarray(0, 4096).includes(0)) { out.errors.push(`${name}: não parece um arquivo de texto.`); continue; }
      let t = buf.toString('utf8').replace(/^﻿/, '');
      const cut = t.length > MAX_TEXT_CHARS;
      if (cut) t = t.slice(0, MAX_TEXT_CHARS);
      out.text += `\n\n[arquivo: ${name}${cut ? ` (primeiros ${MAX_TEXT_CHARS} caracteres)` : ''}]\n\`\`\`\n${t}\n\`\`\``;
      out.names.push(name);
    }
  }
  return out;
}

// mensagem do usuário com mídia, no formato de cada provedor
function mediaMessage(provider, text, media) {
  if (!media.length) return { role: 'user', content: text };
  if (provider === 'anthropic') {
    return {
      role: 'user',
      content: [
        ...media.map((m) => m.kind === 'pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: m.b64 } }
          : { type: 'image', source: { type: 'base64', media_type: m.mime, data: m.b64 } }),
        { type: 'text', text },
      ],
    };
  }
  if (provider === 'ollama') return { role: 'user', content: text, images: media.map((m) => m.b64) };
  return { // openrouter / servidor local (formato OpenAI). PDF só no OpenRouter: parte "file" (lida pelo plugin file-parser, ver openrouter.js)
    role: 'user',
    content: [{ type: 'text', text }, ...media.map((m) => (m.kind === 'pdf'
      ? { type: 'file', file: { filename: m.name, file_data: `data:application/pdf;base64,${m.b64}` } }
      : { type: 'image_url', image_url: { url: `data:${m.mime};base64,${m.b64}` } }))],
  };
}

module.exports = { MAX_FILES, MAX_TEXT_CHARS, classify, prepare, mediaMessage };
