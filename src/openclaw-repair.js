'use strict';
// "Reparar OpenClaw": a Yoru identifica e resolve sozinha os problemas mais comuns do OpenClaw neste PC.
//  1. openclaw.json ilegível (vírgula/chave quebrada)  -> volta para a última versão boa (openclaw.json.last-good), com cópia da quebrada
//  2. chaves que a versão instalada não reconhece        -> remove SÓ as que o próprio `openclaw config validate` aponta
//     (inclui a env.OPENROUTER_API_KEY solta das versões antigas da Yoru, que vira env.vars.OPENROUTER_API_KEY)
//  3. gateway não instalado / parado                     -> `openclaw gateway install` + `start`
//  4. token recusado / endpoint de chat desligado        -> reinicia o gateway e relê o token (a detecção liga o endpoint)
//  5. nenhum token serviu                                -> DEFINE um token novo no OpenClaw, reinicia o gateway e guarda o mesmo token aqui
//  6. sem openclaw.json (ou quebrado sem versão boa)     -> cria uma configuração mínima válida (local, só neste PC, endpoint de chat ligado)
// Só reescreve JSON puro (JSON5 com comentários não é tocado), sempre com cópia de segurança. Dependências injetáveis, sem Electron.
const nodeFs = require('node:fs');
const nodePath = require('node:path');
const nodeCrypto = require('node:crypto');
const OCD = require('./openclaw-detect');
const { defaultExec } = require('./openclaw-skills');

const SEG = /^[A-Za-z0-9_-]{1,64}$/;
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const stamp = (now) => now().toISOString().replace(/[:.]/g, '-');
const clean = (s) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '');

// Linhas como:  - openclaw.json:57 — gateway.controlUi: Unrecognized key: "allowInsecureAuth"
function parseUnrecognized(text) {
  const out = [];
  for (const raw of clean(text).split(/\r?\n/)) {
    const m = raw.match(/^\s*[-•*]?\s*(?:[^\s:]*\.json5?:\d+\s*[—–-]+\s*)?([^:]*?):\s*Unrecognized keys?:\s*(.+)$/i);
    if (!m) continue;
    const where = m[1].trim();
    const path = where === '<root>' || where === '' ? [] : where.split('.');
    if (!path.every((s) => SEG.test(s))) continue;
    for (const k of m[2].matchAll(/"([^"]+)"/g)) if (SEG.test(k[1])) out.push({ path, key: k[1] });
  }
  return out;
}

function removeKeys(obj, items) {
  let n = 0;
  for (const { path, key } of items) {
    let cur = obj;
    for (const s of path) cur = isObj(cur) ? cur[s] : undefined;
    if (isObj(cur) && Object.prototype.hasOwnProperty.call(cur, key)) { delete cur[key]; n++; }
  }
  return n;
}

// Versões antigas da Yoru gravaram a chave solta em `env`; o OpenClaw novo só aceita em env.vars.
function migrateLegacyEnv(cfg) {
  if (!isObj(cfg) || !isObj(cfg.env) || typeof cfg.env.OPENROUTER_API_KEY !== 'string') return false;
  cfg.env.vars = isObj(cfg.env.vars) ? cfg.env.vars : {};
  if (!cfg.env.vars.OPENROUTER_API_KEY) cfg.env.vars.OPENROUTER_API_KEY = cfg.env.OPENROUTER_API_KEY;
  delete cfg.env.OPENROUTER_API_KEY;
  return true;
}

function strictJson(fs, file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return undefined; }
}

/**
 * Deixa o openclaw.json válido. Devolve { ok, valid, changes:[texto], backup, reason? }.
 * reason: no-file | json5 | broken | no-cli
 */
