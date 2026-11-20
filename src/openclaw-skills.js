'use strict';
// Instala e gerencia skills do OpenClaw pelo comando dele (`openclaw skills ...`, docs.openclaw.ai/cli/skills).
// A Yoru não baixa nem escreve nada na pasta de skills por conta própria: quem instala é o próprio OpenClaw
// (que também varre a skill antes). Aqui ficam só a validação do que o painel pede e a chamada do comando.
// Tudo com `exec` injetável, sem Electron, para testar com `npm test`.
const { execFile } = require('node:child_process');

// Só origens "de catálogo" entram. Caminho local (./pasta) fica de fora de propósito: o painel não deve
// conseguir mandar o OpenClaw instalar qualquer pasta do PC.
const SEG = '[a-z0-9][a-z0-9._-]{0,63}';
const RE_CLAWHUB = new RegExp(`^@${SEG}/${SEG}$`, 'i');                       // @dono/skill
const RE_GIT = new RegExp(`^git:${SEG}/${SEG}(@[A-Za-z0-9][A-Za-z0-9._/-]{0,79})?$`, 'i'); // git:dono/repo[@ref]
const RE_SKILLSSH = new RegExp(`^skills-sh:${SEG}/${SEG}/${SEG}$`, 'i');       // skills-sh:dono/repo/skill
const RE_AGENT = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function kindOf(src) {
  const s = String(src || '').trim();
  if (RE_CLAWHUB.test(s)) return 'clawhub';
  if (RE_SKILLSSH.test(s)) return 'skills-sh';
  if (RE_GIT.test(s) && !s.includes('..')) return 'git';
  return '';
}
const cleanSource = (src) => { const s = String(src || '').trim(); return kindOf(s) ? s : ''; };
const cleanAgent = (a) => { const s = String(a || '').trim(); return RE_AGENT.test(s) ? s : ''; };
// A busca vai para a linha de comando: só letras, números e separadores simples.
const cleanQuery = (q) => String(q || '').normalize('NFC').replace(/[^\p{L}\p{N} ._-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);

function defaultExec(args, { timeout = 30000, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    // No Windows o openclaw é um .cmd (o Node não executa .cmd sem shell). Os argumentos já passaram pelas listas
    // acima (sem aspas, espaço, &, |, < ou >), então entre aspas é seguro.
    const win = platform === 'win32';
    const a = win ? args.map((x) => `"${x}"`) : args;
    execFile('openclaw', a, { timeout, windowsHide: true, encoding: 'utf8', shell: win, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        missing: !!(err && (err.code === 'ENOENT' || /não é reconhecido|not recognized|command not found/i.test(String(stderr || err.message)))),
        timedOut: !!(err && err.killed),
        out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim(),
      });
    });
  });
}

// O comando às vezes imprime avisos antes do JSON: pega do primeiro { ou [ em diante.
function parseJson(text) {
  const t = String(text || '');
  const i = t.search(/[[{]/);
  if (i < 0) return null;
  try { return JSON.parse(t.slice(i)); } catch (_) { return null; }
}

const tail = (s, n = 400) => String(s || '').replace(/\x1b\[[0-9;]*m/g, '').trim().slice(-n);
const NO_CLI = 'Não achei o comando "openclaw" neste PC. Instale o OpenClaw (ele traz o comando) e abra um terminal novo ou reinicie a Yoru para o PATH atualizar.';

// Normaliza uma lista vinda do `--json` (o formato exato muda entre versões, então aceita vários nomes de campo).
function pickList(j) {
  const arr = Array.isArray(j) ? j : Array.isArray(j && j.skills) ? j.skills : Array.isArray(j && j.results) ? j.results : Array.isArray(j && j.items) ? j.items : [];
  return arr.filter((x) => x && typeof x === 'object').map((x) => ({
    name: String(x.name || x.slug || x.id || '').slice(0, 80),
    source: String(x.slug || x.source || x.ref || x.name || '').slice(0, 140),
    description: String(x.description || x.summary || '').slice(0, 240),
    eligible: x.eligible === undefined ? undefined : !!x.eligible,
  })).filter((x) => x.name);
}

function createSkills({ exec = defaultExec } = {}) {
  const fail = (r, what) => (r.missing ? { ok: false, reason: 'no-cli', text: NO_CLI }
    : r.timedOut ? { ok: false, reason: 'timeout', text: `O OpenClaw demorou demais para ${what}. Tente de novo.` }
      : { ok: false, reason: 'cli', text: `O OpenClaw não conseguiu ${what}: ${tail(r.err || r.out) || 'sem detalhes'}` });

  async function search(query, { limit = 12 } = {}) {
    const q = cleanQuery(query);
    const n = Math.max(1, Math.min(30, Number(limit) | 0 || 12));
    const args = ['skills', 'search', ...(q ? [q] : []), '--limit', String(n), '--json'];
    const r = await exec(args, { timeout: 30000 });
    if (r.code !== 0) return fail(r, 'buscar skills');
    const list = pickList(parseJson(r.out));
    return { ok: true, query: q, skills: list, text: list.length ? `${list.length} skill(s) encontrada(s).` : 'Nenhuma skill encontrada para essa busca.' };
  }

  async function installed({ agent } = {}) {
    const a = cleanAgent(agent);
    const r = await exec(['skills', 'list', '--json', ...(a ? ['--agent', a] : [])], { timeout: 30000 });
    if (r.code !== 0) return fail(r, 'listar as skills');
    const list = pickList(parseJson(r.out));
    return { ok: true, skills: list, text: `${list.length} skill(s) no OpenClaw.` };
  }

  // `global`: pasta compartilhada por todos os agentes. Não combina com `agent` (regra do próprio comando).
  async function install(source, { agent, global = false } = {}) {
    const src = cleanSource(source);
    if (!src) return { ok: false, reason: 'bad-source', text: 'Origem inválida. Use @dono/skill (ClawHub), git:dono/repo ou skills-sh:dono/repo/skill.' };
    const a = cleanAgent(agent);
    const scope = global ? ['--global'] : a ? ['--agent', a] : [];
    const r = await exec(['skills', 'install', src, ...scope], { timeout: 180000 });
    if (r.code !== 0) return fail(r, `instalar ${src}`);
    return {
      ok: true, source: src, kind: kindOf(src), output: tail(r.out, 1200),
      text: `Pronto ✔ ${src} instalada${global ? ' para todos os agentes' : a ? ` no agente ${a}` : ''}. Se ela não aparecer de imediato, reinicie o gateway ou comece uma conversa nova.`,
    };
  }

  async function update({ agent } = {}) {
    const a = cleanAgent(agent);
    const r = await exec(['skills', 'update', '--all', ...(a ? ['--agent', a] : [])], { timeout: 180000 });
    if (r.code !== 0) return fail(r, 'atualizar as skills');
    return { ok: true, output: tail(r.out, 1200), text: 'Skills atualizadas ✔' };
  }

  // Confere se as skills têm tudo o que precisam (inventário, requisitos, visibilidade).
  async function check({ agent } = {}) {
    const a = cleanAgent(agent);
    const r = await exec(['skills', 'check', ...(a ? ['--agent', a] : [])], { timeout: 30000 });
    if (r.code !== 0) return fail(r, 'conferir as skills');
    return { ok: true, output: tail(r.out, 1500), text: 'Conferência feita.' };
  }

  return { search, installed, install, update, check };
}

module.exports = { defaultExec, createSkills, cleanSource, cleanAgent, cleanQuery, kindOf, parseJson, pickList, NO_CLI };
