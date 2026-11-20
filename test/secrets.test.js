'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/secrets');

// "safeStorage" falso e reversível, só para provar o caminho de ida e volta (inverte os bytes)
const fake = (available = true) => S.createCodec({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').reverse()),
  decryptString: (b) => { if (b.toString('utf8') === 'lixo') throw new Error('sem permissão'); return Buffer.from(b).reverse().toString('utf8'); },
});
const cfg = () => ({
  provider: 'anthropic', systemPrompt: 'oi',
  anthropic: { apiKey: 'sk-ant-SEGREDO', model: 'm' },
  openrouter: { apiKey: '', model: 'auto' },
  groq: { apiKey: 'COLE_SUA_CHAVE_AQUI' },
  cloudflare: { accountId: 'abc123', apiToken: 'cf-TOKEN' },
});

test('protect cifra apiKey e apiToken e não deixa o segredo em texto no arquivo', () => {
  const out = S.protect(cfg(), fake());
  assert.ok(S.isEnc(out.anthropic.apiKey) && S.isEnc(out.cloudflare.apiToken));
  assert.doesNotMatch(JSON.stringify(out), /SEGREDO|cf-TOKEN/);
  assert.equal(out.openrouter.apiKey, '', 'vazia continua vazia');
  assert.equal(out.groq.apiKey, 'COLE_SUA_CHAVE_AQUI', 'o texto de exemplo não é cifrado');
  assert.equal(out.cloudflare.accountId, 'abc123', 'ID da conta não é segredo');
  assert.equal(out.anthropic.model, 'm');
});

test('ida e volta: reveal devolve as chaves originais e não pede migração', () => {
  const codec = fake();
  const r = S.reveal(S.protect(cfg(), codec), codec);
  assert.equal(r.cfg.anthropic.apiKey, 'sk-ant-SEGREDO');
  assert.equal(r.cfg.cloudflare.apiToken, 'cf-TOKEN');
  assert.equal(r.needsMigration, false);
  assert.equal(r.failed, 0);
});

test('protect não cifra duas vezes', () => {
  const codec = fake();
  const once = S.protect(cfg(), codec);
  assert.deepEqual(S.protect(once, codec), once);
});

test('arquivo antigo com chave em texto puro: reveal mantém a chave e pede migração', () => {
  const r = S.reveal(cfg(), fake());
  assert.equal(r.cfg.anthropic.apiKey, 'sk-ant-SEGREDO');
  assert.equal(r.needsMigration, true);
});

test('sem cifragem no sistema: nada é cifrado e nada se perde', () => {
  const codec = fake(false);
  assert.deepEqual(S.protect(cfg(), codec), cfg());
  const r = S.reveal(cfg(), codec);
  assert.equal(r.needsMigration, false);
  assert.equal(r.cfg.anthropic.apiKey, 'sk-ant-SEGREDO');
});

test('chave cifrada que não abre (outro usuário/PC) volta vazia, sem derrubar o app', () => {
  const bad = cfg();
  bad.anthropic.apiKey = S.PREFIX + Buffer.from('lixo').toString('base64');
  const r = S.reveal(bad, fake());
  assert.equal(r.cfg.anthropic.apiKey, '');
  assert.equal(r.failed, 1);
  assert.equal(r.cfg.cloudflare.apiToken, 'cf-TOKEN');
});

test('falha ao cifrar mantém a chave em texto em vez de perder', () => {
  const codec = S.createCodec({ isEncryptionAvailable: () => true, encryptString: () => { throw new Error('x'); }, decryptString: () => '' });
  assert.equal(S.protect(cfg(), codec).anthropic.apiKey, 'sk-ant-SEGREDO');
});

test('não altera o objeto recebido', () => {
  const c = cfg(); S.protect(c, fake()); S.reveal(c, fake());
  assert.deepEqual(c, cfg());
});

test('main.js usa o secrets.js ao ler e gravar o config.json', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.match(main, /require\('electron'\)/);
  assert.match(main, /safeStorage/);
  assert.match(main, /SECRETS\.reveal\(/);
  assert.match(main, /STORE\.writeAtomic\(CONFIG_FILE, JSON\.stringify\(SECRETS\.protect\(/);
});
