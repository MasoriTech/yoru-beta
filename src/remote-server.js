'use strict';
// Servidor do app de celular (PWA) da Yoru. Roda dentro do processo principal e serve:
//   Modo 1 — usar a Yoru: conversar com ela pelo celular (precisa só do pareamento feito no PC).
//   Modo 2 — controlar o PC: exige a senha de controle (definida SÓ no PC) e uma sessão curta.
// Segurança (resumo):
//   • desligado por padrão; ao ligar, só aceita aparelhos pareados (QR/código gerado no PC, uso único);
//   • tokens aleatórios de 256 bits; no disco ficam só os hashes (SHA-256), nunca o token;
//   • senha de controle com scrypt + sal; comparação em tempo constante; bloqueio progressivo após erros;
//   • o controle usa uma lista FIXA de ações (volume, mídia, janelas, abrir programa, tela, energia) — nada de
//     comando livre — e desligar/reiniciar/suspender exigem confirmação explícita;
//   • cabeçalhos de segurança, checagem de Host/Origin (contra DNS rebinding/CSRF), corpo limitado e limites de taxa.
// Tudo que depende do Electron/Windows entra por injeção (chat, pc, captureScreen...), então dá para testar com `npm test`.

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const DEFAULT_PORT = 8787;
const MAX_DEVICES = 10;
const MAX_BODY = 16 * 1024;
const PAIR_TTL_MS = 10 * 60 * 1000;
const CONTROL_MAX_SESSION_MS = 4 * 60 * 60 * 1000;
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 96 * 1024 * 1024 };
const WEAK_PASSWORDS = new Set(['12345678', '123456789', '1234567890', '87654321', 'password', 'password1', 'senha123', 'senha1234', 'qwertyui', 'qwerty123', '11111111', '00000000', 'abcd1234', 'admin123', 'yoru1234']);

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/index.html': ['index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/app.css': ['app.css', 'text/css; charset=utf-8', 'no-cache'],
  '/sw.js': ['sw.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json; charset=utf-8', 'no-cache'],
  '/avatar3d.js': ['avatar3d.js', 'text/javascript; charset=utf-8', 'no-cache'],
  '/icon-192.png': ['icon-192.png', 'image/png', 'public, max-age=86400'],
  '/icon-512.png': ['icon-512.png', 'image/png', 'public, max-age=86400'],
  '/icon-maskable-512.png': ['icon-maskable-512.png', 'image/png', 'public, max-age=86400'],
  '/apple-touch-icon.png': ['apple-touch-icon.png', 'image/png', 'public, max-age=86400'],
  '/reactions/aguardando.webp': ['reactions/aguardando.webp', 'image/webp', 'public, max-age=86400'],
  '/reactions/ola.webp': ['reactions/ola.webp', 'image/webp', 'public, max-age=86400'],
  '/reactions/ouvindo.webp': ['reactions/ouvindo.webp', 'image/webp', 'public, max-age=86400'],
  '/reactions/processando.webp': ['reactions/processando.webp', 'image/webp', 'public, max-age=86400'],
  '/reactions/haha.webp': ['reactions/haha.webp', 'image/webp', 'public, max-age=86400'],
  '/reactions/ops.webp': ['reactions/ops.webp', 'image/webp', 'public, max-age=86400'],
};

