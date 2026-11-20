'use strict';
// Aba "Criação": gerar imagens, textos, vídeos (apresentações animadas), SVG e páginas HTML e guardar como projetos.
// Aqui fica a parte sem Electron e sem tela (estilos, prompts, roteiro do vídeo, lista de projetos),
// para testar com `npm test`. O main.js faz os pedidos de rede e grava os arquivos; o painel desenha a tela.

const MAX_PROMPT = 2000;

// id, nome na tela, texto que entra no fim do prompt da imagem
const STYLES = [
  ['realista', 'Realista', 'photorealistic, natural lighting, highly detailed, sharp focus'],
  ['anime', 'Anime', 'anime style, vibrant colors, clean line art, detailed illustration'],
  ['digital', 'Arte digital', 'digital art, concept art, rich colors, dramatic lighting, highly detailed'],
  ['3d', '3D', '3d render, soft studio lighting, smooth materials, octane render'],
  ['pintura', 'Pintura a óleo', 'oil painting, visible brush strokes, rich texture, classical composition'],
  ['aquarela', 'Aquarela', 'watercolor painting, soft gradients, paper texture, delicate'],
  ['pixel', 'Pixel art', 'pixel art, 16-bit, limited color palette, crisp pixels'],
  ['cinema', 'Cinematográfico', 'cinematic still, anamorphic lens, film grain, moody color grading'],
  ['cartoon', 'Desenho animado 2D', '2d cartoon style, bold outlines, flat colors, playful, expressive'],
  ['hq', 'Quadrinhos (HQ)', 'comic book style, ink outlines, halftone dots, dynamic composition, vivid colors'],
  ['cyberpunk', 'Cyberpunk neon', 'cyberpunk, neon lights, rainy night, futuristic city, glowing reflections'],
  ['fantasia', 'Fantasia épica', 'epic fantasy art, magical atmosphere, intricate details, volumetric light'],
  ['minimal', 'Minimalista / vetor', 'minimalist vector illustration, flat design, simple shapes, clean background'],
  ['lowpoly', 'Low poly', 'low poly 3d, faceted geometry, pastel gradients, clean render'],
  ['isometrico', 'Isométrico', 'isometric illustration, tiny detailed scene, soft shadows, clean colors'],
  ['lapis', 'Esboço a lápis', 'pencil sketch, graphite shading, hand drawn, paper texture'],
  ['retro80', 'Retrô anos 80', '1980s retro style, synthwave, vhs grain, vivid magenta and cyan'],
  ['papercraft', 'Papercraft', 'papercraft, layered cut paper, soft shadows, handmade look'],
  ['produto', 'Foto de produto', 'professional product photography, studio lighting, clean background, sharp details'],
  ['retrato', 'Retrato de estúdio', 'studio portrait, soft key light, shallow depth of field, detailed skin and eyes'],
  ['logo', 'Logotipo', 'logo design, simple bold shapes, vector style, centered, plain background'],
  ['icone', 'Ícone de app', 'app icon, rounded square, glossy gradient, simple symbol, high contrast'],
  ['livre', 'Sem estilo', ''],
].map(([id, label, suffix]) => ({ id, label, suffix }));

// formatos: tamanho de geração (múltiplos de 8) e proporção do vídeo
const RATIOS = [
  ['16:9', '16:9 (Paisagem)', 1280, 720],
  ['9:16', '9:16 (Retrato)', 720, 1280],
  ['1:1', '1:1 (Quadrado)', 1024, 1024],
  ['4:3', '4:3', 1152, 864],
  ['3:4', '3:4', 864, 1152],
  ['3:2', '3:2 (Foto)', 1152, 768],
  ['2:3', '2:3 (Foto em pé)', 768, 1152],
  ['4:5', '4:5 (Post de rede social)', 896, 1120],
  ['21:9', '21:9 (Ultrawide)', 1344, 576],
].map(([id, label, w, h]) => ({ id, label, w, h }));

// ---------- modelos GRATUITOS (conferidos em nov/2026; essas listas mudam, então há plano B automático) ----------
// Imagem: o Pollinations acabou com o uso grátis sem chave (jul/2026). A melhor opção grátis hoje é a Cloudflare Workers AI
// (conta grátis, sem cartão, cota diária de 10 mil "neurons"). `needs` diz qual chave o modelo exige; `negative` = aceita "prompt negativo".
const IMAGE_MODELS = [
  { id: 'cf-flux', label: 'FLUX.1 schnell: melhor qualidade grátis (Cloudflare)', kind: 'cloudflare', model: '@cf/black-forest-labs/flux-1-schnell', needs: 'cloudflare', free: true, square: true, steps: 4 },
  { id: 'cf-sdxl', label: 'SDXL Lightning: rápido, vários formatos (Cloudflare)', kind: 'cloudflare', model: '@cf/bytedance/stable-diffusion-xl-lightning', needs: 'cloudflare', free: true, maxSide: 1024, steps: 6, guidance: 1.5, negative: true },
  { id: 'cf-sdxl-base', label: 'SDXL Base 1.0: mais detalhe, mais lento (Cloudflare)', kind: 'cloudflare', model: '@cf/stabilityai/stable-diffusion-xl-base-1.0', needs: 'cloudflare', free: true, maxSide: 1024, steps: 20, guidance: 7.5, negative: true },
  { id: 'cf-dream', label: 'DreamShaper 8: ilustração e anime (Cloudflare)', kind: 'cloudflare', model: '@cf/lykon/dreamshaper-8-lcm', needs: 'cloudflare', free: true, maxSide: 768, steps: 8, guidance: 1.5, negative: true },
  { id: 'pollinations', label: 'Pollinations: precisa de chave com Pollen (não é grátis)', kind: 'pollinations', model: 'black-forest-labs/flux.1-schnell', needs: 'pollinations', free: false },
  { id: 'openrouter', label: 'OpenRouter: modelo pago, usa a sua chave', kind: 'openrouter', model: '', needs: 'openrouter', free: false },
];

