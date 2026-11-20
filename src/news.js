'use strict';
// Manchetes de notícias via RSS (sem chave de API).

const FEEDS = [
  { name: 'Google Notícias', url: 'https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419', splitSource: true },
  { name: 'G1', url: 'https://g1.globo.com/rss/g1/' },
];

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeed(xml, feed) {
  const out = [];
  const seen = new Set();
  const items = String(xml).split(/<item[\s>]/i).slice(1);
  for (const it of items) {
    const m = it.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (!m) continue;
    let title = decode(m[1]);
    let source = feed.name;
    if (feed.splitSource) {
      const i = title.lastIndexOf(' - ');
      if (i > 10) { source = title.slice(i + 3).trim() || source; title = title.slice(0, i).trim(); }
    }
    const key = title.toLowerCase().slice(0, 40);
    if (!title || seen.has(key)) continue;
    seen.add(key);
    out.push({ title, source });
  }
  return out;
}

async function fetchHeadlines(n = 5, fetchFn = fetch) {
  let lastErr = null;
  for (const feed of FEEDS) {
    try {
      const r = await fetchFn(feed.url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'Mozilla/5.0 AvatarDesktop' } });
      if (!r.ok) throw new Error(`${feed.name}: HTTP ${r.status}`);
      const items = parseFeed(await r.text(), feed).slice(0, n);
      if (items.length) return items;
      lastErr = new Error(`${feed.name}: sem itens`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('sem notícias');
}

module.exports = { fetchHeadlines, parseFeed };
