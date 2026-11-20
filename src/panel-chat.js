// Aba Chat: mensagens, anexos e memória de longo prazo.
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- chat -----
const log = $('#chatlog');
let typingEl = null, lastUserText = '';
let typingTimer = null;
// tarefas de agente (ex.: OpenClaw) podem demorar: depois de um tempo, a bolinha de "digitando" ganha um texto
// dizendo que ela ainda está acompanhando o progresso, em vez de parecer travada
const WAIT_HINTS = [
  [8, 'ainda trabalhando nisso…'],
  [25, 'é uma tarefa mais longa — acompanhando o progresso…'],
  [60, 'continua rodando; aviso assim que tiver novidade…'],
];
const SVG = (d, w) => `<svg width="${w || 20}" height="${w || 20}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  user: SVG('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/>', 20),
  bot: SVG('<path d="M5 4l7 9 7-9M12 13v7" stroke-width="2.4"/>', 22),
  warn: SVG('<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4M12 17v.5"/>', 20),
  checks: SVG('<path d="m3 13 4 4 8-9M11 16l1 1 8-9"/>', 15),
  copy: SVG('<rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8"/>', 18),
  up: SVG('<path d="M7 11v9H4v-9h3Zm0 0 4-7c1.6 0 2.5 1.2 2 2.8L12.5 10H19a1.8 1.8 0 0 1 1.8 2.1l-1.3 6.2A2.5 2.5 0 0 1 17 20H7"/>', 18),
  down: SVG('<path d="M7 13V4H4v9h3Zm0 0 4 7c1.6 0 2.5-1.2 2-2.8L12.5 14H19a1.8 1.8 0 0 0 1.8-2.1l-1.3-6.2A2.5 2.5 0 0 0 17 4H7"/>', 18),
  redo: SVG('<path d="M20 5v5h-5M4 19v-5h5"/><path d="M19 10a7.5 7.5 0 0 0-13-2.5M5 14a7.5 7.5 0 0 0 13 2.5"/>', 18),
};
const pad2 = (n) => String(n).padStart(2, '0');
const fmtHour = (t) => { const d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
function el(tag, cls, html) { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
function actBtn(icon, title, onClick, toggle) {
  const b = el('button', 'cm-act', ICON[icon]);
  b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
  if (toggle) b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => onClick(b));
  return b;
}
async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch (_) { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (__) {} ta.remove(); }
  const old = btn.title; btn.title = 'Copiado!'; btn.classList.add('ok'); btn.setAttribute('aria-pressed', 'true');
  setTimeout(() => { btn.title = old; btn.classList.remove('ok'); btn.removeAttribute('aria-pressed'); }, 1400);
}
function addLog(role, text, t) {
  const empty = log.querySelector('.empty');
  if (empty) empty.remove();
  if (typingEl) { typingEl.remove(); typingEl = null; }
  if (typingTimer) { clearInterval(typingTimer); typingTimer = null; }
  const when = t || Date.now();
  const isUser = role === 'user', isErr = role === 'error';
  const row = el('div', 'cm-row ' + (isUser ? 'user' : isErr ? 'error' : 'assistant'));
  const col = el('div', 'cm-col');
  const bubble = el('div', 'cm-bubble');
  const txt = el('span', 'cm-txt'); txt.textContent = text;
  const foot = el('div', 'cm-foot');
  const time = el('time', null); time.textContent = fmtHour(when); foot.appendChild(time);
  if (isUser) {
    bubble.appendChild(el('div', 'cm-av' + (PF.has() ? ' ph' : ''), ICON.user));
    const inner = el('div'); inner.appendChild(txt); inner.appendChild(foot); bubble.appendChild(inner);
    foot.insertAdjacentHTML('beforeend', ICON.checks);
    col.appendChild(bubble); row.appendChild(col);
    lastUserText = String(text).split('\n').filter((l) => !l.startsWith('📎')).join('\n').trim() || lastUserText;
  } else {
    row.appendChild(el('div', 'cm-av', isErr ? ICON.warn : ICON.bot));
    bubble.appendChild(txt); bubble.appendChild(foot);
    col.appendChild(bubble);
    if (!isErr) {
      const acts = el('div', 'cm-actions');
      acts.appendChild(actBtn('copy', 'Copiar resposta', (b) => copyText(text, b)));
      const up = actBtn('up', 'Gostei', () => { const on = up.getAttribute('aria-pressed') !== 'true'; up.setAttribute('aria-pressed', on); if (on) down.setAttribute('aria-pressed', 'false'); }, true);
      const down = actBtn('down', 'Não gostei', () => { const on = down.getAttribute('aria-pressed') !== 'true'; down.setAttribute('aria-pressed', on); if (on) up.setAttribute('aria-pressed', 'false'); }, true);
      acts.appendChild(up); acts.appendChild(down);
      acts.appendChild(actBtn('redo', 'Gerar de novo', () => { if (lastUserText) panel.chat(lastUserText, []); }));
      col.appendChild(acts);
      log.querySelectorAll('.cm-row.last').forEach((r) => r.classList.remove('last'));
      row.classList.add('last');
    }
    row.appendChild(col);
  }
  log.appendChild(row);
  if (isUser) {
    typingEl = el('div', 'cm-row typing assistant');
    typingEl.appendChild(el('div', 'cm-av', ICON.bot));
    const bub = el('div', 'cm-bubble', '<i></i><i></i><i></i>');
    const hint = el('span', 'cm-wait-hint'); hint.hidden = true; bub.appendChild(hint);
    const tb = el('div', 'cm-col'); tb.appendChild(bub);
    typingEl.appendChild(tb); typingEl.setAttribute('aria-label', 'Digitando...');
    log.appendChild(typingEl);
    const startedAt = Date.now();
    typingTimer = setInterval(() => {
      const secs = Math.round((Date.now() - startedAt) / 1000);
      let text = '';
      for (const [after, msg] of WAIT_HINTS) if (secs >= after) text = msg;
      if (text) { hint.hidden = false; hint.textContent = text; }
    }, 1000);
  }
  log.scrollTop = log.scrollHeight;
}
panel.onChatLog((e) => addLog(e.role, e.text, e.t));
panel.onChatClear(() => {
  typingEl = null; lastUserText = '';
  log.innerHTML = '<div class="empty">Conversa limpa ✨</div>';
});

// cabeçalho: relógio e modelo em uso
(() => {
  const D = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'], M = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const tick = () => { const d = new Date(); $('#chatClock').textContent = fmtHour(d); $('#chatDate').textContent = `${D[d.getDay()]}, ${pad2(d.getDate())} de ${M[d.getMonth()]}`; };
  tick(); setInterval(tick, 15000);
  window.refreshChatModel = async () => {
    try { const c = await panel.getConfig(); const m = c.providers[c.provider].model; $('#chatModelName').textContent = 'Modelo: ' + (m || c.provider); }
    catch (_) { $('#chatModelName').textContent = 'Modelo: —'; }
  };
  window.refreshChatModel();
  $('#chatModel').addEventListener('click', () => document.querySelector('.tab[data-tab="ia"]').click());
  $('#chatMic').addEventListener('click', () => document.querySelector('.tab[data-tab="conversa"]').click());
  document.querySelectorAll('#quickRow [data-q]').forEach((b) => b.addEventListener('click', () => panel.chat(b.dataset.q, [])));
  // menu "+"
  const menu = $('#chatMenu'), plus = $('#chatPlus');
  const close = () => { menu.hidden = true; plus.setAttribute('aria-expanded', 'false'); };
  plus.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; plus.setAttribute('aria-expanded', String(!menu.hidden)); });
  menu.addEventListener('click', close);
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
})();
// ----- anexos -----
const MAX_ATTACH = 5, MAX_ATTACH_BYTES = 20 * 1024 * 1024;
let attached = []; // { name, mime, b64, size }
const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
function toB64(buf) {
  const u = new Uint8Array(buf); let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function renderAttach() {
  const row = $('#attachRow');
  row.innerHTML = '';
  row.hidden = !attached.length;
  attached.forEach((f, i) => {
    const c = document.createElement('div'); c.className = 'att-chip';
    const n = document.createElement('span'); n.textContent = '📎 ' + f.name; n.title = f.name; c.appendChild(n);
    const sz = document.createElement('small'); sz.textContent = fmtSize(f.size); c.appendChild(sz);
    const x = document.createElement('button'); x.textContent = '✕'; x.title = 'Remover'; x.onclick = () => { attached.splice(i, 1); renderAttach(); }; c.appendChild(x);
    row.appendChild(c);
  });
}
async function addFiles(list) {
  for (const f of Array.from(list || [])) {
    if (attached.length >= MAX_ATTACH) { addLog('error', `Máximo de ${MAX_ATTACH} arquivos por mensagem.`); break; }
    if (f.size > MAX_ATTACH_BYTES) { addLog('error', `${f.name}: maior que 20 MB.`); continue; }
    try { attached.push({ name: f.name || 'arquivo', mime: f.type || '', b64: toB64(await f.arrayBuffer()), size: f.size }); }
    catch (_) { addLog('error', `${f.name}: não consegui ler o arquivo.`); }
  }
  renderAttach();
}
$('#chatAttach').addEventListener('click', () => $('#chatFile').click());
$('#chatFile').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
$('#chatImg').addEventListener('click', () => $('#chatImgFile').click());
$('#chatImgFile').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
const chatPane = $('#tab-chat');
chatPane.addEventListener('dragover', (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files')) { e.preventDefault(); chatPane.classList.add('drop-on'); } });
chatPane.addEventListener('dragleave', (e) => { if (e.target === chatPane || !chatPane.contains(e.relatedTarget)) chatPane.classList.remove('drop-on'); });
chatPane.addEventListener('drop', (e) => { e.preventDefault(); chatPane.classList.remove('drop-on'); addFiles(e.dataTransfer.files); });
$('#chatInput').addEventListener('paste', (e) => {
  const fs = e.clipboardData && e.clipboardData.files;
  if (fs && fs.length) { e.preventDefault(); addFiles(fs); }
});

// ----- memória de longo prazo -----
let memItems = [];
let memQuery = '';
function renderMem(list) {
  memItems = Array.isArray(list) ? list : [];
  $('#memToggle span').textContent = `Memória (${memItems.length})`;
  const box = $('#memList'); box.innerHTML = '';
  const filtered = memItems.filter((m) => !memQuery || String(m.text).toLocaleLowerCase('pt-BR').includes(memQuery));
  $('#memCount').textContent = `${filtered.length} de ${memItems.length} lembranças · organizadas automaticamente por categoria`;
  if (!filtered.length) { const e = document.createElement('div'); e.className = 'li-empty'; e.textContent = memItems.length ? 'Nenhuma lembrança corresponde à busca.' : 'Ainda não guardei nada sobre você. Diga "lembre que..." no chat ou adicione abaixo.'; box.appendChild(e); }
  filtered.forEach((m) => {
    const r = document.createElement('div'); r.className = 'mem-item';
    const content = document.createElement('div'); content.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px';
    const t = document.createElement('span'); t.textContent = m.text; content.appendChild(t);
    const meta = document.createElement('small'); meta.textContent = `${({pessoal:'Pessoal',preferencias:'Preferências',rotina:'Rotina',trabalho:'Trabalho',projetos:'Projetos',relacionamentos:'Relacionamentos',outros:'Outros'})[m.category] || 'Outros'} · ${new Date(m.updatedAt || m.at).toLocaleDateString('pt-BR')}`; meta.style.color = 'var(--muted)'; content.appendChild(meta); r.appendChild(content);
    const edit = document.createElement('button'); edit.className = 'b'; edit.textContent = 'Editar'; edit.title = 'Editar lembrança';
    // Electron não suporta prompt(): edição direta no próprio item (Enter salva, Esc cancela).
    edit.onclick = () => {
      if (content.querySelector('input.mem-edit')) return;
      const input = document.createElement('input'); input.type = 'text'; input.className = 'mem-edit'; input.value = m.text; input.maxLength = 500; input.setAttribute('aria-label', 'Editar lembrança');
      input.style.cssText = 'width:100%;padding:6px 8px;border:1px solid var(--accent);border-radius:8px;background:var(--bg);color:var(--text);font:inherit;box-sizing:border-box';
      const note = document.createElement('small'); note.style.color = 'var(--err)';
      t.replaceWith(input); content.appendChild(note); edit.textContent = 'Salvar'; input.focus(); input.select();
      const cancel = () => renderMem(memItems);
      const save = async () => {
        const value = input.value.trim();
        if (!value || value === m.text) { cancel(); return; }
        input.disabled = true;
        const result = await panel.memUpdate(m.id, value);
        if (!result.ok) { input.disabled = false; note.textContent = 'Não foi possível atualizar: o texto está repetido ou contém dados sensíveis.'; input.focus(); return; }
        renderMem(result.list || memItems);
      };
      edit.onclick = save;
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { e.preventDefault(); cancel(); } });
    };
    r.appendChild(edit);
    const x = document.createElement('button'); x.className = 'b danger'; x.textContent = '🗑'; x.title = 'Esquecer isto'; x.onclick = () => panel.memRemove(m.id).then(renderMem);
    r.appendChild(x); box.appendChild(r);
  });
}
$('#memSearch').addEventListener('input', (e) => { memQuery = e.target.value.trim().toLocaleLowerCase('pt-BR'); renderMem(memItems); });
$('#memToggle').addEventListener('click', () => {
  const open = $('#memBox').hidden;
  $('#memBox').hidden = !open; log.hidden = open;
  $('#memToggle').classList.toggle('primary', open);
});
async function addMem() {
  const i = $('#memInput'); const t = i.value.trim();
  if (!t) return;
  const r = await panel.memAdd(t);
  if (r.ok) i.value = ''; else { i.value = ''; i.placeholder = 'Já sei isso (ou não posso guardar esse tipo de dado).'; }
  renderMem(r.list);
}
$('#memAdd').addEventListener('click', addMem);
$('#memInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addMem(); });
$('#memClear').addEventListener('click', () => { if (memItems.length && confirm('Apagar tudo que ela guardou sobre você?')) panel.memClear().then(renderMem); });
panel.onMem(renderMem);
panel.memList().then(renderMem);

async function sendChat() {
  const input = $('#chatInput');
  const t = input.value.trim();
  if (!t && !attached.length) return;
  const files = attached.map(({ name, mime, b64 }) => ({ name, mime, b64 }));
  input.value = '';
  attached = []; renderAttach();
  await panel.chat(t, files);
  input.focus();
}
$('#chatSend').addEventListener('click', sendChat);
$('#chatInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) sendChat(); });
