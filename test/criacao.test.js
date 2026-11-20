'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const C = require('../src/criacao');
const mainSource = require('./helpers/main-source');
const rd = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('prompt da imagem leva o estilo escolhido', () => {
  assert.match(C.buildImagePrompt('  uma raposa   de capuz ', 'anime'), /^uma raposa de capuz, anime style/);
  assert.equal(C.buildImagePrompt('gato', 'livre'), 'gato'); // sem estilo: nada é acrescentado
  assert.equal(C.buildImagePrompt('gato', 'inexistente').includes('photorealistic'), true); // desconhecido cai no padrão
  assert.equal(C.clampPrompt('a'.repeat(5000)).length, C.MAX_PROMPT);
});

test('formatos e modelos têm tamanho válido', () => {
  for (const r of C.RATIOS) { assert.equal(r.w % 8, 0); assert.equal(r.h % 8, 0); }
  assert.equal(C.getRatio('9:16').h > C.getRatio('9:16').w, true);
  assert.equal(C.getModel('x').id, 'cf-flux'); // desconhecido (ex.: 'fast' de versões antigas) cai no melhor grátis
  const u = C.pollinationsUrl({ prompt: 'olá mundo & cia', w: 1280, h: 720, seed: 7, model: 'flux' });
  assert.match(u, /^https:\/\/gen\.pollinations\.ai\/image\/ol%C3%A1%20mundo%20%26%20cia\?/);
  assert.match(u, /width=1280/); assert.match(u, /seed=7/); assert.match(u, /model=flux/);
  assert.ok(!/key=/.test(u), 'a chave nunca vai na URL');
});

test('modelos de imagem: os grátis vêm primeiro e dizem qual chave exigem', () => {
  assert.equal(C.IMAGE_MODELS[0].id, 'cf-flux');
  for (const m of C.IMAGE_MODELS) { assert.ok(m.id && m.label && m.kind && m.needs, m.id); if (m.free) assert.equal(m.kind, 'cloudflare'); }
  assert.deepEqual(C.IMAGE_MODELS.filter((m) => !m.free).map((m) => m.id), ['pollinations', 'openrouter']); // os pagos nunca aparecem como grátis
  assert.ok(new Set(C.IMAGE_MODELS.map((m) => m.id)).size === C.IMAGE_MODELS.length);
});

test('Cloudflare: endereço, corpo do pedido, tamanhos e recorte', () => {
  assert.equal(C.cloudflareUrl(' abc123 ', '@cf/black-forest-labs/flux-1-schnell'), 'https://api.cloudflare.com/client/v4/accounts/abc123/ai/run/@cf/black-forest-labs/flux-1-schnell');
  const flux = C.cloudflareBody(C.getModel('cf-flux'), { prompt: 'x'.repeat(5000), w: 1280, h: 720, seed: 9 });
  assert.equal(flux.prompt.length, 2000); assert.equal(flux.steps, 4); assert.equal(flux.width, undefined); // FLUX não aceita tamanho
  const sdxl = C.cloudflareBody(C.getModel('cf-sdxl'), { prompt: 'gato', w: 1280, h: 720, seed: 9 });
  assert.deepEqual([sdxl.width, sdxl.height, sdxl.seed], [1024, 576, 9]);
  const dream = C.cloudflareBody(C.getModel('cf-dream'), { prompt: 'gato', w: 720, h: 1280, seed: 3 });
  assert.deepEqual([dream.width, dream.height], [432, 768]);
  for (const m of C.IMAGE_MODELS.filter((x) => x.kind === 'cloudflare' && !x.square)) for (const r of C.RATIOS) {
    const b = C.cloudflareBody(m, { prompt: 'a', w: r.w, h: r.h, seed: 1 });
    assert.equal(b.width % 8, 0); assert.equal(b.height % 8, 0); assert.ok(Math.max(b.width, b.height) <= m.maxSide);
  }
  assert.deepEqual(C.cropRect(1024, 1024, 16, 9), { x: 0, y: 224, width: 1024, height: 576 });
  assert.deepEqual(C.cropRect(1024, 1024, 9, 16), { x: 224, y: 0, width: 576, height: 1024 });
  assert.deepEqual(C.cropRect(1024, 1024, 1, 1), { x: 0, y: 0, width: 1024, height: 1024 });
});

test('modelos de texto: grátis do OpenRouter, automático primeiro, IA do chat marcada como possivelmente paga', () => {
  assert.equal(C.TEXT_MODELS[0].id, 'auto'); assert.equal(C.getTextModel('nao-existe').id, 'auto');
  assert.ok(C.FREE_TEXT_ORDER.length >= 3);
  for (const id of C.FREE_TEXT_ORDER) assert.match(id, /:free$/, id); // nada pago na ordem automática
  assert.equal(C.getTextModel('chat').free, false);
});

