'use strict';
// Clima por voz: Open-Meteo (grátis, sem chave). Cidade: dita no pedido, configurada, ou detectada pelo IP.

const CODES = {
  0: 'céu limpo', 1: 'céu quase limpo', 2: 'parcialmente nublado', 3: 'nublado',
  45: 'neblina', 48: 'neblina', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte', 56: 'garoa gelada', 57: 'garoa gelada',
  61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 66: 'chuva gelada', 67: 'chuva gelada forte',
  71: 'neve fraca', 73: 'neve', 75: 'neve forte', 77: 'grãos de neve',
  80: 'pancadas de chuva fracas', 81: 'pancadas de chuva', 82: 'pancadas de chuva fortes',
  85: 'neve passageira', 86: 'neve passageira forte', 95: 'tempestade', 96: 'tempestade com granizo', 99: 'tempestade com granizo forte',
};
const describe = (c) => CODES[c] || 'tempo instável';
const isRain = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c >= 95;

const STOP_CITY = new Set(['hoje', 'amanha', 'amanhã', 'agora', 'semana', 'manha', 'manhã', 'tarde', 'noite', 'fim', 'casa', 'la', 'lá', 'aqui',
  'fora', 'hora', 'dia', 'mim', 'gente', 'voce', 'você', 'tempo', 'clima', 'previsao', 'previsão', 'mundo', 'geral', 'novo', 'nova']);

// Lê o pedido: cidade (se dita) e dia (0 = hoje/agora, 1 = amanhã, 2 = depois de amanhã)
function parseRequest(raw) {
  const txt = String(raw || '').replace(/[?!.]+$/g, '').trim();
  const low = txt.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let day = 0;
  if (/\bdepois de amanha\b/.test(low)) day = 2;
  else if (/\bamanha\b/.test(low)) day = 1;
  let city = null;
  const re = /\b(?:em|de|para|pra|no|na|ai em|la em)\s+([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .-]{2,40}?)(?=\s+(?:hoje|amanh[ãa]|agora|por favor|neste|nesta|nessa|nesse|agorinha)\b|[?.!,]|$)/gi;
  let m;
  while ((m = re.exec(txt))) {
    const c = m[1].trim().replace(/^(o|a|os|as|um|uma)\s+/i, '');
    const first = c.split(/\s+/)[0].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (c.length >= 3 && !STOP_CITY.has(first) && !STOP_CITY.has(c.toLowerCase())) { city = c; break; }
  }
  return { city, day };
}

const r0 = (n) => Math.round(Number(n));

function weatherText(w, day = 0) {
  const d = w.days[Math.min(day, w.days.length - 1)];
  const rain = d.rainProb != null && d.rainProb >= 30 ? `, com ${r0(d.rainProb)}% de chance de chuva` : '';
  let out;
  if (day === 0) {
    const feel = Math.abs(w.now.feels - w.now.temp) >= 3 ? `, com sensação de ${r0(w.now.feels)}` : '';
    out = `Agora em ${w.place} faz ${r0(w.now.temp)} graus, ${describe(w.now.code)}${feel}. ` +
      `Hoje a máxima é de ${r0(d.max)} e a mínima de ${r0(d.min)}${rain}.`;
  } else {
    out = `${day === 1 ? 'Amanhã' : 'Depois de amanhã'} em ${w.place}: ${describe(d.code)}, máxima de ${r0(d.max)} graus e mínima de ${r0(d.min)}${rain}.`;
  }
  const t = day === 0 ? w.now.temp : (d.max + d.min) / 2;
  if ((d.rainProb != null && d.rainProb >= 50) || isRain(d.code) || (day === 0 && isRain(w.now.code))) out += ' Melhor levar um guarda-chuva!';
  else if (d.max >= 32) out += ' Está bem quente, beba bastante água!';
  else if (d.min <= 12 || t <= 14) out += ' Leve um casaco!';
  return out;
}

function emotionFor(w, day = 0) {
  const d = w.days[Math.min(day, w.days.length - 1)];
  const code = day === 0 ? w.now.code : d.code;
  if (code >= 95 || d.max >= 35) return 'surprised';
  if (isRain(code)) return 'relaxed';
  if (code <= 1) return 'happy';
  return 'neutral';
}

function createWeather({ fetchFn, ttlMs = 10 * 60 * 1000, nowMs = () => Date.now() } = {}) {
  const f = (...a) => (fetchFn || fetch)(...a);
  const cache = new Map();   // "lat,lon" -> { t, data }
  const geoCache = new Map(); // cidade -> local
  let ipLoc = null;

  async function getJson(url) {
    const r = await f(url, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'AvatarDesktop' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async function geocode(name) {
    const key = name.toLowerCase();
    if (geoCache.has(key)) return geoCache.get(key);
    const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=pt&format=json`);
    const g = j && j.results && j.results[0];
    if (!g) { const e = new Error('cidade não encontrada'); e.code = 'NOCITY'; throw e; }
    const loc = { place: g.name, lat: g.latitude, lon: g.longitude };
    geoCache.set(key, loc);
    return loc;
  }

  async function locateByIp() {
    if (ipLoc) return ipLoc;
    let last = null;
    for (const url of ['https://ipwho.is/', 'https://ipapi.co/json/']) {
      try {
        const j = await getJson(url);
        const lat = j.latitude, lon = j.longitude;
        if (typeof lat === 'number' && typeof lon === 'number' && j.success !== false) {
          ipLoc = { place: j.city || j.region || 'sua região', lat, lon };
          return ipLoc;
        }
      } catch (e) { last = e; }
    }
    const e = new Error('não consegui descobrir sua localização' + (last ? ': ' + last.message : ''));
    e.code = 'NOLOC';
    throw e;
  }

  async function get({ city } = {}) {
    const loc = city ? await geocode(city) : await locateByIp();
    const key = loc.lat.toFixed(2) + ',' + loc.lon.toFixed(2);
    const hit = cache.get(key);
    if (hit && nowMs() - hit.t < ttlMs) return { ...hit.data, place: loc.place };
    const j = await getJson('https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=auto&forecast_days=3');
    if (!j || !j.current || !j.daily) throw new Error('resposta inesperada do serviço de clima');
    const days = j.daily.time.map((_, i) => ({
      code: j.daily.weather_code[i], max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i],
      rainProb: j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[i] : null,
    }));
    const data = {
      now: { temp: j.current.temperature_2m, feels: j.current.apparent_temperature, code: j.current.weather_code, wind: j.current.wind_speed_10m },
      days,
    };
    cache.set(key, { t: nowMs(), data });
    return { ...data, place: loc.place };
  }

  return { get };
}

module.exports = { createWeather, parseRequest, weatherText, emotionFor, describe };
