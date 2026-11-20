'use strict';
// Confere se o KoboldCpp está pronto para ser o cérebro da Yoru:  npm run check:kobold  [endereço]
// Padrão: http://localhost:5001/v1 (o mesmo do painel). Faz duas perguntas ao servidor: qual modelo está carregado e uma resposta curta.
const base = String(process.argv[2] || process.env.YORU_KOBOLD_URL || 'http://localhost:5001/v1').replace(/\/$/, '');
const key = String(process.env.YORU_KOBOLD_KEY || '').trim();
const headers = { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) };

async function main() {
  console.log(`KoboldCpp em ${base}`);
  let r;
  try { r = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(8000) }); } catch (e) {
    console.log('✗ Não consegui conectar. Abra o KoboldCpp com um modelo (ex.: koboldcpp.exe --model seu-modelo.gguf --port 5001) e tente de novo.');
    process.exit(1);
  }
  if (r.status === 401 || r.status === 403) { console.log('✗ O KoboldCpp pediu senha. Defina YORU_KOBOLD_KEY com a senha (--password) e tente de novo.'); process.exit(1); }
  if (!r.ok) { console.log(`✗ O servidor respondeu ${r.status} em /models. O endereço termina em /v1?`); process.exit(1); }
  const j = await r.json().catch(() => ({}));
  const ids = (Array.isArray(j.data) ? j.data : []).map((m) => m.id).filter(Boolean);
  console.log(ids.length ? `✓ Modelo carregado: ${ids.join(', ')}` : '✓ Servidor no ar (não informou o nome do modelo).');
  const t0 = Date.now();
  try {
    const c = await fetch(`${base}/chat/completions`, {
      method: 'POST', headers, signal: AbortSignal.timeout(180000),
      body: JSON.stringify({ model: ids[0] || 'koboldcpp', max_tokens: 40, messages: [{ role: 'user', content: 'Responda só com: ok' }] }),
    });
    if (!c.ok) { console.log(`✗ Falhou ao conversar (${c.status}): ${(await c.text()).slice(0, 200)}`); process.exit(1); }
    const out = await c.json();
    const text = out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
    console.log(text ? `✓ Respondeu em ${((Date.now() - t0) / 1000).toFixed(1)} s: ${String(text).trim().slice(0, 80)}` : '✗ Respondeu vazio. O modelo precisa de um template de chat; veja as opções do KoboldCpp.');
    if (!text) process.exit(1);
  } catch (e) { console.log('✗ Tempo esgotado ou falha ao conversar: ' + (e && e.message)); process.exit(1); }
  console.log('Tudo certo: na Yoru, aba IA › Conexão › KoboldCpp.');
}
main();
