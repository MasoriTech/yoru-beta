'use strict';
// Memória de longo prazo: fatos curtos sobre o usuário que a IA recebe em toda conversa.
// Funções puras (sem Electron) para poderem ser testadas com `npm test`.
const fs = require('fs');

const MAX_ITEMS = 60;
const MAX_LEN = 200;

const clean = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, MAX_LEN);
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const same = (a, b) => a.toLowerCase() === b.toLowerCase();
const CATEGORIES = ['pessoal', 'preferencias', 'rotina', 'trabalho', 'projetos', 'relacionamentos', 'outros'];
function categorize(text) {
  const t = String(text || '').toLowerCase();
  if (/trabalh|emprego|empresa|cargo|sal[aá]rio|colega|chefe|profiss/.test(t)) return 'trabalho';
  if (/projeto|desenvolv|yoru|masori|programa|aplicativo|site|c[oó]digo/.test(t)) return 'projetos';
  if (/namorad|marido|espos|filh|m[aã]e|pai|irm[aã]|amig|fam[ií]lia/.test(t)) return 'relacionamentos';
  if (/prefere|gosta|n[aã]o gosta|favorit|odeia|curte|gost[ao]/.test(t)) return 'preferencias';
  if (/rotina|todo dia|sempre|hor[aá]rio|costuma|h[aá]bito/.test(t)) return 'rotina';
  if (/mora|nasceu|anivers[aá]rio|idade|altura|nome|formad|estud/.test(t)) return 'pessoal';
  return 'outros';
}

// Dados que nunca devem ficar guardados, mesmo se a IA ou o usuário tentarem
const SENSITIVE = /\b(senha|password|passwd|token|api[-_ ]?key|cart[aã]o|cvv|cpf|rg)\b|\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b|\b(?:\d[ -]?){13,19}\b/i;

function sanitize(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const x of list) {
    const text = clean(x && x.text);
    if (!text || SENSITIVE.test(text) || out.some((o) => same(o.text, text))) continue;
    out.push({ id: typeof x.id === 'string' && x.id ? x.id : newId(), text, category: CATEGORIES.includes(x.category) ? x.category : categorize(text), at: Number(x.at) || Date.now(), updatedAt: Number(x.updatedAt) || Number(x.at) || Date.now() });
  }
  return out.slice(-MAX_ITEMS);
}

// devolve { list, added } sem alterar a lista original
function add(list, text) {
  const t = clean(text);
  if (!t || SENSITIVE.test(t) || list.some((o) => same(o.text, t))) return { list, added: null };
  const item = { id: newId(), text: t, category: categorize(t), at: Date.now(), updatedAt: Date.now() };
  return { list: [...list, item].slice(-MAX_ITEMS), added: item };
}
const remove = (list, id) => list.filter((o) => o.id !== id);
function update(list, id, text) {
  const t = clean(text);
  if (!t || SENSITIVE.test(t) || list.some((o) => o.id !== id && same(o.text, t))) return { list, updated: null };
  let updated = null;
  const next = list.map((o) => { if (o.id !== id) return o; updated = { ...o, text: t, category: categorize(t), updatedAt: Date.now() }; return updated; });
  return { list: next, updated };
}
function search(list, query, category) {
  const q = clean(query).toLocaleLowerCase('pt-BR');
  return list.filter((o) => (!category || category === 'todas' || o.category === category) && (!q || o.text.toLocaleLowerCase('pt-BR').includes(q)));
}
// esquecer por trecho: remove as lembranças que contêm o texto (sem diferenciar maiúsculas)
function forget(list, part) {
  const p = clean(part).toLowerCase();
  if (p.length < 3) return { list, removed: 0 };
  const kept = list.filter((o) => !o.text.toLowerCase().includes(p));
  return { list: kept, removed: list.length - kept.length };
}

// trecho que entra no prompt do sistema
function promptBlock(list) {
  let s = '\n\nMEMÓRIA DE LONGO PRAZO. ';
  if (list.length) {
    // Limita o contexto para não consumir tokens demais: fatos recentes primeiro.
    const recent = [...list].sort((a, b) => (Number(b.updatedAt || b.at) - Number(a.updatedAt || a.at)));
    const lines = []; let used = 0;
    for (const item of recent) { const line = `- ${item.text} [${item.category || categorize(item.text)}]`; if (used + line.length > 3200) continue; lines.push(line); used += line.length; }
    s += 'O que você já sabe sobre o usuário (use com naturalidade, sem recitar a lista):\n' + lines.join('\n') + '\n';
  } else {
    s += 'Você ainda não guardou nada sobre o usuário.\n';
  }
  s += 'Quando o usuário pedir para você lembrar de algo, ou contar um fato pessoal duradouro (nome, gostos, rotina, projetos, pessoas importantes), ' +
    'guarde com UMA tag [lembrar: fato curto] logo depois da tag de emoção. Se ele pedir para esquecer algo, use [esquecer: trecho do fato]. ' +
    'Não guarde coisas passageiras, nem senhas, números de documento ou de cartão. As tags não aparecem para o usuário.';
  return s;
}

// tags [lembrar: ...] e [esquecer: ...] de uma resposta
const TAG = /\[(lembrar|esquecer):\s*([^\]]{1,400})\]\s*/gi;
function extractTags(raw) {
  const remember = [], forgetList = [];
  const text = String(raw).replace(TAG, (m, kind, body) => {
    (kind.toLowerCase() === 'lembrar' ? remember : forgetList).push(clean(body));
    return '';
  }).trim();
  return { text, remember, forget: forgetList };
}

function load(file) {
  try { return sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) { return []; }
}
function save(file, list) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list));
  fs.renameSync(tmp, file);
}

module.exports = { SENSITIVE, MAX_ITEMS, MAX_LEN, CATEGORIES, clean, categorize, sanitize, add, update, remove, search, forget, promptBlock, extractTags, load, save };
