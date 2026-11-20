'use strict';
// Agenda por voz: entende "agende dentista amanhã às 15h", guarda num arquivo e avisa na hora.

const fs = require('fs');

const deaccent = (s) => String(s || '').replace(/[À-ÿ]/g, (c) => {
  const map = 'aaaaaaaceeeeiiiidnooooo/ouuuuyts'; // usado só para letras comuns do português
  const i = 'ÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖ×ØÙÚÛÜÝÞß'.indexOf(c);
  if (i >= 0) return map[i];
  const j = 'àáâãäåæçèéêëìíîïðñòóôõö÷øùúûüýþÿ'.indexOf(c);
  return j >= 0 ? map[j] : c;
});
const low = (s) => deaccent(s).toLowerCase();

const NUMW = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, meia: 0.5 };
const NUMRE = '\\d{1,3}|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|cinquenta|meia';
const num = (w) => (/^\d+$/.test(w) ? parseInt(w, 10) : NUMW[w]);
const WEEK = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
const WEEK_NAME = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const MONTHS = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTH_NAME = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const PERIOD_HOUR = { manha: 9, tarde: 15, noite: 20, madrugada: 6 };

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function cleanTitle(t) {
  let s = String(t || '').replace(/\s+/g, ' ').trim();
  const PREFIX = [
    /^[\s,.;:!?\-–]+/,
    /^(por favor|pode|poderia|quero que voce|eu quero|quero|preciso|gostaria de|voce)\b/,
    /^(me\s+)?(agend[ae]r?|marc[ae]r?|marque|anot[ae]r?|adicion[ae]r?|colo(?:que|ca|car)|ponha|poe|cri[ae]r?|cadastr[ae]r?|registr[ae]r?|insira|inserir|lembr[ae]r?|lembre|avis[ae]r?|fa[cz]a|fazer|abr[ae]r?|monte|montar)\b/,
    /^(na|no|em|a|o|as|os|um|uma|minha|meu|nova|novo|de|do|da|para|pra|pro|que|sobre|com|e|ai|la)\b/,
    /^(agenda|compromisso|lembrete|evento|tarefa|calendario)s?\b/,
  ];
  for (let guard = 0; guard < 20; guard++) {
    const d = low(s);
    let hit = false;
    for (const re of PREFIX) {
      const m = d.match(re);
      if (m && m[0].length) { s = s.slice(m[0].length).trim(); hit = true; break; }
    }
    if (!hit) break;
  }
  for (let guard = 0; guard < 10; guard++) {
    const d = low(s);
    const m = d.match(/(?:[\s,.;:!?\-–]+|\b(?:no|na|em|as|a|o|de|do|da|para|pra|por favor|e|dia|hoje)\s*)$/);
    if (!m || !m[0].length) break;
    s = s.slice(0, s.length - m[0].length).trim();
  }
  s = s.replace(/[\s,.;:!?\-–]+$/, '').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// Entende data/hora e título. now: Date.
function parseEvent(raw, now = new Date()) {
  const text = String(raw || '');
  let d = low(text);
  const spans = [];
  const eat = (m) => {
    spans.push([m.index, m.index + m[0].length]);
    d = d.slice(0, m.index) + ' '.repeat(m[0].length) + d.slice(m.index + m[0].length);
  };
  const find = (re) => { const m = d.match(re); if (m) eat(m); return m; };

  let at = null, allDay = false, approx = false, period = null, rel = null;
  let h = null, mi = 0, dayOffset = null, explicitPeriod = false;

  // 1) relativo: "daqui a 20 minutos", "em 2 horas", "daqui a meia hora"
  let m = find(new RegExp('\\b(?:daqui\\s+a|dentro\\s+de)\\s+(' + NUMRE + ')\\s*(minutos?|min|horas?|dias?|semanas?)?(\\s+e\\s+meia)?\\b'))
    || find(new RegExp('\\bem\\s+(' + NUMRE + ')\\s+(minutos?|horas?|dias?)\\b'));
  if (m) {
    let n = num(m[1]);
    const unit = m[2] || (n === 0.5 ? 'hora' : 'minutos');
    let minutes;
    if (/^dia/.test(unit)) minutes = n * 1440;
    else if (/^semana/.test(unit)) minutes = n * 10080;
    else if (/^h/.test(unit) || n === 0.5) minutes = n * 60;
    else minutes = n;
    if (m[3]) minutes += 30;
    minutes = Math.round(minutes);
    at = new Date(now.getTime() + minutes * 60000);
    if (/^(dia|semana)/.test(unit)) { at.setHours(9, 0, 0, 0); allDay = true; }
    else rel = minutes >= 60 && minutes % 60 === 0 ? `${minutes / 60} ${minutes === 60 ? 'hora' : 'horas'}` : minutes > 60 ? `${Math.floor(minutes / 60)} h e ${minutes % 60} min` : `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
  }

  if (!at) {
    // 2) dia
    if ((m = find(/\bdepois\s+de\s+amanha\b/))) dayOffset = 2;
    else if ((m = find(/\bamanha\b/))) dayOffset = 1;
    else if ((m = find(/\bhoje\b/))) dayOffset = 0;
    else if ((m = find(/\b(?:na\s+|no\s+|nesta\s+|neste\s+|proxim[ao]\s+)?(domingo|segunda|terca|quarta|quinta|sexta|sabado)(?:[\s-]feira)?(?:\s+que\s+vem|\s+proxima)?\b/))) {
      const wd = WEEK[m[1]];
      let diff = (wd - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      dayOffset = diff;
    } else if ((m = find(/\b(?:no\s+dia\s+|dia\s+)?(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/))
      || (m = find(/\b(?:no\s+dia|dia)\s+(\d{1,2})(?:\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))?\b/))) {
      const dd = parseInt(m[1], 10);
      let mon = m[2] == null ? now.getMonth() : (/^\d+$/.test(m[2]) ? parseInt(m[2], 10) - 1 : MONTHS.indexOf(m[2]));
      let target = new Date(now.getFullYear(), mon, dd);
      if (m[2] == null && target < startOfDay(now)) target = new Date(now.getFullYear(), mon + 1, dd);
      else if (target < startOfDay(now)) target = new Date(now.getFullYear() + 1, mon, dd);
      if (dd >= 1 && dd <= 31) dayOffset = Math.round((target - startOfDay(now)) / 86400000);
    }

    // 3) hora
    if ((m = find(/\bmeio[\s-]?dia\b/))) { h = 12; mi = 0; explicitPeriod = true; }
    else if ((m = find(/\bmeia[\s-]?noite\b/))) { h = 0; mi = 0; explicitPeriod = true; }
    else if ((m = find(new RegExp('\\b(?:as|a)\\s+(\\d{1,2}|uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)(?:\\s*(?:horas?|hrs|hs|h|:)(?:\\s*(\\d{2}))?)?(?:\\s+e\\s+(meia|\\d{1,2})(?!\\d))?(?!\\d)')))) {
      if (m[0].trim().startsWith('a ') && !/^(uma|1)$/.test(m[1]) && !m[2] && !/hora|h/.test(m[0])) { /* "a 15" solto: ignora */ spans.pop(); d = low(text); spans.length = 0; }
      else {
        h = num(m[1]);
        mi = m[2] ? parseInt(m[2], 10) : m[3] === 'meia' ? 30 : m[3] ? parseInt(m[3], 10) : 0;
      }
    } else if ((m = find(/\b(\d{1,2})\s*(?:hrs|hs|h|:)(?:\s*(\d{2}))?(?!\d)/)) || (m = find(/\b(\d{1,2})\s+horas?\b/))) {
      h = parseInt(m[1], 10);
      mi = m[2] ? parseInt(m[2], 10) : 0;
    }

    // 4) período do dia ("da tarde", "de manhã", "à noite")
    const p = find(/\b(?:de|da|do|a|em|pela|na)?\s*\b(manha|tarde|noite|madrugada)\b/);
    if (p) {
      period = p[1];
      if (h != null && !explicitPeriod) {
        if ((period === 'tarde' || period === 'noite') && h < 12) h += 12;
        if (period === 'noite' && h === 12) h = 0;
        explicitPeriod = true;
      } else if (h == null) { h = PERIOD_HOUR[period]; mi = 0; approx = true; }
    }

    if (h != null && (h > 23 || mi > 59)) { h = null; mi = 0; }

    // 5) junta
    if (h != null || dayOffset != null) {
      const base = startOfDay(now);
      if (dayOffset == null) {
        // só a hora: próximo horário que ainda não passou
        const cands = h >= 1 && h <= 11 && !explicitPeriod ? [h, h + 12] : [h];
        let best = null;
        for (const ch of cands) { const t = new Date(base); t.setHours(ch, mi, 0, 0); if (t > now && (!best || t < best)) best = t; }
        if (!best) { best = new Date(addDays(base, 1)); best.setHours(cands[0], mi, 0, 0); }
        at = best;
      } else {
        at = addDays(base, dayOffset);
        if (h == null) { at.setHours(9, 0, 0, 0); allDay = true; }
        else {
          if (h >= 1 && h <= 11 && !explicitPeriod && dayOffset === 0) { // "hoje às 3": a próxima ocorrência
            const a = new Date(at); a.setHours(h, mi, 0, 0);
            const b = new Date(at); b.setHours(h + 12, mi, 0, 0);
            at = a > now ? a : b;
          } else at.setHours(h, mi, 0, 0);
        }
      }
    }
  }

  // título: o texto original sem os trechos de data/hora
  spans.sort((a, b) => a[0] - b[0]);
  let title = '', pos = 0;
  for (const [s, e] of spans) { if (s >= pos) { title += text.slice(pos, s) + ' '; pos = e; } }
  title += text.slice(pos);
  title = cleanTitle(title);

  return { title, at, allDay, approx, period, rel, hasWhen: !!at };
}

// ---------- falar a data ----------
function timePhrase(date) {
  const h = date.getHours(), m = date.getMinutes();
  if (h === 12 && m === 0) return 'ao meio-dia';
  if (h === 0 && m === 0) return 'à meia-noite';
  const lead = h === 1 ? 'à' : 'às';
  if (m === 0) return `${lead} ${h} ${h === 1 ? 'hora' : 'horas'}`;
  return `${lead} ${h} e ${m}`;
}
function dayPhrase(date, now) {
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86400000);
  if (diff === 0) return 'hoje';
  if (diff === 1) return 'amanhã';
  if (diff === 2) return 'depois de amanhã';
  if (diff > 2 && diff < 7) { const w = date.getDay(); return (w === 0 || w === 6 ? 'no ' : 'na ') + WEEK_NAME[w]; }
  return `dia ${date.getDate()} de ${MONTH_NAME[date.getMonth()]}`;
}
function whenText(item, now = new Date()) {
  if (!item.at) return 'sem data';
  const at = new Date(item.at);
  const day = dayPhrase(at, now);
  if (item.allDay) return day;
  if (item.approx) {
    const h = at.getHours();
    return day + (h < 6 ? ' de madrugada' : h < 12 ? ' de manhã' : h < 18 ? ' à tarde' : ' à noite');
  }
  return `${day} ${timePhrase(at)}`;
}

// ---------- armazenamento ----------
function createStore(file, now = () => new Date()) {
  let items = [];
  const save = () => { try { fs.writeFileSync(file + '.tmp', JSON.stringify(items)); fs.renameSync(file + '.tmp', file); } catch (_) {} };
  try {
    items = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(items)) items = [];
  } catch (_) { items = []; }
  const limit = now().getTime() - 30 * 86400000; // apaga o que passou há mais de 30 dias
  const before = items.length;
  items = items.filter((x) => x && x.title && (!x.at || new Date(x.at).getTime() > limit));
  if (items.length !== before) save();

  const sorted = () => items.slice().sort((a, b) => (a.at ? new Date(a.at).getTime() : Infinity) - (b.at ? new Date(b.at).getTime() : Infinity));
  return {
    add(ev) {
      const at = ev.at ? new Date(ev.at) : null;
      const item = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        title: String(ev.title).slice(0, 120),
        at: at ? at.toISOString() : null,
        allDay: !!ev.allDay, approx: !!ev.approx,
        reminded: !!(at && at.getTime() <= now().getTime()), // já passou: não avisa
      };
      items.push(item);
      save();
      return item;
    },
    all: sorted,
    // itens (não passados) de um intervalo [from, to)
    range(from, to) { return sorted().filter((x) => x.at && new Date(x.at) >= from && new Date(x.at) < to); },
    upcoming(n = 5, from = now()) { return sorted().filter((x) => x.at && new Date(x.at) >= from).slice(0, n); },
    undated() { return items.filter((x) => !x.at); },
    remove(id) { const n = items.length; items = items.filter((x) => x.id !== id); if (items.length !== n) save(); return items.length !== n; },
    clear() { const n = items.length; items = []; save(); return n; },
    due(at = now()) {
      const t = at.getTime();
      return sorted().filter((x) => x.at && !x.reminded && new Date(x.at).getTime() <= t && t - new Date(x.at).getTime() <= 3 * 3600000);
    },
    markReminded(id) { const x = items.find((i) => i.id === id); if (x) { x.reminded = true; save(); } },
    // procura pelo título (palavras em comum); devolve o melhor
    find(query) {
      const q = low(query).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2);
      if (!q.length) return null;
      let best = null, score = 0;
      for (const x of items) {
        const words = new Set(low(x.title).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/));
        const sc = q.filter((w) => words.has(w) || [...words].some((v) => v.length > 3 && (v.startsWith(w) || w.startsWith(v)))).length;
        if (sc > score) { score = sc; best = x; }
      }
      return best;
    },
    size: () => items.length,
  };
}

// o que sobra de "apague o compromisso dentista" depois de tirar o verbo e os nomes
function removeQuery(raw) {
  return low(raw)
    .replace(/\b(apag[ue]r?|remov[ae]r?|remova|cancel[ae]r?|exclu[ai]r?|delet[ae]r?|tire|tirar|limp[ae]r?)\b/g, ' ')
    .replace(/\b(o|a|os|as|um|uma|da|do|na|no|minha|meu|de|compromissos?|agenda|lembretes?|eventos?|tarefas?|calendario|por favor)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

module.exports = { parseEvent, createStore, whenText, removeQuery, cleanTitle, deaccent, startOfDay, addDays };
