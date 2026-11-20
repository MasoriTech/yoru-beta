'use strict';
// Lógica pura da conversa por voz (sem Electron): reconhecer o nome dela,
// entender os pedidos e montar as falas (hora, comentários, etc.).

const APP = require('./app-actions');
const strip = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const norm = (s) => strip(s).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length) % arr.length];

// ---------- nome de chamada (a transcrição erra: "Yoru" vira "Ioru", "Joru"...) ----------
function lev(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
// som parecido (português falado): y/j/h no começo viram "i", w vira "u", o final/átono soa "u",
// e átono soa "i", letras repetidas colapsam ("Yorou", "Joro", "Ioru" -> "iuru")
const canon = (w) => w.replace(/h/g, '').replace(/[yj]/g, 'i').replace(/w/g, 'u').replace(/o/g, 'u').replace(/e/g, 'i').replace(/(.)\1+/g, '$1');

function sameWord(a, b) {
  if (a === b) return true;
  const ca = canon(a), cb = canon(b);
  if (ca === cb) return true;
  // a transcrição às vezes come a primeira letra ("Oru" por "Yoru"): vale se o resto bate
  const ta = ca.replace(/^i/, ''), tb = cb.replace(/^i/, '');
  const lostOne = (ca !== ta) !== (cb !== tb); // só um dos dois começava com "i"
  if (lostOne && ta === tb && ta.length >= 3) return true;
  if (Math.min(ca.length, cb.length) < 4) return false; // nomes curtos: só igualdade exata
  const max = Math.max(ca.length, cb.length) <= 5 ? 1 : 2;
  return ca[0] === cb[0] && lev(ca, cb) <= max;
}

const FILLERS = new Set(['ei', 'ey', 'hey', 'oi', 'ola', 'ok', 'okay', 'opa', 'fala', 'e', 'ai', 'o', 'ow', 'oh', 'eh', 'psiu']);
const FILLER_PREFIXES = ['hey', 'ola', 'oi', 'ei', 'ey', 'ok', 'opa', 'ai', 'o']; // grudados no nome: "oiyoru", "eiyoru"

function wakeList(wake, aliases) {
  const out = [];
  for (const raw of [wake, ...String(aliases || '').split(/[,;\n]/)]) {
    const parts = norm(raw).split(' ').filter(Boolean);
    if (parts.length) out.push(parts);
  }
  return out;
}

// Tenta casar o nome (lista de palavras) a partir do token i. Aceita:
//  - a palavra certa ou parecida ("Ioru", "Joru");
//  - a palavra dividida pela transcrição em duas ("Yo ru") ou com "oi/ei" colado ("oiyoru");
// Devolve quantos tokens consumiu, ou 0.
// palavras comuns do português que soam quase igual ao nome: só valem se forem escritas exatamente como o nome
const NOT_A_NAME = new Set(['ouro', 'ouros', 'juro', 'juros', 'jura', 'jurou', 'jurar', 'euro', 'euros', 'oro', 'uru', 'jururu', 'ioga', 'iogurte', 'ora']);
function matchName(ntoks, i, parts) {
  let j = i;
  for (let k = 0; k < parts.length; k++) {
    const t = ntoks[j];
    if (!t) return 0;
    if (NOT_A_NAME.has(t) && t !== parts[k]) return 0;
    if (sameWord(t, parts[k])) { j += 1; continue; }
    if (ntoks[j + 1] && !NOT_A_NAME.has(ntoks[j + 1]) && sameWord(t + ntoks[j + 1], parts[k])) { j += 2; continue; }
    if (k === 0) {
      const f = FILLER_PREFIXES.find((p) => t.length >= p.length + 3 && t.startsWith(p) && sameWord(t.slice(p.length), parts[k]));
      if (f) { j += 1; continue; }
    }
    return 0;
  }
  return j - i;
}

// Procura o nome no começo (até 5 palavras) ou no fim (últimas 3) da frase.
function findWake(text, wake, aliases) {
  const toks = String(text || '').trim().split(/\s+/).filter(Boolean);
  const ntoks = toks.map(norm);
  const names = wakeList(wake, aliases);
  const n = toks.length;
  for (let i = 0; i < n; i++) {
    if (!(i < 5 || i >= n - 3)) continue;
    if (!ntoks[i]) continue;
    for (const parts of names) {
      const used = matchName(ntoks, i, parts);
      if (!used) continue;
      let from = i;
      while (from > 0 && FILLERS.has(ntoks[from - 1])) from--; // "ei", "oi" antes do nome
      if (from > 0 && ntoks.slice(0, from).some((t) => !FILLERS.has(t))) from = i; // tem outras palavras: só tira o nome
      const rest = [...toks.slice(0, from), ...toks.slice(i + used)].join(' ')
        .replace(/^[\s,.!?;:\-–]+|[\s,.!?;:\-–]+$/g, '')
        .trim();
      return { called: true, rest };
    }
  }
  return { called: false, rest: String(text || '').trim() };
}

// ---------- ruído / alucinações do Whisper em silêncio ----------
const HALLU = [
  'amara org', 'legendas pela comunidade', 'legendado por', 'inscreva se', 'obrigado por assistir', 'obrigada por assistir',
  'ate o proximo video', 'nao se esqueca de se inscrever', 'curta o video', 'www ', 'http',
  'deixe seu like', 'deixa seu like', 'ative o sininho', 'se inscreva no canal', 'thanks for watching', 'subtitles by',
  'sous titres', 'traducao e legendas', 'legenda por', 'legendas por', 'proximo episodio', 'musica de fundo',
];
function isNoise(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  if (/^[\[\(♪\*].*[\]\)♪\*]$/.test(raw)) return true; // [música], (aplausos), ♪ ... ♪
  const t = norm(raw);
  if (t.length < 2 && !/\d/.test(t)) return true;
  if (/^(hum+|ah+|eh+|uh+|oh+|hm+|mm+|ahn+|e+|o+|a+|uhum)$/.test(t)) return true;
  const w = t.split(' ');
  if (w.length <= 12 && HALLU.some((h) => t.includes(h))) return true; // frase longa que cita "transcrição" etc. é do usuário

  if (w.length >= 6 && new Set(w).size / w.length < 0.34) return true; // loop de repetição ("obrigado obrigado obrigado...")
  return false;
}

// ---------- pedidos ----------
// Ordem importa: o primeiro que combinar vence, então os específicos vêm antes dos genéricos
// (ex.: "google agenda" e "google drive" antes de "google", que abre o navegador).
const SITES = [
  { key: 'youtube', re: /\b(youtube|you tube|iutube|iutiube)\b/, url: 'https://www.youtube.com', label: 'o YouTube' },
  { key: 'agenda', re: /\bgoogle (agenda|calendar|calendario)\b/, url: 'https://calendar.google.com', label: 'a Google Agenda' },
  { key: 'docs', re: /\b(google docs|google documentos|documentos google)\b/, url: 'https://docs.google.com', label: 'o Google Docs' },
  { key: 'sheets', re: /\b(google planilhas|google sheets|planilhas google)\b/, url: 'https://sheets.google.com', label: 'o Google Planilhas' },
  { key: 'photos', re: /\b(google fotos|fotos do google)\b/, url: 'https://photos.google.com', label: 'o Google Fotos' },
  { key: 'translate', re: /\b(tradutor|google tradutor|google translate)\b/, url: 'https://translate.google.com', label: 'o Google Tradutor' },
  { key: 'drive', re: /\b(drive|google drive)\b/, url: 'https://drive.google.com', label: 'o Drive' },
  { key: 'gmail', re: /\b(gmail|e mail|email|correio)\b/, url: 'https://mail.google.com', label: 'o Gmail' },
  { key: 'whatsapp', re: /\b(whatsapp|zap|zapzap)\b/, url: 'https://web.whatsapp.com', label: 'o WhatsApp' },
  { key: 'maps', re: /\b(maps|mapas?)\b/, url: 'https://maps.google.com', label: 'o Maps' },
  { key: 'spotify', re: /\b(spotify)\b/, url: 'https://open.spotify.com', label: 'o Spotify' },
  { key: 'prime', re: /\b(prime video|amazon prime|prime)\b/, url: 'https://www.primevideo.com', label: 'o Prime Video' },
  { key: 'netflix', re: /\b(netflix)\b/, url: 'https://www.netflix.com', label: 'a Netflix' },
  { key: 'disney', re: /\b(disney|disney plus|disney mais)\b/, url: 'https://www.disneyplus.com', label: 'o Disney Plus' },
  { key: 'github', re: /\b(github|git hub)\b/, url: 'https://github.com', label: 'o GitHub' },
  { key: 'instagram', re: /\b(instagram|insta)\b/, url: 'https://www.instagram.com', label: 'o Instagram' },
  { key: 'facebook', re: /\b(facebook|face)\b/, url: 'https://www.facebook.com', label: 'o Facebook' },
  { key: 'twitter', re: /\b(twitter|x com)\b/, url: 'https://x.com', label: 'o X' },
  { key: 'linkedin', re: /\b(linkedin|linked in)\b/, url: 'https://www.linkedin.com', label: 'o LinkedIn' },
  { key: 'reddit', re: /\b(reddit)\b/, url: 'https://www.reddit.com', label: 'o Reddit' },
  { key: 'tiktok', re: /\b(tiktok|tik tok)\b/, url: 'https://www.tiktok.com', label: 'o TikTok' },
  { key: 'pinterest', re: /\b(pinterest)\b/, url: 'https://www.pinterest.com', label: 'o Pinterest' },
  { key: 'twitch', re: /\b(twitch)\b/, url: 'https://www.twitch.tv', label: 'a Twitch' },
  { key: 'discord', re: /\b(discord)\b/, url: 'https://discord.com/app', label: 'o Discord' },
  { key: 'telegram', re: /\b(telegram)\b/, url: 'https://web.telegram.org', label: 'o Telegram' },
  { key: 'outlook', re: /\b(outlook|hotmail)\b/, url: 'https://outlook.live.com', label: 'o Outlook' },
  { key: 'canva', re: /\b(canva)\b/, url: 'https://www.canva.com', label: 'o Canva' },
  { key: 'chatgpt', re: /\b(chat gpt|chatgpt)\b/, url: 'https://chatgpt.com', label: 'o ChatGPT' },
  { key: 'claude', re: /\b(claude)\b/, url: 'https://claude.ai', label: 'o Claude' },
  { key: 'wikipedia', re: /\b(wikipedia|wikipédia)\b/, url: 'https://pt.wikipedia.org', label: 'a Wikipédia' },
  { key: 'mercadolivre', re: /\b(mercado livre|mercadolivre)\b/, url: 'https://www.mercadolivre.com.br', label: 'o Mercado Livre' },
  { key: 'amazon', re: /\b(amazon)\b/, url: 'https://www.amazon.com.br', label: 'a Amazon' },
  { key: 'calc', re: /\b(calculadora)\b/, app: 'calc', label: 'a calculadora' },
  { key: 'notepad', re: /\b(bloco de notas|notepad|editor de texto)\b/, app: 'notepad', label: 'o bloco de notas' },
  { key: 'paint', re: /\b(paint)\b/, app: 'paint', label: 'o Paint' },
  { key: 'explorer', re: /\b(explorador( de arquivos)?|gerenciador de arquivos|finder)\b/, app: 'explorer', label: 'o explorador de arquivos' },
  { key: 'taskmgr', re: /\b(gerenciador de tarefas)\b/, app: 'taskmgr', label: 'o gerenciador de tarefas' },
  { key: 'google', re: /\b(navegador|browser|internet|chrome|firefox|edge|brave|opera|google)\b/, url: 'https://www.google.com', label: 'o navegador' },
];

// Verbos "fortes": abrir qualquer coisa, mesmo que ela não conheça (aí ela avisa).
const OPEN_VERB = /\b(abr[ae]|abrir|abri|inici[ae]|iniciar|executa|executar|execute|ligue|liga|ligar|acesse|acessa|acessar|va para|vai para|entra em|entre em|visite|visitar)\b/;
// Verbos "fracos": só valem quando o que vem depois é um site/programa que ela conhece
// ("me mostre o youtube", "quero o gmail", "vai no maps"), para não atrapalhar conversa normal.
const WEAK_OPEN = /\b(mostr(?:e|a|ar)|exib(?:a|ir)|quero (?:ver|usar|acessar|entrar|abrir|ir|o|a)|queria (?:ver|usar|o|a)|preciso (?:do|da|de)|me leva|me leve|leva|levar|vai (?:no|na|pro|pra|para|ao)|va (?:no|na|pro|pra|para|ao)|ir (?:no|na|pro|pra|para|ao)|entra (?:no|na)|bota|coloca|poe|ponha|carrega|chama|sobe|manda ver|pode (?:abrir|ser))\b/;

// ---------- agenda e clima ----------
const AG_NOUN = /\b(agenda|compromissos?|lembretes?|calendario|eventos?|tarefas?)\b/;
const AG_ADD = /\b(agend(?:e|ar)|marc[ae]r?|marque|anot[ae]r?|adicion[ae]r?|colo(?:que|ca|car)|ponha|poe|cri[ae]r?|cadastr[ae]r?|registr[ae]r?|insira|inserir)\b/;
const AG_REMIND = /\b(me\s+(lembr[ae]r?|avis[ae]r?)|lembrete)\b/;
const AG_DEL = /\b(apag(?:ue|ar|a)|remov(?:a|e|er)|cancel(?:e|a|ar)|exclu(?:a|i|ir)|delet(?:e|ar)|tire|tirar)\b/;
const AG_LIST_VERB = /\b(mostr[ae]r?|ver|veja|le|leia|ler|fal[ae]r?|dig[ao]|diz|consult[ae]r?|confira|checar|checa|abr[ae]r?|abrir)\b/;

function agendaIntent(t, words) {
  if (/\bgoogle\b/.test(t)) return null;
  const noun = AG_NOUN.test(t);
  if (/\b(limp[ae]r?|esvazi[ae]r?)\b.*\bagenda\b/.test(t)) return { type: 'agenda-clear' };
  if (AG_DEL.test(t) && /\b(agenda|compromissos?|lembretes?|eventos?|tarefas?|reuniao|consulta)\b/.test(t)) return { type: 'agenda-remove' };
  if (AG_REMIND.test(t) && words >= 3) return { type: 'agenda-add' };
  if (/\b(agend(?:e|ar)|marc[ae]r?|marque)\b/.test(t) && words >= 3) return { type: 'agenda-add' };
  if (noun && AG_ADD.test(t)) return { type: 'agenda-add' };
  if (noun && (/\b(o que|que|quais?|quantos?)\b.*\b(tem|ha|tenho|marcado|agendado|compromissos?|lembretes?)\b/.test(t) ||
      /\b(tem|tenho|ha)\b.*\b(algum|alguma|compromissos?|lembretes?|reunioes|reuniao)\b/.test(t) ||
      AG_LIST_VERB.test(t) || /^(minha |a |meus |os )?(agenda|compromissos?|lembretes?)( de (hoje|amanha))?$/.test(t))) return { type: 'agenda-list' };
  return null;
}

function weatherIntent(t, words) {
  if (words > 14 || /\b(pesquis[ae]r?|procur[ae]r?|busc[ae]r?|googl[ae])\b/.test(t)) return null;
  if (/\b(clima|previsao( do tempo)?|temperatura|vai chover|chovendo|chuva|guarda chuva|como (esta|ta) o tempo|tempo (hoje|agora|amanha|la fora|esta|ta|fazendo|vai))\b/.test(t)) return { type: 'weather' };
  if (words <= 5 && /^(esta|ta|faz|fica|vai (ficar|fazer)|hoje|agora)\b.*\b(frio|calor|quente|gelado|abafado|ensolarado|nublado|sol)\b/.test(t)) return { type: 'weather' };
  return null;
}


// ---------- números, contas e tempo ----------
const UNITS = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19 };
const TENS = { vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90 };
const HUND = { cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900 };