// Bibliotecas 3D (as mesmas do avatar do PC), servidas só por esta lista fechada. O import "three" (nome solto) vira o caminho real,
// porque a CSP estrita não permite o importmap inline.
const VENDOR = new Set([
  'three/three.module.js', 'three/three.core.js', 'three/addons/loaders/GLTFLoader.js',
  'three/addons/utils/BufferGeometryUtils.js', 'three/addons/utils/SkeletonUtils.js', 'three-vrm/three-vrm.module.js',
]);
const BARE_THREE = /(\bfrom\s*)(['"])three\2/g;

const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest();
const safeEqual = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);
const token = () => crypto.randomBytes(32).toString('base64url');
const clean = (s, max, fallback) => {
  const v = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  return v || fallback;
};
const isHex = (s, n) => typeof s === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(s);

function scryptAsync(password, salt, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), salt, params.keylen || SCRYPT.keylen, { N: params.N, r: params.r, p: params.p, maxmem: SCRYPT.maxmem }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT);
  return { salt: salt.toString('hex'), hash: key.toString('hex'), N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p };
}
async function verifyPassword(password, rec) {
  try {
    if (!rec || !isHex(rec.salt, 32) || !/^[0-9a-f]{128}$/.test(rec.hash || '')) return false;
    const key = await scryptAsync(password, Buffer.from(rec.salt, 'hex'), { N: rec.N, r: rec.r, p: rec.p, keylen: 64 });
    return safeEqual(key, Buffer.from(rec.hash, 'hex'));
  } catch (_) { return false; }
}

function sanitizeConfig(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const port = Number(r.port);
  const ttl = Number(r.controlTtlMin);
  const c = r.control;
  const control = c && isHex(c.salt, 32) && /^[0-9a-f]{128}$/.test(c.hash || '') && [c.N, c.r, c.p].every((n) => Number.isInteger(n) && n > 0 && n <= 1 << 20)
    ? { salt: c.salt, hash: c.hash, N: c.N, r: c.r, p: c.p } : null;
  const devices = (Array.isArray(r.devices) ? r.devices : []).filter((d) => d && isHex(d.id, 16) && isHex(d.tokenHash, 64)).slice(0, MAX_DEVICES)
    .map((d) => ({ id: d.id, name: clean(d.name, 40, 'Celular'), tokenHash: d.tokenHash, createdAt: Number(d.createdAt) || 0, lastSeen: Number(d.lastSeen) || 0 }));
  return {
    enabled: r.enabled === true,
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT,
    lan: r.lan !== false,
    controlEnabled: r.controlEnabled === true,
    controlTtlMin: Number.isFinite(ttl) ? Math.max(1, Math.min(240, Math.round(ttl))) : 10,
    control,
    devices,
  };
}