// Texto grátis, de quatro serviços (cada um com chave grátis, sem cartão). A mesma conta da Cloudflare serve para imagem E texto.
//  - OpenRouter: modelos ":free" (20 pedidos/min e 50/dia; 1.000/dia depois de comprar US$ 10 de crédito)
//  - Google Gemini (AI Studio): chave grátis em aistudio.google.com/apikey
//  - Groq: chave grátis em console.groq.com/keys (muito rápido)
//  - Cloudflare: usa o mesmo ID de conta e token da imagem (divide a cota diária de neurons com as imagens)
// A ordem é uma escolha editorial (qualidade em português, velocidade e estabilidade), não um benchmark.
const TEXT_PROVIDERS = {
  gemini: { label: 'Google Gemini (grátis)', needs: 'gemini', base: () => 'https://generativelanguage.googleapis.com/v1beta/openai' },
  groq: { label: 'Groq (grátis, muito rápido)', needs: 'groq', base: () => 'https://api.groq.com/openai/v1' },
  cloudflare: { label: 'Cloudflare (grátis)', needs: 'cloudflare', base: (cfg) => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(String((cfg.cloudflare && cfg.cloudflare.accountId) || '').trim())}/ai/v1` },
  openrouter: { label: 'OpenRouter (grátis)', needs: 'openrouter' },
};
const TEXT_MODELS = [
  { id: 'auto', label: 'Automático: o melhor grátis que estiver respondendo', kind: 'auto', free: true, group: 'Automático', needs: null },
  // Google Gemini
  { id: 'gemini:gemini-2.5-flash', label: 'Gemini 2.5 Flash: ótimo em português', kind: 'openai', provider: 'gemini', model: 'gemini-2.5-flash', free: true },
  { id: 'gemini:gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite: o mais leve', kind: 'openai', provider: 'gemini', model: 'gemini-2.5-flash-lite', free: true },
  // Groq
  { id: 'groq:llama-3.3-70b-versatile', label: 'Llama 3.3 70B: rápido e equilibrado', kind: 'openai', provider: 'groq', model: 'llama-3.3-70b-versatile', free: true },
  { id: 'groq:openai/gpt-oss-120b', label: 'GPT-OSS 120B: raciocínio forte', kind: 'openai', provider: 'groq', model: 'openai/gpt-oss-120b', free: true },
  { id: 'groq:qwen/qwen3-32b', label: 'Qwen 3 32B: bom em texto longo', kind: 'openai', provider: 'groq', model: 'qwen/qwen3-32b', free: true },
  { id: 'groq:llama-3.1-8b-instant', label: 'Llama 3.1 8B: instantâneo', kind: 'openai', provider: 'groq', model: 'llama-3.1-8b-instant', free: true },
  // Cloudflare (mesma conta da imagem)
  { id: 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast', label: 'Llama 3.3 70B (usa a conta da imagem)', kind: 'openai', provider: 'cloudflare', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', free: true },
  { id: 'cf:@cf/openai/gpt-oss-120b', label: 'GPT-OSS 120B (usa a conta da imagem)', kind: 'openai', provider: 'cloudflare', model: '@cf/openai/gpt-oss-120b', free: true },
  { id: 'cf:@cf/mistralai/mistral-small-3.1-24b-instruct', label: 'Mistral Small 3.1 24B (usa a conta da imagem)', kind: 'openai', provider: 'cloudflare', model: '@cf/mistralai/mistral-small-3.1-24b-instruct', free: true },
  { id: 'cf:@cf/google/gemma-3-12b-it', label: 'Gemma 3 12B (usa a conta da imagem)', kind: 'openai', provider: 'cloudflare', model: '@cf/google/gemma-3-12b-it', free: true },
  // OpenRouter ":free"
  { id: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B (Google): ótimo em português', kind: 'openrouter', provider: 'openrouter', free: true },
  { id: 'qwen/qwen3.8-27b:free', label: 'Qwen 3.8 27B: bom em texto longo', kind: 'openrouter', provider: 'openrouter', free: true },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B (NVIDIA): o maior, mais lento', kind: 'openrouter', provider: 'openrouter', free: true },
  { id: 'google/gemma-4-26b-a4b-it:free', label: 'Gemma 4 26B A4B: rápido', kind: 'openrouter', provider: 'openrouter', free: true },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'Nemotron 3.5 Lightning (NVIDIA): o mais rápido', kind: 'openrouter', provider: 'openrouter', free: true },
  { id: 'chat', label: 'A IA da aba IA (pode ser paga)', kind: 'chat', free: false, group: 'Outros', needs: null },
].map((m) => (m.provider ? { ...m, group: TEXT_PROVIDERS[m.provider].label, needs: TEXT_PROVIDERS[m.provider].needs } : m));
// só os do OpenRouter: é a lista do plano B (ids com ":free")
const FREE_TEXT_ORDER = TEXT_MODELS.filter((m) => m.kind === 'openrouter').map((m) => m.id);
// ordem do "Automático": mistura os serviços (o que tiver chave entra; o que falhar passa para o próximo)
const AUTO_TEXT_ORDER = [
  'gemini:gemini-2.5-flash', 'groq:llama-3.3-70b-versatile', 'cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'google/gemma-4-31b-it:free',
  'groq:openai/gpt-oss-120b', 'gemini:gemini-2.5-flash-lite', 'cf:@cf/mistralai/mistral-small-3.1-24b-instruct', 'qwen/qwen3.8-27b:free',
  'groq:qwen/qwen3-32b', 'cf:@cf/google/gemma-3-12b-it', 'google/gemma-4-26b-a4b-it:free', 'groq:llama-3.1-8b-instant',
  'cf:@cf/openai/gpt-oss-120b', 'nvidia/nemotron-3-ultra-550b-a55b:free', 'nvidia/nemotron-3.5-lightning:free',
];
const realKey = (k) => (k && k !== 'COLE_SUA_CHAVE_AQUI' ? String(k) : '');
// a chave que o modelo exige está preenchida? (cfg = config do app)
function keyReady(cfg, needs) {
  cfg = cfg || {};
  if (!needs) return true;
  if (needs === 'cloudflare') return !!(cfg.cloudflare && String(cfg.cloudflare.accountId || '').trim() && realKey(cfg.cloudflare.apiToken));
  return !!(cfg[needs] && realKey(cfg[needs].apiKey));
}
// modelos "fixos" do Automático que têm chave, na ordem certa
const autoTextModels = (cfg) => AUTO_TEXT_ORDER.map((id) => TEXT_MODELS.find((m) => m.id === id)).filter((m) => m && keyReady(cfg, m.needs));

const byId = (list, id, dflt) => list.find((x) => x.id === id) || list.find((x) => x.id === dflt) || list[0];
const getStyle = (id) => byId(STYLES, id, 'realista');
const getRatio = (id) => byId(RATIOS, id, '16:9');
const getModel = (id) => byId(IMAGE_MODELS, id, 'cf-flux');
const getTextModel = (id) => byId(TEXT_MODELS, id, 'auto');

const clampNegative = (p) => String(p || '').replace(/\s+/g, ' ').trim().slice(0, 500);
const clampPrompt = (p) => String(p || '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROMPT);

function buildImagePrompt(prompt, styleId) {
  const s = getStyle(styleId);
  const p = clampPrompt(prompt);
  return s.suffix ? `${p}, ${s.suffix}` : p;
}

// Pollinations (gen.pollinations.ai): exige chave (vai no cabeçalho Authorization, nunca na URL). O texto vai na própria URL (limite prático ~1500 caracteres).
function pollinationsUrl({ prompt, w, h, seed, model, negative }) {
  const q = new URLSearchParams({ model: model || 'black-forest-labs/flux.1-schnell', width: String(w), height: String(h), seed: String(seed) });
  if (clampNegative(negative)) q.set('negative_prompt', clampNegative(negative));
  return `https://gen.pollinations.ai/image/${encodeURIComponent(String(prompt).slice(0, 1500))}?${q}`;
}