// "vinte e cinco" -> { value: 25, next: índice depois do número }
function wordNum(toks, i) {
  let j = i, val = 0, stage = 0, end = i;
  while (j < toks.length) {
    let w = toks[j];
    if (w === 'e' && stage > 0 && stage < 3) { j++; w = toks[j]; if (w === undefined) break; }
    if (HUND[w] != null && stage < 1) { val += HUND[w]; stage = 1; }
    else if (TENS[w] != null && stage < 2) { val += TENS[w]; stage = 2; }
    else if (UNITS[w] != null && stage < 3) { val += UNITS[w]; stage = 3; }
    else break;
    j++; end = j;
  }
  return end > i ? { value: val, next: end } : null;
}
// troca números por extenso por dígitos (texto já normalizado)
function numberize(t) {
  const toks = t.split(' ');
  const out = [];
  for (let i = 0; i < toks.length;) {
    const r = wordNum(toks, i);
    if (r) { out.push(String(r.value)); i = r.next; } else out.push(toks[i++]);
  }
  return out.join(' ');
}
// versão que preserva dígitos, vírgula decimal e símbolos de conta
function mathNorm(raw) {
  let s = strip(raw);
  s = s.replace(/(\d)\s*,\s*(\d)/g, '$1.$2')
    .replace(/(\d)\s*%/g, '$1 por cento ')
    .replace(/×/g, ' vezes ').replace(/÷/g, ' dividido por ')
    .replace(/(\d)\s*x\s*(\d)/g, '$1 vezes $2')
    .replace(/\+/g, ' mais ').replace(/\*/g, ' vezes ').replace(/\//g, ' dividido por ')
    .replace(/(\d)\s*-\s*(\d)/g, '$1 menos $2').replace(/\s-\s/g, ' menos ')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .replace(/\.(?!\d)/g, ' ').replace(/(\d)\.(?=\s|$)/g, '$1');
  s = s.replace(/\s+/g, ' ').trim().replace(/\bpor cento\b/g, 'porcento');
  return numberize(s).replace(/\bporcento\b/g, 'por cento');
}

const NUM = '(\\d+(?:\\.\\d+)?)';
const fmtNum = (n) => Number(n.toFixed(4)).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

// resolve "2 + 3 * 4" (sem parênteses) respeitando a precedência
function evalFlat(tokens) {
  const nums = [], ops = [];
  let i = 0, sign = 1;
  if (tokens[0] === '-') { sign = -1; i = 1; }
  for (let k = i, expectNum = true; k < tokens.length; k++, expectNum = !expectNum) {
    const x = tokens[k];
    if (expectNum) { if (!/^\d/.test(x)) return null; nums.push(parseFloat(x) * (nums.length ? 1 : sign)); }
    else { if (!/^[+\-*/]$/.test(x)) return null; ops.push(x); }
  }
  if (nums.length !== ops.length + 1 || nums.length < 2) return null;
  const n2 = [nums[0]], o2 = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k] === '*' || ops[k] === '/') {
      const a = n2.pop(), b = nums[k + 1];
      if (ops[k] === '/' && b === 0) return { error: 'div0' };
      n2.push(ops[k] === '*' ? a * b : a / b);
    } else { o2.push(ops[k]); n2.push(nums[k + 1]); }
  }
  let r = n2[0];
  for (let k = 0; k < o2.length; k++) r = o2[k] === '+' ? r + n2[k + 1] : r - n2[k + 1];
  return { value: r };
}

