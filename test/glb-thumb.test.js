const test = require('node:test');
const assert = require('node:assert/strict');
const { thumbnailOf } = require('../src/glb-thumb');

function glb(json, bin) {
  const pad = (b, fill) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, fill)]);
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20);
  const b = pad(bin, 0);
  const head = Buffer.alloc(12);
  head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + b.length, 8);
  const ch = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32LE(data.length, 0); h.write(type, 4, 'latin1'); return Buffer.concat([h, data]); };
  return Buffer.concat([head, ch('JSON', j), ch('BIN\0', b)]);
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const bin = Buffer.concat([Buffer.alloc(8, 9), PNG]);
const base = { bufferViews: [{ buffer: 0, byteOffset: 8, byteLength: PNG.length }], images: [{ bufferView: 0, mimeType: 'image/png' }] };

test('VRM 1.0: lê thumbnailImage', () => {
  const r = thumbnailOf(glb({ ...base, extensions: { VRMC_vrm: { meta: { thumbnailImage: 0 } } } }, bin));
  assert.equal(r.mime, 'image/png');
  assert.deepEqual([...r.data], [...PNG]);
});

test('VRM 0.x: lê meta.texture -> textures -> images', () => {
  const r = thumbnailOf(glb({ ...base, textures: [{ source: 0 }], extensions: { VRM: { meta: { texture: 0 } } } }, bin));
  assert.deepEqual([...r.data], [...PNG]);
});

test('sem miniatura, arquivo inválido ou truncado: null', () => {
  assert.equal(thumbnailOf(glb({ ...base }, bin)), null);
  assert.equal(thumbnailOf(Buffer.from('nao e glb')), null);
  assert.equal(thumbnailOf(null), null);
  const bad = glb({ ...base, extensions: { VRMC_vrm: { meta: { thumbnailImage: 0 } } }, bufferViews: [{ buffer: 0, byteOffset: 8, byteLength: 9999 }] }, bin);
  assert.equal(thumbnailOf(bad), null);
  assert.equal(thumbnailOf(glb({ ...base, extensions: { VRMC_vrm: { meta: { thumbnailImage: 0 } } } }, bin).subarray(0, 40)), null);
});
