// Aba Perfil.
// Script comum (não é módulo): compartilha o escopo global com os outros panel-*.js, carregados em ordem pelo panel.html.
// ----- perfil -----
const PF = {};
(() => {
  const MON = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const OPT = ['location', 'job', 'company', 'goals', 'prefs', 'health'];
  const blank = () => ({ name: '', nickname: '', birth: '', gender: '', height: null, weight: null, about: '', photo: '',
    opt: { location: '', job: '', company: '', goals: '', prefs: '', health: '' }, interests: [], track: { weight: false, workout: false, meals: false }, weightGoal: null, useInPrompt: true, createdAt: 0 });
  let saved = blank(), draft = blank();
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const numOrNull = (v) => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
  const ageOf = (b) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b || '')) return null;
    const [y, m, d] = b.split('-').map(Number), n = new Date();
    let a = n.getFullYear() - y; if (n.getMonth() + 1 < m || (n.getMonth() + 1 === m && n.getDate() < d)) a--;
    return a >= 0 && a < 130 ? a : null;
  };
  const same = () => JSON.stringify(draft) === JSON.stringify(saved);
  function say(t, bad) { const s = $('#pfStatus'); s.textContent = t || ''; s.className = 'pf-status' + (bad ? ' bad' : ''); }
  function dirty() { $('#pfSave').disabled = same(); if (!same()) say(''); }

  // reflete o rascunho nos elementos que dependem dele (sem mexer nos campos de digitação)
  function paint() {
    const d = draft;
    $('#pfNameShow').textContent = d.name || d.nickname || 'Seu nome';
    $('#pfBadge').textContent = d.gender === 'f' ? 'Usuária da Yoru' : d.gender === 'm' ? 'Usuário da Yoru' : 'Usuário(a) da Yoru';
    const c = saved.createdAt; $('#pfSince').textContent = c ? `Membro desde: ${pad2(new Date(c).getDate())} de ${MON[new Date(c).getMonth()]} de ${new Date(c).getFullYear()}` : 'Perfil ainda não salvo';
    const a = ageOf(d.birth); $('#pfAge').value = a == null ? '' : a + (a === 1 ? ' ano' : ' anos'); $('#pfAge').placeholder = '—';
    $('#pfAboutN').textContent = d.about.length + '/300';
    const ph = $('#pfPhoto'); ph.classList.toggle('has', !!d.photo); ph.style.backgroundImage = d.photo ? `url("${d.photo}")` : '';
    $('#pfPhotoDel').hidden = !d.photo;
    OPT.forEach((k) => {
      const row = document.querySelector(`.pf-opt[data-opt="${k}"]`);
      row.classList.toggle('has', !!d.opt[k]);
      row.querySelector('.pf-opt-v').textContent = d.opt[k];
    });
    renderChips();
  }
  // preenche os campos a partir do rascunho (ao abrir, cancelar ou salvar)
  function fill() {
    const d = draft;
    $('#pfName').value = d.name; $('#pfNick').value = d.nickname; $('#pfBirth').value = d.birth; $('#pfGender').value = d.gender;
    $('#pfHeight').value = d.height == null ? '' : d.height; $('#pfWeight').value = d.weight == null ? '' : d.weight;
    $('#pfAbout').value = d.about; $('#pfGoalW').value = d.weightGoal == null ? '' : d.weightGoal;
    $('#pfTrackW').checked = d.track.weight; $('#pfTrackT').checked = d.track.workout; $('#pfTrackM').checked = d.track.meals; $('#pfUse').checked = d.useInPrompt;
    OPT.forEach((k) => { document.querySelector(`.pf-opt[data-opt="${k}"] input`).value = d.opt[k]; });
    paint(); dirty();
  }
  function renderChips() {
    const box = $('#pfChips'); box.innerHTML = '';
    draft.interests.forEach((t, i) => {
      const c = document.createElement('span'); c.className = 'pf-chip';
      const l = document.createElement('span'); l.textContent = t; c.appendChild(l);
      const x = document.createElement('button'); x.type = 'button'; x.title = 'Remover ' + t; x.setAttribute('aria-label', 'Remover ' + t); x.innerHTML = SVG('<path d="M6 6l12 12M18 6 6 18"/>', 12);
      x.onclick = () => { draft.interests.splice(i, 1); renderChips(); dirty(); };
      c.appendChild(x); box.appendChild(c);
    });
    if (draft.interests.length >= 12) return;
    const add = document.createElement('button'); add.type = 'button'; add.className = 'pf-add';
    add.innerHTML = SVG('<path d="M12 5v14M5 12h14"/>', 16) + 'Adicionar';
    add.onclick = () => {
      const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'pf-addin'; inp.maxLength = 24; inp.placeholder = 'Ex.: Música'; inp.setAttribute('aria-label', 'Novo interesse');
      const done = (ok) => {
        const v = inp.value.replace(/\s+/g, ' ').trim();
        if (ok && v && !draft.interests.some((x) => x.toLowerCase() === v.toLowerCase())) draft.interests.push(v);
        renderChips(); dirty();
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') done(false); });
      inp.addEventListener('blur', () => { if (inp.isConnected) done(true); });
      add.replaceWith(inp); inp.focus();
    };
    box.appendChild(add);
  }

  // ----- eventos dos campos -----
  const bind = (sel, fn, ev) => $(sel).addEventListener(ev || 'input', () => { fn($(sel)); paint(); dirty(); });
  bind('#pfName', (e) => { draft.name = e.value; });
  bind('#pfNick', (e) => { draft.nickname = e.value; });
  bind('#pfBirth', (e) => { draft.birth = e.value; });
  bind('#pfGender', (e) => { draft.gender = e.value; }, 'change');
  bind('#pfHeight', (e) => { draft.height = numOrNull(e.value); });
  bind('#pfWeight', (e) => { draft.weight = numOrNull(e.value); });
  bind('#pfAbout', (e) => { draft.about = e.value; });
  bind('#pfGoalW', (e) => { draft.weightGoal = numOrNull(e.value); });
  bind('#pfTrackW', (e) => { draft.track.weight = e.checked; }, 'change');
  bind('#pfTrackT', (e) => { draft.track.workout = e.checked; }, 'change');
  bind('#pfTrackM', (e) => { draft.track.meals = e.checked; }, 'change');
  bind('#pfUse', (e) => { draft.useInPrompt = e.checked; }, 'change');
  $('#pfNameEdit').addEventListener('click', () => { $('#pfName').focus(); $('#pfName').select(); });
  document.querySelectorAll('.pf-opt').forEach((row) => {
    const k = row.dataset.opt, head = row.querySelector('.pf-opt-h'), body = row.querySelector('.pf-opt-b'), inp = row.querySelector('input');
    head.addEventListener('click', () => {
      const open = body.hidden; body.hidden = !open; row.classList.toggle('open', open); head.setAttribute('aria-expanded', String(open));
      if (open) inp.focus();
    });
    inp.addEventListener('input', () => { draft.opt[k] = inp.value; paint(); dirty(); });
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') head.click(); });
  });

  // ----- foto: recorta em quadrado e reduz para 320 px (fica leve no profile.json) -----
  $('#pfCam').addEventListener('click', () => $('#pfFile').click());
  $('#pfPhoto').addEventListener('dblclick', () => $('#pfFile').click());
  $('#pfPhotoDel').addEventListener('click', () => { draft.photo = ''; paint(); dirty(); });
  $('#pfFile').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f);
      const S = 320, side = Math.min(bmp.width, bmp.height), cv = document.createElement('canvas'); cv.width = cv.height = S;
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
      ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, S, S);
      draft.photo = cv.toDataURL('image/jpeg', 0.85); paint(); dirty(); say('');
    } catch (_) { say('Não consegui abrir essa imagem.', true); }
  });

  // ----- salvar / cancelar -----
  $('#pfSave').addEventListener('click', async () => {
    if (same()) return;
    $('#pfSave').disabled = true;
    try { saved = await panel.profileSet(draft); draft = clone(saved); fill(); applyProfile(); say('Perfil salvo ✓'); setTimeout(() => { if ($('#pfStatus').textContent === 'Perfil salvo ✓') say(''); }, 3000); }
    catch (_) { say('Não consegui salvar. Tente de novo.', true); $('#pfSave').disabled = false; }
  });
  $('#pfCancel').addEventListener('click', () => { draft = clone(saved); fill(); say(''); });

  // ----- uso do perfil no resto do painel (saudação e foto do chat) -----
  function applyProfile() {
    const n = saved.nickname || saved.name;
    const h = $('#chatHello'); if (h) h.textContent = n ? `Oi, ${n} 👋` : 'Oi 👋';
    document.documentElement.style.setProperty('--user-photo', saved.photo ? `url("${saved.photo}")` : 'none');
    document.querySelectorAll('.cm-row.user .cm-av').forEach((a) => a.classList.toggle('ph', !!saved.photo));
  }
  PF.has = () => !!saved.photo;
  PF.apply = applyProfile;
  const load = (p) => { saved = Object.assign(blank(), p || {}); if (same() || !dirtyNow()) draft = clone(saved); fill(); applyProfile(); };
  const dirtyNow = () => document.querySelector('#tab-perfil').contains(document.activeElement) && !same();
  panel.onProfile((p) => { if (document.querySelector('#tab-perfil').contains(document.activeElement)) { saved = Object.assign(blank(), p || {}); paint(); dirty(); applyProfile(); } else load(p); });
  panel.profileGet().then(load);
})();