// "quanto é 2 mais 2", "20 por cento de 150", "raiz quadrada de 81", "5 ao quadrado"
function mathIntent(raw) {
  let u = mathNorm(raw).replace(/\bpor favor\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\d/.test(u) || u.split(' ').length > 14) return null;
  u = u.replace(/^(?:(?:quanto|qual|me|diga|diz|fale|fala|calcule|calcula|calcular|faca|faz|resolva|resolve|pode|poderia|voce|a|o|conta|resultado|de|e|eh|da|vale|fica|seria|sera|igual|sao)\s+)+/, '');
  let m, value, spoken;
  if ((m = u.match(new RegExp('^raiz (?:quadrada )?(?:de )?' + NUM + '$')))) {
    value = Math.sqrt(parseFloat(m[1])); spoken = `raiz de ${fmtNum(parseFloat(m[1]))}`;
  } else if ((m = u.match(new RegExp('^' + NUM + ' por cento (?:de )?' + NUM + '$')))) {
    value = parseFloat(m[1]) * parseFloat(m[2]) / 100; spoken = `${fmtNum(parseFloat(m[1]))} por cento de ${fmtNum(parseFloat(m[2]))}`;
  } else if ((m = u.match(new RegExp('^' + NUM + ' (?:ao quadrado|elevado ao quadrado)$')))) {
    value = parseFloat(m[1]) ** 2; spoken = `${fmtNum(parseFloat(m[1]))} ao quadrado`;
  } else if ((m = u.match(new RegExp('^' + NUM + ' (?:ao cubo|elevado ao cubo)$')))) {
    value = parseFloat(m[1]) ** 3; spoken = `${fmtNum(parseFloat(m[1]))} ao cubo`;
  } else if ((m = u.match(new RegExp('^' + NUM + ' elevado (?:a |na |ao )?' + NUM + '$')))) {
    value = parseFloat(m[1]) ** parseFloat(m[2]); spoken = `${fmtNum(parseFloat(m[1]))} elevado a ${fmtNum(parseFloat(m[2]))}`;
  } else {
    const e = u.replace(/\bmultiplicado por\b/g, '*').replace(/\bvezes\b/g, '*')
      .replace(/\bdividido (?:por|pra|para)\b/g, '/').replace(/\bdividido\b/g, '/')
      .replace(/\bmais\b/g, '+').replace(/\bmenos\b/g, '-')
      .replace(/\s+(?:igual|da quanto|e quanto|da|fica|vale)$/, '').trim();
    if (!/^[\d.\s+\-*/]+$/.test(e) || !/[+\-*/]/.test(e)) return null;
    const tokens = e.match(/\d+(?:\.\d+)?|[+\-*/]/g) || [];
    if (tokens.join('') !== e.replace(/\s+/g, '')) return null;
    const r = evalFlat(tokens);
    if (!r) return null;
    if (r.error) return { type: 'math', error: r.error };
    value = r.value;
    spoken = tokens.map((x) => ({ '+': 'mais', '-': 'menos', '*': 'vezes', '/': 'dividido por' }[x] || fmtNum(parseFloat(x)))).join(' ');
  }
  if (!Number.isFinite(value)) return null;
  return { type: 'math', value, text: fmtNum(value), spoken };
}

// "de 1 a 10", "entre 5 e 20", "até 50"
function numberIntent(t) {
  if (!/\bnumeros?\b/.test(t) || !/\b(sorteie|sortear|sorteia|escolha|escolhe|pense|gere|gerar|gera|diga|diz|fale|fala|me de|da me|aleatorio|sorteado)\b/.test(t)) return null;
  const nums = (mathNorm(t.replace(/\b(?:um|uma)\s+numero/, 'numero')).match(/\d+/g) || []).map(Number).slice(0, 2);
  let min = 1, max = 100;
  if (nums.length === 2) { min = Math.min(...nums); max = Math.max(...nums); }
  else if (nums.length === 1) max = nums[0];
  if (max > 1e9 || min < 0) return null;
  if (min === max) max = min + 1;
  return { type: 'number', min, max };
}

// duração falada: "5 minutos", "meia hora", "1 hora e meia", "2 min e 30 seg"
function durationMs(raw, bareMinutes = false) {
  const t = mathNorm(raw);
  let ms = 0, found = false;
  if (/\bmeia hora\b/.test(t)) { ms += 30 * 60000; found = true; }
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(segundos?|seg|minutos?|min|horas?|hrs?|h)\b/g)) {
    const n = parseFloat(m[1]);
    const u = m[2][0] === 's' ? 1000 : m[2][0] === 'm' ? 60000 : 3600000;
    ms += n * u; found = true;
  }
  if (found && /\b(?:horas?|h) e meia\b/.test(t)) ms += 30 * 60000;
  else if (found && /\bminutos? e meio\b/.test(t)) ms += 30000;
  if (!found && bareMinutes) {
    const m = t.match(/^(?:(?:de|para|pra|por|em|uns|umas)\s+)*(\d+(?:\.\d+)?)$/);
    if (m) { ms = parseFloat(m[1]) * 60000; found = true; }
  }
  return found ? Math.round(ms) : null;
}
function durationText(ms) {
  let s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  const parts = [];
  if (h) parts.push(`${h} ${h === 1 ? 'hora' : 'horas'}`);
  if (m) parts.push(`${m} ${m === 1 ? 'minuto' : 'minutos'}`);
  if (s) parts.push(`${s} ${s === 1 ? 'segundo' : 'segundos'}`);
  return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1] : (parts[0] || '0 segundos');
}
function timerIntent(t, raw) {
  const kind = t.match(/\b(timer|cronometro|temporizador|contagem regressiva|alarme|despertador)\b/);
  if (!kind) return null;
  const ms = durationMs(raw, true);
  if (/^(alarme|despertador)$/.test(kind[1]) && ms == null) return null; // alarme por horário é com a agenda
  return { type: 'timer', ms };
}

// ---------- tocar música / ver vídeo ----------
const MUSIC_NOUN = /^(musicas?|musicazinha|musiquinhas?|sons?|cancao|cancoes|clipes?|videoclipes?|playlists?|albuns|album|hits?|trilha sonora|radio)\b/;
const VIDEO_NOUN = /^(videos?|videozinho|trailers?|tutoriais|tutorial|aulas?|episodios?|desenhos?|lives?|shows?|entrevistas?|documentarios?)\b/;
const GENRES = /^(funk|rock|sertanejo|pagode|samba|mpb|rap|pop|gospel|eletronica|forro|jazz|blues|classica|lofi|lo fi|reggae|axe|piseiro|trap|metal|kpop|k pop)\b/;
const PLAY_FREE = new Set(['tocar', 'toca', 'toque', 'escutar', 'escuta', 'escute', 'ouvir', 'ouve', 'ouca']);
const PLAY_VIDEO_VERBS = new Set(['assistir', 'assista', 'assiste', 'ver', 'abrir', 'abre', 'abra', 'mostrar', 'mostra', 'mostre', 'passa', 'passe']);
const PLAY_NOUN_VERBS = new Set([...PLAY_FREE, ...PLAY_VIDEO_VERBS, 'botar', 'bota', 'bote', 'colocar', 'coloca', 'coloque', 'poe', 'ponha', 'reproduzir', 'reproduza']);
const LEAD_OK = new Set(['quero', 'queria', 'queremos', 'gostaria', 'gostava', 'de', 'preciso', 'precisava', 'vou', 'vamos', 'bora', 'da', 'pra', 'para',
  'pode', 'poderia', 'poder', 'consegue', 'me', 'eu', 'gente', 'agora', 'entao', 'ja', 'so', 'tipo', 'ai', 'la', 'um', 'momento', 'por', 'favor', 'voce', 'vc', 'que', 'tal', 'e', 'mas']);
const STOP_FIRST = new Set(['de', 'do', 'da', 'isso', 'isto', 'aquilo', 'voce', 'vc', 'ele', 'ela', 'eles', 'elas', 'que', 'se', 'como', 'quando', 'porque', 'nada', 'ninguem', 'nao', 'tudo']);
const RANDOM_ANSWER = /^(qualquer(?: uma| coisa| musica| video| som)?|aleatori[ao]s?|alguma(?: coisa| musica)?|a que (?:voce )?(?:quiser|escolher|achar)|o que (?:voce )?(?:quiser|escolher|tiver|achar)|tanto faz|me surpreenda|surpreenda me|surpresa|voce escolhe|escolha voce|sei la|nao sei|pode ser qualquer(?: uma)?)$/;
const MUSIC_RANDOM = ['as melhores músicas brasileiras', 'mix de músicas para relaxar', 'top hits do momento', 'clássicos do rock nacional', 'MPB clássicos', 'lofi para relaxar', 'pop internacional mix'];
const YT_RE = /\b(?:(?:no|pelo|na|em|do)\s+)?(?:youtube|you tube|iutube|spotify)\b/g;

function cleanQuery(q) {
  return String(q || '').trim()
    .replace(/^(?:(?:chamad[ao]s?|que se chama|que chama|cujo nome e|de|do|da|dos|das|com|sobre|pelo|pela|tipo|a|o|as|os|e|ai)\s+)+/, '')
    .replace(/\s+(?:por favor|pra mim|para mim|agora)$/, '')
    .replace(/\s+/g, ' ').trim().slice(0, 80);
}

// "legiao urbana" -> "Legião Urbana": procura cada palavra na frase original
function restoreWords(q, raw) {
  const orig = new Map();
  for (const tok of String(raw || '').split(/\s+/)) {
    const clean = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (clean) orig.set(norm(clean), clean);
  }
  return String(q || '').split(' ').map((w) => orig.get(w) || w).join(' ');
}

function playIntent(t, raw) {
  const toks = t.split(' ');
  if (toks.length > 14) return null;
  const vi = toks.findIndex((w, i) => i < 6 && PLAY_NOUN_VERBS.has(w) && toks.slice(0, i).every((x) => LEAD_OK.has(x)));
  if (vi < 0) return null;
  const verb = toks[vi];
  let obj = toks.slice(vi + 1).join(' ').replace(/^(?:me\s+|(?:pra|para) mim\s+)+/, '');
  const where = /\bspotify\b/.test(obj) ? 'spotify' : 'youtube';
  obj = obj.replace(YT_RE, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\s+(?:por favor|pra mim|para mim|agora)$/, '')
    .replace(/^(?:(?:a|o|as|os|um|uma|uns|umas|alguma|algum|aquela|aquele|essa|esse|outra|outro|mais)\s+)+/, '').trim();
  let media = null, rest = '';
  let m;
  if ((m = obj.match(MUSIC_NOUN))) { media = 'music'; rest = obj.slice(m[0].length); }
  else if ((m = obj.match(VIDEO_NOUN))) { media = 'video'; rest = obj.slice(m[0].length); }
  else if (!PLAY_VIDEO_VERBS.has(verb) && obj && obj.split(' ').length <= 8 && !STOP_FIRST.has(obj.split(' ')[0]) &&
    (PLAY_FREE.has(verb) || GENRES.test(obj))) { media = 'music'; rest = obj; }
  if (!media) return null;
  rest = cleanQuery(rest);
  const random = RANDOM_ANSWER.test(rest);
  return { type: 'play', media, query: random || !rest ? null : restoreWords(rest, raw), random, where };
}

