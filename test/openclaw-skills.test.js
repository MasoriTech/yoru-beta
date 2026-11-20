'use strict';
// Instalar skills no OpenClaw pelo comando `openclaw skills ...`: validação da origem e fiação.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../src/openclaw-skills');

const fake = (reply) => { const calls = []; const exec = async (args, o) => { calls.push({ args, o }); return typeof reply === 'function' ? reply(args) : reply; }; return { exec, calls }; };
const okR = (out = '') => ({ code: 0, out, err: '' });

test('origens aceitas e recusadas', () => {
  for (const s of ['@dono/skill', 'git:dono/repo', 'git:dono/repo@main', 'git:dono/repo@feat/x', 'skills-sh:dono/repo/skill']) assert.ok(S.cleanSource(s), s);
  for (const s of ['./pasta', '../x', 'C:\\x', '/etc/x', 'skill', '@dono', '-rf', '@a/b c', '@a/b&calc', '@a/b"; x', 'git:a/b@../../x', 'git:a/b;x', '--global', '', null, 'https://x.com/a'])
    assert.equal(S.cleanSource(s), '', String(s));
});
test('busca: sanitiza o texto e pede JSON', async () => {
  const f = fake(okR(JSON.stringify([{ slug: '@a/cal', name: 'cal', description: 'agenda' }])));
  const r = await S.createSkills({ exec: f.exec }).search('calendário & "x" | y', { limit: 500 });
  assert.deepEqual(f.calls[0].args, ['skills', 'search', 'calendário x y', '--limit', '30', '--json']);
  assert.equal(r.skills[0].source, '@a/cal');
});
test('busca sem texto navega os destaques; aceita aviso antes do JSON e formatos {skills:[]}', async () => {
  const f = fake(okR('aviso...\n{"skills":[{"name":"x","description":"d"}]}'));
  const r = await S.createSkills({ exec: f.exec }).search('');
  assert.ok(!f.calls[0].args.includes(''));
  assert.equal(r.skills.length, 1);
});
test('instalar: monta o comando, no agente atual ou global', async () => {
  const f = fake(okR('ok'));
  const sk = S.createSkills({ exec: f.exec });
  assert.ok((await sk.install('@a/b', { agent: 'main' })).ok);
  assert.deepEqual(f.calls[0].args, ['skills', 'install', '@a/b', '--agent', 'main']);
  await sk.install('@a/b', { agent: 'main', global: true });
  assert.deepEqual(f.calls[1].args, ['skills', 'install', '@a/b', '--global']); // --global não combina com --agent
  await sk.install('@a/b');
  assert.deepEqual(f.calls[2].args, ['skills', 'install', '@a/b']);
  await sk.install('@a/b', { agent: 'x; calc' });
  assert.deepEqual(f.calls[3].args, ['skills', 'install', '@a/b']); // id de agente inválido é descartado
});
test('instalar: origem inválida nem chega ao comando', async () => {
  const f = fake(okR());
  const r = await S.createSkills({ exec: f.exec }).install('./minha-pasta');
  assert.equal(r.ok, false); assert.equal(r.reason, 'bad-source'); assert.equal(f.calls.length, 0);
});
test('erros: sem o comando, tempo esgotado e falha do próprio OpenClaw', async () => {
  const sk = (r) => S.createSkills({ exec: fake(r).exec });
  assert.equal((await sk({ code: 1, missing: true, out: '', err: '' }).install('@a/b')).reason, 'no-cli');
  assert.equal((await sk({ code: 1, timedOut: true, out: '', err: '' }).update()).reason, 'timeout');
  const r = await sk({ code: 1, out: '', err: '\x1b[31mscan falhou\x1b[0m' }).install('@a/b');
  assert.match(r.text, /scan falhou/); assert.ok(!r.text.includes('\x1b'));
});
test('atualizar e listar usam o agente atual', async () => {
  const f = fake(okR('[]'));
  const sk = S.createSkills({ exec: f.exec });
  await sk.update({ agent: 'main' }); await sk.installed({ agent: 'main' });
  assert.deepEqual(f.calls[0].args, ['skills', 'update', '--all', '--agent', 'main']);
  assert.deepEqual(f.calls[1].args, ['skills', 'list', '--json', '--agent', 'main']);
});

// ---------- fiação ----------
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
test('IPC, preload, limites e painel ligados', () => {
  const ipc = read('ipc-ia.js'), pre = read('panel-preload.js'), sec = read('ipc-security.js'), html = read('panel.html'), js = read('panel-ia.js');
  for (const ch of ['search', 'installed', 'install', 'update']) {
    const i = ipc.indexOf(`'openclaw-skills-${ch}'`);
    assert.ok(i > 0, ch);
    assert.match(ipc.slice(i, i + 120), /panelOnly\(e\)/);
    assert.match(sec, new RegExp(`'openclaw-skills-${ch}':`));
  }
  assert.match(pre, /openclawSkillsInstall:[^\n]*'openclaw-skills-install'/);
  for (const id of ['ocSkillQuery', 'ocSkillSearch', 'ocSkillInstall', 'ocSkillResults', 'ocSkillInstalled', 'ocSkillUpdate']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(js, /panel\.openclawSkillsInstall/);
  assert.match(js.slice(js.indexOf('async function ocInstall')), /confirm\(/); // pede permissão antes de instalar
});
