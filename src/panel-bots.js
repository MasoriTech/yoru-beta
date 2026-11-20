(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const STORE_BOTS = 'yoru.bots.v1';
  const STORE_RULES = 'yoru.botRules.v1';
  const STORE_WA = 'yoru.botWa.v1'; // só campos não secretos; o token nunca é gravado
  const CHANNELS = { whatsapp: 'WhatsApp', web: 'Site (futuro)', telegram: 'Telegram (futuro)' };
  const LIMITS = { name: 60, persona: 1000, instructions: 8000, keyword: 80, reply: 1000 };

  const safeRead = (key) => { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  const safeWrite = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; } };
  const readWa = () => { try { const v = JSON.parse(localStorage.getItem(STORE_WA) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

  let bots = safeRead(STORE_BOTS), rules = safeRead(STORE_RULES), editingId = null;
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `bot-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const announce = (el, msg, kind = '') => { if (!el) return; el.textContent = msg; el.dataset.state = kind; };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const btn = (label, onClick, cls) => { const b = el('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };

  // ---------- aviso discreto (substitui alert para confirmações de sucesso) ----------
  let toastTimer = 0;
  const toast = (msg, kind = 'ok') => {
    let t = $('botToast');
    if (!t) {
      t = el('div'); t.id = 'botToast'; t.setAttribute('role', 'status'); t.setAttribute('aria-live', 'polite');
      Object.assign(t.style, { position: 'fixed', right: '22px', bottom: '22px', zIndex: '50', maxWidth: '360px', padding: '10px 14px', border: '1px solid var(--line)', borderLeft: '3px solid var(--accent)', borderRadius: '10px', background: 'var(--card)', color: 'var(--text)', fontSize: '13px', boxShadow: '0 8px 28px rgba(0,0,0,.35)', transition: 'opacity .2s', pointerEvents: 'none' });
      document.body.append(t);
    }
    t.textContent = msg; t.style.borderLeftColor = kind === 'error' ? 'var(--err)' : 'var(--ok)'; t.style.opacity = '1';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 3200);
  };

  // ---------- navegação interna ----------
  const go = (name) => {
    document.querySelector('.tab[data-tab="bots"]')?.click();
    document.querySelector(`#tab-bots .subtab[data-sub="${name}"]`)?.click();
  };
  $('botsGoCreate')?.addEventListener('click', () => { resetForm(); go('meusbots'); $('botName')?.focus(); });
  $('botsGoWhatsapp')?.addEventListener('click', () => go('whatsapp'));
  document.querySelectorAll('#tab-bots [data-bots-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.botsGo)));

  // ---------- contadores de caracteres nos campos longos ----------
  const counter = (inputId, max) => {
    const input = $(inputId); if (!input) return () => {};
    const label = input.closest('label'); if (!label) return () => {};
    const c = el('small', 'muted'); c.style.alignSelf = 'flex-end'; c.style.fontWeight = '400'; label.append(c);
    const upd = () => { c.textContent = `${input.value.length.toLocaleString('pt-BR')} / ${max.toLocaleString('pt-BR')}`; c.style.color = input.value.length > max ? 'var(--err)' : ''; };
    input.addEventListener('input', upd); upd(); return upd;
  };
  const updName = counter('botName', LIMITS.name);
  const updPersona = counter('botPersona', LIMITS.persona);
  const updInstr = counter('botInstructions', LIMITS.instructions);

  // ---------- WhatsApp ----------
  const creds = () => ({ phoneId: $('botWaPhoneId').value.trim(), token: $('botWaToken').value.trim(), version: $('botWaVersion').value.trim() });
  const status = (msg, kind = '') => announce($('botWaStatus'), msg, kind);
  const busy = (button, on, label) => { button.disabled = on; if (on) { button.dataset.oldLabel = button.textContent; button.textContent = label; } else { button.textContent = button.dataset.oldLabel || button.textContent; } };
  const WA_FIELDS = { botWaPhoneId: 'phoneId', botWaWabaId: 'wabaId', botWaVersion: 'version' };
  { const saved = readWa(); Object.entries(WA_FIELDS).forEach(([id, key]) => { if (saved[key] && $(id)) $(id).value = String(saved[key]).slice(0, 80); }); }
  const saveWa = () => { const o = {}; Object.entries(WA_FIELDS).forEach(([id, key]) => { o[key] = $(id).value.trim(); }); safeWrite(STORE_WA, o); };
  Object.keys(WA_FIELDS).forEach((id) => $(id)?.addEventListener('change', saveWa));
  const needToken = () => { const c = creds(); return !c.phoneId || !c.token; };

  $('botWaTest')?.addEventListener('click', async () => {
    const button = $('botWaTest');
    if (needToken()) { status('Informe o Phone Number ID e o token de acesso.', 'error'); (creds().phoneId ? $('botWaToken') : $('botWaPhoneId')).focus(); return; }
    busy(button, true, 'Testando...'); saveWa();
    try { const r = await panel.botWaTest(creds()); status(r.ok ? `Conectado: ${r.name} · ${r.displayPhone || 'telefone sem identificação'} · Qualidade: ${r.quality} · Verificação: ${r.verification}` : `Não foi possível conectar: ${r.error}${r.code ? ` (código ${r.code})` : ''}`, r.ok ? 'ok' : 'error'); }
    catch (e) { status(`Erro ao consultar a Meta: ${e.message}`, 'error'); }
    finally { busy(button, false); }
  });
  $('botWaSend')?.addEventListener('click', async () => {
    const button = $('botWaSend'); const to = $('botWaTo').value.trim();
    if (needToken() || !to) { status('Preencha Phone Number ID, token e telefone de destino.', 'error'); return; }
    if (!/^\d{8,15}$/.test(to.replace(/[\s()+-]/g, ''))) { status('Telefone inválido. Use o formato internacional, só números (ex.: 5511999999999).', 'error'); $('botWaTo').focus(); return; }
    if (!confirm('Enviar uma mensagem real de teste para o número informado?')) return;
    busy(button, true, 'Enviando...'); saveWa();
    try { const r = await panel.botWaSend({ ...creds(), to }); status(r.ok ? `Mensagem aceita pela Meta. ID: ${r.id || 'não informado'}. A entrega final depende do status retornado por webhook.` : `Falha no envio: ${r.error}${r.code ? ` (código ${r.code})` : ''}`, r.ok ? 'ok' : 'error'); }
    catch (e) { status(`Erro no envio: ${e.message}`, 'error'); }
    finally { busy(button, false); }
  });
  $('botWaClear')?.addEventListener('click', () => { ['botWaPhoneId', 'botWaWabaId', 'botWaToken', 'botWaTo'].forEach((k) => { $(k).value = ''; }); saveWa(); status('Campos limpos.'); });

  // ---------- visão geral ----------
  const renderMetrics = () => {
    const set = (id, n) => { const n0 = $(id); if (n0) n0.textContent = String(n); };
    set('botMetricTotal', bots.length); set('botMetricActive', bots.filter((b) => b.active).length); set('botMetricRules', rules.length);
  };

  // ---------- construtor ----------
  const resetForm = () => {
    editingId = null;
    ['botName', 'botPersona', 'botInstructions'].forEach((k) => { $(k).value = ''; });
    $('botChannel').value = 'whatsapp'; $('botSave').textContent = 'Salvar bot';
    const t = $('botFormTitle'); if (t) t.textContent = 'Construtor de bots';
    updName(); updPersona(); updInstr();
  };
  const startEdit = (bot) => {
    editingId = bot.id; $('botName').value = bot.name; $('botChannel').value = bot.channel; $('botPersona').value = bot.persona || ''; $('botInstructions').value = bot.instructions || '';
    $('botSave').textContent = 'Salvar alterações';
    const t = $('botFormTitle'); if (t) t.textContent = `Editando: ${bot.name}`;
    updName(); updPersona(); updInstr(); go('meusbots'); $('botName').focus();
  };
  const persistBots = () => { if (!safeWrite(STORE_BOTS, bots)) { toast('Não foi possível salvar os bots neste perfil do Yoru.', 'error'); return false; } renderBots(); syncWaWeb(); return true; };
  const persistRules = () => { if (!safeWrite(STORE_RULES, rules)) { toast('Não foi possível salvar as regras neste perfil do Yoru.', 'error'); return false; } renderRules(); syncWaWeb(); return true; };

  const fmtDate = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }); };
  const emptyState = (title, text) => { const d = el('div', 'bot-empty'); d.append(el('strong', '', title), document.createTextNode(text)); return d; };

  const renderBots = () => {
    renderMetrics();
    const host = $('botSavedList'); host.replaceChildren();
    const q = norm($('botSearch')?.value.trim()); const f = $('botStatusFilter')?.value || 'all';
    const list = bots.filter((b) => (f === 'all' || (f === 'active') === !!b.active) && (!q || norm(`${b.name} ${CHANNELS[b.channel] || b.channel} ${b.persona}`).includes(q)));
    if (!bots.length) host.append(emptyState('Nenhum bot cadastrado', 'Preencha o construtor ao lado para criar seu primeiro assistente.'));
    else if (!list.length) host.append(emptyState('Nada encontrado', 'Nenhum bot corresponde à busca ou ao filtro atual.'));
    else {
      const count = el('p', 'muted', `${list.length} de ${bots.length} ${bots.length === 1 ? 'bot' : 'bots'}`); count.style.margin = '4px 0 0'; count.style.fontSize = '11px'; host.append(count);
    }
    list.forEach((bot) => {
      const card = el('article', 'bot-item'); if (bot.id === editingId) card.style.borderColor = 'var(--accent)';
      const head = el('div', 'bot-item-head');
      const state = el('span', 'bot-state', bot.active ? '● Ativo' : '○ Pausado'); state.dataset.active = String(!!bot.active);
      head.append(el('strong', '', bot.name), state);
      const meta = el('p', '', `${CHANNELS[bot.channel] || bot.channel}${bot.createdAt && fmtDate(bot.createdAt) ? ` · criado em ${fmtDate(bot.createdAt)}` : ''}`); meta.style.fontSize = '12px'; meta.style.color = 'var(--muted)';
      const persona = el('p', '', bot.persona || 'Personalidade não definida');
      const instr = el('p', 'muted', bot.instructions || 'Sem instruções adicionais.');
      Object.assign(instr.style, { display: '-webkit-box', webkitLineClamp: '3', webkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' });
      instr.style.setProperty('-webkit-line-clamp', '3'); instr.style.setProperty('-webkit-box-orient', 'vertical');
      const actions = el('div', 'bot-actions');
      actions.append(
        btn('Editar', () => startEdit(bot)),
        btn(bot.active ? 'Pausar' : 'Ativar', () => { bot.active = !bot.active; persistBots(); }),
        btn('Simular', () => { go('simulador'); $('botSimSelect').value = bot.id; $('botSimMessage').focus(); }),
        btn('Duplicar', () => { bots.push({ ...bot, id: uid(), name: `${bot.name} (cópia)`.slice(0, LIMITS.name), active: false, createdAt: new Date().toISOString() }); if (persistBots()) toast('Bot duplicado (pausado).'); }),
        btn('Excluir', () => { if (!confirm(`Excluir o bot “${bot.name}”?`)) return; bots = bots.filter((x) => x.id !== bot.id); if (editingId === bot.id) resetForm(); persistBots(); }),
      );
      card.append(head, meta, persona, instr, actions); host.append(card);
    });
    const select = $('botSimSelect');
    if (select) {
      const previous = select.value; select.replaceChildren();
      const first = el('option', '', bots.length ? 'Selecione um bot' : 'Crie um bot primeiro'); first.value = ''; select.append(first);
      bots.forEach((bot) => { const opt = el('option', '', `${bot.name}${bot.active ? '' : ' (pausado)'}`); opt.value = bot.id; select.append(opt); });
      if (bots.some((b) => b.id === previous)) select.value = previous;
    }
  };

  const saveBot = () => {
    const name = $('botName').value.trim(), persona = $('botPersona').value.trim(), instructions = $('botInstructions').value.trim();
    if (!name) { $('botName').focus(); toast('Dê um nome ao bot.', 'error'); return; }
    if (name.length > LIMITS.name || persona.length > LIMITS.persona || instructions.length > LIMITS.instructions) { toast('Reduza o texto: nome até 60, personalidade até 1.000 e instruções até 8.000 caracteres.', 'error'); return; }
    const channel = $('botChannel').value;
    const clash = bots.some((b) => b.id !== editingId && norm(b.name) === norm(name));
    if (clash && !confirm(`Já existe um bot chamado “${name}”. Salvar mesmo assim?`)) return;
    if (editingId) { const bot = bots.find((x) => x.id === editingId); if (bot) Object.assign(bot, { name, channel, persona, instructions }); }
    else bots.push({ id: uid(), name, channel, persona, instructions, active: false, createdAt: new Date().toISOString() });
    const wasEditing = !!editingId;
    if (persistBots()) { resetForm(); toast(wasEditing ? 'Alterações salvas.' : 'Bot criado. Ele começa pausado; ative-o na lista.'); }
  };
  $('botSave')?.addEventListener('click', saveBot);
  $('botNew')?.addEventListener('click', () => { resetForm(); $('botName').focus(); });
  $('botFormCancel')?.addEventListener('click', () => { resetForm(); renderBots(); });
  $('botName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveBot(); } });
  ['botPersona', 'botInstructions'].forEach((k) => $(k)?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveBot(); } }));
  $('botSearch')?.addEventListener('input', renderBots);
  $('botStatusFilter')?.addEventListener('change', renderBots);

  // ---------- regras ----------
  const renderRules = () => {
    renderMetrics();
    const host = $('botRulesList'); host.replaceChildren();
    if (!rules.length) { host.append(emptyState('Nenhuma regra cadastrada', 'Adicione uma palavra-chave e a resposta sugerida acima.')); return; }
    rules.forEach((rule) => {
      const card = el('article', 'bot-rule'); const p = el('p');
      p.append(document.createTextNode('Se a mensagem contiver '), el('strong', '', `“${rule.keyword}”`), document.createTextNode(', sugerir: '), el('span', '', rule.reply));
      const acts = el('div', 'bot-actions'); acts.style.marginTop = '0'; acts.style.flexShrink = '0';
      acts.append(
        btn('Editar', () => { $('botKeyword').value = rule.keyword; $('botReply').value = rule.reply; rules = rules.filter((x) => x.id !== rule.id); persistRules(); $('botKeyword').focus(); }),
        btn('Remover', () => { rules = rules.filter((x) => x.id !== rule.id); persistRules(); }),
      );
      card.append(p, acts); host.append(card);
    });
  };
  const addRule = () => {
    const keyword = $('botKeyword').value.trim(), reply = $('botReply').value.trim();
    if (!keyword || !reply) { toast('Preencha a palavra-chave e a resposta sugerida.', 'error'); ($('botKeyword').value.trim() ? $('botReply') : $('botKeyword')).focus(); return; }
    if (keyword.length > LIMITS.keyword || reply.length > LIMITS.reply) { toast('Palavra-chave até 80 caracteres e resposta até 1.000.', 'error'); return; }
    if (rules.some((r) => norm(r.keyword) === norm(keyword))) { toast(`Já existe uma regra para “${keyword}”. Remova ou edite a existente.`, 'error'); return; }
    rules.push({ id: uid(), keyword, reply });
    if (persistRules()) { $('botKeyword').value = ''; $('botReply').value = ''; $('botKeyword').focus(); }
  };
  $('botRuleAdd')?.addEventListener('click', addRule);
  ['botKeyword', 'botReply'].forEach((k) => $(k)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRule(); } }));

  // ---------- simulador ----------
  const runSim = () => {
    const bot = bots.find((b) => b.id === $('botSimSelect').value);
    const message = $('botSimMessage').value.trim(); const result = $('botSimResult');
    result.style.whiteSpace = 'pre-wrap';
    if (!bot) { result.textContent = 'Selecione um bot para simular.'; return; }
    if (!message) { result.textContent = 'Digite uma mensagem de exemplo.'; return; }
    const text = norm(message);
    const matches = rules.filter((r) => text.includes(norm(r.keyword)));
    const lines = [`Bot: ${bot.name} (${bot.active ? 'ativo' : 'pausado'}) · ${CHANNELS[bot.channel] || bot.channel}`];
    if (matches.length) {
      lines.push(`${matches.length} ${matches.length === 1 ? 'regra acionada' : 'regras acionadas'}; a primeira seria usada:`, '');
      matches.forEach((m, i) => lines.push(`${i === 0 ? '▶' : '·'} “${m.keyword}” → ${m.reply}`));
    } else {
      lines.push('Nenhuma palavra-chave correspondeu.', `Personalidade: ${bot.persona || 'não definida'}`, `Instruções cadastradas: ${bot.instructions || 'nenhuma'}`, '', 'Esta é apenas uma prévia local; configure regras para obter respostas de exemplo.');
    }
    if (!bot.active) lines.push('', 'Aviso: este bot está pausado e não responderia em conversas reais.');
    result.textContent = lines.join('\n');
  };
  $('botSimRun')?.addEventListener('click', runSim);
  $('botSimMessage')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runSim(); } });

  // ---------- backup ----------
  $('botExport')?.addEventListener('click', () => {
    const payload = { format: 'yoru-bots-backup', version: 1, exportedAt: new Date().toISOString(), bots, rules };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `yoru-bots-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Backup exportado (${bots.length} bots, ${rules.length} regras).`);
  });
  $('botImport')?.addEventListener('click', () => $('botImportFile').click());
  $('botImportFile')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('O arquivo deve ter até 1 MB.');
      const data = JSON.parse(await file.text());
      if (data.format !== 'yoru-bots-backup' || data.version !== 1 || !Array.isArray(data.bots) || !Array.isArray(data.rules)) throw new Error('Formato de backup não reconhecido.');
      const seen = new Set();
      const cleanBots = data.bots.filter((b) => b && typeof b.name === 'string' && typeof b.id === 'string' && !seen.has(b.id) && seen.add(b.id)).slice(0, 200).map((b) => ({ id: b.id, name: b.name.slice(0, LIMITS.name), channel: Object.hasOwn(CHANNELS, b.channel) ? b.channel : 'whatsapp', persona: String(b.persona || '').slice(0, LIMITS.persona), instructions: String(b.instructions || '').slice(0, LIMITS.instructions), active: !!b.active, createdAt: b.createdAt || new Date().toISOString() }));
      const seenR = new Set();
      const cleanRules = data.rules.filter((r) => r && typeof r.keyword === 'string' && typeof r.reply === 'string').map((r) => ({ id: String(r.id || uid()), keyword: r.keyword.slice(0, LIMITS.keyword), reply: r.reply.slice(0, LIMITS.reply) })).filter((r) => !seenR.has(r.id) && seenR.add(r.id)).slice(0, 500);
      if (!confirm(`Importar ${cleanBots.length} bots e ${cleanRules.length} regras? Isso substituirá os dados locais atuais.`)) return;
      bots = cleanBots; rules = cleanRules;
      if (!safeWrite(STORE_BOTS, bots) || !safeWrite(STORE_RULES, rules)) throw new Error('Falha ao gravar os dados no perfil local.');
      resetForm(); renderBots(); renderRules(); toast('Backup importado com sucesso.');
    } catch (error) { toast(`Não foi possível importar: ${error.message}`, 'error'); }
    finally { event.target.value = ''; }
  });

  // ---------- WhatsApp Web (QR code, sem conta Business) ----------
  const WAW_TEXT = {
    off: 'Desconectado.',
    starting: 'Iniciando a conexão…',
    qr: 'Escaneie o QR code com o WhatsApp do celular.',
    connected: 'Conectado.',
    reconnecting: 'Sem conexão. Tentando reconectar sozinho, sem limite de tempo…',
    error: 'Erro na conexão.',
  };
  const WAW_BADGE = { off: 'Desconectado', starting: 'Iniciando', qr: 'Aguardando QR', connected: '● Conectado', reconnecting: 'Reconectando', error: 'Erro' };
  let wawSyncTimer = 0, wawReady = false;

  const wawFillBots = () => {
    const select = $('waWebBot'); if (!select) return;
    const previous = select.value; select.replaceChildren();
    const base = el('option', '', 'Assistente padrão (sem personalidade definida)'); base.value = ''; select.append(base);
    bots.forEach((bot) => { const opt = el('option', '', bot.name); opt.value = bot.id; select.append(opt); });
    if (bots.some((b) => b.id === previous)) select.value = previous;
  };
  const wawConfig = () => {
    const bot = bots.find((b) => b.id === $('waWebBot').value) || null;
    return {
      botId: bot ? bot.id : '', botName: bot ? bot.name : '', persona: bot ? bot.persona || '' : '', instructions: bot ? bot.instructions || '' : '',
      rules: rules.map((r) => ({ keyword: r.keyword, reply: r.reply })),
      allowedNumbers: $('waWebNumbers').value, replyToEveryone: $('waWebAll').checked, useAI: $('waWebUseAI').checked, autoStart: $('waWebAuto').checked,
    };
  };
  const wawRender = (snap) => {
    if (!snap || !$('waWebStatus')) return;
    const st = snap.status || 'off';
    let text = WAW_TEXT[st] || '';
    if (st === 'connected' && snap.me) text = `Conectado como +${snap.me}.`;
    if (snap.error) text = `${text} ${snap.error}`.trim();
    announce($('waWebStatus'), text, st === 'error' ? 'error' : st === 'connected' ? 'ok' : '');
    const badge = $('waWebBadge'); if (badge) { badge.textContent = WAW_BADGE[st] || st; badge.dataset.active = String(st === 'connected'); }
    const qrBox = $('waWebQr');
    if (st === 'qr' && snap.qr && window.YoruQR) {
      try {
        const doc = new DOMParser().parseFromString(window.YoruQR.toSvg(snap.qr, { ecl: 'L', border: 2 }), 'image/svg+xml');
        qrBox.replaceChildren(document.importNode(doc.documentElement, true)); qrBox.hidden = false;
      } catch { qrBox.replaceChildren(); qrBox.hidden = true; announce($('waWebStatus'), 'Não consegui desenhar o QR code.', 'error'); }
    } else { qrBox.replaceChildren(); qrBox.hidden = true; }
    $('waWebConnect').disabled = !!snap.running;
    $('waWebDisconnect').disabled = !snap.running;
    $('waWebLogout').disabled = !snap.hasSession && !snap.running;
    const s = snap.stats || {};
    $('waWebStats').textContent = st === 'connected' || s.received ? `Recebidas: ${s.received || 0} · Respondidas: ${s.replied || 0} · Ignoradas: ${s.ignored || 0}` : '';
    $('waWebNote').textContent = snap.note || '';
    const n = (snap.config && snap.config.allowedNumbers || []).length;
    const hint = $('waWebNumbersHint');
    if (hint) hint.textContent = n ? `${n} ${n === 1 ? 'número válido' : 'números válidos'}.` : (snap.config && snap.config.replyToEveryone ? '' : 'Adicione pelo menos um número (por exemplo, o seu) para o bot responder.');
  };
  function syncWaWeb() {
    wawFillBots();
    if (!wawReady || !window.panel || !panel.waWebSetConfig) return;
    clearTimeout(wawSyncTimer);
    wawSyncTimer = setTimeout(() => { panel.waWebSetConfig(wawConfig()).then(wawRender).catch(() => {}); }, 300);
  }
  const wawAct = async (button, fn) => {
    button.disabled = true;
    try { wawRender(await fn()); } catch (e) { announce($('waWebStatus'), `Erro: ${e.message}`, 'error'); button.disabled = false; }
  };
  if ($('waWebConnect') && window.panel && panel.waWebStatus) {
    $('waWebConnect').addEventListener('click', async () => {
      if (!$('waWebAll').checked && !$('waWebNumbers').value.replace(/\D/g, '')) { announce($('waWebStatus'), 'Antes de conectar, adicione pelo menos um número permitido (ou marque "responder a qualquer pessoa").', 'error'); $('waWebNumbers').focus(); return; }
      try { await panel.waWebSetConfig(wawConfig()); } catch { /* segue mesmo assim */ }
      wawAct($('waWebConnect'), () => panel.waWebStart());
    });
    $('waWebDisconnect').addEventListener('click', () => wawAct($('waWebDisconnect'), () => panel.waWebStop()));
    $('waWebLogout').addEventListener('click', () => {
      if (!confirm('Sair da conta do WhatsApp neste computador? Será preciso ler um novo QR code para conectar de novo.')) return;
      wawAct($('waWebLogout'), () => panel.waWebLogout());
    });
    ['waWebBot', 'waWebNumbers', 'waWebUseAI', 'waWebAuto', 'waWebAll'].forEach((id) => $(id).addEventListener('change', syncWaWeb));
    $('waWebNumbers').addEventListener('input', syncWaWeb);
    wawFillBots();
    panel.onWaWebStatus(wawRender);
    panel.waWebStatus().then((snap) => {
      const c = (snap && snap.config) || {};
      $('waWebNumbers').value = (c.allowedNumbers || []).join('\n');
      $('waWebUseAI').checked = c.useAI !== false; $('waWebAuto').checked = !!c.autoStart; $('waWebAll').checked = !!c.replyToEveryone;
      if (c.botId && bots.some((b) => b.id === c.botId)) $('waWebBot').value = c.botId;
      wawReady = true; wawRender(snap); syncWaWeb();
    }).catch(() => {});
  }

  renderBots(); renderRules();
})();