// resposta à pergunta "qual música?" (pode vir como "Evidências", "toca Djavan", "qualquer uma"...)
function mediaAnswer(raw) {
  const where = /\bspotify\b/.test(strip(raw)) ? 'spotify' : null;
  let t = norm(raw).replace(YT_RE, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:(?:eu quero|eu queria|quero|queria|gostaria de|pode ser|que tal|vai|coloca|bota|toca|toque|tocar|poe|ponha|escutar|ouvir|ver|assistir|a musica|o video|a|o|as|os|um|uma|musica|video|chamada|chamado|de|do|da|aquela|aquele|essa|esse)\s+)+/, '').trim();
  const random = RANDOM_ANSWER.test(t) || RANDOM_ANSWER.test(norm(raw));
  const q = cleanQuery(t);
  return { query: random || !q ? null : restoreWords(q, raw), random, where };
}


const HELLO_RE = /^(oi+|ola+|oie+|e ai|eae|opa|salve|hey|ei|alo|fala ai)(?:\s+(?:tudo bem|tudo bom|como vai|como voce esta|td bem))?$/;
const HOWRU_START = /^(?:e\s+)?(?:tudo bem|tudo bom|td bem|como (?:voce )?(?:vai|esta|ta|anda)|esta tudo bem|ta tudo bem)\b/;
const HOWRU_FULL = /^(?:e\s+)?(?:tudo bem|tudo bom|td bem|tudo certo|como (?:voce )?(?:vai|esta|ta|anda|se sente)|esta tudo bem|ta tudo bem|ta bem|esta bem)(?: (?:com )?(?:voce|vc))?$/;

// "bom dia", "boa tarde", "boa noite", "oi" — sozinhos ou antes de outro pedido
function greetIntent(t, words, opts) {
  const m = t.match(/^(?:(?:ola|oi|ei|opa|e ai|eae)\s+)?(bom dia|boa tarde|boa noite)\b\s*/);
  if (m) {
    const kind = { 'bom dia': 'dia', 'boa tarde': 'tarde', 'boa noite': 'noite' }[m[1]];
    const rest = t.slice(m[0].length).replace(/^(?:(?:pra|para) (?:voce|vc|todos|todo mundo)|a todos|galera|gente)\s*/, '').trim();
    if (!rest) return { type: 'greet', kind, howru: false };
    if (words <= 7 && HOWRU_START.test(rest)) return { type: 'greet', kind, howru: true };
    const inner = parseIntent(rest, opts);
    if (inner.type === 'chat') return null; // frase longa: deixa a IA responder tudo
    return { ...inner, lead: kind };
  }
  if (words <= 5 && HELLO_RE.test(t)) return { type: 'greet', kind: 'hello', howru: /\b(tudo|como)\b/.test(t) };
  return null;
}


// ---------- controle do computador (volume, mídia, janelas, energia) ----------
const PC_ALIAS = [
  [/^(word|microsoft word)$/, 'winword|word'], [/^excel$/, 'excel'], [/^(power ?point)$/, 'powerpnt|powerpoint'],
  [/^(bloco de notas|notepad)$/, 'notepad|bloco de notas'], [/^(vs ?code|visual studio code|vscode)$/, 'code|visual studio code'],
  [/^(navegador|browser|internet)$/, 'chrome|msedge|firefox|brave|opera'], [/^(chrome|google chrome)$/, 'chrome'],
  [/^(edge|microsoft edge)$/, 'msedge'], [/^firefox$/, 'firefox'], [/^calculadora$/, 'calculator|calculadora'],
  [/^(explorador( de arquivos)?|gerenciador de arquivos)$/, 'explorer'], [/^(zap|zapzap|whatsapp)$/, 'whatsapp'],
  [/^spotify$/, 'spotify'], [/^discord$/, 'discord'], [/^gerenciador de tarefas$/, 'taskmgr|gerenciador de tarefas'],
  [/^paint$/, 'mspaint|paint'], [/^steam$/, 'steam'], [/^obs$/, 'obs64|obs'], [/^telegram$/, 'telegram'],
  [/^(terminal|prompt de comando|cmd|powershell)$/, 'windowsterminal|cmd|powershell|terminal'],
];
const PC_GENERIC = new Set(['', 'janela', 'janela atual', 'janela aberta', 'janela em foco', 'programa', 'programa atual', 'programa aberto',
  'app', 'aplicativo', 'isso', 'tela', 'aqui', 'atual', 'em foco', 'esse', 'essa', 'este', 'esta']);

function pcTarget(x) {
  const t = String(x || '')
    .replace(/^(?:(?:de|do|da|dos|das|para|pra|pro|no|na|ao|a|o|os|as|um|uma|esse|essa|este|esta|meu|minha|programa|app|aplicativo|janela)(?:\s+|$))+/, '')
    .replace(/\s+(?:por favor|pra mim|para mim|agora|ai|ja|rapidinho)$/, '')
    .trim();
  return t;
}
function pcQuery(target) {
  const hit = PC_ALIAS.find(([re]) => re.test(target));
  return hit ? hit[1] : target;
}
const isGenericTarget = (full) => PC_GENERIC.has(String(full || '').replace(/\s+(?:por favor|pra mim|para mim|agora|ai|ja)$/, '').trim());

function pcIntent(t, raw, isSite) {
  const words = t.split(' ').length;
  if (words > 12) return null;
  const has = (re) => re.test(t);

  // cancelar desligamento
  if (has(/\bcancel\w*\b.*\b(desligamento|reinicio|reinicializacao|desligar|reiniciar)\b/)) return { type: 'pc', op: 'power-cancel' };

  // otimizar o PC (limpeza, energia, espaço livre): frases com palavras bem específicas para não colidir com "limpa a agenda"
  const wantsClean = has(/\b(limp\w*|apag\w*|delet\w*|exclu\w*|esvazi\w*|zer[ae]r?)\b/);
  if (has(/\blixeira\b/) && wantsClean) return { type: 'pc', op: 'opt-recycle', danger: true };
  if (has(/\bdns\b/) && wantsClean) return { type: 'pc', op: 'opt-dns' };
  if (has(/\bcache\b/) && has(/\b(navegador\w*|chrome|edge|firefox|brave|browser)\b/) && wantsClean) return { type: 'pc', op: 'opt-browser' };
  if (has(/\btemporari\w*\b/) && wantsClean) return { type: 'pc', op: 'opt-temp' };
  if ((has(/\b(limp\w*|otimiz\w*|acelera\w*)\b/) || has(/\buma limpeza\b/) || has(/\bmais rapid[oa]\b/)) && has(/\b(computador|pc|maquina|notebook|windows)\b/) && !/\b(tela|teclado|mouse)\b/.test(t)) return { type: 'pc', op: 'opt-clean-all' };
  if (has(/\b(alto desempenho|desempenho maximo|maximo desempenho)\b/) && has(/\b(modo|plano|energia|coloca|poe|pon\w*|muda\w*|ativ\w*|lig\w*)\b/)) return { type: 'pc', op: 'opt-power-high' };
  if (has(/\b(economia de energia|modo economia|plano economia)\b/) && has(/\b(modo|plano|energia|coloca|poe|pon\w*|muda\w*|ativ\w*|lig\w*)\b/)) return { type: 'pc', op: 'opt-power-saver' };
  if (has(/\b(modo|plano)( de energia)? equilibrad\w*\b/) || has(/\benergia equilibrad\w*\b/)) return { type: 'pc', op: 'opt-power-balanced' };
  if ((has(/\b(espaco)\b/) && has(/\b(livre|disco|hd|ssd|pc|computador)\b/)) || has(/\bcomo (esta|ta) (o |a )?(meu |minha )?(pc|computador|maquina)\b/)) return { type: 'pc', op: 'opt-info' };

  // energia (pede confirmação no executor)
  if (has(/\b(desligu?e|desligar|desliga)\b.*\b(computador|pc|maquina|notebook|windows)\b/) && !/\b(som|volume|tela|wifi|internet|bluetooth)\b/.test(t)) return { type: 'pc', op: 'shutdown', danger: true };
  if (has(/\b(reinici\w*|reboot)\b/) && has(/\b(computador|pc|maquina|notebook|windows)\b/)) return { type: 'pc', op: 'restart', danger: true };
  if (has(/\b(suspend\w*|hibern\w*|repouso)\b/) || (has(/\bdormir\b/) && has(/\b(computador|pc|notebook)\b/))) return { type: 'pc', op: 'sleep', danger: true };
  if (has(/\b(bloquei\w*|trav[ae]r?|trave)\b/) && has(/\b(computador|pc|tela|maquina|windows|notebook|sessao)\b/)) return { type: 'pc', op: 'lock' };

  // captura de tela
  if (has(/\b(print|prints|screenshot|captura|capture|capturar|foto)\b/) && has(/\b(tela|monitor|screenshot)\b/) || has(/\b(tira|tire|tirar|faz|faca|fazer|bate|bata|salva|salve)\b.*\b(print|screenshot|captura)\b/)) return { type: 'pc', op: 'screenshot' };

  // o que está aberto
  if (has(/\bo que (esta|ta) (aberto|rodando)\b/) || has(/\bquais (programas|janelas|apps|aplicativos) (estao |tem )?(abert\w+|rodando)\b/) || has(/\b(programas|janelas|aplicativos) abert\w+\b/)) return { type: 'pc', op: 'list' };

  // área de trabalho
  if (has(/\b(mostr\w+|ver|exib\w+)\b.*\barea de trabalho\b/) || has(/\bminimiz\w+ (tudo|todas|todos)\b/) || has(/\bdesktop\b/)) return { type: 'pc', op: 'desktop' };

  // volume
  if (has(/\b(volume|som|audio)\b/) || has(/\bmais (alto|baixo)\b/)) {
    const m = mathNorm(raw);
    const n = (m.match(/\d+/) || [])[0];
    if (has(/\b(mudo|mutar|muta|mute|silenci\w+|desmut\w+)\b/) || has(/\b(tira|tire|tirar|desliga|desligue|liga|ligue|ativa|ative|volta|volte)\b.*\bsom\b/)) return { type: 'pc', op: 'volume-mute' };
    const up = has(/\b(aument\w+|sob[ae]r?|suba|eleva\w*|mais alto|alto|dobra\w*)\b/);
    const down = has(/\b(diminu\w+|abaix\w+|baix[ae]r?|reduz\w*|mais baixo|menos)\b/);
    const little = has(/\b(um pouco|um pouquinho|poquinho|levemente)\b/);
    const lots = has(/\b(muito|bastante|demais)\b/);
    const steps = n ? Math.max(1, Math.min(50, Math.round(parseInt(n, 10) / 2))) : little ? 2 : lots ? 12 : 5;
    if (up && !down) return { type: 'pc', op: 'volume-up', steps };
    if (down && !up) return { type: 'pc', op: 'volume-down', steps };
    if (has(/\b(maximo|maxima|no maximo|ao maximo)\b/)) return { type: 'pc', op: 'volume-set', level: 100 };
    if (has(/\b(minimo|minima|zero)\b/) && !n) return { type: 'pc', op: 'volume-set', level: 0 };
    if (n && has(/\bvolume\b/) && parseInt(n, 10) <= 100) return { type: 'pc', op: 'volume-set', level: parseInt(n, 10) };
    return null;
  }

  // mídia (teclas multimídia: valem para Spotify, YouTube no navegador, players...)
  const mediaNoun = /\b(musica|musicas|faixa|video|som|filme|serie|episodio|reproducao|spotify|youtube|podcast)\b/;
  if (has(/\b(proxim[ao]|pula|pule|pular|avanca\w*|passa|passe)\b/) && (has(mediaNoun) || words <= 2)) return { type: 'pc', op: 'media-next' };
  if (has(/\b(anterior|volta|volte|voltar)\b/) && has(mediaNoun) && !has(/\b(tela|janela|pagina)\b/)) return { type: 'pc', op: 'media-prev' };
  if (has(/\b(paus[ae]r?|pausa|pause|play|despaus\w+|retom\w+)\b/) && (words <= 4 || has(mediaNoun))) return { type: 'pc', op: 'media-playpause' };
  if (has(/\b(continu\w+|segue|siga)\b/) && has(mediaNoun) && words <= 6) return { type: 'pc', op: 'media-playpause' };

  // alternar janelas
  if (has(/\b(proxima janela|janela anterior|(troca|troque|muda|mude|alterna|alterne) (de|entre as?) janelas?|alt tab)\b/)) return { type: 'pc', op: 'switch' };

  // janelas e programas
  const WIN = [['minimize', /\b(minimiz\w+|escond\w+)\b/], ['maximize', /\bmaximiz\w+\b/], ['restore', /\brestaur\w+\b/],
    ['close', /\b(fecha|feche|fechar|encerra|encerre|encerrar)\b/]];
  for (const [act, re] of WIN) {
    const m = t.match(re);
    if (!m) continue;
    const full = t.slice(m.index + m[0].length).trim();
    if (full.split(' ').filter(Boolean).length > 5) return null;
    const generic = isGenericTarget(full) || !pcTarget(full);
    const target = generic ? '' : pcTarget(full);
    if (!generic && act === 'close' && isSite && isSite(target)) { // "fecha o youtube" = a aba do navegador
      return { type: 'pc', op: 'win', act: 'closetab', target: pcQuery(target), label: target, danger: true };
    }
    if (!generic && /^(a |o )?(conversa|historia|porta|conta|boca|minha boca|aba|sessao|ideia|assunto)\b/.test(full)) return null;
    return { type: 'pc', op: 'win', act, target: generic ? null : pcQuery(target), label: generic ? 'a janela em foco' : target, danger: act === 'close' };
  }

  // ir para uma janela já aberta
  let m = t.match(/\b(?:muda|mude|troca|troque|alterna|alterne|va|vai|ir|volta|volte|passa|passe|traz|traga|foca|foque)\s+(?:de |para |pra |pro |no |na |ao |a |o )*(janela|programa|app|aplicativo)?\s*(?:do |da |de )?(.+)$/);
  if (m) {
    const target = pcTarget(m[2]);
    const known = PC_ALIAS.some(([re]) => re.test(target));
    const explicit = !!m[1] || /\b(foca|foque|traz|traga)\b/.test(t); // "janela do spotify", "traz o discord"
    const site = isSite && isSite(target);
    if (target && target.split(' ').length <= 3 && (explicit || (known && !site))) {
      return { type: 'pc', op: 'win', act: 'focus', target: pcQuery(target), label: target };
    }
  }
  return null;
}