// Cloudflare Workers AI: POST com a chave no cabeçalho. O FLUX responde JSON com a imagem em base64; os modelos Stable Diffusion respondem a imagem direto.
function cloudflareUrl(accountId, model) {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(String(accountId || '').trim())}/ai/run/${model}`;
}
// reduz (w,h) para que o lado maior caiba em maxSide, mantendo a proporção e múltiplos de 8
function fitSize(w, h, maxSide) {
  const k = Math.min(1, maxSide / Math.max(w, h));
  const r8 = (v) => Math.max(256, Math.round((v * k) / 8) * 8);
  return { w: r8(w), h: r8(h) };
}
function cloudflareBody(m, { prompt, w, h, seed, negative }) {
  const p = String(prompt).slice(0, 2000);
  if (m.square) return { prompt: p, steps: m.steps }; // FLUX não aceita tamanho nem prompt negativo: sai quadrado e o main.js recorta
  const { w: W, h: H } = fitSize(w, h, m.maxSide || 1024);
  const body = { prompt: p, width: W, height: H, num_steps: m.steps, guidance: m.guidance, seed: Number(seed) % 2147483647 };
  const neg = clampNegative(negative);
  if (m.negative && neg) body.negative_prompt = neg;
  return body;
}
// maior retângulo centralizado com a proporção rw:rh dentro de uma imagem w×h
function cropRect(w, h, rw, rh) {
  let cw = w, ch = Math.round((w * rh) / rw);
  if (ch > h) { ch = h; cw = Math.round((h * rw) / rh); }
  return { x: Math.floor((w - cw) / 2), y: Math.floor((h - ch) / 2), width: cw, height: ch };
}

// Da lista viva do OpenRouter (/models): só modelos de texto realmente gratuitos, os de maior contexto primeiro (plano B).
function pickFreeModels(list) {
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && typeof m.id === 'string' && /:free$/.test(m.id) && m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0
      && !/safety|guard|embed|rerank|lyria|image/i.test(m.id)
      && (!m.architecture || !Array.isArray(m.architecture.output_modalities) || m.architecture.output_modalities.join() === 'text'))
    .sort((a, b) => (b.context_length || 0) - (a.context_length || 0))
    .map((m) => m.id);
}

// ---------- texto ----------
const TEXT_KINDS = [
  ['livre', 'Texto livre', 'Escreva exatamente o que for pedido.'],
  ['roteiro', 'Roteiro', 'Escreva um roteiro com cenas numeradas, falas e indicações curtas de ação.'],
  ['historia', 'História', 'Escreva uma história com começo, meio e fim.'],
  ['ideias', 'Lista de ideias', 'Dê uma lista numerada de ideias criativas e diferentes entre si.'],
  ['poema', 'Poema ou letra', 'Escreva um poema (ou letra de música) com estrofes.'],
  ['email', 'E-mail ou mensagem', 'Escreva uma mensagem pronta para enviar, com assunto quando for e-mail.'],
  ['resposta', 'Responder uma mensagem', 'Escreva uma resposta pronta para a mensagem fornecida, educada e direta.'],
  ['post', 'Post para redes sociais', 'Escreva um post pronto para publicar, com gancho na primeira linha, texto curto e algumas hashtags no fim.'],
  ['legenda', 'Legenda de foto', 'Escreva 3 opções curtas de legenda, numeradas, com emojis com moderação.'],
  ['titulo', 'Títulos e slogans', 'Dê 10 opções numeradas de título ou slogan, curtas e marcantes.'],
  ['nomes', 'Ideias de nome', 'Dê 12 ideias de nome numeradas, cada uma com meia linha explicando a escolha.'],
  ['produto', 'Descrição de produto', 'Escreva uma descrição de produto persuasiva, com benefícios claros e uma chamada para ação.'],
  ['anuncio', 'Anúncio', 'Escreva um anúncio curto e persuasivo, com título, texto e chamada para ação.'],
  ['video', 'Descrição para vídeo', 'Escreva título, descrição e hashtags para um vídeo, otimizados para busca.'],
  ['discurso', 'Discurso', 'Escreva um discurso falado, com abertura marcante, desenvolvimento e fechamento.'],
  ['carta', 'Carta ou pedido formal', 'Escreva uma carta formal ou pedido, com vocativo, corpo organizado e despedida.'],
  ['explicar', 'Explicar de forma simples', 'Explique o assunto de forma simples, com um exemplo do dia a dia, como para quem nunca ouviu falar.'],
  ['estudo', 'Plano de estudos', 'Monte um plano de estudos em etapas, com metas curtas e uma ordem sugerida.'],
  ['receita', 'Receita', 'Escreva uma receita com lista de ingredientes e modo de preparo em passos numerados.'],
  ['piadas', 'Piadas e trocadilhos', 'Escreva 5 piadas ou trocadilhos curtos, numerados, sem ofender ninguém.'],
  ['resumo', 'Resumo', 'Resuma o texto fornecido de forma clara e fiel.'],
  ['melhorar', 'Melhorar um texto', 'Reescreva o texto fornecido com mais clareza e fluidez, sem mudar o sentido.'],
  ['corrigir', 'Corrigir ortografia e gramática', 'Corrija ortografia, acentos e gramática do texto fornecido, sem mudar o estilo nem o sentido.'],
  ['traduzir', 'Traduzir', 'Traduza o texto fornecido de forma natural, mantendo o sentido e o tom.'],
].map(([id, label, how]) => ({ id, label, how }));
const TONES = [['neutro', 'Neutro'], ['animado', 'Animado'], ['divertido', 'Divertido'], ['amigavel', 'Amigável'], ['formal', 'Formal'], ['profissional', 'Profissional'],
  ['persuasivo', 'Persuasivo'], ['inspirador', 'Inspirador'], ['tecnico', 'Técnico'], ['poetico', 'Poético'], ['sarcastico', 'Sarcástico'], ['sombrio', 'Sombrio']]
  .map(([id, label]) => ({ id, label }));
// words: o que vai no prompt; tokens: limite de resposta para o modelo
const SIZES = [['mini', 'Mini', 'até uns 30 palavras', 600], ['curto', 'Curto', 'até uns 100 palavras', 1000], ['medio', 'Médio', 'uns 250 palavras', 1800],
  ['longo', 'Longo', 'uns 600 palavras', 3000], ['enorme', 'Muito longo', 'uns 1200 palavras', 4500]]
  .map(([id, label, words, tokens]) => ({ id, label, words, tokens }));
const LANGS = [['pt', 'Português (Brasil)', 'português do Brasil'], ['en', 'Inglês', 'inglês'], ['es', 'Espanhol', 'espanhol'], ['fr', 'Francês', 'francês'],
  ['de', 'Alemão', 'alemão'], ['it', 'Italiano', 'italiano'], ['ja', 'Japonês', 'japonês'], ['ko', 'Coreano', 'coreano'], ['zh', 'Chinês', 'chinês']]
  .map(([id, label, name]) => ({ id, label, name }));
const maxTokensFor = (size) => byId(SIZES, size, 'medio').tokens;

function textSystem({ kind, tone, size, lang } = {}) {
  const k = byId(TEXT_KINDS, kind, 'livre'), t = byId(TONES, tone, 'neutro'), z = byId(SIZES, size, 'medio'), l = byId(LANGS, lang, 'pt');
  const where = l.id === 'pt' ? 'Responda em português do Brasil (a não ser que o pedido peça outro idioma)' : `Responda em ${l.name}`;
  return `Você é uma assistente de escrita criativa. ${k.how} Tom: ${t.label.toLowerCase()}. Tamanho: ${z.words}. ` +
    `${where}, só com o texto pedido, sem explicações antes ou depois.`;
}

// ideias para o botão 🎲 (cada ferramenta tem as suas)
const IDEAS = {
  image: [
    'uma raposa de capuz explorando uma cidade neon à noite', 'um castelo flutuando entre as nuvens ao nascer do sol', 'um gato astronauta tomando café na Lua',
    'uma biblioteca antiga com vaga-lumes flutuando entre as estantes', 'um robô jardineiro cuidando de flores em uma estufa de vidro', 'uma vila de pescadores sob uma aurora boreal',
    'um dragão pequeno dormindo em cima de uma pilha de livros', 'uma cafeteria aconchegante num dia de chuva, vista da janela', 'uma floresta de cogumelos gigantes brilhando no escuro',
    'um samurai solitário caminhando numa ponte de neve', 'uma cidade submersa com peixes luminosos entre os prédios', 'uma nave espacial pousada em um deserto de cristais',
  ],
  text: [
    'um roteiro de 1 minuto apresentando a Yoru para quem nunca a viu', 'uma história curta sobre um robô que aprende a pintar', 'dez nomes para uma cafeteria temática de gatos',
    'um post animado anunciando a abertura de uma loja de plantas', 'um e-mail educado pedindo mais prazo para entregar um trabalho', 'um plano de estudos de 4 semanas para aprender inglês do zero',
    'um poema sobre a chuva na cidade grande', 'uma descrição de produto para uma garrafa térmica que mantém o gelo por 24 horas',
  ],
  svg: [
    'um mascote de raposa laranja sorrindo, em estilo plano', 'um ícone de foguete com chamas, traço grosso e cantos arredondados', 'uma paisagem de montanhas ao pôr do sol em camadas',
    'um logotipo para uma cafeteria chamada Grão de Lua', 'um padrão de ondas do mar em tons de azul', 'um gráfico de barras com as vendas de cada mês (dados de exemplo)',
    'um planeta com anéis girando devagar, com estrelas piscando ao fundo', 'um emblema redondo de “Melhor Barista” com uma xícara no centro',
  ],
  html: [
    'uma landing page para um app de meditação, com visual calmo e botão de baixar', 'um cartão de visita digital para uma ilustradora freelancer', 'um currículo de uma pessoa desenvolvedora júnior, limpo e para imprimir',
    'um convite de aniversário de 30 anos com tema de cinema', 'um slide de apresentação com o título “Resultados do 3º trimestre” e três números grandes', 'uma animação em CSS de uma xícara de café soltando vapor',
    'uma calculadora de gorjeta simples e bonita', 'um jogo da memória com emojis, 4×4',
  ],
  video: [
    'uma raposa de capuz explorando uma cidade neon à noite', 'a viagem de uma gota de chuva da nuvem até o oceano', 'um robô descobrindo uma flor no meio de um ferro-velho',
    'um dia na vida de um gato astronauta', 'uma pequena nave atravessando um cinturão de asteroides coloridos', 'a construção de um castelo de areia que vira um reino mágico',
  ],
};
function randomIdea(tool, rnd = Math.random) {
  const list = IDEAS[tool] || IDEAS.image;
  return list[Math.min(list.length - 1, Math.floor(rnd() * list.length))];
}

const ENHANCE_SYSTEM = 'You turn a short idea (any language) into ONE detailed image-generation prompt in English: subject, setting, lighting, mood, composition. ' +
  'Keep the user\'s intent, add no text overlays, and answer with the prompt only (max 60 words).';

// ---------- vídeo (apresentação animada) ----------
const STORYBOARD_SYSTEM = (n) => `Você cria roteiros visuais curtos. Para a ideia do usuário, devolva SOMENTE um JSON (sem texto fora dele) com exatamente ${n} cenas: ` +
  '[{"prompt":"descrição visual da cena em inglês, concreta e detalhada","caption":"legenda curta em português (até 8 palavras)"}]. ' +
  'As cenas formam uma sequência com começo, meio e fim e mantêm o mesmo personagem/estilo.';

// aceita JSON puro, JSON dentro de ```, ou (último recurso) uma cena por linha
function parseStoryboard(text, n = 5) {
  const raw = String(text || '');
  const clean = (arr) => arr.map((x) => ({
    prompt: clampPrompt(typeof x === 'string' ? x : x && (x.prompt || x.description || x.scene)),
    caption: String((x && x.caption) || '').replace(/\s+/g, ' ').trim().slice(0, 80),
  })).filter((s) => s.prompt).slice(0, n);
  const m = raw.match(/\[[\s\S]*\]/);
  if (m) { try { const j = JSON.parse(m[0]); if (Array.isArray(j)) return clean(j); } catch (_) { /* não é JSON: tenta o plano B */ } }
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '').trim()).filter((l) => l.length > 8);
  return clean(lines);
}