test('plano B: só modelos de texto realmente grátis, os de maior contexto primeiro', () => {
  const list = [
    { id: 'a/pequeno:free', pricing: { prompt: '0', completion: '0' }, context_length: 32000, architecture: { output_modalities: ['text'] } },
    { id: 'b/grande:free', pricing: { prompt: '0', completion: '0' }, context_length: 1000000, architecture: { output_modalities: ['text'] } },
    { id: 'c/pago:free', pricing: { prompt: '0.1', completion: '0' }, context_length: 9e6, architecture: { output_modalities: ['text'] } },
    { id: 'd/musica:free', pricing: { prompt: '0', completion: '0' }, context_length: 9e6, architecture: { output_modalities: ['text', 'audio'] } },
    { id: 'e/seguranca-guard:free', pricing: { prompt: '0', completion: '0' }, context_length: 9e6, architecture: { output_modalities: ['text'] } },
    { id: 'f/sem-sufixo', pricing: { prompt: '0', completion: '0' }, context_length: 9e6 },
    null,
  ];
  assert.deepEqual(C.pickFreeModels(list), ['b/grande:free', 'a/pequeno:free']);
  assert.deepEqual(C.pickFreeModels(undefined), []);
});

test('roteiro do vídeo: JSON puro, dentro de cercas e plano B por linhas', () => {
  const json = '[{"prompt":"a fox in a neon city","caption":"A raposa chega"},{"prompt":"the fox looks up","caption":"Ela olha para cima"}]';
  assert.equal(C.parseStoryboard(json, 5).length, 2);
  assert.equal(C.parseStoryboard('Claro!\n```json\n' + json + '\n```', 5)[1].caption, 'Ela olha para cima');
  assert.equal(C.parseStoryboard(json, 1).length, 1); // respeita o número de cenas
  const lines = C.parseStoryboard('1. uma raposa andando na cidade\n2) a raposa sobe no telhado\n- ela olha a lua grande', 5);
  assert.equal(lines.length, 3); assert.equal(lines[0].prompt, 'uma raposa andando na cidade');
  assert.deepEqual(C.parseStoryboard('', 5), []);
  assert.deepEqual(C.parseStoryboard('[{"caption":"sem prompt"}]', 5), []);
});

test('quadro do vídeo: cena certa, transição só no fim, nunca passa do total', () => {
  const f0 = C.sceneFrame(0, 4, 5);
  assert.equal(f0.index, 0); assert.equal(f0.mix, 0); assert.equal(f0.total, 20);
  assert.equal(C.sceneFrame(2.5, 4, 5).mix, 0);
  const f = C.sceneFrame(4.7, 4, 5); // faltam 0,3 s da cena 0
  assert.equal(f.index, 0); assert.equal(f.next, 1); assert.ok(f.mix > 0.4 && f.mix < 0.6);
  assert.equal(C.sceneFrame(5.1, 4, 5).index, 1);
  const last = C.sceneFrame(999, 4, 5);
  assert.equal(last.index, 3); assert.equal(last.next, null); assert.equal(last.mix, 0); // última cena não faz transição
  assert.equal(C.sceneFrame(-5, 4, 5).index, 0);
  for (let t = 0; t <= 20; t += 0.25) { const q = C.sceneFrame(t, 4, 5); assert.ok(q.mix >= 0 && q.mix <= 1 && q.a.zoom >= 1.04 && q.a.zoom <= 1.14); }
});

test('o painel tem uma cópia idêntica de sceneFrame', () => {
  const src = rd('panel-criacao.js');
  const block = src.slice(src.indexOf('// <sceneFrame>'), src.indexOf('// </sceneFrame>'));
  const local = new Function(block + '; return sceneFrame;')();
  for (const [n, sec] of [[3, 3], [5, 4], [8, 6]]) for (let t = -1; t <= n * sec + 1; t += 0.37) assert.deepEqual(local(t, n, sec), C.sceneFrame(t, n, sec));
});

test('projetos: busca sem acento, filtro por tipo, mais novos primeiro', () => {
  const list = [
    { id: 'a', type: 'image', title: 'Raposa Neon', prompt: 'fox', createdAt: 1 },
    { id: 'b', type: 'text', title: 'Roteiro Intro', prompt: 'introdução', createdAt: 3 },
    { id: 'c', type: 'video', title: 'Apresentação', prompt: 'cidade', createdAt: 2 },
  ];
  assert.deepEqual(C.filterProjects(list).map((p) => p.id), ['b', 'c', 'a']);
  assert.deepEqual(C.filterProjects(list, { type: 'video' }).map((p) => p.id), ['c']);
  assert.deepEqual(C.filterProjects(list, { q: 'apresentacao' }).map((p) => p.id), ['c']);   // sem acento
  assert.deepEqual(C.filterProjects(list, { q: 'INTRODUCAO' }).map((p) => p.id), ['b']);     // acha pelo prompt
  assert.deepEqual(C.filterProjects(list, { q: 'nada' }), []);
});