// danças e poses pedidas por voz ("dança", "dança samba", "senta", "levanta", "bate palmas")
function poseIntent(t, words) {
  if (words > 8) return null;
  // Movimentos da janela/avatar na tela. "Sai da frente" e "está atrapalhando"
  // deslocam para a direita por padrão; o usuário pode escolher o lado explicitamente.
  if (/\b(vai|va|ande|anda|mova|move|desloca|desloque)\b.*\b(esquerda|esquerdo)\b/.test(t)
      || /\b(esquerda|esquerdo)\b.*\b(vai|va|anda|ande|mova|move)\b/.test(t)) return { type: 'avatar-move', direction: 'left' };
  if (/\b(vai|va|ande|anda|mova|move|desloca|desloque)\b.*\b(direita|direito)\b/.test(t)
      || /\b(direita|direito)\b.*\b(vai|va|anda|ande|mova|move)\b/.test(t)) return { type: 'avatar-move', direction: 'right' };
  if (/\b(vai|va|anda|ande|mova|move|desloca|desloque)\b.*\b(pro lado|para o lado|pra o lado|para lado|pra lado)\b/.test(t)
      || /\b(sai|saia|afasta|afaste)\b.*\b(da frente|do caminho)\b/.test(t)
      || /\b(ta|esta) atrapalhando\b/.test(t)) return { type: 'avatar-move', direction: 'right' };
  if (/\b(se abaixa|abaixe se|abaixa o corpo|agacha|agache|fica abaixada|fique abaixada)\b/.test(t)) return { type: 'pose', emote: 'duck' };
  if (/\b(joinha|dedao|polegar para cima)\b/.test(t)) return { type: 'pose', emote: 'thumbs_up' };
  if (/\b(faz|faca|manda|desenha|mostra)\b.*\b(coracao)\b/.test(t) || /^coracao( com as maos)?$/.test(t)) return { type: 'pose', emote: 'heart' };
  if (/\b(manda|mande|joga|jogue|me da|me de)\b.*\b(beijo|beijinho)\b/.test(t) || /^beijo( para mim)?$/.test(t)) return { type: 'pose', emote: 'blow_kiss' };
  if (/\b(facepalm|face palm)\b|\b(mao|coloca|coloque|poe|ponha)\b.*\b(testa|rosto)\b/.test(t)) return { type: 'pose', emote: 'facepalm' };
  if (/\b(da de ombros|de de ombros|encolhe os ombros|encolha os ombros|faz cara de tanto faz)\b/.test(t)) return { type: 'pose', emote: 'shrug' };
  if (/\b(aponta|aponte|apontar)\b/.test(t)) return { type: 'pose', emote: 'point' };
  if (/^(para|pare|parar) (de )?(danca|dancar)\b/.test(t) || /\b(levanta|levante|levantar|fica em pe|fique em pe)\b/.test(t)) return { type: 'pose', emote: 'stand' };
  if (/\b(danca|dance|dancar|dancinha)\b/.test(t) && !/\b(aula|curso|escola|festa|musica|playlist|roupa|sapato)\b/.test(t)) {
    const style = /\bsamba\b/.test(t) ? 'samba' : /\bdisco\b/.test(t) ? 'disco' : /\brobo\b/.test(t) ? 'robot'
      : /\bbale\b/.test(t) ? 'ballet' : /\b(hip hop|hiphop|funk)\b/.test(t) ? 'hiphop' : null;
    return { type: 'pose', dance: style };
  }
  if (/\b(senta|sente se|sentar|se senta)\b/.test(t)) return { type: 'pose', emote: /\bchao\b/.test(t) ? 'sit' : 'chair' };
  if (/\b(bate|bata|bater) palmas\b|\b(aplaude|aplauda|aplaudir)\b/.test(t)) return { type: 'pose', emote: 'clap' };
  if (/\bcontinencia\b/.test(t)) return { type: 'pose', emote: 'salute' };
  if (/\bmaos na cintura\b/.test(t)) return { type: 'pose', emote: 'pose' };
  return null;
}

