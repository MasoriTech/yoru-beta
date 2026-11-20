// Biblioteca de avatares e itens (.vrm / .glb).
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- biblioteca de avatares e itens -----
const ITEMS = [['none', '🚫', 'Nenhum'], ['phone', '📱', 'Celular'], ['dice', '🎲', 'Dados'], ['mug', '☕', 'Caneca'], ['book', '📖', 'Livro'],
  ['flower', '🌸', 'Flor'], ['balloon', '🎈', 'Balão'], ['lollipop', '🍭', 'Pirulito']];
let lib = { avatars: [], items: [] };
const ITEM_INFO = {
  none: 'Mãos livres.', phone: 'A tela mostra a hora de verdade.', dice: 'Dois dados; use “Rolar os dados” ao lado.',
  mug: 'Uma caneca de café.', book: 'Um livro azul.', flower: 'Balança de leve.', balloon: 'Flutua e balança.', lollipop: 'Pirulito doce.',
};
function mkRow(name, ext, mb, active, onUse, onRemove) {
  const li = document.createElement('div');
  li.className = 'li' + (active ? ' active' : '');
  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.textContent = name;
  if (mb) { const sm = document.createElement('small'); sm.textContent = mb + ' MB'; nm.appendChild(sm); }
  li.appendChild(nm);
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = ext.toUpperCase();
  li.appendChild(tag);
  if (active) { const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = 'Em uso'; li.appendChild(bd); }
  else { const u = document.createElement('button'); u.className = 'b primary'; u.textContent = 'Usar'; u.onclick = onUse; li.appendChild(u); }
  if (onRemove) { const x = document.createElement('button'); x.className = 'b danger'; x.textContent = '🗑'; x.title = 'Remover da biblioteca'; x.onclick = onRemove; li.appendChild(x); }
  return li;
}
// ----- avatares: grade de cartões + painel de detalhes -----
const thumbs = new Map(); // id -> Promise<dataURL|null>
const thumbOf = (id) => { if (!thumbs.has(id)) thumbs.set(id, panel.libThumb('avatars', id).catch(() => null)); return thumbs.get(id); };
let selAv = null, lastAv = null;
function setPh(el, id, ext) {
  el.textContent = ext === 'glb' ? '🧊' : '🧍';
  thumbOf(id).then((u) => { if (u) { el.style.backgroundImage = `url("${u}")`; el.textContent = ''; } });
}
function renderAvatars() {
  const cur = state.avatarFile || 'default';
  const all = [{ id: 'default', name: 'Padrão', ext: 'vrm', mb: 0, builtin: true }, ...lib.avatars];
  if (!selAv || !all.some((a) => a.id === selAv)) selAv = cur;
  const grid = $('#avatarList');
  grid.innerHTML = '';
  all.forEach((a) => {
    const c = document.createElement('button');
    c.className = 'av-card' + (a.id === selAv ? ' sel' : '');
    c.title = a.name;
    const ph = document.createElement('span'); ph.className = 'ph'; setPh(ph, a.id, a.ext); c.appendChild(ph);
    const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = a.name; c.appendChild(cap);
    if (a.id === cur) { const ok = document.createElement('span'); ok.className = 'ok'; ok.textContent = '✓'; c.appendChild(ok); }
    c.onclick = () => { selAv = a.id; renderAvatars(); };
    grid.appendChild(c);
  });
  const a = all.find((x) => x.id === selAv);
  const d = $('#avatarDetail');
  d.innerHTML = '';
  const pv = document.createElement('div'); pv.className = 'av-prev';
  const ph = document.createElement('div'); ph.className = 'ph'; setPh(ph, a.id, a.ext); pv.appendChild(ph); d.appendChild(pv);
  const h = document.createElement('h3'); h.textContent = a.name; d.appendChild(h);
  const meta = document.createElement('div'); meta.className = 'meta';
  if (a.builtin) { const p = document.createElement('span'); p.className = 'pill'; p.textContent = 'Padrão'; meta.appendChild(p); }
  const fmt = document.createElement('span'); fmt.textContent = a.ext.toUpperCase() + (a.mb ? ' · ' + a.mb + ' MB' : ''); meta.appendChild(fmt);
  d.appendChild(meta);
  const use = document.createElement('button');
  if (a.id === cur) { use.className = 'b inuse'; use.textContent = '✓ Em uso'; use.disabled = true; }
  else { use.className = 'b primary'; use.textContent = 'Usar este avatar'; use.onclick = () => panel.set({ avatarFile: a.id }); }
  d.appendChild(use);
  if (!a.builtin) {
    const rm = document.createElement('button'); rm.className = 'b danger'; rm.textContent = '🗑 Remover da biblioteca';
    rm.onclick = () => { if (confirm(`Remover "${a.name}" da biblioteca?`)) { thumbs.delete(a.id); panel.libRemove('avatars', a.id).then((l) => { lib = l; renderLib(); }); } };
    d.appendChild(rm);
  }
}
let lastLibKey = null;
function renderLib() {
  lastLibKey = (state.avatarFile || '') + '|' + (state.item || '') + '|' + (state.itemHand || '');
  if ((state.avatarFile || 'default') !== lastAv) { lastAv = state.avatarFile || 'default'; selAv = null; } // trocou o avatar em uso: o detalhe acompanha
  renderAvatars();
  renderItems();
}
// ----- itens: cartões com miniatura 3D (como os avatares) + painel de detalhes -----
// A miniatura é desenhada pela janela do avatar (tem o three.js). Falhou ou ainda não ficou pronta? Fica o ícone e tenta de novo.
const ithumbs = new Map(); // id -> Promise<dataURL> (só guarda sucesso)
function itemThumbOf(id) {
  if (!ithumbs.has(id)) {
    ithumbs.set(id, panel.libThumb('items', id).catch(() => null).then((u) => { if (!u) ithumbs.delete(id); return u; }));
  }
  return ithumbs.get(id);
}
function setItemPh(el, id, icon, tries = 0) {
  el.textContent = icon;
  el.classList.add('skel');
  itemThumbOf(id).then((u) => {
    el.classList.remove('skel');
    if (u) { el.style.backgroundImage = `url("${u}")`; el.textContent = ''; }
    else if (tries < 3 && el.isConnected) setTimeout(() => { if (el.isConnected) setItemPh(el, id, icon, tries + 1); }, 4000);
  });
}
let selItem = null, lastItem = null;
function itemCard(it, cur) {
  const c = document.createElement('button');
  c.type = 'button';
  c.className = 'av-card item-card' + (it.key === selItem ? ' sel' : '');
  c.title = it.info ? `${it.name}: ${it.info}` : it.name;
  c.setAttribute('aria-pressed', it.key === selItem ? 'true' : 'false');
  const ph = document.createElement('span'); ph.className = 'ph';
  if (it.id) setItemPh(ph, it.id, it.icon); else ph.textContent = it.icon;
  c.appendChild(ph);
  const cap = document.createElement('span'); cap.className = 'cap'; cap.textContent = it.name; c.appendChild(cap);
  if (it.key === cur && cur !== 'none') { const h = document.createElement('span'); h.className = 'hold'; h.textContent = 'Na mão'; c.appendChild(h); }
  c.onclick = () => { selItem = it.key; renderItems(); };
  c.ondblclick = () => panel.set({ item: it.key });
  return c;
}
function renderItems() {
  const cur = state.item || 'none';
  const hand = state.itemHand === 'left' ? 'left' : 'right';
  if (cur !== lastItem) { lastItem = cur; selItem = null; } // trocou o item na mão: o detalhe acompanha
  const builtin = ITEMS.map(([key, icon, name]) => ({ key, id: key === 'none' ? null : key, icon, name, info: ITEM_INFO[key] || '', builtin: true }));
  const mine = lib.items.map((it) => ({ key: 'custom:' + it.id, id: it.id, icon: '🧊', name: it.name.replace(/\.[^.]+$/, ''), info: '', ext: it.ext, mb: it.mb, file: it.name }));
  const all = [...builtin, ...mine];
  if (!selItem || !all.some((x) => x.key === selItem)) selItem = all.some((x) => x.key === cur) ? cur : 'none';

  const grid = $('#itemGrid');
  grid.innerHTML = '';
  builtin.forEach((it) => grid.appendChild(itemCard(it, cur)));
  $('#itemBuiltinCount').textContent = `${builtin.length - 1} itens`;

  const il = $('#itemList');
  il.innerHTML = '';
  $('#itemCount').textContent = mine.length ? `${mine.length} ${mine.length === 1 ? 'item' : 'itens'}` : '';
  if (!mine.length) {
    const e = document.createElement('div'); e.className = 'li-empty hint';
    e.textContent = 'Nenhum item seu ainda. Arraste um arquivo .glb para cá ou use o botão abaixo.';
    il.appendChild(e);
  }
  mine.forEach((it) => il.appendChild(itemCard(it, cur)));

  // detalhes do item escolhido
  const it = all.find((x) => x.key === selItem);
  const d = $('#itemDetail');
  d.innerHTML = '';
  const pv = document.createElement('div'); pv.className = 'item-prev';
  const ph = document.createElement('div'); ph.className = 'ph';
  if (it.id) setItemPh(ph, it.id, it.icon); else ph.textContent = it.icon;
  pv.appendChild(ph); d.appendChild(pv);
  const h = document.createElement('h3'); h.textContent = it.key === 'none' ? 'Mãos livres' : it.name; d.appendChild(h);
  const meta = document.createElement('div'); meta.className = 'meta';
  if (it.builtin && it.key !== 'none') { const p = document.createElement('span'); p.className = 'pill'; p.textContent = 'Embutido'; meta.appendChild(p); }
  if (!it.builtin) { const f = document.createElement('span'); f.textContent = it.ext.toUpperCase() + (it.mb ? ' · ' + it.mb + ' MB' : ''); meta.appendChild(f); }
  if (meta.children.length) d.appendChild(meta);
  const info = document.createElement('p'); info.className = 'item-desc';
  info.textContent = it.key === 'none' ? 'Escolha um item ao lado para ela segurar.' : it.builtin ? it.info : 'Item seu. Ele é redimensionado para caber na mão.';
  d.appendChild(info);
  const use = document.createElement('button');
  if (it.key === cur) {
    use.className = 'b inuse'; use.disabled = true; use.textContent = it.key === 'none' ? '✓ Mãos livres' : '✓ Na mão';
    d.appendChild(use);
    if (cur !== 'none') { const drop = document.createElement('button'); drop.className = 'b'; drop.textContent = 'Soltar'; drop.onclick = () => panel.set({ item: 'none' }); d.appendChild(drop); }
  } else {
    use.className = 'b primary'; use.textContent = it.key === 'none' ? 'Soltar o item' : 'Segurar este item';
    use.onclick = () => panel.set({ item: it.key });
    d.appendChild(use);
  }
  if (!it.builtin) {
    const rm = document.createElement('button'); rm.className = 'b danger'; rm.textContent = '🗑 Remover da biblioteca';
    rm.onclick = () => { if (confirm(`Remover "${it.file}" da biblioteca?`)) { ithumbs.delete(it.id); panel.libRemove('items', it.id).then((l) => { lib = l; renderLib(); }); } };
    d.appendChild(rm);
  }

  // ajustes: só fazem sentido com algo na mão
  $('#itemAdjust').classList.toggle('idle', cur === 'none');
  document.querySelectorAll('[data-hand]').forEach((b) => b.classList.toggle('sel', b.dataset.hand === hand));
  const av = lib.avatars.find((a) => a.id === state.avatarFile);
  const noHands = !!av && av.ext === 'glb';
  $('#itemAdjHint').textContent = cur === 'none' ? 'Escolha um item para liberar os ajustes.'
    : noHands ? 'Seu avatar é um .glb (sem mãos): o item flutua ao lado dele, no lado escolhido.'
    : `Ela segura o item na mão ${hand === 'left' ? 'esquerda' : 'direita'}.`;
}
async function addToLib(kind, statusSel) {
  const st = $(statusSel);
  st.className = 'status';
  st.textContent = 'Escolha o arquivo na janela que abriu...';
  report(await panel.libAdd(kind), st);
}
function report(r, st) {
  if (r.lib) lib = r.lib;
  const skipped = r.skipped && r.skipped.length ? ` Ignorado: ${r.skipped.join('; ')}` : '';
  if (r.canceled) { st.className = 'status'; st.textContent = ''; }
  else if (r.ok) { st.className = 'status ok'; st.textContent = `Adicionado: ${r.added.join(', ')}` + (r.added.length === 1 ? ' (já em uso).' : '.') + skipped; }
  else { st.className = 'status bad'; st.textContent = 'Não consegui adicionar: ' + (r.error || 'erro desconhecido'); }
  renderLib();
}
// arrastar arquivos .vrm/.glb para o cartão da biblioteca
function enableDrop(card, kind, statusSel) {
  card.addEventListener('dragover', (e) => { e.preventDefault(); card.classList.add('drop-on'); });
  card.addEventListener('dragleave', () => card.classList.remove('drop-on'));
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drop-on');
    const st = $(statusSel);
    st.className = 'status';
    st.textContent = 'Importando...';
    report(await panel.libAddFiles(kind, e.dataTransfer.files), st);
  });
}
enableDrop($('#avatarList').closest('.card'), 'avatars', '#avatarStatus');
enableDrop($('#itemList').closest('.card'), 'items', '#itemStatus');
// soltar um arquivo fora dos cartões não pode abrir o arquivo dentro da janela
['dragover', 'drop'].forEach((ev) => document.addEventListener(ev, (e) => e.preventDefault()));
$('#avatarAdd').addEventListener('click', () => addToLib('avatars', '#avatarStatus'));
$('#itemAdd').addEventListener('click', () => addToLib('items', '#itemStatus'));
$('#avatarFolder').addEventListener('click', () => panel.libOpen('avatars'));
$('#itemFolder').addEventListener('click', () => panel.libOpen('items'));
panel.libList().then((l) => { lib = l; renderLib(); });