// O que desenhar no instante t (segundos): cena atual, a próxima (durante a transição) e o zoom/deslocamento de cada uma.
// motion: 'misto' (padrão), 'zoom' (aproxima), 'afastar' (afasta) ou 'pan' (desliza de lado, sem zoom)
// <sceneFrame>
function sceneFrame(t, n, secPer, fade = 0.6, motion = 'misto') {
  const total = n * secPer;
  const tt = Math.min(Math.max(t, 0), Math.max(total - 1e-6, 0));
  const i = Math.min(n - 1, Math.floor(tt / secPer));
  const local = tt - i * secPer;
  const progress = local / secPer;
  const left = secPer - local;
  const mix = i < n - 1 && left < fade ? 1 - left / fade : 0; // 0..1 só no fim da cena
  const move = (idx, p) => {
    if (motion === 'zoom') return { zoom: 1.04 + 0.1 * p, px: 0, py: 0 };
    if (motion === 'afastar') return { zoom: 1.14 - 0.1 * p, px: 0, py: 0 };
    if (motion === 'pan') return { zoom: 1.1, px: (idx % 2 ? -1 : 1) * 0.06 * (p - 0.5), py: 0 };
    return { zoom: 1.04 + 0.1 * p, px: (idx % 2 ? -1 : 1) * 0.03 * (p - 0.5), py: (idx % 3 ? 1 : -1) * 0.02 * (p - 0.5) };
  };
  return { index: i, next: i < n - 1 ? i + 1 : null, mix, a: move(i, progress), b: move(i + 1, 0), total };
}
// </sceneFrame>
const MOTIONS = [['misto', 'Misto (zoom e deslize)'], ['zoom', 'Aproximar (zoom in)'], ['afastar', 'Afastar (zoom out)'], ['pan', 'Deslizar de lado']].map(([id, label]) => ({ id, label }));
const FADES = [['0.3', 'Corte rápido'], ['0.6', 'Normal'], ['1', 'Suave'], ['1.5', 'Bem suave']].map(([id, label]) => ({ id, label, sec: Number(id) }));