function parseIntentRaw(raw, opts = {}) {
  const t = norm(raw);
  if (!t) return { type: 'empty' };
  const words = t.split(' ').length;

  const ag = agendaIntent(t, words);
  if (ag) return ag;

  // mexer no próprio app: tema, cor, avatar e item na mão (usa a biblioteca de modelos do usuário)
  const ap = APP.parseIntent(t, opts.lib || { avatars: [], items: [] });
  if (ap) return ap;

  const pc = pcIntent(t, raw, (x) => SITES.some((si) => si.key !== 'google' && !si.app && si.re.test(x)));
  if (pc) return pc;

  const po = poseIntent(t, words);
  if (po) return po;

  if (words <= 4 && /^(para|pare|parar|cala|cale|silencio|chega|cancela|cancele|esquece|esqueca)\b/.test(t)) return { type: 'stop' };
  if (words <= 6 && /\b(tchau|ate logo|ate mais|ate amanha|era so isso|so isso|por enquanto e so|pode descansar|pode ir dormir)\b/.test(t)) return { type: 'bye' };

  const gr = greetIntent(t, words, opts);
  if (gr) return gr;

  // conversa leve (sem IA)
  if (words <= 6 && HOWRU_FULL.test(t)) return { type: 'howru' };
  if (words <= 5 && /\b(obrigad[oa]|brigad[oa]|valeu|vlw|agradeco)\b/.test(t)) return { type: 'thanks' };
  if (words <= 8 && (/\bo que (voce )?(sabe|consegue|pode|faz)( fazer)?\b/.test(t) || /\bquais (sao )?(os )?(seus )?comandos\b/.test(t) ||
    /^(ajuda|comandos|help|lista de comandos|me ajuda)$/.test(t))) return { type: 'help' };
  if (words <= 8 && (/\bquem (e|eh|ee) (voce|vc)\b/.test(t) || /\bquem (voce|vc) (e|eh)\b/.test(t) || /\bqual (e )?(o )?seu nome\b/.test(t) ||
    /\bcomo (voce|vc) se chama\b/.test(t) || /\b(se apresente|apresente se)\b/.test(t))) return { type: 'who' };
  if (words <= 9 && (/\bpiadas?\b/.test(t) || /\b(me faz|me faca|faca me|faz me) rir\b/.test(t))) return { type: 'joke' };

  // alarme/despertador em horário marcado vira compromisso na agenda
  if (/\b(alarme|despertador|me acorde|me acorda)\b/.test(t) && /\b(\d{1,2}\s*(h|horas?)\b|as \d|amanha|meio dia)/.test(t) && durationMs(raw) == null) return { type: 'agenda-add' };

  const timeQ = /\bque horas?\b/.test(t) || /\bqual (e )?(a )?hora\b/.test(t) || /\bhoras? (sao|e)\b/.test(t) ||
    /\b(diz|diga|fala|fale|conta|conte|da|de) (me )?(as )?horas?\b/.test(t) || /\bhora (agora|atual|certa)\b/.test(t);
  if (timeQ && words <= 8 && !/\b(abre|fecha|comeca|termina|passa|chega|sai|vai|tem)\b/.test(t)) return { type: 'time' };

  if (/\bque dia (e|eh|sao)\b/.test(t) || /\bqual (e )?(a )?data\b/.test(t) || /\bdata de hoje\b/.test(t) ||
    /\bdia da semana\b/.test(t) || /\bque dia (e )?hoje\b/.test(t) || /\bhoje e que dia\b/.test(t)) return { type: 'date' };

  if (/\b(role|rola|rolar|jogue|joga|jogar|lance|lanca|lancar|gire|gira|girar|sorteie|sortear)\b.*\bdados?\b/.test(t) ||
    /\bdados?\b.*\b(role|rola|rolar|jogue|joga|jogar|lance|lanca)\b/.test(t)) return { type: 'dice' };

  if (words <= 8 && (/\bcara ou coroa\b/.test(t) || (/\bmoeda\b/.test(t) && /\b(joga|jogue|jogar|lanca|lance|lancar|gira|gire|tira|tire)\b/.test(t)))) return { type: 'coin' };

  const nm = numberIntent(t);
  if (nm) return nm;

  const tm = timerIntent(t, raw);
  if (tm) return tm;

  const mt = mathIntent(raw);
  if (mt) return mt;

  const wx = weatherIntent(t, words);
  if (wx) return wx;

  if (/\b(noticias?|manchetes?|jornal)\b/.test(t) || /\bo que (esta|ta|tem) (acontecendo|rolando)\b/.test(t) ||
    /\bnovidades (do mundo|de hoje|do dia)\b/.test(t)) return { type: 'news' };

  const pl = playIntent(t, raw);
  if (pl) return pl;

  const s = t.match(/\b(pesquis[ae]r?|procur[ae]r?|busc[ae]r?)\s+(?:por |sobre )?(.+)$/) ||
    t.match(/^(?:ok |ei |hey )?(googl[ae])\s+(?:por |sobre )?(.+)$/);
  if (s && !OPEN_VERB.test(t.slice(0, s.index))) {
    let q = s[2];
    let where = 'google';
    if (/\bno youtube$/.test(q)) { where = 'youtube'; q = q.replace(/\s*no youtube$/, ''); }
    q = q.replace(/\s*(no google|na internet|no navegador)$/, '').trim();
    if (q) return { type: 'search', query: q, where };
  }

  const strong = t.match(OPEN_VERB);
  const o = strong || t.match(WEAK_OPEN);
  if (o) {
    const target = t.slice(o.index + o[0].length);
    const site = SITES.find((x) => x.re.test(target));
    if (site) return { type: 'open', ...site };
    if (strong) return { type: 'open-unknown', target: target.trim().replace(/^(?:(?:o|a|os|as|um|uma|pra mim|para mim|por favor)\s+)+/, '').replace(/\s+(?:por favor|pra mim|para mim)$/, '').trim() };
  }
  // só o nome do site: "youtube", "o gmail por favor"
  if (words <= 4 && !/\?/.test(String(raw))) {
    const site = SITES.find((x) => x.re.test(t));
    if (site) return { type: 'open', ...site };
  }

  return { type: 'chat' };
}

// ---------- falas ----------
function timeText(d = new Date()) {
  const h = d.getHours(), m = d.getMinutes();
  if (h === 0) return m === 0 ? 'É meia-noite em ponto.' : `É meia-noite e ${m} ${m === 1 ? 'minuto' : 'minutos'}.`;
  if (h === 12 && m === 0) return 'É meio-dia em ponto.';
  const hs = h === 1 ? 'É 1 hora' : `São ${h} horas`;
  return m === 0 ? `${hs} em ponto.` : `${hs} e ${m} ${m === 1 ? 'minuto' : 'minutos'}.`;
}

function dateText(d = new Date()) {
  const s = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `Hoje é ${s}.`;
}

const POOLS = {
  madrugada: { emotion: 'surprised', emote: 'shake', lines: [
    'Nossa, já é madrugada! Você não vai dormir?',
    'Já passou da hora de dormir, hein...',
    'Madrugada total. Vai dormir ou vai virar a noite?' ] },
  cedo: { emotion: 'happy', emote: 'wave', lines: [
    'Nossa, acordou cedo hoje! Bom dia!',
    'Madrugou, hein? Bom dia!' ] },
  manha: { emotion: 'happy', emote: null, lines: [
    'Bom dia! O dia está só começando.',
    'Já tomou café?',
    'Manhã boa pra render, hein!' ] },
  almoco: { emotion: 'happy', emote: null, lines: [
    'Já é hora do almoço! Já comeu?',
    'Opa, hora de almoçar!' ] },
  tarde: { emotion: 'relaxed', emote: null, lines: [
    'Tarde tranquila, hein.',
    'Bate aquele cansaço da tarde, né? Que tal uma água?',
    'Falta pouco pro fim do dia!' ] },
  noite: { emotion: 'relaxed', emote: null, lines: [
    'Já está anoitecendo.',
    'Hora do jantar, hein?',
    'Fim de dia! Já pode relaxar um pouco.' ] },
  tardinha21: { emotion: 'surprised', emote: null, lines: [
    'Nossa, tá ficando tarde! Ou você já vai dormir?',
    'Já são 21 horas, hein! Vai dormir daqui a pouco?',
    'Tá ficando tarde... vai dormir ou vai ficar mais um pouco?' ] },
  tarde22: { emotion: 'surprised', emote: 'stretch', lines: [
    'Nossa, tá tarde! Não vai dormir?',
    'Já é tarde, hein. Amanhã tem dia!',
    'Vai dormir ou vai ficar mais um pouco?' ] },
};
function poolFor(h) {
  if (h < 5) return POOLS.madrugada;
  if (h < 7) return POOLS.cedo;
  if (h < 12) return POOLS.manha;
  if (h < 14) return POOLS.almoco;
  if (h < 18) return POOLS.tarde;
  if (h < 21) return POOLS.noite;
  if (h < 22) return POOLS.tardinha21;
  return POOLS.tarde22;
}
// "de vez em quando": mais provável quando a hora chama atenção (tarde da noite / madrugada)
function shouldComment(h, rnd = Math.random) {
  const p = h >= 21 || h < 5 ? 0.85 : 0.4;
  return rnd() < p;
}
function timeComment(h, rnd = Math.random) {
  const p = poolFor(h);
  return { text: pick(p.lines, rnd), emotion: p.emotion, emote: p.emote };
}

const IDLE_GENERIC = [
  'Tô por aqui se precisar de mim.',
  'Ei, se quiser conversar é só me chamar.',
  'Que tal uma pausa pra esticar as pernas?',
  'Lembra de beber água!',
  'Já faz um tempinho que você tá aí, hein.' ];
function idleRemark(h, rnd = Math.random) {
  if (h >= 22 || h < 5) return { text: pick(['Já é tarde, hein. Não vai dormir?', 'Nossa, que horas são... você precisa descansar!'], rnd), emotion: 'relaxed', emote: 'stretch' };
  if (h >= 12 && h < 14) return { text: pick(['Já almoçou?', 'Hora do almoço, hein!'], rnd), emotion: 'happy', emote: null };
  return { text: pick(IDLE_GENERIC, rnd), emotion: 'happy', emote: rnd() < 0.3 ? 'wave' : null };
}


