'use strict';
// Gerador de QR Code sem dependências (ISO/IEC 18004): modo byte (UTF-8), versões 1–40, níveis L/M/Q/H.
// Uso: YoruQR.encode(texto, { ecl: 'M' }) -> { version, size, modules }  |  YoruQR.toSvg(texto, opções)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YoruQR = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const ECL = { L: 0, M: 1, Q: 2, H: 3 };
  const FORMAT_BITS = [1, 0, 3, 2];
  const ECC_PER_BLOCK = [
    [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  ];
  const NUM_BLOCKS = [
    [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
  ];

  const bit = (x, i) => ((x >>> i) & 1) !== 0;

  function rawDataModules(ver) {
    let r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; if (ver >= 7) r -= 36; }
    return r;
  }
  const dataCodewords = (ver, e) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[e][ver] * NUM_BLOCKS[e][ver];

  function alignmentPositions(ver) {
    if (ver === 1) return [];
    const n = Math.floor(ver / 7) + 2, size = ver * 4 + 17;
    const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    const r = [6];
    for (let pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  // ----- Reed–Solomon em GF(256), polinômio 0x11D -----
  function gfMul(x, y) { let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z; }
  function rsDivisor(degree) {
    const r = new Array(degree).fill(0); r[degree - 1] = 1; let root = 1;
    for (let i = 0; i < degree; i++) { for (let j = 0; j < degree; j++) { r[j] = gfMul(r[j], root); if (j + 1 < degree) r[j] ^= r[j + 1]; } root = gfMul(root, 2); }
    return r;
  }
  function rsRemainder(data, divisor) {
    const r = new Array(divisor.length).fill(0);
    for (const b of data) { const factor = b ^ r.shift(); r.push(0); divisor.forEach((c, i) => { r[i] ^= gfMul(c, factor); }); }
    return r;
  }

  function utf8(text) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(text));
    return Array.from(Buffer.from(text, 'utf8'));
  }

  function encodeData(bytes, ver, e) {
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4); push(bytes.length, ver <= 9 ? 8 : 16); bytes.forEach((b) => push(b, 8));
    const cap = dataCodewords(ver, e) * 8;
    push(0, Math.min(4, cap - bits.length)); push(0, (8 - (bits.length % 8)) % 8);
    const out = [];
    for (let i = 0; i < bits.length; i += 8) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j]; out.push(v); }
    for (let pad = 0xec; out.length < cap / 8; pad ^= 0xec ^ 0x11) out.push(pad);
    return out;
  }

  function addEccAndInterleave(data, ver, e) {
    const nb = NUM_BLOCKS[e][ver], eccLen = ECC_PER_BLOCK[e][ver], raw = Math.floor(rawDataModules(ver) / 8);
    const shortBlocks = nb - (raw % nb), shortLen = Math.floor(raw / nb), div = rsDivisor(eccLen), blocks = [];
    for (let i = 0, k = 0; i < nb; i++) {
      const len = shortLen - eccLen + (i < shortBlocks ? 0 : 1), dat = data.slice(k, k + len); k += len;
      const ecc = rsRemainder(dat, div); if (i < shortBlocks) dat.push(0); blocks.push(dat.concat(ecc));
    }
    const out = [];
    for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= shortBlocks) out.push(b[i]); });
    return out;
  }

  function buildMatrix(codewords, ver, e, forcedMask) {
    const size = ver * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(false));
    const fn = Array.from({ length: size }, () => new Array(size).fill(false));
    const setFn = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };
    for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
    const finder = (cx, cy) => { for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)), x = cx + dx, y = cy + dy; if (x >= 0 && x < size && y >= 0 && y < size) setFn(x, y, d !== 2 && d !== 4); } };
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    const ap = alignmentPositions(ver), n = ap.length;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
    const drawFormat = (mask) => {
      const data = (FORMAT_BITS[e] << 3) | mask; let rem = data;
      for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      const bits = ((data << 10) | rem) ^ 0x5412;
      for (let i = 0; i <= 5; i++) setFn(8, i, bit(bits, i));
      setFn(8, 7, bit(bits, 6)); setFn(8, 8, bit(bits, 7)); setFn(7, 8, bit(bits, 8));
      for (let i = 9; i < 15; i++) setFn(14 - i, 8, bit(bits, i));
      for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, bit(bits, i));
      for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, bit(bits, i));
      setFn(8, size - 8, true);
    };
    drawFormat(0);
    if (ver >= 7) {
      let rem = ver; for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
      const bits = (ver << 12) | rem;
      for (let i = 0; i < 18; i++) { const b = bit(bits, i), a = size - 11 + (i % 3), c = Math.floor(i / 3); setFn(a, c, b); setFn(c, a, b); }
    }
    let idx = 0;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) for (let j = 0; j < 2; j++) {
        const x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - vert : vert;
        if (!fn[y][x] && idx < codewords.length * 8) { m[y][x] = bit(codewords[idx >>> 3], 7 - (idx & 7)); idx++; }
      }
    }
    const applyMask = (mask) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let inv;
        switch (mask) {
          case 0: inv = (x + y) % 2 === 0; break; case 1: inv = y % 2 === 0; break; case 2: inv = x % 3 === 0; break; case 3: inv = (x + y) % 3 === 0; break;
          case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break; case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break; default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
        }
        if (!fn[y][x] && inv) m[y][x] = !m[y][x];
      }
    };
    const penalty = () => {
      let p = 0, dark = 0;
      const line = (get) => {
        let run = 1, hist = '';
        for (let i = 0; i < size; i++) {
          const v = get(i); hist += v ? '1' : '0';
          if (i > 0) { if (v === get(i - 1)) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
        }
        for (const pat of ['10111010000', '00001011101']) { let from = 0, at; while ((at = hist.indexOf(pat, from)) !== -1) { p += 40; from = at + 1; } }
      };
      for (let y = 0; y < size; y++) { line((i) => m[y][i]); for (let x = 0; x < size; x++) if (m[y][x]) dark++; }
      for (let x = 0; x < size; x++) line((i) => m[i][x]);
      for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) { const c = m[y][x]; if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3; }
      const total = size * size; p += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
      return p;
    };
    let best = 0, bestPen = Infinity;
    for (let mask = 0; mask < 8; mask++) { applyMask(mask); drawFormat(mask); const p = penalty(); if (p < bestPen) { bestPen = p; best = mask; } applyMask(mask); }
    if (forcedMask >= 0 && forcedMask <= 7) best = forcedMask;
    applyMask(best); drawFormat(best);
    return { size, modules: m, mask: best };
  }

  function encode(text, options = {}) {
    const e = ECL[String(options.ecl || 'M').toUpperCase()];
    if (e === undefined) throw new Error('Nível de correção inválido (use L, M, Q ou H).');
    const bytes = utf8(String(text));
    let ver = 0;
    for (let v = options.minVersion || 1; v <= 40; v++) { const cc = v <= 9 ? 8 : 16; if (4 + cc + bytes.length * 8 <= dataCodewords(v, e) * 8) { ver = v; break; } }
    if (!ver) throw new Error('Texto longo demais para um QR Code neste nível de correção.');
    const codewords = addEccAndInterleave(encodeData(bytes, ver, e), ver, e);
    const { size, modules, mask } = buildMatrix(codewords, ver, e, options.mask);
    return { version: ver, size, modules, mask, ecl: Object.keys(ECL)[e], bytes: bytes.length };
  }

  function toSvg(text, options = {}) {
    const qr = encode(text, options), border = options.border == null ? 4 : options.border, dark = options.dark || '#000', light = options.light || '#fff';
    const dim = qr.size + border * 2; let d = '';
    for (let y = 0; y < qr.size; y++) { let x = 0; while (x < qr.size) { if (!qr.modules[y][x]) { x++; continue; } let w = 1; while (x + w < qr.size && qr.modules[y][x + w]) w++; d += `M${x + border},${y + border}h${w}v1h-${w}z`; x += w; } }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
  }

  // Carga útil de Wi-Fi no formato lido pelas câmeras (Android e iOS).
  const wifiEscape = (s) => String(s).replace(/([\\;,:"])/g, '\\$1');
  function wifiPayload({ ssid, password = '', security = 'WPA', hidden = false }) {
    if (!String(ssid || '').trim()) throw new Error('Informe o nome da rede (SSID).');
    const t = security === 'nopass' ? 'nopass' : security === 'WEP' ? 'WEP' : 'WPA';
    return `WIFI:T:${t};S:${wifiEscape(ssid)};${t === 'nopass' ? '' : `P:${wifiEscape(password)};`}H:${hidden ? 'true' : 'false'};;`;
  }

  return { encode, toSvg, wifiPayload, ECL: Object.keys(ECL) };
});