// ---------- código: SVG e HTML escritos pela IA ----------
// A IA escreve o código; o painel mostra uma prévia segura (SVG como <img>, HTML num iframe sem scripts) e o arquivo é salvo já limpo.
// `how` entra em inglês no prompt do sistema (os modelos grátis seguem melhor as regras assim).
const SVG_KINDS = [
  ['livre', 'Livre', 'a vector image that fits the request'],
  ['ilustracao', 'Ilustração', 'a detailed flat vector illustration with a clear focal subject, layered background and soft gradients'],
  ['icone', 'Ícone', 'a single crisp icon: simple geometry, consistent stroke width, centered with generous padding'],
  ['logo', 'Logotipo', 'a clean logo mark (with an optional short wordmark in a generic font), bold simple shapes that work on light and dark backgrounds'],
  ['mascote', 'Mascote / personagem', 'an ORIGINAL cute character or mascot (never an existing copyrighted character) built from simple shapes, with an expressive face and a thin outline'],
  ['cena', 'Cenário / paisagem', 'a layered scene or landscape with depth: sky gradient, sun or moon, distant and near silhouettes'],
  ['padrao', 'Padrão / textura', 'a decorative pattern or texture, built with <pattern> or repeated shapes, in a harmonious palette'],
  ['grafico', 'Gráfico / infográfico', 'a clean chart or infographic with labeled shapes and readable text (invent plausible sample values only when the user gave none)'],
  ['animado', 'Animação (SMIL ou CSS)', 'an animated SVG that loops smoothly, using SMIL (<animate>, <animateTransform>) or CSS @keyframes inside a <style> tag, with no JavaScript'],
  ['badge', 'Emblema / adesivo', 'a badge, emblem or sticker with a thick outline, a simple symbol and a short text'],
  ['fundo', 'Fundo / wallpaper', 'an abstract wallpaper made of gradients, blobs and soft shapes, with no text'],
].map(([id, label, how]) => ({ id, label, how }));
const HTML_KINDS = [
  ['livre', 'Livre', 'a web page that fits the request'],
  ['pagina', 'Página / landing page', 'a modern landing page with a hero section, a feature grid, a call to action and a footer'],
  ['cartao', 'Cartão de visita digital', 'a digital business card: avatar or monogram, name, role, and clickable-looking contact rows'],
  ['curriculo', 'Currículo', 'a clean one-page résumé with summary, experience, skills and education, ready to print on A4'],
  ['convite', 'Convite', 'a festive invitation with date, time, place and a visual theme that fits the event'],
  ['slide', 'Slide de apresentação (16:9)', 'ONE presentation slide in a 16:9 frame that scales to the window, with a strong title and short supporting points'],
  ['post', 'Post / banner (1:1)', 'a square social media post (1:1 frame) with a bold headline and a simple graphic'],
  ['infografico', 'Infográfico', 'a vertical infographic with sections, big numbers, icons made with CSS or inline SVG, and a clear reading order'],
  ['animacao', 'Animação em CSS', 'a looping animation made only with CSS (@keyframes, transforms, gradients), with no JavaScript'],
  ['componente', 'Componente de interface', 'a polished UI component (button set, card, menu, toggle or form) shown on a neutral stage, with hover and focus states'],
  ['jogo', 'Mini jogo ou ferramenta (JavaScript)', 'a small interactive toy, game or tool; the interaction is written in one inline <script> that works offline'],
].map(([id, label, how]) => ({ id, label, how }));
const CODE_PALETTES = [
  ['livre', 'Livre (a IA escolhe)', ''],
  ['yoru', 'Laranja sobre escuro (estilo Yoru)', 'a dark warm background (#14110f to #1f1a16) with vivid orange accents (#ff7a2e, #ffb066) and off-white details'],
  ['neon', 'Neon escuro', 'a near-black background with glowing neon cyan, magenta and violet accents'],
  ['pastel', 'Pastel suave', 'soft pastel colors (peach, mint, lavender, sky blue) on a creamy background'],
  ['claro', 'Claro e minimalista', 'a white or very light grey background, one strong accent color and dark grey text'],
  ['mono', 'Preto e branco', 'strictly black, white and shades of grey'],
  ['terra', 'Tons terrosos', 'earthy tones: terracotta, olive, sand, deep brown and cream'],
  ['oceano', 'Azuis e verdes do mar', 'ocean blues, teals and seafoam greens with a touch of coral'],
  ['sunset', 'Pôr do sol', 'warm sunset gradients: deep purple, magenta, orange and golden yellow'],
].map(([id, label, hint]) => ({ id, label, hint }));