// ---------- falas espontâneas (periódicas) ----------
// tipos que o usuário liga/desliga na aba Comportamento
const CHATTER_KINDS = ['checkin', 'time', 'sleep', 'talk', 'care', 'sulk', 'smash', 'custom'];
const CHATTER_LINES = {
  checkin: { emotion: 'happy', emote: 'wave', lines: [
    'Oi, você tá aí?', 'Alô? Tem alguém aí?', 'Ei, sumiu? Tô aqui!', 'Você ainda tá aí? Tá bem quietinho...',
    'Psiu! Você tá por aí?', 'Oi oi! Tá vivo aí?', 'Cadê você?', 'Cadê você, hein? Sumiu!', 'Oi, eu tô aqui!',
    'Eu tô aqui, viu? Só pra avisar.', 'Oiê! Tô aqui, tá?' ] },
  talk: { emotion: 'happy', emote: 'nod', lines: [
    'Fala comigo!', 'Tô com saudade de conversar, fala comigo!', 'Que tal a gente conversar um pouco?',
    'Tô entediada... fala comigo!', 'Me conta alguma coisa!', 'Ei, bora bater um papo?' ] },
  sleep: { emotion: 'relaxed', emote: 'stretch', lines: [
    'Já é tarde, hein. Vai dormir!', 'Não tá na hora de dormir não?', 'Seus olhos merecem descanso... vai dormir!',
    'Amanhã é outro dia, vai dormir um pouco!', 'Tá tarde! Dormir faz bem, viu?', 'Vai dormir, vai... eu fico aqui de guarda.' ] },
  care: { emotion: 'happy', emote: null, lines: [
    'Lembra de beber água!', 'Que tal uma pausa pra esticar as pernas?', 'Respira fundo e relaxa os ombros um pouquinho.',
    'Já faz um tempinho que você tá aí, hein. Descansa os olhos!', 'Uma aguinha cairia bem, hein.' ] },
  // ela reclama de ter sido chamada à toa
  sulk: { emotion: 'angry', emote: 'shake', lines: [
    'Me chamou pra nada, né?', 'Você me chamou e nem falou nada... pra nada!', 'Tô aqui à toa, então?',
    'Hmpf. Me chamou pra nada.', 'Ah, claro. Me chamou pra nada. De novo.', 'Eu vim correndo e era pra nada?' ] },
  // ela perde a paciência e soca a tela (o efeito de tela rachada é feito pelo app; aqui só a fala)
  smash: { emotion: 'angry', emote: null, smash: true, lines: [
    'Cadê você?! Tá me ignorando? Toma!', 'Oi?! Eu tô aqui! Olha só isso!', 'Chega! Se não me dá atenção, eu quebro a tela!',
    'Eu falei que eu tava aqui! Toma essa!' ] },
};
// frases escritas pelo usuário (uma por linha) na aba Comportamento
function parseCustomLines(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, 30);
}
// "dormir" só faz sentido à noite; o resto vale a qualquer hora
const isNight = (h) => h >= 21 || h < 5;
// sorteia um tipo entre os ligados; à noite o "vai dormir" tem mais chance; evita repetir o último tipo
function pickChatterKind(enabled, h, rnd = Math.random, last = null) {
  let cands = CHATTER_KINDS.filter((k) => enabled && enabled[k] !== false && (k !== 'sleep' || isNight(h)));
  if (!cands.length) return null;
  if (cands.length > 1 && last) cands = cands.filter((k) => k !== last);
  const w = cands.map((k) => (k === 'sleep' ? 3 : 1));
  let r = rnd() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < cands.length; i++) { r -= w[i]; if (r < 0) return cands[i]; }
  return cands[cands.length - 1];
}
// monta a fala do tipo sorteado; "time" diz as horas e comenta o período do dia ("tá tarde")
function chatterLine(kind, d = new Date(), rnd = Math.random, lastText = '', custom = []) {
  if (kind === 'custom') {
    let lines = custom.length ? custom : null;
    if (!lines) return idleRemark(d.getHours(), rnd);
    if (lines.length > 1 && lastText) lines = lines.filter((l) => l !== lastText);
    return { text: pick(lines, rnd), emotion: 'happy', emote: null };
  }
  if (kind === 'time') {
    const c = timeComment(d.getHours(), rnd);
    return { text: `${timeText(d)} ${c.text}`, emotion: c.emotion, emote: c.emote };
  }
  const pool = CHATTER_LINES[kind];
  if (!pool) return idleRemark(d.getHours(), rnd);
  let lines = pool.lines;
  if (lines.length > 1 && lastText) lines = lines.filter((l) => l !== lastText);
  const text = pick(lines, rnd);
  const out = { text, emotion: pool.emotion, emote: pool.emote && rnd() < 0.6 ? pool.emote : null };
  if (pool.smash) out.smash = true;
  return out;
}

const ACK = [
  'Oi! Pode falar.', 'Tô aqui!', 'Pois não?', 'Oi, o que você precisa?', 'Pode falar, tô ouvindo!',
  'Fala comigo!', 'Chamou? Tô por aqui.', 'Opa, o que foi?', 'Diga lá!', 'Sim? Em que posso ajudar?',
  'Presente! O que você quer?', 'Oi, oi! Pode mandar.', 'Estou aqui, pode falar.', 'Prontinha! O que vamos fazer?',
  'Ouvindo você!', 'Pode pedir, tô pronta.', 'Oi! Como posso ajudar?', 'Pode dizer, sou toda ouvidos.',
  'Chegou a hora! O que precisa?', 'Qual é a boa?', 'Às suas ordens!', 'E aí, o que vai ser?',
  'Tô na escuta, manda ver!', 'Oi! Me conta o que você precisa.'
];
const BYE = ['Tchau! Até mais!', 'Até logo! Qualquer coisa é só chamar.', 'Tá bom, até mais!'];
let lastAck = -1; // evita repetir a mesma resposta duas vezes seguidas
const ackLine = (rnd = Math.random) => {
  let i = Math.floor(rnd() * ACK.length) % ACK.length;
  if (i === lastAck) i = (i + 1) % ACK.length;
  lastAck = i;
  return { text: ACK[i], emotion: 'happy', emote: null };
};
const byeLine = (rnd) => ({ text: pick(BYE, rnd), emotion: 'happy', emote: 'wave' });


// ---------- saudações (com correção sarcástica quando o horário não bate) ----------
const GREETING = { dia: 'Bom dia', tarde: 'Boa tarde', noite: 'Boa noite' };
const periodOf = (h) => (h >= 5 && h < 12 ? 'dia' : h >= 12 && h < 18 ? 'tarde' : 'noite');
const realKeyOf = (h) => (h < 5 ? 'madrugada' : periodOf(h));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const clockPhrase = (d) => { const s = timeText(d).replace(/\.$/, ''); return s.charAt(0).toLowerCase() + s.slice(1); };

const GREET_OK = {
  dia: ['Bom dia! Dormiu bem?', 'Bom dia! Já tomou café?', 'Bom dia! Que bom te ver por aqui.', 'Bom dia! Hoje vai ser um dia produtivo, eu sinto.'],
  tarde: ['Boa tarde! Já almoçou?', 'Boa tarde! Como está sendo o seu dia?', 'Boa tarde! Falta pouco pro fim do dia.'],
  noite: ['Boa noite! Como foi o seu dia?', 'Boa noite! Já jantou?', 'Boa noite! Hora de desacelerar um pouco, né?'],
  noiteTarde: ['Boa noite! Já está tarde, hein. Não vai dormir?', 'Boa noite! Descanse bem, amanhã tem mais.'],
};
// o que a pessoa disse > que horas realmente são. {c} = relógio, {C} = relógio com inicial maiúscula
const GREET_FIX = {
  'dia>tarde': ['Bom dia? Olha o relógio: {c}. Já é de tarde, viu? Mas vou deixar passar... boa tarde!', 'Bom dia?! Acordou agora? {C}, o certo é boa tarde.', 'Ah, bom dia, é? Que ótimo, só que o dia já foi embora faz tempo. Boa tarde!'],
  'dia>noite': ['Bom dia?! Nossa, dormiu o dia inteiro? {C}, já é noite. Boa noite!', 'Bom dia a essa hora? {C}. Seu relógio biológico está de férias, hein? Boa noite!', 'Bom dia... sei. Olha pela janela: já escureceu. Boa noite, criatura!'],
  'dia>madrugada': ['Bom dia? {C}, ainda é madrugada! Você acordou cedo demais ou nem dormiu?', 'Bom dia?! Ainda é madrugada, hein. Vai dormir, vai!'],
  'tarde>dia': ['Boa tarde? Calma, apressadinho! {C}, ainda é de manhã. Bom dia!', 'Boa tarde? Pulou o almoço e eu nem vi? Ainda é de manhã, o certo é bom dia.', 'Boa tarde agora de manhã? Quer adiantar o relógio? Bom dia!'],
  'tarde>noite': ['Boa tarde? A tarde acabou faz tempo. {C}, já é noite. Boa noite!', 'Boa tarde nesse horário? Você está vivendo no passado, hein. Boa noite!', 'Boa tarde... só se for a de ontem. Já é noite, viu? Boa noite!'],
  'tarde>madrugada': ['Boa tarde? {C}, é madrugada, criatura! Vai dormir.', 'Boa tarde de madrugada? Seu relógio quebrou? Vai dormir!'],
  'noite>dia': ['Boa noite? {C}, da manhã! Virou a noite? Bom dia, então.', 'Boa noite? O sol está lá fora. Bom dia!', 'Boa noite de manhã? Dormiu de novo, é? Bom dia!'],
  'noite>tarde': ['Boa noite? Ainda é de tarde! Está com pressa de o dia acabar? É boa tarde, viu?', 'Boa noite? Ainda tem sol aí fora. O certo é boa tarde!', 'Boa noite agora? Calma, o dia ainda nem terminou. Boa tarde!'],
  'noite>madrugada': ['Boa noite... {C}. Ou melhor, boa madrugada. Você devia estar dormindo!', 'Boa noite? Já é madrugada, hein. Vai dormir ou vai virar a noite?'],
};
const HELLO = ['Oi! Tudo bem?', 'Olá! Pode falar.', 'E aí! Tô por aqui.', 'Oi, oi! O que vamos fazer?'];
const HOWRU = ['Tô ótima! E você, como está?', 'Tudo bem por aqui, e com você?', 'Tudo ótimo! Obrigada por perguntar. E você?'];
const HOWRU_TAIL = ['Tudo ótimo por aqui, e com você?', 'Por aqui tudo bem! E você?'];

function greetReply(kind, d = new Date(), rnd = Math.random, howru = false) {
  const h = d.getHours();
  let text, ok = true, emotion = 'happy', emote = rnd() < 0.5 ? 'wave' : null;
  if (kind === 'hello') {
    text = pick(HELLO, rnd);
    if (howru) text = pick(HOWRU, rnd);
    return { text, emotion, emote, ok: true };
  }
  const real = realKeyOf(h);
  if (kind === real) {
    text = pick(kind === 'noite' && h >= 22 ? GREET_OK.noiteTarde : GREET_OK[kind], rnd);
  } else {
    ok = false;
    text = pick(GREET_FIX[`${kind}>${real}`], rnd)
      .replace(/\{C\}/g, cap(clockPhrase(d))).replace(/\{c\}/g, clockPhrase(d));
    emotion = 'surprised'; emote = rnd() < 0.6 ? 'shake' : null;
    if (real === 'madrugada') emote = rnd() < 0.5 ? 'stretch' : emote;
  }
  if (howru) text += ' ' + pick(HOWRU_TAIL, rnd);
  return { text, emotion, emote, ok };
}
// versão curta, usada como abertura quando a pessoa cumprimenta e já pede outra coisa
function greetShort(kind, d = new Date()) {
  if (kind === 'hello') return '';
  const real = realKeyOf(d.getHours());
  if (kind === real) return `${GREETING[kind]}!`;
  if (real === 'madrugada') return kind === 'noite' ? `${GREETING[kind]}... já é madrugada, hein.` : `${GREETING[kind]}? Ainda é madrugada, hein.`;
  return `${GREETING[kind]}? O certo agora é ${GREETING[real].toLowerCase()}, mas tudo bem.`;
}

