'use strict';
// A Yoru mexe no próprio app: trocar o tema do painel, a cor de destaque, o avatar (modelo) e o item que ela
// segura na mão. Dois caminhos usam este módulo:
//   1) pedido por voz/texto ("muda o tema para escuro", "pega a katana", "larga o item") -> parseIntent;
//   2) a IA escreve tags na resposta ("[app:item=Katana]") -> parseReply (ai-stream.js) -> resolveAll.
// Só mexe em configurações visuais e reversíveis (nada de apagar arquivo ou chamar programa).
// Função pura, sem Electron, para poder ser testada com `npm test`.

const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const norm = (s) => strip(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

// id, nome na tela, jeitos de falar (já sem acento). Os mais longos são testados primeiro.
const THEMES = [
  ['auto', 'Automático', ['automatico', 'do sistema', 'auto']],
  ['dark', 'Escuro', ['escuro', 'dark', 'noturno']],
  ['light', 'Claro', ['claro', 'light', 'branco']],
  ['midnight', 'Meia-noite', ['meia noite', 'preto', 'black', 'amoled']],
  ['ocean', 'Oceano', ['oceano', 'azul', 'mar']],
  ['forest', 'Floresta', ['floresta', 'verde']],
  ['sakura', 'Sakura', ['sakura', 'rosa', 'cerejeira']],
  ['sepia', 'Sépia', ['sepia', 'papel']],
  ['contrast', 'Alto contraste', ['alto contraste', 'contraste']],
];
const ACCENTS = [
  ['#ff7a2e', 'laranja', ['laranja']], ['#ef4444', 'vermelho', ['vermelho', 'vermelha']], ['#3b82f6', 'azul', ['azul']],
  ['#22c55e', 'verde', ['verde']], ['#a855f7', 'roxo', ['roxo', 'roxa', 'violeta']], ['#ec4899', 'rosa', ['rosa', 'pink']],
  ['#eab308', 'amarelo', ['amarelo', 'amarela']], ['#06b6d4', 'ciano', ['ciano', 'turquesa']],
];
// itens que já vêm no app (desenhados por código)
const BUILTIN_ITEMS = [
  ['phone', 'celular', ['celular', 'telefone', 'smartphone']],
  ['dice', 'dados', ['dados', 'dado']],
  ['mug', 'caneca', ['caneca', 'xicara', 'copo']],
  ['book', 'livro', ['livro']],
  ['flower', 'flor', ['flor']],
  ['balloon', 'balão', ['balao', 'bexiga']],
  ['lollipop', 'pirulito', ['pirulito']],
];
// apelidos em português para modelos que vêm no projeto (chave: nome do arquivo sem extensão, normalizado)
const LIB_ALIASES = {
  basketball: ['bola de basquete', 'basquete', 'bola'],
  katana: ['espada', 'katana'],
  'iphone 14 pro': ['iphone'],
};
// nome para falar/mostrar (os outros arquivos usam o próprio nome)
const LIB_LABELS = { basketball: 'bola de basquete', katana: 'katana', 'iphone 14 pro': 'iPhone 14 Pro' };
const DEFAULT_AVATAR_WORDS = ['padrao', 'original', 'inicial', 'default', 'de antes', 'normal'];
const STOP = new Set(['de', 'da', 'do', 'das', 'dos', 'a', 'o', 'as', 'os', 'um', 'uma', 'pra', 'para', 'por', 'favor', 'com', 'e', 'na', 'no', 'em', 'me', 'pro',
  // verbos e palavras de comando: não contam como parte do nome do item/avatar
  'muda', 'mude', 'mudar', 'troca', 'troque', 'trocar', 'vira', 'vire', 'virar', 'pega', 'pegue', 'pegar', 'segura', 'segure', 'segurar',
  'usa', 'use', 'usar', 'coloca', 'coloque', 'poe', 'ponha', 'bota', 'bote', 'quero', 'avatar', 'item', 'modelo', 'personagem', 'mao']);

const words = (s) => norm(s).split(' ').filter(Boolean);
const hasPhrase = (t, p) => new RegExp(`(^| )${p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(t);

// Pontua o quanto a frase `phrase` fala de um candidato (lista de rótulos já normalizados). 0 = não fala.
function scoreLabels(phrase, labels) {
  const t = norm(phrase);
  const pw = new Set(words(t).filter((w) => !STOP.has(w)));
  let best = 0;
  for (const raw of labels) {
    const l = norm(raw);
    if (!l) continue;
    if (hasPhrase(t, l)) { best = Math.max(best, 10 + l.length); continue; }
    const lw = words(l).filter((w) => !STOP.has(w) && w.length >= 3);
    if (lw.length && lw.every((w) => pw.has(w))) best = Math.max(best, 5 + lw.join('').length);
    else if (pw.size && pw.size <= 4 && [...pw].every((w) => w.length >= 3 && words(l).includes(w))) best = Math.max(best, 3 + [...pw].join('').length);
  }
  return best;
}
function bestOf(phrase, cands) {
  let top = null, topScore = 0, tie = false;
  for (const c of cands) {
    const sc = scoreLabels(phrase, c.labels);
    if (sc > topScore) { top = c; topScore = sc; tie = false; } else if (sc && sc === topScore) tie = true;
  }
  return topScore && !tie ? top : null;
}

const stem = (id) => String(id).replace(/\.[^.]+$/, '');
const libBase = (it) => norm(stem(it.id).replace(/[_-]/g, ' '));
const libLabels = (it) => {
  const base = libBase(it);
  return [base, norm(it.name || ''), ...(LIB_ALIASES[base] || []), LIB_LABELS[base] || ''].filter(Boolean);
};
const libShow = (it) => LIB_LABELS[libBase(it)] || it.name || stem(it.id);

function itemCandidates(lib) {
  const out = BUILTIN_ITEMS.map(([key, label, al]) => ({ key, label, labels: [label, ...al] }));
  for (const it of (lib && lib.items) || []) out.push({ key: 'custom:' + it.id, label: libShow(it), labels: libLabels(it) });
  return out;
}
function avatarCandidates(lib) {
  const out = [{ key: 'default', label: 'padrão', labels: DEFAULT_AVATAR_WORDS }];
  for (const a of (lib && lib.avatars) || []) out.push({ key: a.id, label: a.name || stem(a.id), labels: libLabels(a) });
  return out;
}

const resolveTheme = (q) => {
  const t = norm(q);
  const c = bestOf(t, THEMES.map(([id, label, al]) => ({ key: id, label, labels: [label, id, ...al] })));
  return c ? { id: c.key, label: c.label } : null;
};
const resolveAccent = (q) => {
  const c = bestOf(q, ACCENTS.map(([hex, label, al]) => ({ key: hex, label, labels: al })));
  if (c) return { hex: c.key, label: c.label };
  const hex = String(q || '').match(/#[0-9a-fA-F]{6}\b/);
  return hex ? { hex: hex[0].toLowerCase(), label: hex[0] } : null;
};
const resolveItem = (q, lib) => {
  if (/\b(nenhum|nenhuma|nada|sem item|vazio)\b/.test(norm(q)) && !bestOf(q, itemCandidates(lib))) return { key: 'none', label: 'nada' };
  const c = bestOf(q, itemCandidates(lib));
  return c ? { key: c.key, label: c.label } : null;
};
const resolveAvatar = (q, lib) => {
  const c = bestOf(q, avatarCandidates(lib));
  return c ? { key: c.key, label: c.label } : null;
};
const resolveHand = (q) => {
  const t = norm(q);
  if (/\besquerd/.test(t)) return 'left';
  if (/\bdireit/.test(t)) return 'right';
  if (/\b(outra|trocar|troca|inverte)\b/.test(t)) return 'toggle';
  return null;
};

// ---------- pedido por voz / texto ----------
const CHANGE = /\b(muda|mude|mudar|troca|troque|trocar|coloca|coloque|colocar|poe|ponha|por|bota|bote|usa|use|usar|quero|escolhe|escolha|deixa|deixe|vira|vire|ativa|ative)\b/;
const PICK = /\b(pega|pegue|pegar|segura|segure|segurar|empunha|empunhe|empunhar|agarra|agarre|usa|use|usar|me mostra|mostra|mostre|coloca|coloque|poe|ponha|bota|bote|troca|troque|muda|mude|quero|escolhe|escolha|carrega|carregue)\b/;
const DROP = /\b(larga|largue|largar|solta|solte|soltar|guarda|guarde|guardar|abaixa|abaixe|abaixar|tira|tire|tirar|deixa|deixe|deixar|esquece|esqueca)\b/;
const GENERIC_ITEM = /\b(item|itens|objeto|objetos|isso|tudo)\b/;
const VOICE_STUFF = /\b(voz|reconhecimento|whisper|ollama|microfone|openrouter|anthropic|ia)\b/;

function listText(lib) {
  const items = itemCandidates(lib).map((c) => c.label);
  const avs = avatarCandidates(lib).filter((c) => c.key !== 'default').map((c) => c.label);
  return { items, avatars: avs, themes: THEMES.map((x) => x[1]) };
}

// t: frase já normalizada (voice-logic.norm). lib: { avatars: [{id,name}], items: [{id,name}] }
function parseIntent(t, lib) {
  const n = words(t).length;
  if (n === 0 || n > 14) return null;

  // quais itens / avatares / temas ela tem
  if (/\b(quais|que|lista|mostra|mostre)\b.*\b(itens|objetos|avatares|temas|modelos|coisas)\b/.test(t) ||
      /\bo que (voce )?(pode|consegue|sabe) (segurar|pegar)\b/.test(t)) {
    const what = /\bavatar|modelo\b/.test(t) ? 'avatars' : /\btemas?\b/.test(t) ? 'themes' : 'items';
    if (!/\b(do|da|no|na) (tempo|agenda|computador)\b/.test(t)) return { type: 'app', action: 'list', what };
  }

  // tema do painel: "muda o tema para escuro", "modo escuro", "deixa o painel azul"
  if (/\b(tema|temas|aparencia|modo)\b/.test(t) || (/\bpainel\b/.test(t) && CHANGE.test(t) && !/\b(abre|abra|fecha|feche|mostra|esconde)\b/.test(t))) {
    if (/\bcor\b.*\b(destaque|principal)\b|\bdestaque\b/.test(t)) {
      return { type: 'app', action: 'accent', value: resolveAccent(t) };
    }
    if (!VOICE_STUFF.test(t) && (CHANGE.test(t) || /^(tema|modo)\b/.test(t) || resolveTheme(t))) {
      // "modo" sozinho é ambíguo ("modo avião"): só vale se a frase falar de um tema conhecido
      const th = resolveTheme(t);
      if (th || /\b(tema|temas|aparencia)\b/.test(t)) return { type: 'app', action: 'theme', value: th };
    }
  }
  if (/\bcor\b/.test(t) && /\b(destaque|principal|do painel|do app|do tema)\b/.test(t) && CHANGE.test(t)) {
    return { type: 'app', action: 'accent', value: resolveAccent(t) };
  }

  // mão em que ela segura o item
  if (/\bmao\b/.test(t) && /\b(item|segura|segurar|esquerda|direita|outra|troca|troque)\b/.test(t) && resolveHand(t) && !PICK_HAS_ITEM(t, lib)) {
    return { type: 'app', action: 'hand', value: resolveHand(t) };
  }

  // soltar o item
  if (/\b(sem item|sem nada na mao|mao vazia)\b/.test(t)) return { type: 'app', action: 'item', value: { key: 'none', label: 'nada' } };
  if (DROP.test(t) && !/\b(janela|print|som|volume|computador|agenda)\b/.test(t)) {
    const named = resolveItem(t, lib);
    if (GENERIC_ITEM.test(t) || /\bsegurando\b/.test(t) || (named && named.key !== 'none')) {
      return { type: 'app', action: 'item', value: { key: 'none', label: 'nada' } };
    }
  }

  // pegar/segurar um item
  const it = resolveItem(t, lib);
  if (PICK.test(t) && it && it.key !== 'none') {
    const tryAvatarWord = /\b(avatar|personagem|modelo|roupa|skin)\b/.test(t);
    if (!tryAvatarWord || /\b(item|objeto|na mao|segura|pega)\b/.test(t)) {
      return { type: 'app', action: 'item', value: it, hand: resolveHand(t) };
    }
  }
  if (PICK.test(t) && GENERIC_ITEM.test(t) && /\b(item|objeto)\b/.test(t) && !/\b(do|da)\b.*\b(agenda|lista)\b/.test(t) && !VOICE_STUFF.test(t)) {
    return { type: 'app', action: 'item', value: null };
  }

  // trocar de avatar (modelo)
  const wantsAvatar = /\b(avatar|personagem|roupa|skin|modelo|corpo|visual)\b/.test(t) && CHANGE.test(t) && !VOICE_STUFF.test(t) && !/\b3d de item\b/.test(t);
  if (wantsAvatar) return { type: 'app', action: 'avatar', value: resolveAvatar(t, lib) };
  // "vira a Noelle", "muda para a Noelle": só vale se o nome for de um avatar conhecido
  if (/\b(vira|vire|virar|muda|mude|troca|troque|se transforma|transforme)\b/.test(t)) {
    const av = resolveAvatar(t, lib);
    if (av && av.key !== 'default') return { type: 'app', action: 'avatar', value: av };
    if (av && /\b(avatar|padrao|original|inicial)\b/.test(t)) return { type: 'app', action: 'avatar', value: av };
  }
  return null;
}
function PICK_HAS_ITEM(t, lib) { const r = resolveItem(t, lib); return !!(r && r.key !== 'none'); }

// ---------- executar ----------
// Resolve uma ação (de voz ou de tag da IA) e devolve o que mudar nas configurações + o que ela fala.
// act: { action: 'theme'|'accent'|'item'|'avatar'|'hand'|'list', value: objeto já resolvido OU texto (tag da IA), what }
function resolveOne(act, lib, cur = {}) {
  const lst = listText(lib);
  const miss = (what, names) => ({ ok: false, partial: null, say: `Não achei ${what}. ${names.length ? 'Tenho: ' + names.join(', ') + '.' : 'Ainda não tenho nenhum na biblioteca.'}` });
  const val = act.value;
  const asText = typeof val === 'string' ? val : null;
  switch (act.action) {
    case 'theme': {
      const th = asText != null ? resolveTheme(asText) : val;
      if (!th) return miss('esse tema', lst.themes);
      if (cur.panelTheme === th.id) return { ok: true, partial: null, say: `O tema já está em ${th.label}.` };
      return { ok: true, partial: { panelTheme: th.id }, say: `Pronto, tema ${th.label}!` };
    }
    case 'accent': {
      const ac = asText != null ? resolveAccent(asText) : val;
      if (!ac) return miss('essa cor', ACCENTS.map((a) => a[1]));
      return { ok: true, partial: { panelAccent: ac.hex }, say: `Cor de destaque ${ac.label}!` };
    }
    case 'item': {
      if (val === null || val === undefined) return miss('esse item', lst.items);
      const it = asText != null ? resolveItem(asText, lib) : val;
      if (!it) return miss('esse item', lst.items);
      const partial = { item: it.key };
      if (act.hand === 'left' || act.hand === 'right') partial.itemHand = act.hand;
      if (it.key === 'none') return { ok: true, partial, say: cur.item && cur.item !== 'none' ? 'Pronto, larguei o item.' : 'Já estou de mãos vazias.' };
      return { ok: true, partial, say: `Pronto, ${it.label} na mão!` };
    }
    case 'avatar': {
      const av = asText != null ? resolveAvatar(asText, lib) : val;
      if (!av) return miss('esse avatar', lst.avatars);
      if (cur.avatarFile === av.key) return { ok: true, partial: null, say: 'Já estou com esse visual.' };
      return { ok: true, partial: { avatarFile: av.key }, say: av.key === 'default' ? 'Voltei ao visual padrão!' : `Trocando para ${av.label}!` };
    }
    case 'hand': {
      let h = asText != null ? (['left', 'right', 'toggle'].includes(asText) ? asText : resolveHand(asText)) : val;
      if (h === 'toggle') h = cur.itemHand === 'left' ? 'right' : 'left';
      if (h !== 'left' && h !== 'right') return { ok: false, partial: null, say: 'Em qual mão? Esquerda ou direita.' };
      return { ok: true, partial: { itemHand: h }, say: `Agora seguro na mão ${h === 'left' ? 'esquerda' : 'direita'}.` };
    }
    case 'list': {
      const what = act.what || 'items';
      const names = what === 'avatars' ? lst.avatars : what === 'themes' ? lst.themes : lst.items;
      const label = what === 'avatars' ? 'Avatares' : what === 'themes' ? 'Temas' : 'Itens que posso segurar';
      return { ok: true, partial: null, say: names.length ? `${label}: ${names.join(', ')}.` : `${label}: nenhum na biblioteca ainda.` };
    }
    default: return { ok: false, partial: null, say: 'Não entendi o que mudar.' };
  }
}

// intent vindo do parseIntent (voz/texto)
function handleIntent(intent, lib, cur) {
  return resolveOne({ action: intent.action, value: intent.value, what: intent.what, hand: intent.hand }, lib, cur);
}

// tags da IA: [{ kind: 'tema'|'item'|'avatar'|'mao'|'cor', value: texto }] -> junta tudo num só pacote de configurações
const KIND = { tema: 'theme', theme: 'theme', item: 'item', avatar: 'avatar', modelo: 'avatar', mao: 'hand', hand: 'hand', cor: 'accent', accent: 'accent' };
function resolveAll(actions, lib, cur = {}) {
  const partial = {};
  const errors = [];
  let state = { ...cur };
  for (const a of actions || []) {
    const action = KIND[strip(a.kind)];
    if (!action) continue;
    const r = resolveOne({ action, value: a.value }, lib, state);
    if (r.ok && r.partial) { Object.assign(partial, r.partial); state = { ...state, ...r.partial }; }
    else if (!r.ok) errors.push(`${a.kind}=${a.value}`);
  }
  return { partial, errors };
}

// bloco que entra no prompt da IA (com as listas atuais, para ela usar os nomes certos)
function promptBlock(lib, cur = {}) {
  const lst = listText(lib);
  const themeNow = (THEMES.find((x) => x[0] === (cur.panelTheme || 'auto')) || THEMES[0])[1];
  const itemNow = cur.item && cur.item !== 'none'
    ? (itemCandidates(lib).find((c) => c.key === cur.item) || { label: cur.item }).label : 'nada';
  const avNow = !cur.avatarFile || cur.avatarFile === 'default' ? 'padrão'
    : (avatarCandidates(lib).find((c) => c.key === cur.avatarFile) || { label: cur.avatarFile }).label;
  return '\n\nVOCÊ PODE MEXER NO PRÓPRIO APP quando o usuário pedir (ou concordar com a sua sugestão). Faça isso escrevendo tags no começo da resposta, junto da emoção; o app executa e esconde a tag:\n' +
    `- [app:tema=NOME] muda o tema do painel. Temas: ${lst.themes.join(', ')}. (agora: ${themeNow})\n` +
    `- [app:cor=NOME] muda a cor de destaque. Cores: ${ACCENTS.map((a) => a[1]).join(', ')}.\n` +
    `- [app:item=NOME] você pega e segura o item na mão; [app:item=nenhum] você solta. Itens: ${lst.items.join(', ')}. (agora: ${itemNow})\n` +
    '- [app:mao=esquerda] ou [app:mao=direita] escolhe a mão que segura o item.\n' +
    `- [app:avatar=NOME] troca o seu visual (modelo 3D); [app:avatar=padrão] volta ao original. Avatares: ${lst.avatars.length ? lst.avatars.join(', ') : 'nenhum extra na biblioteca'}, padrão. (agora: ${avNow})\n` +
    'Regras: use o nome exatamente como está na lista; uma tag por mudança; só quando houver pedido; depois da tag, diga em uma frase curta o que fez. ' +
    'Se o que pediram não está na lista, não use tag e diga as opções que existem. Você não muda mais nada no app (chave da IA, arquivos, voz). ' +
    'Exemplo: "[happy] [app:item=Katana] Peguei a katana!"';
}

module.exports = {
  THEMES, ACCENTS, BUILTIN_ITEMS, norm, parseIntent, handleIntent, resolveOne, resolveAll, promptBlock,
  resolveTheme, resolveAccent, resolveItem, resolveAvatar, resolveHand, listText,
};