test('datas, duração e nomes de arquivo', () => {
  const now = new Date(2026, 10, 7, 20, 0).getTime();
  assert.equal(C.humanDate(new Date(2026, 10, 7, 14, 52).getTime(), now), 'Hoje, 14:52');
  assert.equal(C.humanDate(new Date(2026, 10, 6, 18, 7).getTime(), now), 'Ontem, 18:07');
  assert.equal(C.humanDate(new Date(2026, 10, 3, 9, 0).getTime(), now), '03/11/2026');
  assert.equal(C.formatDuration(42), '00:42'); assert.equal(C.formatDuration(125), '02:05');
  assert.equal(C.safeFileName('Apresentação: raposa/neon?'), 'Apresentacao_raposa_neon');
  assert.equal(C.safeFileName('???'), 'projeto');
  assert.equal(C.defaultTitle('image', 'uma raposa de capuz explorando a cidade'), 'uma raposa de capuz explorando');
  assert.equal(C.defaultTitle('text', ''), 'Texto');
});

test('data URL de imagem: só png/jpg/webp', () => {
  assert.deepEqual(C.parseDataUrl('data:image/jpeg;base64,QUJD'), { mime: 'image/jpeg', ext: 'jpg', b64: 'QUJD' });
  assert.equal(C.parseDataUrl('data:image/png;base64,QUJD').ext, 'png');
  assert.equal(C.parseDataUrl('data:text/html;base64,QUJD'), null);
  assert.equal(C.parseDataUrl('data:image/svg+xml;base64,QUJD'), null); // svg pode carregar script: não aceita
  assert.equal(C.parseDataUrl('http://x/y.png'), null);
});

test('texto: instruções mudam com tipo, tom e tamanho', () => {
  const a = C.textSystem({ kind: 'roteiro', tone: 'divertido', size: 'curto' });
  assert.match(a, /roteiro/i); assert.match(a, /divertido/); assert.match(a, /100 palavras/);
  assert.match(C.textSystem({}), /Tom: neutro/);
});

test('a tela só usa elementos que existem no painel', () => {
  const html = rd('panel.html'), js = rd('panel-criacao.js');
  const have = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const used = new Set([...js.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]));
  for (const id of used) assert.ok(have.has(id), `#${id} não existe no panel.html`);
  assert.match(html, /data-tab="criacao"/);
  assert.match(html, /<script src="\.\/panel-criacao\.js">/);
});

test('a Criação também abre em janela separada', () => {
  assert.match(mainSource(), /ia: 'IA', masori: 'Masori-Sama'/);
  assert.match(rd('windows.js'), /criacao: 'Criação'/);
});

