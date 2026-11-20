'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../src/attachments');

const b64 = (s) => Buffer.from(s).toString('base64');

test('classify reconhece texto, imagem, PDF e recusa o resto', () => {
  assert.equal(A.classify('nota.txt', ''), 'text');
  assert.equal(A.classify('app.py', ''), 'text');
  assert.equal(A.classify('foto.JPG', ''), 'image');
  assert.equal(A.classify('x', 'image/png'), 'image');
  assert.equal(A.classify('doc.pdf', ''), 'pdf');
  assert.equal(A.classify('musica.mp3', 'audio/mpeg'), null);
  assert.equal(A.classify('setup.exe', ''), null);
});

test('prepare: arquivo de texto entra na mensagem entre cercas', () => {
  const r = A.prepare([{ name: 'a.md', mime: '', b64: b64('# Oi\nmundo') }], 'anthropic');
  assert.match(r.text, /\[arquivo: a\.md\]/);
  assert.match(r.text, /# Oi\nmundo/);
  assert.equal(r.media.length, 0);
  assert.deepEqual(r.names, ['a.md']);
});

test('prepare: texto grande é cortado e binário é recusado', () => {
  const big = A.prepare([{ name: 'g.txt', mime: '', b64: b64('x'.repeat(A.MAX_TEXT_CHARS + 50)) }], 'ollama');
  assert.match(big.text, /primeiros/);
  const bin = A.prepare([{ name: 'b.txt', mime: '', b64: Buffer.from([65, 0, 66]).toString('base64') }], 'ollama');
  assert.equal(bin.errors.length, 1);
  assert.equal(bin.names.length, 0);
});

test('prepare: PDF só com Anthropic; imagem vira mídia; formato errado dá erro', () => {
  const pdf = { name: 'r.pdf', mime: 'application/pdf', b64: b64('%PDF-1.4') };
  assert.equal(A.prepare([pdf], 'anthropic').media[0].kind, 'pdf');
  assert.match(A.prepare([pdf], 'ollama').errors[0], /Anthropic/);
  const img = A.prepare([{ name: 'p.png', mime: 'image/png', b64: b64('PNGDATA') }], 'custom');
  assert.equal(img.media[0].mime, 'image/png');
  assert.match(img.text, /imagem anexada: p\.png/);
  assert.match(A.prepare([{ name: 'a.exe', mime: '', b64: b64('MZ') }], 'anthropic').errors[0], /não suportado/);
});

test('prepare: limite de arquivos e de tamanho de imagem', () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ name: `n${i}.txt`, mime: '', b64: b64('x') }));
  const r = A.prepare(many, 'anthropic');
  assert.equal(r.names.length, A.MAX_FILES);
  assert.equal(r.errors.length, 1);
  const huge = 'A'.repeat(8 * 1024 * 1024);
  assert.match(A.prepare([{ name: 'h.png', mime: '', b64: huge }], 'anthropic').errors[0], /maior/);
});

test('mediaMessage monta o formato de cada provedor', () => {
  const media = [{ kind: 'image', name: 'p.png', mime: 'image/png', b64: 'QUJD' }];
  const an = A.mediaMessage('anthropic', 'olha', media);
  assert.equal(an.content[0].type, 'image');
  assert.equal(an.content[1].text, 'olha');
  const oa = A.mediaMessage('openrouter', 'olha', media);
  assert.equal(oa.content[1].image_url.url, 'data:image/png;base64,QUJD');
  const ol = A.mediaMessage('ollama', 'olha', media);
  assert.deepEqual(ol.images, ['QUJD']);
  assert.equal(A.mediaMessage('anthropic', 'só texto', []).content, 'só texto');
  const doc = A.mediaMessage('anthropic', 'x', [{ kind: 'pdf', name: 'r.pdf', mime: 'application/pdf', b64: 'UERG' }]);
  assert.equal(doc.content[0].type, 'document');
});