// ---------- saudação ao abrir o app ----------
// Sempre cumprimenta pelo horário. Se o perfil tiver nome (ou apelido), puxa assunto chamando a pessoa
// pelo nome e, conforme o gênero do perfil, de "chefe" (m) ou "chefa" (f). Se a pessoa já tem perfil e ficou
// alguns dias sem abrir o app, mostra que sentiu falta ("há quanto tempo... estava com saudades").
const START_ASK = [
  'o que vamos fazer hoje?', 'quais são seus planos pra hoje?', 'o que vamos aprontar hoje?',
  'em que posso te ajudar hoje?', 'qual é o plano de hoje?', 'por onde a gente começa?',
  'o que está nos planos?', 'bora fazer algo produtivo?', 'o que você tem em mente hoje?', 'qual é a missão de hoje?',
];
const START_HEY = ['E aí, {N}!', 'Fala, {N}!', 'Opa, {N}!', 'Olha quem chegou, {N}!', 'Que bom te ver, {N}!', 'Salve, {N}!'];
// só o cumprimento (sem nome no perfil), com algumas variações por período
const START_PLAIN = {
  dia: ['Bom dia!', 'Bom dia! Pronta pra mais um dia?', 'Bom dia! Já tomou café?', 'Bom dia! Que bom te ver por aqui.'],
  tarde: ['Boa tarde!', 'Boa tarde! Já almoçou?', 'Boa tarde! Como está sendo o seu dia?', 'Boa tarde! Que bom te ver por aqui.'],
  noite: ['Boa noite!', 'Boa noite! Como foi o seu dia?', 'Boa noite! Já jantou?', 'Boa noite! Que bom te ver por aqui.'],
};
// quando a pessoa ficou um tempo sem abrir o app. {N} = nome (com chefe/chefa), {t} = há quanto tempo
const START_MISS = [
  'Há quanto tempo, {N}! Fazia {t} que você não aparecia. Estava com saudades!',
  'E aí, {N}, sumiu, hein? Fazia {t}! Estava com saudades.',
  'Que saudade, {N}! Faz {t} que a gente não se vê.',
  '{N}! Fazia {t} que você não vinha. Estava com saudades, viu?',
  'Olha quem voltou! {N}, que bom te ver depois de {t}.',
  'Ufa, {N}, você voltou! Já fazia {t}. Senti sua falta!',
];
const START_MISS_ASK = ['Me conta, o que vamos fazer hoje?', 'Quais são os planos de hoje?', 'Bora recuperar o tempo perdido?', 'O que andou aprontando?'];

function awayText(ms) {
  const days = Math.floor(ms / 86400000);
  if (days < 7) return days === 1 ? '1 dia' : `${days} dias`;
  if (days < 30) { const w = Math.floor(days / 7); return w === 1 ? 'uma semana' : `${w} semanas`; }
  const m = Math.floor(days / 30);
  if (m < 12) return m === 1 ? 'um mês' : `${m} meses`;
  const y = Math.floor(days / 365);
  return y === 1 ? 'um ano' : `${y} anos`;
}
const MISS_AFTER_MS = 2 * 86400000; // a partir de 2 dias sem abrir o app

// lastSeen: momento (ms) da última vez que o app abriu; 0 se não souber
function startupGreeting(profile, d = new Date(), rnd = Math.random, lastSeen = 0) {
  const kind = periodOf(d.getHours()); // madrugada conta como "boa noite"
  const hello = `${GREETING[kind]}!`;
  const p = profile && typeof profile === 'object' ? profile : {};
  const name = String(p.nickname || p.name || '').trim();
  if (!name) return { text: pick(START_PLAIN[kind], rnd), emotion: 'happy', emote: 'wave' };
  const boss = p.gender === 'f' ? 'chefa' : p.gender === 'm' ? 'chefe' : '';
  const who = boss ? `${boss} ${name}` : name;
  const gap = lastSeen > 0 ? d.getTime() - lastSeen : 0;
  if (gap >= MISS_AFTER_MS) {
    const miss = pick(START_MISS, rnd).replace('{N}', who).replace('{t}', awayText(gap));
    const ask = /\?$/.test(miss) ? '' : ' ' + pick(START_MISS_ASK, rnd);
    return { text: `${hello} ${miss}${ask}`, emotion: 'happy', emote: 'cheer', missed: true };
  }
  const hey = pick(START_HEY, rnd).replace('{N}', who);
  const ask = cap(pick(START_ASK, rnd));
  return { text: `${hello} ${hey} ${ask}`, emotion: 'happy', emote: 'wave' };
}

// ---------- conversa leve sem IA ----------
const THANKS = ['De nada!', 'Imagina, é um prazer!', 'Por nada! Qualquer coisa é só chamar.'];
const JOKES = [
  'Por que o livro de matemática ficou triste? Porque tinha muitos problemas.',
  'O que o zero disse pro oito? Belo cinto!',
  'Por que o computador foi ao médico? Porque estava com vírus.',
  'Qual é o café mais perigoso do mundo? O ex-presso.',
  'Por que o programador confunde Halloween com Natal? Porque trinta e um de outubro é igual a vinte e cinco de dezembro.',
  'O que o tomate foi fazer no banco? Tirar extrato.',
  'Qual é o animal mais antigo? A zebra, porque ainda é em preto e branco.',
  'O que o pato disse pra pata? Vem quá!',
  'Qual é o fim da picada? Quando o mosquito vai embora.',
  'Por que o pão foi ao psicólogo? Porque estava se sentindo massa demais... ou de menos.',
  'Por que a vaca foi pro espaço? Pra ver a Via Láctea.',
];
const jokeLine = (rnd) => ({ text: pick(JOKES, rnd), emotion: 'happy', emote: rnd() < 0.5 ? 'laugh' : null });
const thanksLine = (rnd) => ({ text: pick(THANKS, rnd), emotion: 'happy', emote: rnd() < 0.3 ? 'bow' : null });
const howruLine = (rnd) => ({ text: pick(HOWRU, rnd), emotion: 'happy', emote: null });
const whoLine = (name) => ({ text: `Eu sou ${name || 'a Yoru'}, sua avatar aqui da área de trabalho. Sei dizer a hora, abrir sites, tocar músicas, cuidar da agenda e muito mais. É só pedir!`, emotion: 'happy', emote: 'wave' });
const HELP_TEXT = 'Eu sei dizer a hora e a data, abrir sites e programas, pesquisar, tocar música e vídeo no YouTube, cuidar da agenda, controlar o computador (volume, música, janelas, print da tela, bloquear), ver o clima, contar notícias e piadas, dançar, sentar, se abaixar, andar para os lados, fazer joinha, coração, mandar beijo, apontar, dar de ombros, fazer facepalm, bater palmas, rolar dados, jogar moeda, sortear números, fazer contas e marcar timer. É só pedir!';
const helpLine = () => ({ text: HELP_TEXT, emotion: 'happy', emote: 'nod' });
const DANCES = ['dance', 'disco', 'robot', 'samba', 'ballet', 'hiphop'];
const POSE_LINES = {
  dance: ['Bora dançar!', 'Olha só esse passo!', 'Lá vou eu!'],
  sit: ['Vou sentar um pouquinho no chão.', 'Ah, que bom sentar.'],
  chair: ['Vou pegar um banquinho e sentar.', 'Ah, que bom sentar um pouquinho.'],
  stand: ['Pronto, levantei!', 'De pé de novo!'],
  duck: ['Me abaixei!', 'Agachadinha feita.'],
  thumbs_up: ['Joinha para você!', 'Aprovadíssimo! 👍'],
  heart: ['Um coração para você!', 'Olha o coração! 🫶'],
  blow_kiss: ['Um beijo enviado!', 'Muaah! 😘'],
  point: ['Olha ali!', 'É por aqui!'],
  shrug: ['Não sei, fica a seu critério.', 'E agora? 🤷'],
  facepalm: ['Ai, meu Deus…', 'Essa foi de cair o queixo. 🤦'],
  clap: ['Parabéns! Palmas pra você!', 'Palmas, palmas!'],
  salute: ['Às ordens!', 'Sim, senhor... ou senhora!'],
  pose: ['Que tal essa pose?', 'Pose de quem manda aqui!'],
};
const poseLine = (intent, rnd) => {
  const emote = intent.dance !== undefined ? (intent.dance || pick(DANCES, rnd)) : intent.emote;
  const key = DANCES.includes(emote) ? 'dance' : emote;
  return { text: pick(POSE_LINES[key] || POSE_LINES.dance, rnd), emotion: 'happy', emote };
};
const coinLine = (rnd) => (rnd() < 0.5 ? { text: 'Deu cara!', emotion: 'happy', emote: null } : { text: 'Deu coroa!', emotion: 'happy', emote: null });

// Pedido negado ("não abre o youtube", "não desliga o computador") não pode virar comando.
// "Não, abre o youtube" (vírgula logo depois do "não": correção) continua valendo.
const NEGATABLE = new Set(['pc', 'open', 'open-unknown', 'search', 'play', 'app', 'agenda-add', 'agenda-remove', 'agenda-clear', 'timer', 'dice', 'news']);
function parseIntent(raw, opts = {}) {
  const it = parseIntentRaw(raw, opts);
  if (it && NEGATABLE.has(it.type) && !(it.type === 'pc' && it.op === 'power-cancel') &&
      /^\s*(n[aã]o|nunca)\b(?!\s*[,.!?;:])/i.test(String(raw || ''))) {
    return { type: 'chat' };
  }
  return it;
}

module.exports = {
  pcIntent, norm, lev, sameWord, findWake, isNoise, parseIntent, SITES,
  timeText, dateText, shouldComment, timeComment, idleRemark, ackLine, byeLine,
  CHATTER_KINDS, pickChatterKind, chatterLine, parseCustomLines,
  greetReply, greetShort, startupGreeting, jokeLine, thanksLine, howruLine, whoLine, helpLine, coinLine, poseLine,
  mathIntent, durationMs, durationText, mediaAnswer, MUSIC_RANDOM, fmtNum,
};