const codeMaxTokens = (type) => (type === 'html' ? 7000 : 4500);

function codeSystem(type, o = {}) {
  const pal = byId(CODE_PALETTES, o.palette, 'livre');
  const colors = pal.hint ? ` Color palette: ${pal.hint}.` : '';
  if (type === 'html') {
    const k = byId(HTML_KINDS, o.kind, 'livre');
    return `You are an expert front-end designer. Create ${k.how}.${colors} ` +
      'Output ONE complete, self-contained HTML document: start with <!DOCTYPE html>, include <meta charset="utf-8"> and a responsive viewport meta tag, and put ALL the CSS in a single <style> tag. ' +
      'HARD RULES: no external resources of any kind (no CDN scripts or stylesheets, no web fonts, no remote images, no <iframe>); use system font stacks, emoji, CSS shapes and gradients, and inline <svg> for visuals. ' +
      'Use JavaScript only when the request truly needs interaction, as one inline <script> that works offline. ' +
      'Write any visible text in Brazilian Portuguese unless the user asks for another language. Make it polished: good spacing, clear hierarchy, strong contrast and a layout that adapts to narrow windows. ' +
      'Reply with the code only, inside a single ```html block, with no explanation before or after.';
  }
  const k = byId(SVG_KINDS, o.kind, 'livre'), r = getRatio(o.ratio);
  return `You are an expert vector illustrator. Create ${k.how}.${colors} ` +
    `Output ONE complete SVG document whose root is <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.w} ${r.h}"> (use exactly this viewBox and no fixed width or height attributes). ` +
    'HARD RULES: no <script>, no event-handler attributes, no <foreignObject>, no external links or fonts, no embedded raster images; draw everything with vector shapes, <defs> (gradients, patterns, filters) and <text> with generic font families such as font-family="Segoe UI, Arial, sans-serif". ' +
    'Escape special characters in text (&amp; &lt;). Compose it well: a clear focal point, layered depth and balanced margins. Keep the code reasonably compact (under about 250 elements). ' +
    'Write any visible text in Brazilian Portuguese unless the user asks for another language. Reply with the code only, inside a single ```svg block, with no explanation before or after.';
}