function createRemoteServer({
  userDataDir, webDir, vendorDir = null, avatarModel = null, chat, pc = null, captureScreen = null, setVisible = null, isVisible = null,
  onEvent = () => {}, log = () => {}, version = '0', now = Date.now, networkInterfaces = os.networkInterfaces,
  allowedHosts = [], hashPw = hashPassword, verifyPw = verifyPassword,
} = {}) {
  const file = path.join(userDataDir, 'remote.json');
  let cfg;
  try { cfg = sanitizeConfig(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) { cfg = sanitizeConfig({}); }
  let server = null;
  let pairing = null; // { code, expires }
  let lastError = '';
  let chatBusy = false;
  const sessions = new Map(); // sha256(token) hex -> { deviceId, started, last }
  const buckets = new Map();
  const pairGuard = { fails: [], lockUntil: 0, level: 0 };
  const controlGuard = { fails: [], lockUntil: 0, level: 0 };

  const emit = (event) => { try { onEvent({ at: now(), ...event }); } catch (_) { /* observador não pode derrubar o servidor */ } };

  function save() {
    fs.mkdirSync(userDataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  // ---------- limites ----------
  function hit(key, limit, windowMs) {
    const t = now();
    let b = buckets.get(key);
    if (!b || t - b.start >= windowMs) b = { start: t, count: 0 };
    b.count += 1;
    buckets.set(key, b);
    if (buckets.size > 400) for (const [k, v] of buckets) if (t - v.start > 120000) buckets.delete(k);
    return b.count <= limit;
  }
  const lockedFor = (g) => (now() < g.lockUntil ? Math.ceil((g.lockUntil - now()) / 1000) : 0);
  function guardFail(g, max = 5) {
    const t = now();
    g.fails = g.fails.filter((x) => t - x < 15 * 60000);
    g.fails.push(t);
    if (g.fails.length >= max) { g.level += 1; g.lockUntil = t + Math.min(3600000, 60000 * 2 ** (g.level - 1)); g.fails = []; return true; }
    return false;
  }
  const guardOk = (g) => { g.fails = []; g.level = 0; g.lockUntil = 0; };

  // ---------- estado ----------
  const hasPassword = () => !!cfg.control;
  const controlAvailable = () => cfg.controlEnabled && hasPassword();
  function urls() {
    const out = [];
    let ifs = {};
    try { ifs = networkInterfaces() || {}; } catch (_) { /* sem rede */ }
    for (const [name, list] of Object.entries(ifs)) {
      for (const a of list || []) {
        if (a.family !== 'IPv4' || a.internal) continue;
        const o = a.address.split('.').map(Number);
        const tailscale = o[0] === 100 && o[1] >= 64 && o[1] <= 127;
        out.push({ url: `http://${a.address}:${cfg.port}`, label: tailscale ? 'Tailscale' : (name || 'Rede local'), tailscale });
      }
    }
    return out;
  }
  function status() {
    return {
      enabled: cfg.enabled, running: !!server, port: cfg.port, lan: cfg.lan, error: lastError,
      urls: server ? urls() : [],
      pairing: pairing && now() < pairing.expires ? { code: pairing.code, expiresAt: pairing.expires } : null,
      devices: cfg.devices.map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeen: d.lastSeen })),
      controlEnabled: cfg.controlEnabled, hasPassword: hasPassword(), controlTtlMin: cfg.controlTtlMin,
      activeSessions: sessions.size,
    };
  }
  function newPairing() {
    pairing = { code: String(crypto.randomInt(0, 100000000)).padStart(8, '0'), expires: now() + PAIR_TTL_MS };
    pairGuard.fails = [];
    return { code: pairing.code, expiresAt: pairing.expires };
  }
  const dropSessions = (deviceId) => { for (const [k, s] of sessions) if (!deviceId || s.deviceId === deviceId) sessions.delete(k); };

  // ---------- configuração (chamada pelo painel no PC) ----------
  async function configure(patch = {}) {
    const next = sanitizeConfig({ ...cfg, ...patch, control: cfg.control, devices: cfg.devices });
    const restart = !!server && (next.port !== cfg.port || next.lan !== cfg.lan);
    const sessionsOut = next.controlEnabled !== cfg.controlEnabled || next.controlTtlMin !== cfg.controlTtlMin;
    cfg = next;
    save();
    if (sessionsOut) dropSessions();
    if (!cfg.enabled && server) await stop();
    else if (cfg.enabled && (!server || restart)) { if (server) await stop(); await start(); }
    return status();
  }
  async function setPassword(password, confirm) {
    const pw = String(password == null ? '' : password);
    if (pw.length < 8) return { ok: false, error: 'A senha precisa ter pelo menos 8 caracteres.' };
    if (pw.length > 128) return { ok: false, error: 'A senha pode ter no máximo 128 caracteres.' };
    if (pw !== String(confirm == null ? '' : confirm)) return { ok: false, error: 'A confirmação da senha não confere.' };
    if (WEAK_PASSWORDS.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) return { ok: false, error: 'Essa senha é fácil demais de adivinhar. Escolha outra.' };
    cfg.control = await hashPw(pw);
    guardOk(controlGuard);
    dropSessions();
    save();
    emit({ type: 'password-set' });
    return { ok: true, status: status() };
  }
  function clearPassword() {
    cfg.control = null;
    cfg.controlEnabled = false;
    dropSessions();
    save();
    emit({ type: 'password-cleared' });
    return { ok: true, status: status() };
  }
  function revoke(id) {
    const i = cfg.devices.findIndex((d) => d.id === id);
    if (i < 0) return { ok: false, error: 'Aparelho não encontrado.' };
    const [d] = cfg.devices.splice(i, 1);
    dropSessions(d.id);
    save();
    emit({ type: 'revoked', device: d.name });
    return { ok: true, status: status() };
  }
  function revokeAll() { cfg.devices = []; dropSessions(); save(); emit({ type: 'revoked-all' }); return { ok: true, status: status() }; }

  // ---------- http ----------
  function secure(res) {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=()');
  }
  function json(res, code, body, extra = {}) {
    const data = Buffer.from(JSON.stringify(body));
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'no-store', ...extra });
    res.end(data);
  }
  const fail = (res, code, error, extra = {}) => json(res, code, { ok: false, error, ...extra }, extra.retryAfter ? { 'Retry-After': String(extra.retryAfter) } : {});

  function hostOk(req) {
    const h = String(req.headers.host || '').toLowerCase();
    const m = h.match(/^(\[[0-9a-f:.]+\]|[^:/\s]+)(?::\d{1,5})?$/);
    if (!m) return false;
    const host = m[1];
    if (host.startsWith('[') || net.isIPv4(host) || host === 'localhost') return true;
    if (host.endsWith('.ts.net') || host.endsWith('.local') || !host.includes('.')) return true;
    return allowedHosts.includes(host);
  }
  function originOk(req) {
    const o = req.headers.origin;
    if (!o) return true;
    try { return new URL(o).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch (_) { return false; }
  }
  function readJson(req) {
    return new Promise((resolve, reject) => {
      if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) { const e = new Error('tipo'); e.status = 415; return reject(e); }
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { const e = new Error('grande'); e.status = 413; req.destroy(); return reject(e); }
        chunks.push(c);
      });
      req.on('end', () => { try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {}); } catch (_) { const e = new Error('json'); e.status = 400; reject(e); } });
      req.on('error', reject);
    });
  }
  function bearer(req, header = 'authorization') {
    const v = String(req.headers[header] || '');
    return header === 'authorization' ? (/^Bearer\s+([\w-]{20,100})$/.exec(v) || [])[1] || '' : (/^[\w-]{20,100}$/.test(v) ? v : '');
  }
  function authDevice(req) {
    const t = bearer(req);
    if (!t) return null;
    const h = sha256(t);
    let found = null;
    for (const d of cfg.devices) if (safeEqual(h, Buffer.from(d.tokenHash, 'hex'))) found = d; // percorre todos: tempo constante
    if (found && now() - found.lastSeen > 60000) { found.lastSeen = now(); try { save(); } catch (_) { /* não crítico */ } }
    return found;
  }
  function authControl(req, device) {
    if (!controlAvailable()) return { ok: false, code: 'control_off', error: 'O controle do PC está desativado no computador.' };
    const t = bearer(req, 'x-yoru-control');
    const s = t ? sessions.get(sha256(t).toString('hex')) : null;
    const ttl = cfg.controlTtlMin * 60000;
    if (!s || s.deviceId !== device.id || now() - s.last > ttl || now() - s.started > CONTROL_MAX_SESSION_MS) {
      if (s) sessions.delete(sha256(t).toString('hex'));
      return { ok: false, code: 'control_locked', error: 'Controle bloqueado. Digite a senha para continuar.' };
    }
    s.last = now();
    return { ok: true, session: s };
  }
  function controlState(req, device) {
    const t = bearer(req, 'x-yoru-control');
    const s = t ? sessions.get(sha256(t).toString('hex')) : null;
    const ttl = cfg.controlTtlMin * 60000;
    const live = s && s.deviceId === device.id && now() - s.last <= ttl;
    return { available: controlAvailable(), unlocked: !!live, expiresIn: live ? Math.max(0, Math.round((ttl - (now() - s.last)) / 1000)) : null, ttlMin: cfg.controlTtlMin };
  }

  // ---------- ações do PC (lista fixa) ----------
  const intIn = (v, min, max, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d; };
  const query = (v) => clean(v, 60, '');
  const DANGEROUS = new Set(['shutdown', 'restart', 'sleep']);
  const ACTIONS = {
    volume: async (a) => {
      const op = String(a.op);
      if (op === 'set') return { ok: await pc.volume('set', intIn(a.n, 0, 100, 30)) };
      if (['up', 'down'].includes(op)) return { ok: await pc.volume(op, intIn(a.n, 1, 20, 5)) };
      if (op === 'mute') return { ok: await pc.volume('mute', 1) };
      return { ok: false, error: 'Operação de volume inválida.' };
    },
    media: async (a) => (['playpause', 'next', 'prev'].includes(a.op) ? { ok: await pc.media(a.op) } : { ok: false, error: 'Operação de mídia inválida.' }),
    arrow: async (a) => (['left', 'right'].includes(a.dir) ? { ok: await pc.arrow(a.dir) } : { ok: false, error: 'Direção inválida.' }),
    window: async (a) => {
      if (!['minimize', 'maximize', 'restore', 'close', 'closetab', 'focus'].includes(a.act)) return { ok: false, error: 'Ação de janela inválida.' };
      const r = await pc.window(a.act, query(a.query));
      return r.ok ? { ok: true, name: r.name || '' } : { ok: false, error: r.found === false ? 'Janela não encontrada.' : 'Não consegui executar.' };
    },
    switch: async () => ({ ok: await pc.switchWindow() }),
    desktop: async () => ({ ok: await pc.desktop() }),
    list: async () => ({ ok: true, windows: (await pc.list()).slice(0, 40).map((w) => ({ proc: clean(w.proc, 60, ''), title: clean(w.title, 90, '') })) }),
    launch: async (a) => {
      const name = query(a.name);
      if (!name) return { ok: false, error: 'Diga qual programa abrir.' };
      const r = await pc.launch(name);
      return r.ok ? { ok: true, name: r.name } : { ok: false, error: 'Programa não encontrado.' };
    },
    screenshot: async () => { const r = await pc.screenshot(); return r.ok ? { ok: true, saved: true } : { ok: false, error: 'Não consegui tirar o print.' }; },
    lock: async () => ({ ok: await pc.lock() }),
    sleep: async () => ({ ok: await pc.sleep() }),
    shutdown: async () => ({ ok: await pc.shutdown(), note: 'O PC desliga em 30 segundos. Use "Cancelar" para desistir.' }),
    restart: async () => ({ ok: await pc.restart(), note: 'O PC reinicia em 30 segundos. Use "Cancelar" para desistir.' }),
    cancelPower: async () => ({ ok: await pc.cancelPower() }),
  };

  async function route(req, res, url) {
    const p = url.pathname;
    if (req.method === 'GET' && STATIC[p]) return serveStatic(res, p);
    if (req.method === 'GET' && p.startsWith('/vendor/')) return serveVendor(res, p);
    if (!p.startsWith('/api/')) return fail(res, 404, 'Não encontrado.');

    const ip = req.socket.remoteAddress || '?';
    if (!hit(`ip:${ip}`, 240, 60000)) return fail(res, 429, 'Muitas requisições. Aguarde um instante.', { retryAfter: 30 });

    if (req.method === 'POST' && p === '/api/pair') {
      if (!hit(`auth:${ip}`, 20, 60000)) return fail(res, 429, 'Muitas tentativas. Aguarde um minuto.', { retryAfter: 60 });
      const wait = lockedFor(pairGuard);
      if (wait) return fail(res, 429, 'Pareamento bloqueado por tentativas erradas.', { retryAfter: wait });
      const body = await readJson(req);
      if (!pairing || now() >= pairing.expires) return fail(res, 403, 'Não há código de pareamento ativo. Gere um novo no PC.', { code: 'no_pairing' });
      const given = String(body.code || '').replace(/\s|-/g, '');
      if (!/^\d{8}$/.test(given) || !safeEqual(sha256(given), sha256(pairing.code))) {
        if (guardFail(pairGuard, 5)) { pairing = null; emit({ type: 'pair-locked' }); }
        else emit({ type: 'pair-failed' });
        return fail(res, 403, 'Código incorreto.', { code: 'bad_code' });
      }
      if (cfg.devices.length >= MAX_DEVICES) return fail(res, 409, `Limite de ${MAX_DEVICES} aparelhos. Revogue algum no PC.`, { code: 'device_limit' });
      const tk = token();
      const dev = { id: crypto.randomBytes(8).toString('hex'), name: clean(body.name, 40, 'Celular'), tokenHash: sha256(tk).toString('hex'), createdAt: now(), lastSeen: now() };
      cfg.devices.push(dev);
      pairing = null;
      guardOk(pairGuard);
      save();
      emit({ type: 'paired', device: dev.name });
      return json(res, 200, { ok: true, token: tk, device: { id: dev.id, name: dev.name } });
    }

    const dev = authDevice(req);
    if (!dev) return fail(res, 401, 'Aparelho não autorizado. Faça o pareamento de novo.', { code: 'unauthorized' });

    if (req.method === 'GET' && p === '/api/avatar-model') return serveAvatarModel(req, res);
    if (req.method === 'GET' && p === '/api/status') {
      return json(res, 200, {
        ok: true, name: 'Yoru', version, device: { id: dev.id, name: dev.name },
        visible: typeof isVisible === 'function' ? !!isVisible() : null,
        control: controlState(req, dev), pcSupported: !!(pc && pc.supported), screen: typeof captureScreen === 'function',
      });
    }
    if (req.method === 'POST' && p === '/api/logout') {
      cfg.devices = cfg.devices.filter((d) => d.id !== dev.id);
      dropSessions(dev.id);
      save();
      emit({ type: 'logout', device: dev.name });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && p === '/api/chat') {
      if (!hit(`chat:${dev.id}`, 20, 60000)) return fail(res, 429, 'Calma! Muitas mensagens em pouco tempo.', { retryAfter: 20 });
      const body = await readJson(req);
      const text = String(body.text == null ? '' : body.text).trim();
      if (!text) return fail(res, 400, 'Mensagem vazia.');
      if (text.length > 4000) return fail(res, 400, 'Mensagem longa demais (máx. 4000 caracteres).');
      if (chatBusy) return fail(res, 429, 'A Yoru ainda está respondendo a outra mensagem.', { retryAfter: 5 });
      chatBusy = true;
      try {
        const r = await Promise.race([
          Promise.resolve(chat(text, { avatar: body.avatar === true, device: dev.name })),
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000).unref()),
        ]);
        return json(res, 200, { ok: !!(r && r.ok), text: String((r && r.text) || '').slice(0, 20000) });
      } catch (e) {
        return fail(res, e.message === 'timeout' ? 504 : 500, e.message === 'timeout' ? 'A Yoru demorou demais para responder.' : 'Não consegui falar com a IA agora.');
      } finally { chatBusy = false; }
    }
    if (req.method === 'POST' && p === '/api/avatar') {
      const body = await readJson(req);
      if (typeof setVisible !== 'function' || typeof body.visible !== 'boolean') return fail(res, 400, 'Pedido inválido.');
      setVisible(body.visible);
      return json(res, 200, { ok: true, visible: body.visible });
    }

    if (req.method === 'POST' && p === '/api/control/unlock') {
      if (!controlAvailable()) return fail(res, 403, 'O controle do PC está desativado no computador.', { code: 'control_off' });
      if (!hit(`auth:${ip}`, 20, 60000)) return fail(res, 429, 'Muitas tentativas. Aguarde um minuto.', { retryAfter: 60 });
      const wait = lockedFor(controlGuard);
      if (wait) return fail(res, 429, 'Controle bloqueado por tentativas erradas.', { retryAfter: wait, code: 'locked_out' });
      const body = await readJson(req);
      const pw = String(body.password == null ? '' : body.password).slice(0, 200);
      if (!(await verifyPw(pw, cfg.control))) {
        const locked = guardFail(controlGuard, 5);
        emit({ type: 'unlock-failed', device: dev.name, locked });
        log(`[remote] senha de controle incorreta (${dev.name})`);
        return fail(res, 403, locked ? 'Senha incorreta. Muitas tentativas: controle bloqueado por um tempo.' : 'Senha incorreta.', { code: 'bad_password', retryAfter: locked ? lockedFor(controlGuard) : undefined });
      }
      guardOk(controlGuard);
      dropSessions(dev.id);
      const tk = token();
      sessions.set(sha256(tk).toString('hex'), { deviceId: dev.id, started: now(), last: now() });
      emit({ type: 'unlocked', device: dev.name });
      log(`[remote] controle liberado (${dev.name})`);
      return json(res, 200, { ok: true, control: tk, expiresIn: cfg.controlTtlMin * 60 });
    }
    if (req.method === 'POST' && p === '/api/control/lock') {
      dropSessions(dev.id);
      emit({ type: 'locked', device: dev.name });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/control/action' || p === '/api/control/screen') {
      const auth = authControl(req, dev);
      if (!auth.ok) return fail(res, 403, auth.error, { code: auth.code });
      if (p === '/api/control/screen') {
        if (req.method !== 'GET') return fail(res, 405, 'Método não permitido.');
        if (typeof captureScreen !== 'function') return fail(res, 501, 'Ver a tela não está disponível neste computador.');
        if (!hit(`screen:${dev.id}`, 40, 60000)) return fail(res, 429, 'Atualizando rápido demais.', { retryAfter: 5 });
        const img = await captureScreen();
        if (!img || !img.length) return fail(res, 500, 'Não consegui capturar a tela.');
        res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': img.length, 'Cache-Control': 'no-store' });
        return res.end(img);
      }
      if (req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
      if (!pc || !pc.supported) return fail(res, 501, 'O controle do PC só funciona no Windows.');
      if (!hit(`act:${dev.id}`, 60, 60000)) return fail(res, 429, 'Muitas ações em pouco tempo.', { retryAfter: 10 });
      const body = await readJson(req);
      const action = String(body.action || '');
      if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) return fail(res, 400, 'Ação desconhecida.');
      if (DANGEROUS.has(action) && body.confirm !== true) return fail(res, 400, 'Esta ação precisa de confirmação.', { code: 'confirm_required' });
      let result;
      try { result = await ACTIONS[action](body.args && typeof body.args === 'object' ? body.args : {}); } catch (_) { result = { ok: false, error: 'Falhou ao executar.' }; }
      if (action !== 'list') { emit({ type: 'action', device: dev.name, action }); log(`[remote] ação ${action} (${dev.name})`); }
      return json(res, 200, result);
    }
    return fail(res, 404, 'Não encontrado.');
  }

  const vendorCache = new Map();
  async function serveVendor(res, p) {
    const rel = p.slice('/vendor/'.length);
    if (!VENDOR.has(rel)) return fail(res, 404, 'Não encontrado.');
    try {
      let data = vendorCache.get(rel);
      if (!data) {
        const dir = vendorDir || path.join(webDir, '..', 'vendor');
        const text = await fs.promises.readFile(path.join(dir, rel), 'utf8');
        data = Buffer.from(text.replace(BARE_THREE, '$1$2/vendor/three/three.module.js$2'));
        vendorCache.set(rel, data);
      }
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': data.length, 'Cache-Control': 'public, max-age=86400' });
      res.end(data);
    } catch (_) { fail(res, 404, 'Biblioteca 3D não encontrada.'); }
  }
  // modelo VRM do avatar atual: só para aparelho pareado (é um arquivo pessoal); o navegador guarda e revalida por ETag
  async function serveAvatarModel(req, res) {
    try {
      const f = typeof avatarModel === 'function' ? await avatarModel() : null;
      if (!f) return fail(res, 404, 'Nenhum avatar 3D disponível.');
      const st = await fs.promises.stat(f);
      const etag = `"${st.size}-${Math.round(st.mtimeMs)}"`;
      const head = { ETag: etag, 'Cache-Control': 'private, max-age=3600' };
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
      res.writeHead(200, { ...head, 'Content-Type': 'model/gltf-binary', 'Content-Length': st.size });
      fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
    } catch (_) { fail(res, 404, 'Nenhum avatar 3D disponível.'); }
  }

  async function serveStatic(res, p) {
    const [name, type, cache] = STATIC[p];
    try {
      let data = await fs.promises.readFile(path.join(webDir, name));
      if (name === 'sw.js') data = Buffer.from(data.toString('utf8').replace(/__BUILD__/g, String(version).replace(/[^\w.-]/g, '')));
      const extra = name === 'sw.js' ? { 'Service-Worker-Allowed': '/' } : {};
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': cache, ...extra });
      res.end(data);
    } catch (_) { fail(res, 404, 'Arquivo do app não encontrado.'); }
  }

  async function handle(req, res) {
    try {
      secure(res);
      if (!hostOk(req)) return fail(res, 421, 'Endereço não permitido.');
      if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Método não permitido.');
      if (req.method === 'POST' && !originOk(req)) return fail(res, 403, 'Origem não permitida.');
      const url = new URL(req.url, 'http://localhost');
      await route(req, res, url);
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch (_) { /* conexão já fechada */ } return; }
      if (e && e.status) return fail(res, e.status, e.status === 413 ? 'Pedido grande demais.' : e.status === 415 ? 'Envie JSON.' : 'Pedido inválido.');
      log(`[remote] erro: ${e && e.message}`);
      fail(res, 500, 'Erro interno.');
    }
  }

  // ---------- ciclo de vida ----------
  function start() {
    if (server) return Promise.resolve(status());
    lastError = '';
    return new Promise((resolve) => {
      const s = http.createServer(handle);
      s.requestTimeout = 150000;
      s.headersTimeout = 20000;
      s.on('clientError', (_e, socket) => { try { socket.destroy(); } catch (_) { /* já fechado */ } });
      s.once('error', (e) => {
        lastError = e.code === 'EADDRINUSE' ? `A porta ${cfg.port} já está em uso. Escolha outra.` : `Não consegui abrir o servidor: ${e.message}`;
        server = null;
        resolve(status());
      });
      s.listen(cfg.port, cfg.lan ? '0.0.0.0' : '127.0.0.1', () => {
        server = s;
        if (!pairing || now() >= pairing.expires) newPairing();
        resolve(status());
      });
    });
  }
  function stop() {
    dropSessions();
    pairing = null;
    if (!server) return Promise.resolve(status());
    const s = server;
    server = null;
    return new Promise((resolve) => {
      s.close(() => resolve(status()));
      if (typeof s.closeAllConnections === 'function') s.closeAllConnections();
    });
  }
  const autoStart = () => (cfg.enabled ? start() : Promise.resolve(status()));
  const address = () => (server ? server.address() : null);

  return { start, stop, autoStart, status, configure, newPairing, setPassword, clearPassword, revoke, revokeAll, address };
}

module.exports = { createRemoteServer, hashPassword, verifyPassword, sanitizeConfig, DEFAULT_PORT, MAX_DEVICES, ACTIONS_LIST: ['volume', 'media', 'arrow', 'window', 'switch', 'desktop', 'list', 'launch', 'screenshot', 'lock', 'sleep', 'shutdown', 'restart', 'cancelPower'] };
