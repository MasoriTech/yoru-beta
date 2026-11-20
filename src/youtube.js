'use strict';
// Acha o primeiro vídeo de uma busca do YouTube (sem chave de API) para abrir direto no navegador.
// Se algo mudar no site e não achar, quem chama abre a página de resultados no lugar.

const searchUrl = (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const spotifyUrl = (q) => `https://open.spotify.com/search/${encodeURIComponent(q)}`;

// A página traz um JSON embutido; anúncios usam outros "renderers", então o primeiro
// "videoRenderer" é o primeiro vídeo de verdade.
function parseFirstVideo(html) {
  const s = String(html || '');
  const m = /"videoRenderer":\{"videoId":"([\w-]{11})"/.exec(s);
  if (!m) return null;
  const chunk = s.slice(m.index, m.index + 4000);
  const t = chunk.match(/"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/);
  let title = '';
  if (t) { try { title = JSON.parse('"' + t[1] + '"'); } catch (_) { title = t[1]; } }
  return { id: m[1], title, url: watchUrl(m[1]) };
}

async function findVideo(query, fetchFn = fetch) {
  // sp=EgIQAQ%3D%3D = filtro "somente vídeos" (sem canais, playlists nem Shorts misturados)
  const r = await fetchFn(searchUrl(query) + '&sp=EgIQAQ%3D%3D', {
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'pt-BR,pt;q=0.9',
      Cookie: 'CONSENT=YES+1; SOCS=CAI',
    },
  });
  if (!r.ok) throw new Error('YouTube: HTTP ' + r.status);
  const v = parseFirstVideo(await r.text());
  if (!v) throw new Error('YouTube: sem resultados');
  return v;
}

module.exports = { findVideo, parseFirstVideo, searchUrl, watchUrl, spotifyUrl };