// pedido do usuário; com `current`, é um ajuste do código que já existe
function codeUserMessage(prompt, current, type) {
  const p = String(prompt || '').trim().slice(0, MAX_PROMPT * 4);
  const cur = String(current || '').trim().slice(0, 60000);
  if (!cur) return p;
  const t = type === 'html' ? 'html' : 'svg';
  return `Here is the current ${t.toUpperCase()} code:\n\`\`\`${t}\n${cur}\n\`\`\`\n\nChange request (apply it and keep everything else as it is): ${p}\n\nReturn the COMPLETE updated code.`;
}

// tira o código da resposta da IA: bloco ```svg/```html, ou o código solto no meio do texto; '' se não houver nada
function extractCode(text, type) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const isHtml = type === 'html';
  const HTML_TAG = /<(?:!doctype|html|head|body|div|section|main|header|style|h1|p|svg)\b/i;
  const need = isHtml ? HTML_TAG : /<svg\b/i;
  const fences = [...t.matchAll(/```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)(?:```|$)/g)].map((m) => m[1]);
  const code = (fences.find((f) => need.test(f)) ?? t).trim();
  if (!isHtml) {
    const m = code.match(/<svg\b[\s\S]*<\/svg\s*>/i);
    if (m) return m[0];
    const s = code.search(/<svg\b/i);
    return s >= 0 ? code.slice(s) : ''; // resposta cortada: devolve até onde veio (quem chama decide)
  }
  const i = code.search(/<!doctype html|<html\b/i);
  if (i >= 0) {
    const out = code.slice(i), e = out.match(/<\/html\s*>/i);
    return e ? out.slice(0, e.index + e[0].length) : out;
  }
  const j = code.search(HTML_TAG);
  return j >= 0 ? code.slice(j) : '';
}