async function fixConfig({ file, fs = nodeFs, exec = defaultExec, now = () => new Date(), maxRounds = 4 } = {}) {
  file = file || OCD.defaultConfigPath();
  const changes = [];
  let backup = '';
  if (!fs.existsSync(file)) return { ok: false, valid: false, changes, reason: 'no-file' };
  const backupOnce = () => { if (!backup) { backup = `${file}.yoru-bak-${stamp(now)}`; fs.copyFileSync(file, backup); } };

  let cfg = strictJson(fs, file);
  if (cfg === undefined) {
    const parsed = OCD.lenientParse(fs.readFileSync(file, 'utf8'));
    if (parsed.value) return { ok: false, valid: false, changes, reason: 'json5' }; // comentários/formato livre: não reescrevo
    const good = strictJson(fs, `${file}.last-good`);
    if (!isObj(good)) return { ok: false, valid: false, changes, reason: 'broken' };
    const broken = `${file}.yoru-quebrado-${stamp(now)}`;
    fs.copyFileSync(file, broken);
    fs.copyFileSync(`${file}.last-good`, file);
    backup = broken;
    cfg = good;
    changes.push('O openclaw.json estava ilegível: voltei para a última versão boa (a quebrada ficou guardada ao lado).');
  }

  let dirty = false;
  if (migrateLegacyEnv(cfg)) { dirty = true; changes.push('Movi a chave do OpenRouter para env.vars (o formato que o OpenClaw novo aceita).'); }

  let valid = false, missingCli = false;
  for (let round = 0; round < maxRounds; round++) {
    if (dirty) { backupOnce(); fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n'); dirty = false; }
    const r = await exec(['config', 'validate'], { timeout: 30000 });
    if (r.missing) { missingCli = true; break; }
    const text = `${r.out}\n${r.err}`;
    const items = parseUnrecognized(text);
    if (r.code === 0 && !items.length) { valid = true; break; }
    if (!items.length) break; // erro de outro tipo: não sei consertar sozinha
    const n = removeKeys(cfg, items);
    if (!n) break;
    dirty = true;
    changes.push(`Removi ${n} chave(s) que esta versão do OpenClaw não reconhece: ${items.map((i) => [...i.path, i.key].join('.')).join(', ')}.`);
  }
  if (dirty) { backupOnce(); fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n'); }
  if (missingCli) return { ok: changes.length > 0, valid: false, changes, backup, reason: 'no-cli' };
  return { ok: true, valid, changes, backup };
}

const newToken = () => nodeCrypto.randomBytes(24).toString('hex');
const minimalConfig = (token) => ({ gateway: { mode: 'local', port: 18789, bind: 'loopback', auth: { mode: 'token', token }, http: { endpoints: { chatCompletions: { enabled: true } } } } });

// Cria o openclaw.json do zero (ou no lugar de um quebrado sem versão boa; o quebrado fica guardado ao lado).
function writeMinimalConfig({ file, fs = nodeFs, now = () => new Date(), token = newToken() }) {
  let kept = '';
  if (fs.existsSync(file)) { kept = `${file}.yoru-quebrado-${stamp(now)}`; fs.copyFileSync(file, kept); }
  fs.mkdirSync(nodePath.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(minimalConfig(token), null, 2) + '\n');
  return { ok: true, kept, token };
}

// Define o token do gateway (modo token) no openclaw.json: edição direta se for JSON puro (com cópia); senão pelo comando do OpenClaw.
async function setGatewayToken({ file, fs = nodeFs, exec = defaultExec, now = () => new Date(), token = newToken() } = {}) {
  const cfg = strictJson(fs, file);
  if (isObj(cfg)) {
    const backup = `${file}.yoru-bak-${stamp(now)}`;
    fs.copyFileSync(file, backup);
    cfg.gateway = isObj(cfg.gateway) ? cfg.gateway : {};
    if (!cfg.gateway.mode) cfg.gateway.mode = 'local';
    cfg.gateway.auth = { ...(isObj(cfg.gateway.auth) ? cfg.gateway.auth : {}), mode: 'token', token };
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
    return { ok: true, via: 'file', backup, token };
  }
  const a = await exec(['config', 'set', 'gateway.auth.mode', 'token'], { timeout: 30000 });
  const b = a.code === 0 ? await exec(['config', 'set', 'gateway.auth.token', token], { timeout: 30000 }) : a;
  return b.code === 0 ? { ok: true, via: 'cli', token } : { ok: false, via: 'cli' };
}

/**
 * Fluxo completo. `save(r)` guarda a conexão detectada (endereço, token, agente) — feito no processo principal.
 * `report(texto)` recebe cada passo (a interface mostra ao vivo). Devolve { ok, text, steps }.
 */
async function repairAll({ detect = OCD.detect, exec = defaultExec, save = () => {}, report = () => {}, file, fs = nodeFs, now, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const steps = [];
  const say = (t) => { steps.push(t); report(t); };

  say('Conferindo o openclaw.json...');
  const c = await fixConfig({ file, fs, exec, now });
  for (const t of c.changes) say('✔ ' + t);
  if (c.reason === 'no-file' || c.reason === 'broken') {
    const w = writeMinimalConfig({ file: file || OCD.defaultConfigPath(), fs, now });
    say(c.reason === 'no-file' ? '✔ Não havia openclaw.json: criei uma configuração mínima (só neste PC, com token novo e endpoint de chat ligado).'
      : '✔ O openclaw.json estava quebrado e sem versão boa: guardei o quebrado ao lado e criei uma configuração mínima nova.');
    c.valid = true; c.reason = '';
  }
  else if (c.reason === 'json5') say('O openclaw.json tem comentários (JSON5): não reescrevo sozinha. Se houver erro, rode "openclaw doctor --fix".');
  else if (c.reason === 'no-cli') say('Não achei o comando "openclaw" no PATH (abra um terminal novo ou reinstale o OpenClaw).');
  else if (c.valid) say('✔ Configuração válida.');
  else say('A configuração ainda tem um erro que não sei corrigir sozinha ("openclaw config validate" mostra qual).');

  say('Procurando o gateway...');
  let d = await detect({ enable: true, exec });
  if (d.status === 'down' || d.status === 'no-config') {
    say('O gateway está parado. Instalando e iniciando o serviço...');
    await exec(['gateway', 'install'], { timeout: 120000 });
    await exec(['gateway', 'start'], { timeout: 60000 });
    for (let n = 0; n < 5; n++) { await wait(2000); d = await detect({ enable: true, exec }); if (d.status !== 'down') break; }
  }
  if (d.status === 'bad-token' || (d.status === 'endpoint-off' && !d.canEnable)) {
    say('Reiniciando o gateway para ele ler a configuração atual...');
    await exec(['gateway', 'restart'], { timeout: 60000 });
    await wait(3000);
    d = await detect({ enable: true, exec });
  }
  if (d.status === 'bad-token') { // nada que eu ache serve: em vez de adivinhar, DEFINO o token e ensino o gateway
    say('Nenhum token que encontrei é aceito pelo gateway. Definindo um token novo...');
    const t = await setGatewayToken({ file: file || OCD.defaultConfigPath(), fs, exec, now });
    if (t.ok) {
      say('✔ Token novo definido no OpenClaw' + (t.backup ? ' (cópia de segurança ao lado do arquivo)' : '') + '. Reiniciando o gateway...');
      await exec(['gateway', 'restart'], { timeout: 60000 });
      for (let n = 0; n < 5; n++) { await wait(2500); d = await detect({ enable: true, exec }); if (d.status !== 'down') break; }
    } else say('Não consegui gravar o token novo (o comando "openclaw config set" falhou).');
  }
  if (d.enabledNow) say('✔ Liguei o endpoint de chat (cópia de segurança ao lado do arquivo).');
  if (d.status === 'ok') {
    save(d);
    say('✔ ' + OCD.describe({ ...d, notes: [], enabledNow: false }));
    return { ok: true, text: steps.join('\n'), steps };
  }
  say('✖ ' + OCD.describe(d));
  return { ok: false, text: steps.join('\n'), steps };
}

module.exports = { newToken, writeMinimalConfig, setGatewayToken, parseUnrecognized, removeKeys, migrateLegacyEnv, fixConfig, repairAll };
