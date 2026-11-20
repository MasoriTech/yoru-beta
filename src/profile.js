'use strict';
// Perfil do usuário: dados pessoais opcionais que a IA usa para personalizar as respostas.
// Funções puras (sem Electron) para poderem ser testadas com `npm test`.
const fs = require('fs');
const { SENSITIVE } = require('./memory');

const GENDERS = ['f', 'm', 'o'];
const OPT_KEYS = ['location', 'job', 'company', 'goals', 'prefs', 'health'];
const OPT_LABEL = { location: 'Mora em', job: 'Profissão', company: 'Empresa', goals: 'Objetivos', prefs: 'Preferências', health: 'Condições de saúde' };
const MAX_INTERESTS = 12;
const MAX_PHOTO = 300 * 1024; // caracteres do data URL

const text = (v, max) => {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
  return SENSITIVE.test(t) ? '' : t; // senha, CPF, cartão... nunca ficam guardados
};
const num = (v, min, max) => {
  const n = Number(String(v == null ? '' : v).replace(',', '.'));
  return Number.isFinite(n) && v !== '' && n >= min && n <= max ? Math.round(n * 100) / 100 : null;
};

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return '';
  const d = new Date(s + 'T12:00:00');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return '';
  if (d > new Date() || d.getFullYear() < 1900) return '';
  return s;
}

function ageFrom(birth, now = new Date()) {
  if (!validDate(birth)) return null;
  const [y, m, d] = birth.split('-').map(Number);
  let a = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) a--;
  return a >= 0 ? a : null;
}

function empty() {
  return {
    name: '', nickname: '', birth: '', gender: '', height: null, weight: null, about: '', photo: '',
    opt: Object.fromEntries(OPT_KEYS.map((k) => [k, ''])), interests: [],
    track: { weight: false, workout: false, meals: false }, weightGoal: null,
    useInPrompt: true, createdAt: 0,
  };
}

function sanitize(p, prev) {
  const base = empty();
  const x = p && typeof p === 'object' ? p : {};
  const o = x.opt && typeof x.opt === 'object' ? x.opt : {};
  const t = x.track && typeof x.track === 'object' ? x.track : {};
  const out = {
    ...base,
    name: text(x.name, 40), nickname: text(x.nickname, 24), birth: validDate(x.birth),
    gender: GENDERS.includes(x.gender) ? x.gender : '',
    height: num(x.height, 0.5, 2.5), weight: num(x.weight, 20, 400), weightGoal: num(x.weightGoal, 20, 400),
    about: text(x.about, 300),
    photo: typeof x.photo === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x.photo) && x.photo.length <= MAX_PHOTO ? x.photo : '',
    opt: Object.fromEntries(OPT_KEYS.map((k) => [k, text(o[k], 120)])),
    track: { weight: !!t.weight, workout: !!t.workout, meals: !!t.meals },
    useInPrompt: x.useInPrompt !== false,
  };
  const seen = new Set();
  for (const i of Array.isArray(x.interests) ? x.interests : []) {
    const v = text(i, 24);
    if (v && !seen.has(v.toLowerCase()) && seen.size < MAX_INTERESTS) { seen.add(v.toLowerCase()); out.interests.push(v); }
  }
  const keep = prev && Number(prev.createdAt) > 0 ? Number(prev.createdAt) : Number(x.createdAt) > 0 ? Number(x.createdAt) : 0;
  out.createdAt = keep || (out.name || out.nickname ? Date.now() : 0);
  return out;
}

const filled = (p) => !!(p && (p.name || p.nickname || p.birth || p.gender || p.height || p.weight || p.about || p.interests.length ||
  OPT_KEYS.some((k) => p.opt[k]) || p.track.weight || p.track.workout || p.track.meals));

// trecho que entra no prompt do sistema
function promptBlock(p) {
  if (!p || p.useInPrompt === false || !filled(p)) return '';
  const L = [];
  const call = p.nickname || p.name;
  if (p.name) L.push(`Nome: ${p.name}`);
  if (call) L.push(`Chame o usuário de: ${call}`);
  const age = ageFrom(p.birth);
  if (age != null) L.push(`Idade: ${age} anos`);
  if (p.gender) L.push(`Gênero: ${{ f: 'feminino', m: 'masculino', o: 'outro' }[p.gender]}`);
  if (p.height) L.push(`Altura: ${String(p.height).replace('.', ',')} m`);
  if (p.weight) L.push(`Peso: ${String(p.weight).replace('.', ',')} kg`);
  for (const k of OPT_KEYS) if (p.opt[k]) L.push(`${OPT_LABEL[k]}: ${p.opt[k]}`);
  if (p.interests.length) L.push(`Interesses: ${p.interests.join(', ')}`);
  if (p.about) L.push(`Sobre o usuário: ${p.about}`);
  const goals = [];
  if (p.track.weight) goals.push(p.weightGoal ? `acompanhar o peso (meta: ${String(p.weightGoal).replace('.', ',')} kg)` : 'acompanhar o peso');
  if (p.track.workout) goals.push('acompanhar a rotina de treinos');
  if (p.track.meals) goals.push('acompanhar a alimentação');
  if (goals.length) L.push(`Quer ${goals.join(', ')}`);
  return '\n\nPERFIL DO USUÁRIO (dados informados por ele; use com naturalidade e sem recitar a lista, só quando ajudar):\n' + L.map((l) => `- ${l}`).join('\n');
}

function load(file) {
  try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) { return empty(); }
}
function save(file, p) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(p));
  fs.renameSync(tmp, file);
}

module.exports = { GENDERS, OPT_KEYS, OPT_LABEL, MAX_INTERESTS, empty, sanitize, ageFrom, validDate, promptBlock, load, save };
