'use strict';
// Gerador de QR Code (src/qr.js). A saída foi validada com um decodificador independente (OpenCV) em todas
// as versões 1–40 e níveis L/M/Q/H; aqui ficam as verificações estruturais e um vetor de regressão.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const QR = require('../src/qr.js');

const flat = (r) => r.modules.map((row) => row.map(Number).join('')).join('');

test('tamanho segue a versão (17 + 4·v) e a versão cresce com o texto', () => {
  const a = QR.encode('a'), b = QR.encode('a'.repeat(100)), c = QR.encode('a'.repeat(1000));
  assert.equal(a.version, 1); assert.equal(a.size, 21);
  assert.ok(b.version > a.version && c.version > b.version);
  for (const r of [a, b, c]) { assert.equal(r.size, 17 + 4 * r.version); assert.equal(r.modules.length, r.size); }
});

test('padrões de localização, sincronismo e módulo escuro', () => {
  const r = QR.encode('Yoru', { ecl: 'Q' }), m = r.modules, n = r.size;
  const finder = (x0, y0) => { for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++) { const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6, core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4; assert.equal(m[y0 + dy][x0 + dx], edge || core, `finder ${x0},${y0} ${dx},${dy}`); } };
  finder(0, 0); finder(n - 7, 0); finder(0, n - 7);
  for (let i = 8; i < n - 8; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); }
  assert.equal(m[n - 8][8], true);
});

test('informação de formato lida na matriz é um código BCH válido e traz nível e máscara', () => {
  for (const ecl of ['L', 'M', 'Q', 'H']) for (const mask of [0, 3, 7]) {
    const r = QR.encode('teste', { ecl, mask }), m = r.modules;
    let bits = 0; for (let i = 0; i < 15; i++) { const [x, y] = i <= 5 ? [8, i] : i === 6 ? [8, 7] : i === 7 ? [8, 8] : i === 8 ? [7, 8] : [14 - i, 8]; if (m[y][x]) bits |= 1 << i; }
    const v = bits ^ 0x5412; let rem = v; for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
    assert.equal(rem & 0x3ff, 0, `BCH ${ecl}${mask}`);
    assert.equal((v >>> 13) & 3, { L: 1, M: 0, Q: 3, H: 2 }[ecl]); assert.equal((v >>> 10) & 7, mask);
  }
});

test('saída determinística e vetor de regressão (validado por decodificador externo)', () => {
  const url = 'http://192.168.1.5:8080/?token=abc123';
  const r = QR.encode(url, { ecl: 'M' });
  assert.equal(r.version, 3); assert.equal(r.size, 29);
  assert.equal(crypto.createHash('sha256').update(flat(r)).digest('hex'), '0e090316647b42fb071c1bd3399c81bf9130f0c4c2f8a20b30f0cf4e09655b53');
  assert.equal(flat(QR.encode(url, { ecl: 'M' })), flat(r));
});

test('UTF-8 conta bytes, e nível de correção maior exige versão igual ou maior', () => {
  assert.equal(QR.encode('😀').bytes, 4); assert.equal(QR.encode('açaí').bytes, 6);
  const t = 'x'.repeat(200);
  assert.ok(QR.encode(t, { ecl: 'H' }).version > QR.encode(t, { ecl: 'L' }).version);
});

test('limites: texto grande demais e nível inválido geram erro claro', () => {
  assert.equal(QR.encode('a'.repeat(2331), { ecl: 'M' }).version, 40);
  assert.throws(() => QR.encode('a'.repeat(2332), { ecl: 'M' }), /longo demais/);
  assert.throws(() => QR.encode('a', { ecl: 'Z' }), /inválido/);
});

test('SVG válido e Wi-Fi com escape dos caracteres especiais', () => {
  const svg = QR.toSvg('oi', { border: 2 });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 25 25"/); assert.match(svg, /<path d="M/);
  assert.equal(QR.wifiPayload({ ssid: 'Casa;Wi:Fi', password: 'se,nha"1\\', security: 'WPA' }), 'WIFI:T:WPA;S:Casa\\;Wi\\:Fi;P:se\\,nha\\"1\\\\;H:false;;');
  assert.equal(QR.wifiPayload({ ssid: 'Aberta', security: 'nopass', hidden: true }), 'WIFI:T:nopass;S:Aberta;H:true;;');
  assert.throws(() => QR.wifiPayload({ ssid: '  ' }), /SSID/);
});

test('aba Conectividade carrega qr.js antes do painel e tem os controles do gerador', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'panel.html'), 'utf8');
  assert.ok(html.indexOf('./qr.js') !== -1 && html.indexOf('./qr.js') < html.indexOf('./panel-hub.js'));
  for (const id of ['hubQrKind', 'hubQrEcl', 'hubQrText', 'hubQrSsid', 'hubQrPass', 'hubQrOut', 'hubQrPng', 'hubQrSvg', 'hubQrCopy']) assert.match(html, new RegExp(`id="${id}"`), id);
});