// entidades do HTML que o XML (SVG) não conhece: viram número
const XML_ENT = { nbsp: 160, copy: 169, reg: 174, deg: 176, middot: 183, times: 215, mdash: 8212, ndash: 8211, hellip: 8230, bull: 8226, rarr: 8594, larr: 8592, uarr: 8593, darr: 8595, euro: 8364, trade: 8482, laquo: 171, raquo: 187, ldquo: 8220, rdquo: 8221, lsquo: 8216, rsquo: 8217, star: 9734, hearts: 9829, check: 10003 };
const SAFE_HREF = /^(?:#|data:image\/(?:png|jpe?g|webp|gif);base64,)/i;

// Deixa o SVG seguro e válido: sem script, sem manipuladores (onclick…), sem foreignObject, sem links para fora, sem @import;
// acrescenta xmlns/viewBox que faltam e corrige "&" solto. Abrir o .svg direto no navegador executaria scripts, por isso a limpeza vale no arquivo salvo.
// `fallback` = { w, h } usado só se o SVG não tiver tamanho nenhum.
function sanitizeSvg(svg, fallback) {
  let s = String(svg || '');
  const a = s.search(/<svg\b/i);
  if (a < 0) return '';
  s = s.slice(a);
  let end = -1;
  for (const m of s.matchAll(/<\/svg\s*>/gi)) end = m.index + m[0].length;
  if (end > 0) s = s.slice(0, end);
  else { const self = s.match(/^<svg\b[^>]*\/>/i); if (self) s = self[0]; } // <svg …/> sem </svg>: nada depois dele fica
  for (let i = 0; i < 8; i++) { // repete até estabilizar: "<scr<script>ipt>" não escapa
    const prev = s;
    s = s
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<\/?script\b[^>]*>?/gi, '')
      .replace(/<foreignObject\b[\s\S]*?<\/foreignObject\s*>/gi, '').replace(/<\/?foreignObject\b[^>]*>?/gi, '')
      .replace(/<\/?(?:iframe|object|embed|audio|video|link|meta|base|html|head|body)\b[^>]*>?/gi, '')
      .replace(/<!(?!\[CDATA\[|--)[^>]*>/g, '') // <!DOCTYPE …> e <!ENTITY …>
      .replace(/<\?[\s\S]*?\?>/g, '') // <?xml …?> e <?xml-stylesheet …?>
      .replace(/<(?:set|animate)\b[^>]*attributeName\s*=\s*["']?\s*(?:xlink:)?href[^>]*>/gi, '') // animação que troca um link por "javascript:"
      .replace(/(?<=[\s/"'])on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/@import[^;}]*;?/gi, '')
      .replace(/javascript\s*:/gi, '')
      .replace(/url\(\s*(?!['"]?\s*(?:#|data:image\/(?:png|jpe?g|webp|gif)))[^)]*\)/gi, 'none');
    if (s === prev) break;
  }
  // links: só âncoras internas (#id) e imagens embutidas
  s = s.replace(/((?<=[\s/"'])(?:xlink:)?href\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, pre, val) => {
    const v = val.replace(/^["']|["']$/g, '').replace(/[\u0000- ]+/g, '');
    return SAFE_HREF.test(v) ? m : `${pre}"#"`;
  });
  // "&" solto e entidades de HTML quebram o XML (a imagem some): corrige
  s = s.replace(/&(#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);?/g, (m, name) => {
    if (/^#/.test(name) || /^(?:amp|lt|gt|quot|apos)$/.test(name)) return m.endsWith(';') ? m : `&${name};`;
    if (XML_ENT[name] && m.endsWith(';')) return `&#${XML_ENT[name]};`;
    return `&amp;${name}${m.endsWith(';') ? ';' : ''}`;
  }).replace(/&(?![#A-Za-z])/g, '&amp;');
  // raiz: xmlns, xmlns:xlink e viewBox
  s = s.replace(/^<svg\b[^>]*>/i, (tag) => {
    let t = tag;
    if (!/\sxmlns\s*=/i.test(t)) t = t.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    if (/\sxlink:/i.test(s) && !/\sxmlns:xlink\s*=/i.test(t)) t = t.replace(/^<svg/i, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
    if (!/\sviewBox\s*=/i.test(t)) {
      const num = (n) => { const m = t.match(new RegExp(`\\s${n}\\s*=\\s*["']?\\s*([0-9.]+)(?:px)?\\s*["']?(?=[\\s/>])`, 'i')); return m ? Number(m[1]) : 0; };
      const w = num('width') || (fallback && fallback.w) || 1024, h = num('height') || (fallback && fallback.h) || 1024;
      t = t.replace(/^<svg/i, `<svg viewBox="0 0 ${w} ${h}"`);
    }
    return t;
  });
  return s;
}

const CODE_CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";
// Deixa o HTML pronto para salvar e abrir no navegador: documento completo, charset, viewport e uma CSP que BLOQUEIA a internet
// (o código da IA nunca consegue enviar nem baixar nada; scripts embutidos continuam funcionando).
function prepareHtml(html) {
  let h = String(html || '').trim();
  if (!h) return '';
  h = h.replace(/\s*<meta\b[^>]*(?:http-equiv\s*=\s*["']?(?:content-security-policy|refresh)|charset\s*=)[^>]*>/gi, '').replace(/<base\b[^>]*>/gi, '');
  if (!/<html[\s>]/i.test(h)) h = `<html lang="pt-BR"><head></head><body>\n${h.replace(/^<!doctype[^>]*>/i, '')}\n</body></html>`;
  if (!/<head[\s>]/i.test(h)) h = h.replace(/<html\b[^>]*>/i, (m) => `${m}<head></head>`);
  const inject = ['<meta charset="utf-8">', `<meta http-equiv="Content-Security-Policy" content="${CODE_CSP}">`];
  if (!/<meta\b[^>]*name\s*=\s*["']?viewport/i.test(h)) inject.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  h = h.replace(/<head\b[^>]*>\s*/i, (m) => `${m.trim()}\n${inject.join('\n')}\n`);
  if (!/^\s*<!doctype/i.test(h)) h = `<!DOCTYPE html>\n${h}`;
  return h;
}

// título do documento (<title>) e um resumo em texto simples para a miniatura do projeto
const decode = (t) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
function codeTitle(code) {
  const m = String(code || '').match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i);
  return m ? decode(m[1].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 60) : '';
}
function codePreviewText(code) {
  const body = String(code || '').replace(/<(style|script|title)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ');
  return decode(body).replace(/\s+/g, ' ').trim().slice(0, 220);
}

// ---------- projetos ----------
const TYPES = { image: 'Imagem', text: 'Texto', video: 'Vídeo', svg: 'SVG', html: 'Página HTML' };
const typeLabel = (t) => TYPES[t] || 'Projeto';

const safeFileName = (s) => String(s || 'projeto').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'projeto';

function defaultTitle(type, prompt) {
  const words = clampPrompt(prompt).split(' ').slice(0, 5).join(' ');
  return (words || typeLabel(type)).slice(0, 50);
}

function parseDataUrl(u) {
  const m = String(u || '').match(/^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  return { mime: m[1], ext: m[2] === 'jpeg' ? 'jpg' : m[2], b64: m[3] };
}

const pad = (n) => String(n).padStart(2, '0');
function humanDate(ts, now = Date.now()) {
  const d = new Date(ts), n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(n) - day(d)) / 86400000);
  if (diff === 0) return `Hoje, ${hm}`;
  if (diff === 1) return `Ontem, ${hm}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// type: 'all' | 'image' | 'text' | 'video' | 'svg' | 'html'; mais novos primeiro
function filterProjects(list, { q = '', type = 'all', favorites = false, sort = 'newest' } = {}) {
  const nq = norm(q).trim();
  const out = (list || [])
    .filter((p) => (type === 'all' || p.type === type) && (!favorites || p.favorite === true) && (!nq || norm(p.title).includes(nq) || norm(p.prompt).includes(nq)));
  if (sort === 'oldest') out.sort((a, b) => a.createdAt - b.createdAt);
  else if (sort === 'name') out.sort((a, b) => norm(a.title).localeCompare(norm(b.title), 'pt-BR'));
  else out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
}

module.exports = {
  MAX_PROMPT, STYLES, RATIOS, IMAGE_MODELS, TEXT_MODELS, TEXT_PROVIDERS, FREE_TEXT_ORDER, AUTO_TEXT_ORDER, TEXT_KINDS, TONES, SIZES, LANGS, MOTIONS, FADES, TYPES, ENHANCE_SYSTEM, STORYBOARD_SYSTEM,
  getStyle, getRatio, getModel, getTextModel, clampPrompt, clampNegative, keyReady, autoTextModels, maxTokensFor, randomIdea, IDEAS, buildImagePrompt, pollinationsUrl, cloudflareUrl, cloudflareBody, fitSize, cropRect, pickFreeModels, textSystem, parseStoryboard, sceneFrame,
  typeLabel, safeFileName, defaultTitle, parseDataUrl, humanDate, filterProjects, formatDuration,
  SVG_KINDS, HTML_KINDS, CODE_PALETTES, codeSystem, codeUserMessage, codeMaxTokens, extractCode, sanitizeSvg, prepareHtml, codeTitle, codePreviewText, CODE_CSP,
};