test('o main.js liga a aba Criação (rede, arquivos e segurança)', () => {
  const main = mainSource(), pre = rd('panel-preload.js');
  for (const ch of ['cria-meta', 'cria-idea', 'cria-keys-get', 'cria-keys-set', 'cria-list', 'cria-enhance', 'cria-image', 'cria-text', 'cria-storyboard', 'cria-save', 'cria-read-text', 'cria-favorite', 'cria-rename', 'cria-delete', 'cria-reveal', 'cria-open', 'cria-export']) {
    assert.match(main, new RegExp(`criaHandle\\('${ch}'`), ch);
    assert.match(pre, new RegExp(`'${ch}'`), 'preload ' + ch);
  }
  assert.match(main, /path\.basename\(String\(name/);              // arquivos nunca saem da pasta criacao
  assert.match(main, /CRIA\.parseDataUrl\(url\)/);                 // imagem do OpenRouter é validada
  assert.match(main, /\^image\\\/\(png\|jpe\?g\|webp\)\$/);          // só aceita imagem do gerador gratuito
  assert.match(main, /criaLLM\(\[\{ role: 'user', content: prompt \}\], CRIA\.textSystem\(o\), CRIA\.maxTokensFor\(o\.size\), o\.textModel\)/);
  assert.match(main, /criaLLM\(\[\{ role: 'user', content: CRIA\.clampPrompt\(prompt\) \}\], CRIA\.ENHANCE_SYSTEM, 300, textModel\)/);
  assert.match(main, /criaLLM\(\[\{ role: 'user', content: idea \}\], CRIA\.STORYBOARD_SYSTEM\(n\), 1500, o\.textModel\)/);
  assert.match(main, /Authorization: `Bearer \$\{pkey\}`/);     // chave do Pollinations vai no cabeçalho, não na URL
  assert.match(main, /Authorization: `Bearer \$\{token\}`/);    // token da Cloudflare também
  assert.match(rd('ai-core.js'), /function buildRequest\(cfg, messages, system, stream, maxTokens, tail = '', extra = \{\}\)/); // a IA mora em ai-core.js
});

test('as chaves gratuitas: salvas sem mudar o provedor do chat e nunca devolvidas à tela', () => {
  const main = mainSource(), js = rd('panel-criacao.js');
  const set = main.slice(main.indexOf("criaHandle('cria-keys-set'"), main.indexOf("criaHandle('cria-list'"));
  assert.ok(!/c\.provider\s*=/.test(set), 'salvar a chave do OpenRouter aqui não pode trocar o provedor da aba IA');
  const info = main.slice(main.indexOf('const criaKeyInfo'), main.indexOf("criaHandle('cria-keys-get'"));
  assert.match(info, /slice\(-4\)/); assert.ok(!/apiToken\s*[,}]/.test(info.replace(/realKey\(c\.cloudflare\.apiToken\)/, '')), 'só aviso e 4 últimos caracteres');
  assert.match(js, /panel\.criaKeysSet/); assert.match(js, /panel\.criaKeysGet/);
});

test('configuração: as seções novas ganham valores padrão em config.json antigos', () => {
  const core = rd('ai-core.js'); // a configuração padrão mora em ai-core.js
  assert.match(core, /cloudflare: \{ accountId: '', apiToken: '' \}/);
  assert.match(core, /\[\.\.\.PROVIDERS, 'cloudflare', 'pollinations', 'groq', 'gemini'\]/);
});

test('mais opções: estilos, formatos, tipos de texto, tons, tamanhos e idiomas sem repetição', () => {
  for (const [name, list] of Object.entries({ STYLES: C.STYLES, RATIOS: C.RATIOS, TEXT_KINDS: C.TEXT_KINDS, TONES: C.TONES, SIZES: C.SIZES, LANGS: C.LANGS, TEXT_MODELS: C.TEXT_MODELS, IMAGE_MODELS: C.IMAGE_MODELS, MOTIONS: C.MOTIONS })) {
    assert.equal(new Set(list.map((x) => x.id)).size, list.length, `${name} tem id repetido`);
  }
  assert.ok(C.STYLES.length >= 20 && C.RATIOS.length >= 9 && C.TEXT_KINDS.length >= 20);
  assert.equal(C.STYLES.at(-1).id, 'livre'); // "Sem estilo" fica no fim
  for (const k of C.TEXT_KINDS) assert.match(C.textSystem({ kind: k.id }), new RegExp(k.how.slice(0, 20).replace(/[()]/g, '.')));
  assert.match(C.textSystem({ lang: 'ja' }), /Responda em japonês/); assert.match(C.textSystem({}), /português do Brasil/);
  for (let i = 1; i < C.SIZES.length; i++) assert.ok(C.SIZES[i].tokens > C.SIZES[i - 1].tokens); // mais palavras, mais espaço de resposta
  assert.equal(C.maxTokensFor('medio'), 1800); assert.equal(C.maxTokensFor('nada'), 1800);
});

test('modelos de texto grátis: de onde vêm, que chave pedem e o que o Automático usa', () => {
  const need = (id) => C.TEXT_MODELS.find((m) => m.id === id).needs;
  assert.equal(need('gemini:gemini-2.5-flash'), 'gemini'); assert.equal(need('groq:llama-3.3-70b-versatile'), 'groq');
  assert.equal(need('cf:@cf/meta/llama-3.3-70b-instruct-fp8-fast'), 'cloudflare'); assert.equal(need('google/gemma-4-31b-it:free'), 'openrouter');
  assert.equal(need('auto'), null); assert.equal(need('chat'), null);
  for (const m of C.TEXT_MODELS) { assert.ok(m.group, m.id); if (m.kind === 'openai') assert.ok(m.model && C.TEXT_PROVIDERS[m.provider], m.id); }
  assert.ok(C.AUTO_TEXT_ORDER.every((id) => C.TEXT_MODELS.some((m) => m.id === id && m.free)), 'o Automático só usa modelos grátis');
  assert.equal(new Set(C.AUTO_TEXT_ORDER).size, C.AUTO_TEXT_ORDER.length);
  assert.deepEqual(C.autoTextModels({}), []);
  assert.deepEqual(C.autoTextModels({ groq: { apiKey: 'k' } }).map((m) => m.provider), ['groq', 'groq', 'groq', 'groq']);
  assert.deepEqual(C.autoTextModels({ groq: { apiKey: 'COLE_SUA_CHAVE_AQUI' } }), []); // chave de exemplo não conta
  assert.equal(C.keyReady({ cloudflare: { accountId: 'a', apiToken: '' } }, 'cloudflare'), false);
  assert.equal(C.keyReady({ cloudflare: { accountId: 'a', apiToken: 't' } }, 'cloudflare'), true);
  assert.equal(C.TEXT_PROVIDERS.cloudflare.base({ cloudflare: { accountId: ' ab c ' } }), 'https://api.cloudflare.com/client/v4/accounts/ab%20c/ai/v1'); // nunca monta a URL com lixo
});

test('imagem: SDXL Base grátis e prompt negativo só onde o modelo aceita', () => {
  const base = C.getModel('cf-sdxl-base');
  assert.equal(base.free, true); assert.equal(base.kind, 'cloudflare'); assert.match(base.model, /stable-diffusion-xl-base-1\.0$/);
  assert.equal(C.cloudflareBody(base, { prompt: 'x', w: 1280, h: 720, seed: 1, negative: 'feio' }).negative_prompt, 'feio');
  assert.equal(C.cloudflareBody(C.getModel('cf-flux'), { prompt: 'x', w: 1, h: 1, seed: 1, negative: 'feio' }).negative_prompt, undefined);
  assert.equal(C.cloudflareBody(C.getModel('cf-dream'), { prompt: 'x', w: 1280, h: 720, seed: 1, negative: '   ' }).negative_prompt, undefined);
  assert.equal(C.clampNegative('a'.repeat(900)).length, 500);
  assert.match(C.pollinationsUrl({ prompt: 'x', w: 8, h: 8, seed: 1, negative: 'feio' }), /negative_prompt=feio/);
});

test('ideias de prompt: cada ferramenta tem as suas e o sorteio respeita o intervalo', () => {
  for (const t of ['image', 'text', 'video']) { assert.ok(C.IDEAS[t].length >= 5, t); assert.equal(C.randomIdea(t, () => 0), C.IDEAS[t][0]); assert.equal(C.randomIdea(t, () => 0.9999999), C.IDEAS[t].at(-1)); }
  assert.ok(C.randomIdea('nada')); // ferramenta desconhecida cai nas ideias de imagem
});

test('vídeo: movimentos e transições; o padrão não mudou e a cópia do painel acompanha', () => {
  assert.deepEqual(C.sceneFrame(2, 5, 4), C.sceneFrame(2, 5, 4, 0.6, 'misto'));
  const zoom = C.sceneFrame(2, 5, 4, 0.6, 'zoom'), out = C.sceneFrame(2, 5, 4, 0.6, 'afastar'), pan = C.sceneFrame(1, 5, 4, 0.6, 'pan');
  assert.equal(zoom.a.px, 0); assert.ok(zoom.a.zoom > 1.04 && out.a.zoom < 1.14 && out.a.px === 0);
  assert.equal(pan.a.zoom, 1.1); assert.notEqual(pan.a.px, 0); assert.equal(pan.a.py, 0);
  const src = rd('panel-criacao.js');
  const local = new Function(src.slice(src.indexOf('// <sceneFrame>'), src.indexOf('// </sceneFrame>')) + '; return sceneFrame;')();
  for (const motion of C.MOTIONS.map((m) => m.id)) for (const fade of C.FADES.map((f) => f.sec)) for (let t = -1; t <= 21; t += 0.41) assert.deepEqual(local(t, 5, 4, fade, motion), C.sceneFrame(t, 5, 4, fade, motion));
  // transição mais longa começa antes
  assert.ok(C.sceneFrame(3.2, 5, 4, 1.5).mix > C.sceneFrame(3.2, 5, 4, 0.3).mix);
  for (const m of C.MOTIONS) for (let t = 0; t <= 20; t += 0.5) { const f = C.sceneFrame(t, 5, 4, 0.6, m.id); assert.ok(f.a.zoom >= 1.04 - 1e-9 && f.a.zoom <= 1.14 + 1e-9, m.id); }
});

// ---------- SVG e HTML ----------
test('SVG/HTML: tipos, estilos e cores bem formados, sem repetição', () => {
  for (const [name, list] of [['SVG_KINDS', C.SVG_KINDS], ['HTML_KINDS', C.HTML_KINDS], ['CODE_PALETTES', C.CODE_PALETTES]]) {
    assert.ok(list.length >= 8, name); assert.equal(list[0].id, 'livre', name); assert.equal(new Set(list.map((x) => x.id)).size, list.length, name);
    for (const x of list) assert.ok(x.id && x.label, name);
  }
  for (const k of [...C.SVG_KINDS, ...C.HTML_KINDS]) assert.ok(k.how.length > 15, k.id);
  assert.equal(C.CODE_PALETTES[0].hint, ''); for (const p of C.CODE_PALETTES.slice(1)) assert.ok(p.hint, p.id);
  assert.equal(C.typeLabel('svg'), 'SVG'); assert.equal(C.typeLabel('html'), 'Página HTML');
  const list = [{ id: 'a', type: 'svg', title: 'Sol', prompt: '', createdAt: 2 }, { id: 'b', type: 'html', title: 'Página', prompt: '', createdAt: 3 }, { id: 'c', type: 'image', title: 'Sol', prompt: '', createdAt: 1 }];
  assert.deepEqual(C.filterProjects(list, { type: 'svg' }).map((p) => p.id), ['a']); assert.deepEqual(C.filterProjects(list, { type: 'html' }).map((p) => p.id), ['b']);
  for (const t of ['svg', 'html']) { assert.ok(C.IDEAS[t].length >= 5, t); assert.equal(C.randomIdea(t, () => 0), C.IDEAS[t][0]); }
});

test('prompt de SVG/HTML: formato, regras de segurança, cores e ajuste', () => {
  const svg = C.codeSystem('svg', { kind: 'animado', palette: 'sunset', ratio: '9:16' });
  assert.match(svg, /viewBox="0 0 720 1280"/); assert.match(svg, /SMIL/); assert.match(svg, /sunset/); assert.match(svg, /no <script>/); assert.match(svg, /```svg/);
  assert.match(C.codeSystem('svg', {}), /viewBox="0 0 1280 720"/); // formato desconhecido cai no padrão
  assert.ok(!/palette/i.test(C.codeSystem('svg', { palette: 'livre' })));
  const html = C.codeSystem('html', { kind: 'slide', palette: 'yoru' });
  assert.match(html, /16:9/); assert.match(html, /#ff7a2e/); assert.match(html, /no external resources/); assert.match(html, /```html/); assert.match(html, /Brazilian Portuguese/);
  assert.equal(C.codeUserMessage('um sol', '', 'svg'), 'um sol');
  const adj = C.codeUserMessage('mais azul', '<svg/>', 'svg');
  assert.match(adj, /current SVG code/); assert.ok(adj.includes('<svg/>')); assert.match(adj, /mais azul/); assert.match(adj, /COMPLETE/);
  assert.ok(C.codeUserMessage('x', 'a'.repeat(90000), 'html').length < 61000);
  assert.ok(C.codeMaxTokens('html') > C.codeMaxTokens('svg'));
});

test('extractCode: bloco com cerca, código solto, resposta cortada, raciocínio e texto sem código', () => {
  const svg = '<svg viewBox="0 0 1 1"><rect/></svg>';
  assert.equal(C.extractCode('Aqui:\n```svg\n' + svg + '\n```\nGostou?', 'svg'), svg);
  assert.equal(C.extractCode('```xml\n' + svg + '\n```', 'svg'), svg);
  assert.equal(C.extractCode('Veja ' + svg + ' ok', 'svg'), svg);
  assert.equal(C.extractCode('<think>hum <svg></svg></think>```svg\n' + svg + '\n```', 'svg'), svg);
  assert.equal(C.extractCode('```svg\n<svg viewBox="0 0 1 1"><rect', 'svg'), '<svg viewBox="0 0 1 1"><rect'); // sem fechar a cerca nem a tag
  assert.equal(C.extractCode('```css\nbody{}\n```\n```svg\n' + svg + '\n```', 'svg'), svg); // pega o bloco certo
  assert.equal(C.extractCode('Não consigo desenhar isso.', 'svg'), ''); assert.equal(C.extractCode('', 'html'), ''); assert.equal(C.extractCode(null, 'svg'), '');
  const page = '<!DOCTYPE html><html><head></head><body><p>oi</p></body></html>';
  assert.equal(C.extractCode('Segue:\n```html\n' + page + '\n```\nPronto!', 'html'), page);
  assert.equal(C.extractCode('Segue ' + page + ' fim', 'html'), page);
  assert.equal(C.extractCode('```html\n<div class="a">oi</div>\n```', 'html'), '<div class="a">oi</div>'); // só um trecho: o prepareHtml completa
  assert.equal(C.extractCode('Só conversa, sem página.', 'html'), '');
});

test('sanitizeSvg: derruba script, manipuladores, foreignObject, links e CSS para fora; mantém o desenho', () => {
  const attacks = [
    '<svg onload="alert(1)"><rect/></svg>', '<svg/onload=alert(1)><rect/></svg>', '<svg><rect onclick=\'x()\' ONMOUSEOVER = "y()"/></svg>',
    '<svg><script>alert(1)</script></svg>', '<svg><SCRIPT\n>alert(1)</SCRIPT ></svg>', '<svg><scr<script>x</script>ipt>alert(1)</scr</script>ipt></svg>',
    '<svg><foreignObject><iframe src="http://evil"></iframe><body onload=x></foreignObject></svg>',
    '<svg><a href="javascript:alert(1)"><rect/></a></svg>', '<svg><a xlink:href=" jAvA\nscript:alert(1)"><rect/></a></svg>', '<svg><a/href="data:text/html,<script>alert(1)</script>"><rect/></a></svg>',
    '<svg><image href="http://evil/a.png"/></svg>', '<svg><use href="http://evil/x.svg#a"/></svg>',
    '<svg><a href="x"><set attributeName="href" to="javascript:alert(1)"/><rect/></a></svg>', '<svg><animate attributeName="xlink:href" values="javascript:alert(1)"/></svg>',
    '<svg><style>@import url(http://evil/x.css); rect{fill:url(http://evil/y)}</style></svg>', '<svg><rect style="fill:url(\'https://evil/p\')"/></svg>',
    '<?xml-stylesheet href="http://evil/x.css"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg><text>&a;</text></svg>',
  ];
  for (const a of attacks) {
    const out = C.sanitizeSvg(a).replace(/ xmlns(?::\w+)?="[^"]*"/g, ''); // os namespaces xmlns="http://…" são identificadores, não links
    assert.ok(out.startsWith('<svg') && out.endsWith('</svg>'), a);
    for (const bad of [/<script/i, /\bon[a-z]+\s*=/i, /foreignObject/i, /<iframe/i, /javascript\s*:/i, /https?:\/\//i, /data:text/i, /@import/i, /<!ENTITY/i, /<!DOCTYPE/i, /<\?xml-stylesheet/i, /attributeName\s*=\s*["']?(?:xlink:)?href/i])
      assert.ok(!bad.test(out), `${bad} sobrou em: ${out}  (de: ${a})`);
  }
  // o que é legítimo continua
  const ok = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>' +
    '<rect fill="url(#g)" style="filter:url(#f)"/><use xlink:href="#g"/><image href="data:image/png;base64,iVBORw0KGgo="/><style>.a{fill:url("#g")} @keyframes s{to{opacity:0}}</style><animate attributeName="opacity" values="0;1" dur="1s"/></svg>';
  assert.equal(C.sanitizeSvg(ok), ok);
  assert.equal(C.sanitizeSvg(C.sanitizeSvg(attacks[3])), C.sanitizeSvg(attacks[3])); // idempotente
  assert.equal(C.sanitizeSvg('texto sem svg'), ''); assert.equal(C.sanitizeSvg(''), '');
  assert.equal(C.sanitizeSvg('lixo antes <svg viewBox="0 0 1 1"/> lixo depois'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>');
});

test('sanitizeSvg: conserta o que faria a imagem sumir (xmlns, viewBox, & solto, entidades do HTML)', () => {
  assert.equal(C.sanitizeSvg('<svg width="800px" height="600"><rect/></svg>'), '<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg" width="800px" height="600"><rect/></svg>');
  assert.match(C.sanitizeSvg('<svg><rect/></svg>', { w: 1280, h: 720 }), /viewBox="0 0 1280 720"/);
  assert.match(C.sanitizeSvg('<svg width="100%" height="50%"><rect/></svg>', { w: 720, h: 1280 }), /viewBox="0 0 720 1280"/); // % não é tamanho
  assert.match(C.sanitizeSvg('<svg><rect/></svg>'), /viewBox="0 0 1024 1024"/);
  assert.match(C.sanitizeSvg('<svg viewBox="0 0 9 9"><use xlink:href="#a"/></svg>'), /xmlns:xlink="http:\/\/www\.w3\.org\/1999\/xlink"/);
  const t = C.sanitizeSvg('<svg viewBox="0 0 9 9"><text>Tom & Jerry &amp; R&D &copy; &nbsp;&mdash; &#169; &lt; &foo;</text></svg>');
  assert.ok(t.includes('Tom &amp; Jerry &amp; R&amp;D &#169; &#160;&#8212; &#169; &lt; &amp;foo;'), t);
  assert.ok(!C.sanitizeSvg('<svg viewBox="0 0 9 9"><rect/></svg>').includes('xmlns:xlink'));
});

test('prepareHtml: documento completo, CSP sem internet, charset/viewport e idempotente', () => {
  const out = C.prepareHtml('<h1>Oi</h1>');
  assert.match(out, /^<!DOCTYPE html>\n<html lang="pt-BR"><head>/); assert.match(out, /<meta charset="utf-8">/); assert.match(out, /name="viewport"/); assert.match(out, /<body>\n<h1>Oi<\/h1>\n<\/body><\/html>$/);
  assert.match(out, /Content-Security-Policy" content="default-src 'none'/);
  assert.doesNotMatch(C.CODE_CSP, /https?:|\*|connect-src|frame-src/); assert.match(C.CODE_CSP, /form-action 'none'/); assert.match(C.CODE_CSP, /base-uri 'none'/);
  assert.match(C.CODE_CSP, /script-src 'unsafe-inline'/); // a página dela continua funcionando; só a internet fica de fora
  assert.equal(C.prepareHtml(out), out); // salvar de novo não acumula nada
  const full = C.prepareHtml('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=500"><meta http-equiv="Content-Security-Policy" content="default-src *"><meta http-equiv="refresh" content="0;url=http://x"><base href="http://x/"><title>T</title></head><body>ok</body></html>');
  assert.equal((full.match(/charset/gi) || []).length, 1); assert.equal((full.match(/name="viewport"/g) || []).length, 1); assert.equal((full.match(/Content-Security-Policy/g) || []).length, 1);
  assert.doesNotMatch(full, /default-src \*|refresh|<base/); assert.match(full, /<html lang="en">/);
  assert.match(C.prepareHtml('<html><body>x</body></html>'), /<head>[\s\S]*Content-Security-Policy[\s\S]*<\/head>\s*<body>/); // sem <head>
  assert.equal(C.prepareHtml('  '), '');
});

test('título e resumo do código para a lista de projetos', () => {
  assert.equal(C.codeTitle('<head><title> Meu   cartão &amp; cia </title></head>'), 'Meu cartão & cia'); assert.equal(C.codeTitle('<svg/>'), '');
  assert.equal(C.codePreviewText('<style>a{}</style><title>T</title><h1>Olá</h1><script>x()</script><p>mundo &nbsp;lindo</p><!-- c -->'), 'Olá mundo lindo');
  assert.equal(C.codePreviewText('<p>' + 'a'.repeat(500) + '</p>').length, 220);
});

test('a tela de SVG/HTML: elementos existem, prévia isolada e a CSP do painel continua fechada', () => {
  const html = rd('panel.html'), js = rd('panel-criacao.js');
  const have = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const names = ['Prompt', 'Model', 'Kind', 'Palette', 'Clear', 'Idea', 'Save', 'Copy', 'Open', 'Go', 'Status', 'Result', 'ViewPrev', 'ViewCode', 'Undo', 'Stage', 'Code', 'Tweak', 'TweakGo'];
  for (const P of ['crSvg', 'crHtm']) for (const n of names) assert.ok(have.has(P + n), `#${P}${n} não existe no panel.html`);
  for (const id of ['crSvgRatio', 'crSvgBg', 'crSvgPng', 'crHtmWidth']) assert.ok(have.has(id), id);
  assert.match(js, /svg: 'crSvg', html: 'crHtm'/);
  for (const t of ['svg', 'html']) assert.match(html, new RegExp(`data-tool="${t}"`));
  // toda prévia de HTML é um iframe com sandbox VAZIO (sem scripts, sem mesma origem, sem formulários, sem popups)
  const frames = [...js.matchAll(/createElement\('iframe'\)/g)].length;
  assert.equal(frames, 2, 'prévia do criador e janela do projeto');
  assert.equal([...js.matchAll(/setAttribute\('sandbox', ''\)/g)].length, frames, 'todo iframe tem sandbox vazio');
  assert.doesNotMatch(js, /allow-(scripts|same-origin|forms|popups|top-navigation)/);
  assert.doesNotMatch(js, /<iframe/); assert.doesNotMatch(html, /<iframe/);
  assert.match(js, /srcdoc/); assert.doesNotMatch(js, /\.innerHTML\s*=\s*(?!'')[^;]*code/i, 'o código da IA nunca entra por innerHTML');
  assert.match(html, /frame-src 'none'/); assert.doesNotMatch(html, /frame-src [^;']/); // srcdoc não precisa liberar frame-src
  // a ponte: painel → preload → main
  const pre = rd('panel-preload.js'), ipc = rd('ipc-criacao.js');
  for (const [fn, ch] of [['criaCode', 'cria-code'], ['criaOpenCode', 'cria-open-code']]) { assert.ok(pre.includes(`${fn}: (o) => ipcRenderer.invoke('${ch}', o)`), fn); assert.ok(ipc.includes(`'${ch}'`), ch); }
  assert.match(ipc, /\['text', 'svg', 'html'\]\.includes\(p\.type\)/); // ler o código salvo para reutilizar
});


test('filterProjects: favoritos e ordenação por data/nome', () => {
  const rows = [
    { id: 'a', title: 'Zebra', type: 'image', prompt: 'x', createdAt: 10, favorite: true },
    { id: 'b', title: 'Abacate', type: 'text', prompt: 'y', createdAt: 30, favorite: false },
    { id: 'c', title: 'Casa', type: 'html', prompt: 'z', createdAt: 20, favorite: true },
  ];
  assert.deepEqual(C.filterProjects(rows, { favorites: true }).map(x => x.id), ['c', 'a']);
  assert.deepEqual(C.filterProjects(rows, { sort: 'oldest' }).map(x => x.id), ['a', 'c', 'b']);
  assert.deepEqual(C.filterProjects(rows, { sort: 'name' }).map(x => x.id), ['b', 'c', 'a']);
});
