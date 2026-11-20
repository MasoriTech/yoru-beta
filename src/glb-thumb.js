// Extrai a miniatura embutida em um arquivo .vrm / .glb (VRM 0.x e 1.0).
// Devolve { mime, data: Buffer } ou null quando o modelo não traz miniatura.
const MAX_JSON = 8 * 1024 * 1024;

function thumbnailOf(buf) {
  try {
    if (!Buffer.isBuffer(buf) || buf.length < 20 || buf.toString('latin1', 0, 4) !== 'glTF') return null;
    let off = 12, json = null, bin = null;
    while (off + 8 <= buf.length) {
      const len = buf.readUInt32LE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      const start = off + 8, end = start + len;
      if (end > buf.length) return null;
      if (type === 'JSON') { if (len > MAX_JSON) return null; json = JSON.parse(buf.toString('utf8', start, end)); }
      else if (type.startsWith('BIN')) bin = buf.subarray(start, end);
      off = end + ((4 - (len % 4)) % 4);
    }
    if (!json || !bin) return null;
    const ext = json.extensions || {};
    let imageIdx = null;
    const v1 = ext.VRMC_vrm && ext.VRMC_vrm.meta;
    const v0 = ext.VRM && ext.VRM.meta;
    if (v1 && Number.isInteger(v1.thumbnailImage)) imageIdx = v1.thumbnailImage;
    else if (v0 && Number.isInteger(v0.texture) && v0.texture >= 0) {
      const tex = (json.textures || [])[v0.texture];
      if (tex && Number.isInteger(tex.source)) imageIdx = tex.source;
    }
    const img = imageIdx != null ? (json.images || [])[imageIdx] : null;
    if (!img || !Number.isInteger(img.bufferView)) return null;
    const bv = (json.bufferViews || [])[img.bufferView];
    if (!bv) return null;
    const s = bv.byteOffset || 0, e = s + bv.byteLength;
    if (!(bv.byteLength > 0) || e > bin.length) return null;
    return { mime: img.mimeType || 'image/png', data: Buffer.from(bin.subarray(s, e)) };
  } catch (_) {
    return null;
  }
}

module.exports = { thumbnailOf };
