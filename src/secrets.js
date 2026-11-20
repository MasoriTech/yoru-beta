'use strict';
// Chaves de API cifradas no config.json. Usa o `safeStorage` do Electron (no Windows, DPAPI: só o seu usuário deste PC abre).
// Em disco, cada chave vira "enc:v1:<base64>". Na memória o resto do app continua vendo a chave normal (loadConfig devolve em texto).
// Se o sistema não oferece cifragem, a chave fica como estava (não se perde nada); se não der para abrir uma chave cifrada
// (outro usuário/PC, ou o arquivo foi copiado), ela volta vazia e o app pede a chave de novo.
const PREFIX = 'enc:v1:';
const FIELDS = ['apiKey', 'apiToken'];   // apiKey (todos os provedores) e apiToken (Cloudflare)
const PLACEHOLDER = 'COLE_SUA_CHAVE_AQUI';

const isEnc = (v) => typeof v === 'string' && v.startsWith(PREFIX);
const isPlain = (v) => typeof v === 'string' && v !== '' && v !== PLACEHOLDER && !isEnc(v);

// codec: { available(): boolean, encrypt(str): Buffer, decrypt(Buffer): string }
function createCodec(safeStorage) {
  return {
    available() { try { return !!safeStorage && safeStorage.isEncryptionAvailable(); } catch (_) { return false; } },
    encrypt: (s) => safeStorage.encryptString(s),
    decrypt: (b) => safeStorage.decryptString(b),
  };
}

function eachSecret(cfg, fn) {
  if (!cfg || typeof cfg !== 'object') return;
  for (const sec of Object.values(cfg)) {
    if (!sec || typeof sec !== 'object' || Array.isArray(sec)) continue;
    for (const f of FIELDS) if (typeof sec[f] === 'string') fn(sec, f);
  }
}

// config lida do disco -> config com as chaves abertas. `needsMigration`: há chave em texto puro que dá para cifrar.
function reveal(cfg, codec) {
  const out = structuredClone(cfg || {});
  let needsMigration = false, failed = 0;
  eachSecret(out, (sec, f) => {
    const v = sec[f];
    if (isEnc(v)) {
      try { sec[f] = codec.decrypt(Buffer.from(v.slice(PREFIX.length), 'base64')); } catch (_) { sec[f] = ''; failed++; }
    } else if (isPlain(v) && codec.available()) needsMigration = true;
  });
  return { cfg: out, needsMigration, failed };
}

// config em memória -> config pronta para gravar (chaves cifradas quando o sistema permite)
function protect(cfg, codec) {
  const out = structuredClone(cfg || {});
  if (!codec.available()) return out;
  eachSecret(out, (sec, f) => {
    if (isPlain(sec[f])) {
      try { sec[f] = PREFIX + Buffer.from(codec.encrypt(sec[f])).toString('base64'); } catch (_) { /* mantém em texto: melhor que perder a chave */ }
    }
  });
  return out;
}

module.exports = { PREFIX, createCodec, reveal, protect, isEnc };
