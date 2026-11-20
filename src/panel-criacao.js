// Aba "Criação" do painel: gerar imagem, texto, vídeo (apresentação animada), SVG e página HTML e listar os projetos salvos.
// Os pedidos de rede e a gravação dos arquivos ficam no main.js; as regras puras (estilos, roteiro, lista) em criacao.js.
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  if (!$('#tab-criacao')) return;

  let meta = null;
  const st = { tool: 'image', busy: false, cancel: false, img: { list: [], sel: 0 }, text: '', video: null, code: { svg: { stack: [] }, html: { stack: [] } }, view: 'grid', filter: 'all', sort: 'newest', q: '' };
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('yoru.cria') || '{}'); } catch (_) { return {}; } },
    set(o) { try { localStorage.setItem('yoru.cria', JSON.stringify({ ...store.get(), ...o })); } catch (_) { /* sem armazenamento */ } },
  };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const fillSel = (sel, items, val) => {
    sel.innerHTML = ''; const groups = {};
    items.forEach((i) => {
      const o = new Option(i.label, i.id); o.dataset.label = i.label; if (i.needs) o.dataset.needs = i.needs;
      if (i.group) { if (!groups[i.group]) { groups[i.group] = document.createElement('optgroup'); groups[i.group].label = i.group; sel.appendChild(groups[i.group]); } groups[i.group].appendChild(o); } else sel.add(o);
    });
    if (val && items.some((i) => i.id === val)) sel.value = val;
  };
  // marca com 🔒 os modelos cuja chave ainda não foi colocada (ready = { cloudflare: true, groq: false, ... })
  const markLocked = (ready) => $$('option[data-needs]').forEach((o) => { o.textContent = o.dataset.label + (ready[o.dataset.needs] === false ? '  🔒 falta a chave' : ''); });
  const rnd = () => Math.floor(Math.random() * 1e9);

  // ---------- vídeo: o que desenhar em cada instante (cópia de criacao.js; test/criacao.test.js confere as duas) ----------
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

  // ---------- status, barra e botões ----------
  const ids = { image: { go: '#crImgGo', save: '#crImgSave', status: '#crImgStatus', bar: '#crImgBar', result: '#crImgResult' },
    text: { go: '#crTxtGo', save: '#crTxtSave', status: '#crTxtStatus', bar: null, result: '#crTxtResult' },
    video: { go: '#crVidGo', save: '#crVidSave', status: '#crVidStatus', bar: '#crVidBar', result: '#crVidResult' },
    svg: { go: '#crSvgGo', save: '#crSvgSave', status: '#crSvgStatus', bar: null, result: '#crSvgResult' },
    html: { go: '#crHtmGo', save: '#crHtmSave', status: '#crHtmStatus', bar: null, result: '#crHtmResult' } };
  const goLabel = { image: '✨ Gerar Imagem', text: '✨ Gerar Texto', video: '✨ Gerar Vídeo', svg: '✨ Gerar SVG', html: '✨ Gerar HTML' };
  function status(tool, msg, kind) {
    const e = $(ids[tool].status); e.textContent = msg || ''; e.className = 'cr-status' + (kind ? ' ' + kind : '');
    if (kind === 'err' && /Chaves gratuitas/.test(msg || '')) { $('#crKeys').open = true; $('#crKeys').scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  function progress(tool, p) { const b = ids[tool].bar && $(ids[tool].bar); if (!b) return; b.classList.toggle('on', p != null); if (p != null) $('i', b).style.width = Math.round(Math.max(0, Math.min(1, p)) * 100) + '%'; }
  function setBusy(tool, on) {
    st.busy = on; st.cancel = false;
    for (const t of Object.keys(ids)) {
      const go = $(ids[t].go);
      if (t === tool) { go.textContent = on ? '⏹ Cancelar' : goLabel[t]; go.disabled = false; } else go.disabled = on;
    }
    if (!on) progress(tool, null);
  }
  const CODE = { svg: 'crSvg', html: 'crHtm' }; // prefixo dos elementos de cada ferramenta de código
  const cid = (tool, name) => document.getElementById(CODE[tool] + name);
  const codeOf = (tool) => cid(tool, 'Code').value;
  const hasResult = (tool) => tool === 'image' ? st.img.list.length > 0 : tool === 'text' ? !!$('#crTxtOut').value.trim() : CODE[tool] ? !!codeOf(tool).trim() : !!st.video;
  function refreshSave() {
    for (const t of Object.keys(ids)) $(ids[t].save).disabled = st.busy || !hasResult(t);
    $('#crTxtCopy').disabled = !$('#crTxtOut').value.trim();
    for (const t of Object.keys(CODE)) {
      const off = st.busy || !hasResult(t);
      for (const n of ['Copy', 'Open', 'TweakGo']) cid(t, n).disabled = off;
      cid(t, 'Undo').disabled = st.busy || !st.code[t].stack.length;
    }
    $('#crSvgPng').disabled = st.busy || !hasResult('svg');
  }
  const errText = (r) => (r && r.error) || 'Algo deu errado. Tente de novo.';

  // ---------- abas Imagem / Texto / Vídeo ----------
  function showTool(t) {
    st.tool = t; store.set({ tool: t });
    $$('#crTabs .cr-tab').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    $$('.cr-tool').forEach((s) => { s.hidden = s.dataset.tool !== t; });
  }
  $('#crTabs').addEventListener('click', (e) => { const b = e.target.closest('.cr-tab'); if (b) showTool(b.dataset.tool); });

  // contador de caracteres
  $$('.cr-count').forEach((c) => {
    const ta = document.getElementById(c.dataset.for);
    const upd = () => { c.textContent = `${ta.value.length.toLocaleString('pt-BR')} / 2.000`; };
    ta.addEventListener('input', upd); upd();
  });
  $('#crImgAdvBtn').addEventListener('click', () => $('#crImgAdv').classList.toggle('open'));
  const orToggle = () => { $('#crOrWrap').style.display = meta && meta.models.find((m) => m.id === $('#crImgModel').value && m.kind === 'openrouter') ? '' : 'none'; };

  // ---------- IMAGEM ----------
  function renderImages() {
    const box = $('#crImgResult');
    const pending = st.busy ? st.img.pending || 0 : 0;
    box.hidden = !st.img.list.length && !pending;
    box.innerHTML = '';
    if (box.hidden) return;
    const grid = el('div', 'cr-imgs');
    st.img.list.forEach((u, i) => {
      const im = el('img'); im.src = u; im.alt = 'Imagem gerada ' + (i + 1); if (i === st.img.sel) im.className = 'sel';
      im.addEventListener('click', () => { st.img.sel = i; renderImages(); });
      grid.appendChild(im);
    });
    for (let i = 0; i < pending; i++) { const sk = el('div', 'cr-skel'); sk.style.aspectRatio = st.img.ar || '16 / 9'; grid.appendChild(sk); } // espaço reservado das imagens que ainda vêm
    box.appendChild(grid);
    if (st.img.list.length > 1) box.appendChild(el('div', 'cr-note', 'Clique na imagem que você quer guardar: ela vai para o projeto.'));
    if (st.img.used) box.appendChild(el('div', 'cr-note', 'Prompt usado: ' + st.img.used));
  }
  async function genImages() {
    const prompt = $('#crImgPrompt').value.trim();
    if (!prompt) return status('image', 'Escreva o que você quer criar.', 'err');
    setBusy('image', true);
    const rt = (meta && meta.ratios.find((r) => r.id === $('#crImgRatio').value)) || { w: 16, h: 9 };
    st.img = { list: [], sel: 0, used: null, pending: Number($('#crImgCount').value) || 1, ar: `${rt.w} / ${rt.h}` }; renderImages(); refreshSave();
    const opt = () => ({ style: $('#crImgStyle').value, ratio: $('#crImgRatio').value, model: $('#crImgModel').value, orModel: $('#crOrModel').value, negative: $('#crImgNeg').value.trim() });
    store.set({ img: { ...opt(), count: $('#crImgCount').value, enhance: $('#crImgEnhance').checked } });
    let used = prompt, note = '';
    if ($('#crImgEnhance').checked) {
      status('image', 'Melhorando o prompt com a IA…'); progress('image', 0.05);
      const r = await panel.criaEnhance({ prompt, textModel: $('#crTxtModel').value });
      if (r.ok && r.prompt) { used = r.prompt; st.img.used = used; } else note = ' (não consegui melhorar o prompt: ' + errText(r) + ')';
    }
    const count = Number($('#crImgCount').value) || 1;
    const sv = $('#crImgSeed').value.trim();
    const base = sv === '' ? rnd() : Math.abs(Math.floor(Number(sv))) % 2147483000;
    let failed = false;
    for (let i = 0; i < count && !st.cancel; i++) {
      status('image', `Gerando imagem ${i + 1} de ${count}…${note}`); progress('image', (i + 0.2) / count);
      const r = await panel.criaImage({ prompt: used, seed: base + i, ...opt() });
      if (!r.ok) { status('image', errText(r), 'err'); failed = true; break; }
      st.img.list.push(r.dataUrl); st.img.seed = r.seed; st.img.pending = Math.max(0, count - st.img.list.length); renderImages(); refreshSave();
    }
    const n = st.img.list.length;
    st.img.pending = 0;
    if (!failed) status('image', st.cancel ? (n ? `Cancelado. ${n} imagem(ns) pronta(s).` : 'Cancelado.') : `Pronto! ${n} imagem(ns) gerada(s).${note}`, st.cancel ? '' : 'ok');
    setBusy('image', false); renderImages(); refreshSave();
  }
  async function saveImage() {
    const data = st.img.list[st.img.sel]; if (!data) return;
    const r = await panel.criaSave({ type: 'image', data, prompt: $('#crImgPrompt').value, meta: { style: $('#crImgStyle').value, ratio: $('#crImgRatio').value, model: $('#crImgModel').value, seed: st.img.seed, negative: $('#crImgNeg').value.trim() } });
    status('image', r.ok ? 'Salvo em Projetos Salvos. ✔' : errText(r), r.ok ? 'ok' : 'err'); if (r.ok) loadProjects();
  }

  // ---------- TEXTO ----------
  async function genText() {
    const prompt = $('#crTxtPrompt').value.trim();
    if (!prompt) return status('text', 'Escreva do que se trata.', 'err');
    setBusy('text', true); status('text', 'Escrevendo…');
    const sk = el('div', 'cr-skel-wrap'); for (const w of [96, 100, 88, 94, 60]) { const l = el('div', 'cr-skel cr-skel-line'); l.style.width = w + '%'; sk.appendChild(l); }
    $('#crTxtResult').before(sk);
    store.set({ txt: { kind: $('#crTxtKind').value, tone: $('#crTxtTone').value, size: $('#crTxtSize').value, lang: $('#crTxtLang').value, model: $('#crTxtModel').value } });
    const r = await panel.criaText({ prompt, kind: $('#crTxtKind').value, tone: $('#crTxtTone').value, size: $('#crTxtSize').value, lang: $('#crTxtLang').value, textModel: $('#crTxtModel').value });
    if (r.ok) { $('#crTxtOut').value = r.text; $('#crTxtResult').hidden = false; status('text', 'Pronto! Edite se quiser e salve.', 'ok'); }
    else status('text', errText(r), 'err');
    sk.remove(); setBusy('text', false); refreshSave();
  }
  async function saveText() {
    const data = $('#crTxtOut').value; if (!data.trim()) return;
    const r = await panel.criaSave({ type: 'text', data, prompt: $('#crTxtPrompt').value, meta: { kind: $('#crTxtKind').value, tone: $('#crTxtTone').value, size: $('#crTxtSize').value, lang: $('#crTxtLang').value } });
    status('text', r.ok ? 'Salvo em Projetos Salvos. ✔' : errText(r), r.ok ? 'ok' : 'err'); if (r.ok) loadProjects();
  }
  $('#crTxtOut').addEventListener('input', refreshSave);
  $('#crTxtCopy').addEventListener('click', async () => { await panel.copyText($('#crTxtOut').value); status('text', 'Texto copiado!', 'ok'); });

  // ---------- VÍDEO ----------
  const loadImg = (u) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Não consegui abrir uma das imagens geradas.')); i.src = u; });
  function drawCover(ctx, img, W, H, f, alpha) {
    const r = Math.max(W / img.width, H / img.height) * f.zoom, w = img.width * r, h = img.height * r;
    ctx.globalAlpha = alpha; ctx.drawImage(img, (W - w) / 2 + f.px * W, (H - h) / 2 + f.py * H, w, h); ctx.globalAlpha = 1;
  }
  function drawCaption(ctx, text, W, H) {
    if (!text) return;
    const size = Math.round(H * 0.045); ctx.font = `600 ${size}px "Segoe UI", sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const words = text.split(' '), lines = []; let line = '';
    for (const w of words) { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > W * 0.86 && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line);
    const lh = size * 1.3, bh = lines.length * lh + size * 0.9, y0 = H - bh - H * 0.05;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(W * 0.04, y0, W * 0.92, bh);
    ctx.fillStyle = '#fff'; lines.forEach((l, i) => ctx.fillText(l, W / 2, y0 + size * 0.45 + lh * (i + 0.5)));
  }
  function renderFrame(ctx, imgs, caps, t, secPer, W, H, showCaps, fade, motion) {
    const f = sceneFrame(t, imgs.length, secPer, fade, motion);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    drawCover(ctx, imgs[f.index], W, H, f.a, 1);
    if (f.next !== null && f.mix > 0) drawCover(ctx, imgs[f.next], W, H, f.b, f.mix);
    if (showCaps) drawCaption(ctx, caps[f.next !== null && f.mix > 0.5 ? f.next : f.index], W, H);
  }
  function recordVideo(imgs, caps, secPer, W, H, showCaps, onProgress, fade, motion) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
      if (!mime) return reject(new Error('Este computador não conseguiu gravar o vídeo aqui.'));
      const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 4000000 });
      const chunks = []; const total = imgs.length * secPer; let cancelled = false;
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      rec.onerror = () => reject(new Error('Falha ao gravar o vídeo.'));
      renderFrame(ctx, imgs, caps, 0, secPer, W, H, showCaps, fade, motion);
      const poster = canvas.toDataURL('image/jpeg', 0.82);
      rec.onstop = () => (cancelled ? reject(new Error('cancelado')) : resolve({ blob: new Blob(chunks, { type: 'video/webm' }), poster, duration: total }));
      rec.start(250);
      const t0 = performance.now();
      const tick = () => {
        if (st.cancel) { cancelled = true; rec.stop(); return; }
        const t = (performance.now() - t0) / 1000;
        renderFrame(ctx, imgs, caps, t, secPer, W, H, showCaps, fade, motion); onProgress(Math.min(1, t / total));
        if (t >= total) { setTimeout(() => rec.stop(), 250); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  // WebM gravado ao vivo vem sem duração: força o navegador a descobrir para a barra de tempo funcionar
  function fixDuration(v) {
    v.addEventListener('loadedmetadata', () => {
      if (v.duration === Infinity) { v.currentTime = 1e101; v.addEventListener('timeupdate', function h() { v.removeEventListener('timeupdate', h); v.currentTime = 0; }); }
    });
  }
  function showVideo() {
    const box = $('#crVidResult'); box.innerHTML = ''; box.hidden = !st.video; if (!st.video) return;
    const v = el('video'); v.controls = true; v.src = st.video.url; v.poster = st.video.poster; fixDuration(v); box.appendChild(v);
  }
  async function genVideo() {
    const idea = $('#crVidPrompt').value.trim();
    if (!idea) return status('video', 'Descreva a ideia do vídeo.', 'err');
    if (st.video) { URL.revokeObjectURL(st.video.url); st.video = null; showVideo(); }
    setBusy('video', true); refreshSave();
    const n = Number($('#crVidScenes').value), secPer = Number($('#crVidSecs').value);
    const motion = $('#crVidMotion').value || 'misto', fade = Number($('#crVidFade').value) || 0.6;
    const ratio = meta.ratios.find((r) => r.id === $('#crVidRatio').value) || meta.ratios[0];
    // tamanho do vídeo: 1280×720 (paisagem), 720×1280 (retrato) ou 720×720 (quadrado)
    const [Wf, H] = ratio.w > ratio.h ? [1280, 720] : ratio.w < ratio.h ? [720, 1280] : [720, 720];
    const opt = { style: $('#crVidStyle').value, ratio: ratio.id, model: $('#crVidModel').value, orModel: $('#crOrModel').value };
    { const vb = $('#crVidResult'); vb.innerHTML = ''; vb.hidden = false; const sk = el('div', 'cr-skel'); sk.style.aspectRatio = `${ratio.w} / ${ratio.h}`; sk.style.maxHeight = '420px'; sk.style.margin = '0 auto'; vb.appendChild(sk); }
    store.set({ vid: { ...opt, scenes: n, secs: secPer, caps: $('#crVidCaps').checked, txtModel: $('#crVidTxtModel').value, motion, fade } });
    try {
      status('video', 'Montando o roteiro com a IA…'); progress('video', 0.03);
      const sb = await panel.criaStoryboard({ idea, scenes: n, textModel: $('#crVidTxtModel').value });
      if (!sb.ok) throw new Error(errText(sb));
      const scenes = sb.scenes, imgs = [], base = rnd();
      for (let i = 0; i < scenes.length; i++) {
        if (st.cancel) throw new Error('cancelado');
        status('video', `Gerando a cena ${i + 1} de ${scenes.length}…`); progress('video', 0.05 + (0.6 * i) / scenes.length);
        const r = await panel.criaImage({ prompt: scenes[i].prompt, seed: base, ...opt }); // mesma semente: cenas mais parecidas
        if (!r.ok) throw new Error(errText(r));
        imgs.push(await loadImg(r.dataUrl));
      }
      status('video', 'Gravando o vídeo… (deixe o painel aberto)'); progress('video', 0.68);
      const out = await recordVideo(imgs, scenes.map((s) => s.caption), secPer, Wf, H, $('#crVidCaps').checked, (p) => progress('video', 0.68 + 0.3 * p), fade, motion);
      st.video = { ...out, url: URL.createObjectURL(out.blob), scenes: scenes.length, secPer, opt: { ...opt, motion, fade } };
      showVideo(); status('video', 'Pronto! Assista e, se gostar, salve como projeto.', 'ok');
    } catch (e) {
      status('video', e.message === 'cancelado' ? 'Cancelado.' : e.message, e.message === 'cancelado' ? '' : 'err');
    }
    if (!st.video) showVideo(); // sem vídeo pronto: tira o espaço reservado
    setBusy('video', false); refreshSave();
  }
  async function saveVideo() {
    if (!st.video) return;
    status('video', 'Salvando…');
    const data = new Uint8Array(await st.video.blob.arrayBuffer());
    const r = await panel.criaSave({ type: 'video', data, poster: st.video.poster, prompt: $('#crVidPrompt').value, meta: { ...st.video.opt, duration: st.video.duration, scenes: st.video.scenes, secPerScene: st.video.secPer } });
    status('video', r.ok ? 'Salvo em Projetos Salvos. ✔' : errText(r), r.ok ? 'ok' : 'err'); if (r.ok) loadProjects();
  }

  // ---------- SVG e HTML ----------
  // A IA escreve o código. A prévia é segura: o SVG vira <img> (nunca executa nada) e o HTML vai num iframe com sandbox vazio
  // (sem JavaScript, sem internet, sem acesso ao painel). Para rodar o JavaScript de uma página, "Abrir no navegador".
  const svgUrl = (code) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(code);
  function renderStage(tool) {
    const stage = cid(tool, 'Stage'), code = codeOf(tool);
    stage.innerHTML = '';
    if (!code.trim()) return;
    if (tool === 'svg') {
      stage.className = 'cr-stage bg-' + (cid('svg', 'Bg').value || 'xadrez');
      const im = el('img'); im.alt = 'Prévia do SVG';
      im.addEventListener('error', () => { stage.innerHTML = ''; stage.appendChild(el('div', 'cr-bad', 'Este SVG tem um erro de sintaxe e não abre. Corrija no código ou peça um ajuste à IA.')); });
      im.src = svgUrl(code); stage.appendChild(im);
    } else {
      const fr = document.createElement('iframe');
      fr.setAttribute('sandbox', ''); fr.referrerPolicy = 'no-referrer'; fr.title = 'Prévia da página HTML';
      const w = cid('html', 'Width').value; if (w) fr.style.width = w;
      fr.srcdoc = code; stage.appendChild(fr);
    }
  }
  function codeView(tool, v) {
    cid(tool, 'Stage').hidden = v !== 'prev'; cid(tool, 'Code').hidden = v !== 'code';
    cid(tool, 'ViewPrev').classList.toggle('on', v === 'prev'); cid(tool, 'ViewCode').classList.toggle('on', v === 'code');
  }
  function showCode(tool, code) {
    cid(tool, 'Code').value = code; cid(tool, 'Result').hidden = !code.trim();
    codeView(tool, 'prev'); renderStage(tool);
  }
  const codePrefs = (tool) => ({ kind: cid(tool, 'Kind').value, palette: cid(tool, 'Palette').value, ratio: tool === 'svg' ? cid('svg', 'Ratio').value : undefined });
  async function genCode(tool, tweak) {
    const prompt = cid(tool, tweak ? 'Tweak' : 'Prompt').value.trim();
    if (!prompt) return status(tool, tweak ? 'Escreva o ajuste que você quer.' : tool === 'svg' ? 'Descreva o desenho que você quer.' : 'Descreva a página que você quer.', 'err');
    const current = tweak ? codeOf(tool) : '';
    const prefs = codePrefs(tool);
    store.set({ [tool === 'svg' ? 'svg' : 'htm']: { ...prefs, model: cid(tool, 'Model').value } });
    setBusy(tool, true); refreshSave();
    status(tool, tweak ? 'Ajustando o código…' : tool === 'svg' ? 'Desenhando o SVG…' : 'Escrevendo a página…');
    const r = await panel.criaCode({ type: tool, prompt, current, ...prefs, textModel: cid(tool, 'Model').value });
    if (st.cancel) status(tool, 'Cancelado.');
    else if (!r.ok) status(tool, errText(r), 'err');
    else {
      const stack = st.code[tool].stack;
      if (tweak && current.trim()) { stack.push(current); if (stack.length > 10) stack.shift(); } else stack.length = 0;
      showCode(tool, r.code); if (tweak) cid(tool, 'Tweak').value = '';
      status(tool, tweak ? 'Ajuste aplicado! Se não gostou, use “Desfazer ajuste”.' : 'Pronto! Veja a prévia, edite o código se quiser e salve.', 'ok');
    }
    setBusy(tool, false); refreshSave();
  }
  async function saveCode(tool) {
    const data = codeOf(tool); if (!data.trim()) return;
    const r = await panel.criaSave({ type: tool, data, prompt: cid(tool, 'Prompt').value, meta: codePrefs(tool) });
    status(tool, r.ok ? 'Salvo em Projetos Salvos. ✔' : errText(r), r.ok ? 'ok' : 'err'); if (r.ok) loadProjects();
  }
  // tamanho do SVG (viewBox ou width/height) para gerar o PNG
  function svgSize(code) {
    const root = (String(code).match(/<svg\b[^>]*>/i) || [''])[0];
    const vb = root.match(/viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
    if (vb && Number(vb[1]) > 0 && Number(vb[2]) > 0) return { w: Number(vb[1]), h: Number(vb[2]) };
    const n = (a) => { const m = root.match(new RegExp('\\s' + a + '\\s*=\\s*["\']?\\s*([\\d.]+)', 'i')); return m ? Number(m[1]) : 0; };
    return { w: n('width') || 1024, h: n('height') || 1024 };
  }
  async function saveSvgPng() {
    const code = codeOf('svg'); if (!code.trim()) return;
    try {
      const { w, h } = svgSize(code), k = 2048 / Math.max(w, h), W = Math.max(16, Math.round(w * k)), H = Math.max(16, Math.round(h * k));
      const im = await loadImg(svgUrl(code));
      const c = document.createElement('canvas'); c.width = W; c.height = H; c.getContext('2d').drawImage(im, 0, 0, W, H);
      const r = await panel.criaSave({ type: 'image', data: c.toDataURL('image/png'), prompt: $('#crSvgPrompt').value, meta: { ratio: $('#crSvgRatio').value } });
      status('svg', r.ok ? 'PNG salvo em Projetos Salvos (como imagem). ✔' : errText(r), r.ok ? 'ok' : 'err'); if (r.ok) loadProjects();
    } catch (_) { status('svg', 'Não consegui transformar este SVG em PNG. Confira se a prévia abre.', 'err'); }
  }
  for (const tool of Object.keys(CODE)) {
    let t;
    cid(tool, 'Code').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { renderStage(tool); refreshSave(); }, 250); });
    cid(tool, 'ViewPrev').addEventListener('click', () => codeView(tool, 'prev'));
    cid(tool, 'ViewCode').addEventListener('click', () => codeView(tool, 'code'));
    cid(tool, 'Copy').addEventListener('click', async () => { await panel.copyText(codeOf(tool)); status(tool, 'Código copiado!', 'ok'); });
    cid(tool, 'Open').addEventListener('click', async () => { const r = await panel.criaOpenCode({ type: tool, code: codeOf(tool) }); if (!r.ok) status(tool, errText(r), 'err'); });
    cid(tool, 'Undo').addEventListener('click', () => { const prev = st.code[tool].stack.pop(); if (prev != null) { showCode(tool, prev); status(tool, 'Ajuste desfeito.'); refreshSave(); } });
    cid(tool, 'TweakGo').addEventListener('click', () => { if (!st.busy) genCode(tool, true); });
    cid(tool, 'Tweak').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!st.busy && !cid(tool, 'TweakGo').disabled) genCode(tool, true); } });
    cid(tool, 'Save').addEventListener('click', () => saveCode(tool));
    cid(tool, 'Clear').addEventListener('click', () => {
      if (st.busy) return;
      cid(tool, 'Prompt').value = ''; cid(tool, 'Prompt').dispatchEvent(new Event('input')); cid(tool, 'Tweak').value = '';
      st.code[tool].stack.length = 0; showCode(tool, ''); status(tool, ''); refreshSave();
    });
  }
  $('#crSvgBg').addEventListener('change', () => renderStage('svg'));
  $('#crHtmWidth').addEventListener('change', () => renderStage('html'));
  $('#crSvgPng').addEventListener('click', saveSvgPng);

  // ---------- 🎲 ideias de prompt ----------
  for (const [tool, btn, ta] of [['image', '#crImgIdea', '#crImgPrompt'], ['text', '#crTxtIdea', '#crTxtPrompt'], ['video', '#crVidIdea', '#crVidPrompt'], ['svg', '#crSvgIdea', '#crSvgPrompt'], ['html', '#crHtmIdea', '#crHtmPrompt']]) {
    $(btn).addEventListener('click', async () => {
      if (st.busy) return;
      const r = await panel.criaIdea(tool); if (!r.ok) return;
      $(ta).value = r.idea; $(ta).dispatchEvent(new Event('input')); $(ta).focus();
    });
  }

  // ---------- botões de cada ferramenta ----------
  const run = (tool, fn) => () => { if (st.busy) { if (st.tool === tool) { st.cancel = true; status(tool, 'Cancelando…'); } return; } fn(); };
  $('#crImgGo').addEventListener('click', run('image', genImages));
  $('#crTxtGo').addEventListener('click', run('text', genText));
  $('#crVidGo').addEventListener('click', run('video', genVideo));
  $('#crSvgGo').addEventListener('click', run('svg', () => genCode('svg')));
  $('#crHtmGo').addEventListener('click', run('html', () => genCode('html')));
  $('#crImgSave').addEventListener('click', saveImage);
  $('#crTxtSave').addEventListener('click', saveText);
  $('#crVidSave').addEventListener('click', saveVideo);
  $('#crImgClear').addEventListener('click', () => { if (st.busy) return; $('#crImgPrompt').value = ''; $('#crImgNeg').value = ''; $('#crImgPrompt').dispatchEvent(new Event('input')); st.img = { list: [], sel: 0 }; renderImages(); status('image', ''); refreshSave(); });
  $('#crTxtClear').addEventListener('click', () => { if (st.busy) return; $('#crTxtPrompt').value = ''; $('#crTxtPrompt').dispatchEvent(new Event('input')); $('#crTxtOut').value = ''; $('#crTxtResult').hidden = true; status('text', ''); refreshSave(); });
  $('#crVidClear').addEventListener('click', () => { if (st.busy) return; $('#crVidPrompt').value = ''; $('#crVidPrompt').dispatchEvent(new Event('input')); if (st.video) URL.revokeObjectURL(st.video.url); st.video = null; showVideo(); status('video', ''); refreshSave(); });
  $('#crImgModel').addEventListener('change', orToggle);
  $('#crVidModel').addEventListener('change', () => { $('#crImgModel').value = $('#crVidModel').value; orToggle(); });
  $('#crImgModel').addEventListener('change', () => { $('#crVidModel').value = $('#crImgModel').value; });
  // o modelo de texto é um só para Texto, Vídeo, SVG e HTML
  const TXT_MODELS = ['#crTxtModel', '#crVidTxtModel', '#crSvgModel', '#crHtmModel'];
  TXT_MODELS.forEach((id) => $(id).addEventListener('change', () => TXT_MODELS.forEach((o) => { $(o).value = $(id).value; })));

  // ---------- chaves gratuitas (Cloudflare, Gemini, Groq, OpenRouter, Pollinations) ----------
  const KEY_FIELDS = [['#crCfTok', 'cloudflareToken', 'cole o token aqui'], ['#crGeminiKey', 'gemini', 'AIza…'], ['#crGroqKey', 'groq', 'gsk_…'], ['#crOrKey', 'openrouter', 'sk-or-…'], ['#crPollKey', 'pollinations', 'só para o modelo Pollinations']];
  function showKeys(k) {
    $('#crCfAcc').value = k.cloudflareAccountId || '';
    for (const [id, key, ph] of KEY_FIELDS) { $(id).value = ''; $(id).placeholder = k[key].has ? 'salva ' + k[key].hint + ' (cole para trocar)' : ph; }
    const cf = !!(k.cloudflareAccountId && k.cloudflareToken.has);
    const ready = { cloudflare: cf, gemini: k.gemini.has, groq: k.groq.has, openrouter: k.openrouter.has, pollinations: k.pollinations.has };
    const imgOk = cf, txtOk = cf || k.gemini.has || k.groq.has || k.openrouter.has;
    const stEl = $('#crKeysState'); stEl.className = 'cr-key-state' + (imgOk && txtOk ? ' ok' : '');
    stEl.textContent = imgOk && txtOk ? '✔ imagem e texto prontos' : `⚠ falta${imgOk || txtOk ? '' : 'm'}: ${[imgOk ? '' : 'imagem (Cloudflare)', txtOk ? '' : 'texto (Gemini, Groq, Cloudflare ou OpenRouter)'].filter(Boolean).join(' e ')}`;
    markLocked(ready);
    return { imgOk, txtOk };
  }
  async function loadKeys() {
    const r = await panel.criaKeysGet(); if (!r.ok) return;
    const { imgOk, txtOk } = showKeys(r.keys);
    if (!imgOk || !txtOk) $('#crKeys').open = true; // primeira vez: mostra o que falta
  }
  $('#crKeysSave').addEventListener('click', async () => {
    const e = $('#crKeysStatus'); e.className = 'cr-status'; e.textContent = 'Salvando…';
    const r = await panel.criaKeysSet({ cloudflareAccountId: $('#crCfAcc').value, cloudflareToken: $('#crCfTok').value, openrouter: $('#crOrKey').value, pollinations: $('#crPollKey').value, groq: $('#crGroqKey').value, gemini: $('#crGeminiKey').value });
    if (!r.ok) { e.className = 'cr-status err'; e.textContent = errText(r); return; }
    showKeys(r.keys); e.className = 'cr-status ok'; e.textContent = 'Chaves salvas. ✔';
  });
  $('#crKeysClear').addEventListener('click', async () => {
    if (!confirm('Apagar todas as chaves salvas aqui (Cloudflare, Gemini, Groq, OpenRouter e Pollinations)?')) return;
    const e = $('#crKeysStatus'); e.className = 'cr-status'; e.textContent = 'Removendo…';
    const r = await panel.criaKeysSet({ clear: ['cloudflare', 'gemini', 'groq', 'openrouter', 'pollinations'] });
    if (!r.ok) { e.className = 'cr-status err'; e.textContent = errText(r); return; }
    showKeys(r.keys); e.className = 'cr-status ok'; e.textContent = 'Chaves removidas.';
  });
  // Ctrl+Enter gera
  [['#crImgPrompt', '#crImgGo'], ['#crTxtPrompt', '#crTxtGo'], ['#crVidPrompt', '#crVidGo'], ['#crSvgPrompt', '#crSvgGo'], ['#crHtmPrompt', '#crHtmGo']].forEach(([t, g]) => $(t).addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $(g).click(); } }));

  // ---------- PROJETOS SALVOS ----------
  const icon = { image: '🖼️', text: '📄', video: '🎬', svg: '🧩', html: '🌐' };
  let projects = [];
  function thumb(p) {
    const t = el('div', 'cr-thumb');
    if (!p.exists) { t.appendChild(el('div', 'txt', 'Arquivo não encontrado')); return t; }
    if (p.type === 'image') { const i = el('img'); i.loading = 'lazy'; i.src = p.fileUrl; i.alt = p.title; t.appendChild(i); }
    else if (p.type === 'svg') { const i = el('img', 'contain'); i.loading = 'lazy'; i.src = p.fileUrl; i.alt = p.title; t.appendChild(i); }
    else if (p.type === 'html') { t.classList.add('page'); t.appendChild(el('div', 'txt', p.preview || 'Página HTML')); }
    else if (p.type === 'video') {
      if (p.posterUrl) { const i = el('img'); i.loading = 'lazy'; i.src = p.posterUrl; i.alt = p.title; t.appendChild(i); }
      t.appendChild(el('div', 'cr-play', '▶')); if (p.dur) t.appendChild(el('span', 'cr-dur', p.dur));
    } else t.appendChild(el('div', 'txt', p.preview || '…'));
    t.appendChild(el('span', 'cr-badge', icon[p.type] || '📁'));
    return t;
  }
  function card(p) {
    const c = el('div', 'cr-card'); c.dataset.id = p.id; c.tabIndex = 0;
    const info = el('div', 'cr-info'); info.appendChild(el('b', null, p.title)); info.appendChild(el('span', null, `${p.typeLabel} • ${p.when}`));
    const fav = el('button', 'cr-fav' + (p.favorite ? ' active' : ''), p.favorite ? '★' : '☆'); fav.title = p.favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'; fav.setAttribute('aria-label', fav.title);
    fav.addEventListener('click', async (e) => { e.stopPropagation(); const r = await panel.criaFavorite(p.id, !p.favorite); if (r.ok) loadProjects(); else alert(errText(r)); });
    const more = el('button', 'cr-more', '⋮'); more.title = 'Mais opções'; more.setAttribute('aria-label', 'Mais opções');
    c.append(thumb(p), info, fav, more);
    c.addEventListener('click', (e) => { if (e.target.closest('.cr-more') || e.target.tagName === 'INPUT') return; openProject(p); });
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === c) openProject(p); });
    more.addEventListener('click', (e) => { e.stopPropagation(); openMenu(p, more, c); });
    return c;
  }
  function projectSkeletons(grid) {
    for (let i = 0; i < 6; i++) { const c = el('div', 'cr-card cr-skel-card'); c.setAttribute('aria-hidden', 'true'); const t = el('div', 'cr-thumb cr-skel'); const l1 = el('div', 'cr-skel cr-skel-line'); l1.style.width = '70%'; const l2 = el('div', 'cr-skel cr-skel-line'); l2.style.width = '45%'; c.append(t, l1, l2); grid.appendChild(c); }
  }
  async function loadProjects() {
    if (!$('#crGrid').children.length) projectSkeletons($('#crGrid')); // só na primeira carga: nas seguintes a lista antiga fica até a nova chegar (sem piscar)
    const r = await panel.criaList({ q: st.q, type: st.filter === 'favorites' ? 'all' : st.filter, favorites: st.filter === 'favorites', sort: st.sort });
    const grid = $('#crGrid'); grid.innerHTML = '';
    if (!r.ok) { grid.appendChild(el('div', 'cr-empty', errText(r))); return; }
    projects = r.projects;
    if (!projects.length) grid.appendChild(el('div', 'cr-empty', r.total ? 'Nenhum projeto encontrado com esse filtro.' : 'Nenhum projeto ainda. Crie algo acima e clique em “Salvar como projeto”.'));
    projects.forEach((p) => grid.appendChild(card(p)));
    const fmt = (n) => { if (n < 1024) return `${n} B`; if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; };
    $('#crGalleryStats').textContent = `${projects.length} exibido(s) • ${r.total} projeto(s) • ${r.favorites} favorito(s) • ${fmt(r.bytes)} utilizados`;
    $('#crFolderHint').textContent = r.total ? 'Projetos armazenados localmente na pasta de dados do Yoru.' : '';
  }
  let searchT; $('#crSearch').addEventListener('input', (e) => { clearTimeout(searchT); searchT = setTimeout(() => { st.q = e.target.value; loadProjects(); }, 150); });
  $('#crFilter').addEventListener('change', (e) => { st.filter = e.target.value; loadProjects(); });
  $('#crSort').addEventListener('change', (e) => { st.sort = e.target.value; store.set({ sort: st.sort }); loadProjects(); });
  const setView = (v) => { st.view = v; store.set({ view: v }); $('#crGrid').classList.toggle('list', v === 'list'); $('#crViewGrid').classList.toggle('on', v === 'grid'); $('#crViewList').classList.toggle('on', v === 'list'); };
  $('#crViewGrid').addEventListener('click', () => setView('grid'));
  $('#crViewList').addEventListener('click', () => setView('list'));

  // menu ⋮
  let menu = null;
  const closeMenu = () => { if (menu) { menu.remove(); menu = null; } };
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); closeModal(); } });
  function openMenu(p, anchor, cardEl) {
    closeMenu();
    menu = el('div', 'cr-menu');
    const item = (label, fn, cls) => { const b = el('button', cls, label); b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); fn(); }); menu.appendChild(b); };
    item('👁️ Abrir', () => openProject(p));
    item('🔁 Reutilizar o prompt', () => reuse(p));
    item('✏️ Renomear', () => rename(p, cardEl));
    item('📂 Mostrar na pasta', () => panel.criaReveal(p.id));
    item('💾 Salvar uma cópia…', async () => { const r = await panel.criaExport(p.id); if (!r.ok) alert(errText(r)); });
    item('🗑️ Excluir', async () => { if (confirm(`Excluir “${p.title}”? Isso apaga o arquivo.`)) { await panel.criaDelete(p.id); loadProjects(); } }, 'danger');
    document.body.appendChild(menu);
    const r = anchor.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth)) + 'px';
    menu.style.top = Math.max(8, Math.min(window.innerHeight - menu.offsetHeight - 8, r.bottom + 4)) + 'px';
  }
  function rename(p, cardEl) {
    const b = $('b', cardEl); const inp = el('input'); inp.type = 'text'; inp.value = p.title; inp.maxLength = 60; b.replaceWith(inp); inp.focus(); inp.select();
    let done = false;
    const finish = async (save) => { if (done) return; done = true; if (save && inp.value.trim() && inp.value.trim() !== p.title) await panel.criaRename(p.id, inp.value); loadProjects(); };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') finish(true); if (e.key === 'Escape') finish(false); });
    inp.addEventListener('blur', () => finish(true));
  }
  // joga o prompt e as escolhas do projeto de volta na ferramenta certa
  function reuse(p) {
    const m = p.meta || {};
    if (p.type === 'image') {
      $('#crImgPrompt').value = p.prompt; if (m.style) $('#crImgStyle').value = m.style; if (m.ratio) $('#crImgRatio').value = m.ratio; if (m.model) $('#crImgModel').value = m.model;
      $('#crImgSeed').value = m.seed != null ? m.seed : ''; $('#crImgNeg').value = m.negative || ''; $('#crImgPrompt').dispatchEvent(new Event('input')); orToggle(); showTool('image');
    } else if (p.type === 'svg' || p.type === 'html') {
      reuseCode(p); return;
    } else if (p.type === 'text') {
      $('#crTxtPrompt').value = p.prompt; if (m.kind) $('#crTxtKind').value = m.kind; if (m.tone) $('#crTxtTone').value = m.tone; if (m.size) $('#crTxtSize').value = m.size; if (m.lang) $('#crTxtLang').value = m.lang;
      $('#crTxtPrompt').dispatchEvent(new Event('input')); showTool('text');
    } else {
      $('#crVidPrompt').value = p.prompt; if (m.style) $('#crVidStyle').value = m.style; if (m.ratio) $('#crVidRatio').value = m.ratio; if (m.scenes) $('#crVidScenes').value = String(m.scenes);
      if (m.secPerScene) $('#crVidSecs').value = String(m.secPerScene); if (m.motion) $('#crVidMotion').value = m.motion; if (m.fade) $('#crVidFade').value = String(m.fade); $('#crVidPrompt').dispatchEvent(new Event('input')); showTool('video');
    }
    $('#tab-criacao').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // SVG/HTML: devolve o prompt, as escolhas E o código salvo para a ferramenta (dá para ajustar e salvar de novo)
  async function reuseCode(p) {
    const tool = p.type, m = p.meta || {};
    cid(tool, 'Prompt').value = p.prompt; cid(tool, 'Prompt').dispatchEvent(new Event('input'));
    if (m.kind) cid(tool, 'Kind').value = m.kind; if (m.palette) cid(tool, 'Palette').value = m.palette; if (tool === 'svg' && m.ratio) cid('svg', 'Ratio').value = m.ratio;
    const r = await panel.criaReadText(p.id);
    st.code[tool].stack.length = 0;
    if (r.ok) showCode(tool, r.text); else status(tool, errText(r), 'err');
    showTool(tool); refreshSave();
    $('#tab-criacao').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // janela de visualização
  function closeModal() { const m = $('#crModal'); if (m.hidden) return; m.hidden = true; $('#crModalBox').innerHTML = ''; }
  $('#crModal').addEventListener('click', (e) => { if (e.target.id === 'crModal') closeModal(); });
  async function openProject(p) {
    const box = $('#crModalBox'); box.innerHTML = ''; box.appendChild(el('h3', null, p.title));
    if (!p.exists) box.appendChild(el('p', 'cr-note', 'O arquivo deste projeto não está mais na pasta.'));
    else if (p.type === 'image') { const i = el('img'); i.src = p.fileUrl; box.appendChild(i); }
    else if (p.type === 'video') { const v = el('video'); v.controls = true; v.src = p.fileUrl; if (p.posterUrl) v.poster = p.posterUrl; fixDuration(v); box.appendChild(v); }
    else if (p.type === 'svg') { const i = el('img'); i.src = p.fileUrl; i.style.background = '#fff'; i.style.width = '100%'; box.appendChild(i); }
    else if (p.type === 'html') {
      const r = await panel.criaReadText(p.id);
      if (r.ok) { const fr = document.createElement('iframe'); fr.setAttribute('sandbox', ''); fr.referrerPolicy = 'no-referrer'; fr.title = p.title; fr.srcdoc = r.text; box.appendChild(fr); box.appendChild(el('div', 'cr-note', 'Prévia segura, sem JavaScript. Use “Abrir no programa padrão” para ver a página funcionando no navegador.')); }
      else box.appendChild(el('p', 'cr-note', errText(r)));
    } else { const r = await panel.criaReadText(p.id); const pre = el('pre'); pre.textContent = r.ok ? r.text : errText(r); box.appendChild(pre); }
    box.appendChild(el('div', 'cr-prompt-line', `${p.typeLabel} • ${p.when}${p.prompt ? ' • Prompt: ' + p.prompt : ''}`));
    const row = el('div', 'btns');
    const btn = (label, fn, cls) => { const b = el('button', 'b' + (cls ? ' ' + cls : ''), label); b.addEventListener('click', fn); row.appendChild(b); };
    btn('🔁 Reutilizar o prompt', () => { closeModal(); reuse(p); }, 'primary');
    if (p.type === 'text' || p.type === 'svg' || p.type === 'html') btn(p.type === 'text' ? '📋 Copiar' : '📋 Copiar código', async () => { const r = await panel.criaReadText(p.id); if (r.ok) panel.copyText(r.text); });
    btn('↗ Abrir no programa padrão', async () => { const r = await panel.criaOpen(p.id); if (!r.ok) alert(errText(r)); });
    btn('✖ Fechar', closeModal);
    box.appendChild(row); $('#crModal').hidden = false;
  }

  // ---------- início ----------
  (async () => {
    const r = await panel.criaMeta();
    if (!r.ok) return;
    meta = r;
    const sv = store.get(), si = sv.img || {}, sx = sv.txt || {}, sd = sv.vid || {}, sg = sv.svg || {}, sh = sv.htm || {};
    // migração (v2, modelos grátis): a escolha de modelo de imagem das versões antigas (Pollinations/OpenRouter pago) é descartada uma vez, para cair no FLUX grátis
    if (sv.freeV !== 2) { delete si.model; delete sd.model; store.set({ freeV: 2, img: si, vid: sd }); }
    fillSel($('#crImgModel'), meta.models, si.model || sd.model); fillSel($('#crVidModel'), meta.models, si.model || sd.model);
    fillSel($('#crImgStyle'), meta.styles, si.style); fillSel($('#crVidStyle'), meta.styles, sd.style || si.style);
    fillSel($('#crImgRatio'), meta.ratios, si.ratio); fillSel($('#crVidRatio'), meta.ratios.filter((x) => ['16:9', '9:16', '1:1'].includes(x.id)), sd.ratio);
    fillSel($('#crTxtModel'), meta.textModels, sx.model || sd.txtModel); fillSel($('#crVidTxtModel'), meta.textModels, sx.model || sd.txtModel);
    fillSel($('#crTxtKind'), meta.kinds, sx.kind); fillSel($('#crTxtTone'), meta.tones, sx.tone); fillSel($('#crTxtSize'), meta.sizes, sx.size); fillSel($('#crTxtLang'), meta.langs, sx.lang);
    fillSel($('#crSvgModel'), meta.textModels, sx.model || sd.txtModel); fillSel($('#crHtmModel'), meta.textModels, sx.model || sd.txtModel);
    fillSel($('#crSvgKind'), meta.svgKinds, sg.kind); fillSel($('#crHtmKind'), meta.htmlKinds, sh.kind);
    fillSel($('#crSvgPalette'), meta.palettes, sg.palette); fillSel($('#crHtmPalette'), meta.palettes, sh.palette); fillSel($('#crSvgRatio'), meta.ratios, sg.ratio || '1:1');
    fillSel($('#crVidMotion'), meta.motions, sd.motion); fillSel($('#crVidFade'), meta.fades, sd.fade != null ? String(sd.fade) : '0.6'); if (si.negative) $('#crImgNeg').value = si.negative;
    if (si.count) $('#crImgCount').value = si.count; $('#crImgEnhance').checked = !!si.enhance; if (si.orModel) $('#crOrModel').value = si.orModel;
    if (sd.scenes) $('#crVidScenes').value = String(sd.scenes); if (sd.secs) $('#crVidSecs').value = String(sd.secs); if (sd.caps === false) $('#crVidCaps').checked = false;
    orToggle(); setView(sv.view === 'list' ? 'list' : 'grid'); st.sort = ['newest', 'oldest', 'name'].includes(sv.sort) ? sv.sort : 'newest'; $('#crSort').value = st.sort; showTool(['image', 'text', 'video', 'svg', 'html'].includes(sv.tool) ? sv.tool : 'image'); refreshSave();
    loadProjects(); loadKeys();
  })();
  // ao abrir a aba, atualiza a lista (outro painel pode ter salvo algo)
  $$('.tab').forEach((b) => { if (b.dataset.tab === 'criacao') b.addEventListener('click', () => { if (meta) loadProjects(); }); });
})();
