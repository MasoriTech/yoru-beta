'use strict';
// Aba Celular (dock): liga o servidor do app de celular, pareia aparelhos (QR/código) e define a senha do controle do PC.
(() => {
  const $ = (id) => document.getElementById(id);
  const api = window.panel;
  if (!$('rmEnabled') || !api || !api.remoteStatus) return;
  let st = null;
  let shownKey = '';
  const say = (id, text) => { const el = $(id); if (el) el.textContent = text || ''; };
  const fmt = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');

  // Endereço HTTPS do `tailscale serve` (https://…ts.net): o painel não consegue descobri-lo sozinho, então o usuário cola uma vez.
  const TS_KEY = 'yoru.tsUrl';
  const TS_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/i;
  const tsClean = (v) => { const t = String(v || '').trim().replace(/\/+$/, ''); return TS_RE.test(t) ? t.toLowerCase() : ''; };
  let tsUrl = '';
  try { tsUrl = tsClean(localStorage.getItem(TS_KEY)); } catch (_) { tsUrl = ''; }
  // Com a rede Wi‑Fi desligada o servidor só escuta neste PC: os endereços http:// da rede não funcionam, só o https do Tailscale.
  const allUrls = () => [...(tsUrl ? [{ url: tsUrl, https: true }] : []), ...(st && st.lan ? (st.urls || []) : [])];

  function selectedUrl() { const sel = $('rmUrl'); return sel && sel.value ? sel.value : ''; }

  function renderPairing() {
    const code = st && st.pairing ? st.pairing.code : '';
    const url = selectedUrl();
    $('rmCode').textContent = code ? `${code.slice(0, 4)} ${code.slice(4)}` : '––––––––';
    const key = `${code}|${url}`;
    if (key === shownKey) return;
    shownKey = key;
    const box = $('rmQr');
    box.textContent = '';
    if (!code || !url || !window.YoruQR) return;
    const img = document.createElement('img');
    img.alt = 'QR Code para parear o celular';
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.YoruQR.toSvg(`${url}/#pair=${code}`, { ecl: 'M' }));
    box.appendChild(img);
  }
  function renderUrls() {
    const sel = $('rmUrl');
    const old = sel.value;
    const urls = allUrls();
    sel.textContent = '';
    for (const u of urls) { const o = document.createElement('option'); o.value = u.url; o.textContent = `${u.url}${u.https ? '  (Tailscale HTTPS)' : u.tailscale ? '  (Tailscale)' : ''}`; sel.appendChild(o); }
    if (urls.some((u) => u.url === old)) sel.value = old;
  }
  const isOnline = (d) => d.lastSeen && Date.now() - d.lastSeen < 90 * 1000;
  function renderDevices() {
    const box = $('rmDevices');
    box.textContent = '';
    if (!st.devices.length) { const e = document.createElement('div'); e.className = 'hint'; e.textContent = 'Nenhum celular pareado ainda.'; box.appendChild(e); }
    for (const d of st.devices) {
      const row = document.createElement('div'); row.className = 'rm-dev';
      const info = document.createElement('div');
      const name = document.createElement('b'); name.textContent = `📱 ${d.name}`;
      const meta = document.createElement('small'); meta.textContent = `Pareado em ${fmt(d.createdAt)} · visto por último em ${fmt(d.lastSeen)}`;
      if (isOnline(d)) { const on = document.createElement('span'); on.className = 'rm-on'; on.textContent = '● online agora'; name.appendChild(on); }
      info.append(name, meta);
      const btn = document.createElement('button'); btn.className = 'b danger'; btn.textContent = 'Revogar';
      btn.addEventListener('click', async () => { if (!confirm(`Revogar o acesso de "${d.name}"?`)) return; const r = await api.remoteRevoke(d.id); if (r && r.status) render(r.status); });
      row.append(info, btn); box.appendChild(row);
    }
    $('rmRevokeAll').hidden = !st.devices.length;
  }
  function renderTailscale(s) {
    const ts = (s.urls || []).find((u) => u.tailscale);
    const host = ts ? ts.url.replace(/^http:\/\//, '').replace(/:\d+$/, '') : '';
    say('rmTsState', !s.running ? '⚪ Ative o acesso pelo celular (sub-aba Conectar) para detectar o Tailscale.' : ts ? `🟢 Tailscale detectado neste PC (${host}).${tsUrl ? ' Endereço HTTPS salvo.' : ''}` : '⚪ Tailscale não detectado neste PC. Instale em tailscale.com/download e entre com a sua conta.');
    $('rmTsState').className = `rm-state${s.running && ts ? ' on' : ''}`;
    $('rmTsCmd').value = `tailscale serve --bg ${s.port}`;
    $('rmTsLanOff').disabled = !s.lan; $('rmTsPick').disabled = !ts;
    if (document.activeElement !== $('rmTsUrl')) $('rmTsUrl').value = tsUrl;
  }
  function render(s) {
    if (!s || typeof s !== 'object' || s.ok === false) return;
    st = s;
    $('rmEnabled').checked = s.enabled; $('rmLan').checked = s.lan;
    if (document.activeElement !== $('rmPort')) $('rmPort').value = s.port;
    $('rmControl').checked = s.controlEnabled; $('rmControl').disabled = !s.hasPassword;
    $('rmTtl').value = String(s.controlTtlMin);
    const n = (s.devices || []).length;
    const online = (s.devices || []).filter(isOnline).length;
    const count = n ? ` · ${n} aparelho${n > 1 ? 's' : ''} pareado${n > 1 ? 's' : ''}${online ? ` (${online} online)` : ''}` : ' · nenhum aparelho pareado';
    say('rmState', s.error ? `⚠️ ${s.error}` : s.running ? `🟢 Ligado na porta ${s.port}${s.lan ? ' (rede local)' : ' (somente este PC / Tailscale serve)'}${count}` : s.enabled ? '🟡 Iniciando…' : '⚪ Desligado. Ative o acesso pelo celular para gerar o QR Code.');
    $('rmState').className = `rm-state${s.error ? ' err' : s.running ? ' on' : ''}`;
    const warn = $('rmWarn');
    warn.hidden = !(s.running && !allUrls().length);
    warn.textContent = warn.hidden ? '' : s.lan ? 'Nenhum endereço de rede foi encontrado. Conecte este PC ao Wi‑Fi (ou ao Tailscale) e atualize.' : 'A rede Wi‑Fi está desligada: cole o endereço https://…ts.net do Tailscale na sub-aba Fora de casa para gerar o QR.';
    renderTailscale(s);
    say('rmPwState', s.hasPassword ? (s.controlEnabled ? '🔓 Senha definida e controle liberado para celulares pareados.' : '🔒 Senha definida. Ligue a opção acima para permitir o controle.') : 'Nenhuma senha definida: o controle do PC fica indisponível.');
    $('rmPwClear').hidden = !s.hasPassword;
    $('rmSteps').hidden = !!(s.running && s.devices.length);
    renderUrls(); renderDevices(); renderPairing();
    $('rmNewCode').disabled = !s.running; $('rmCopy').disabled = !s.running || !selectedUrl();
  }
  async function refresh() { try { render(await api.remoteStatus()); } catch (_) { /* painel fechando */ } }
  const apply = async (patch) => { const r = await api.remoteSet(patch); if (r && r.status) render(r.status); };

  $('rmEnabled').addEventListener('change', (e) => apply({ enabled: e.target.checked }));
  $('rmLan').addEventListener('change', (e) => apply({ lan: e.target.checked }));
  $('rmPort').addEventListener('change', (e) => apply({ port: Number(e.target.value) }));
  $('rmControl').addEventListener('change', (e) => apply({ controlEnabled: e.target.checked }));
  $('rmTtl').addEventListener('change', (e) => apply({ controlTtlMin: Number(e.target.value) }));
  $('rmUrl').addEventListener('change', renderPairing);
  const goConectar = () => { const b = document.querySelector('#tab-celular .subtab[data-sub="conectar"]'); if (b) b.click(); };
  $('rmTsCopyCmd').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('rmTsCmd').value); say('rmTsMsg', 'Comando copiado. Cole no terminal do PC.'); } catch (_) { say('rmTsMsg', 'Não consegui copiar. Selecione o comando e copie manualmente.'); } });
  $('rmTsLanOff').addEventListener('click', () => { apply({ lan: false }); say('rmTsMsg', 'Rede Wi‑Fi desligada. Agora o acesso é só por este PC e pelo Tailscale (HTTPS).'); });
  $('rmTsPick').addEventListener('click', () => { const o = [...$('rmUrl').options].find((x) => /\(Tailscale\)$/.test(x.textContent)); if (o) { $('rmUrl').value = o.value; renderPairing(); goConectar(); } else say('rmTsMsg', 'Nenhum endereço do Tailscale encontrado. Confira se ele está ligado neste PC.'); });
  $('rmTsSave').addEventListener('click', () => {
    const raw = $('rmTsUrl').value.trim();
    if (!raw) { tsUrl = ''; try { localStorage.removeItem(TS_KEY); } catch (_) { /* sem storage */ } say('rmTsMsg', 'Endereço HTTPS removido.'); }
    else {
      const v = tsClean(raw);
      if (!v) { say('rmTsMsg', '⚠️ Endereço inválido. Use o formato https://nome-do-pc.algo.ts.net (sem porta e sem caminho).'); return; }
      tsUrl = v; try { localStorage.setItem(TS_KEY, v); } catch (_) { /* sem storage */ }
      say('rmTsMsg', '✅ Endereço salvo. O QR da sub-aba Conectar passa a usá-lo.');
    }
    if (st) { renderUrls(); if (tsUrl) $('rmUrl').value = tsUrl; shownKey = ''; renderPairing(); render(st); }
  });
  $('rmCopyCode').addEventListener('click', async () => { const c = st && st.pairing ? st.pairing.code : ''; if (!c) { say('rmLast', 'Gere um código primeiro.'); return; } try { await navigator.clipboard.writeText(c); say('rmLast', 'Código copiado.'); } catch (_) { say('rmLast', 'Não consegui copiar. Digite o código manualmente.'); } });
  $('rmPwShow').addEventListener('change', (e) => { const t = e.target.checked ? 'text' : 'password'; $('rmPw1').type = t; $('rmPw2').type = t; });
  const pwHint = () => { const a = $('rmPw1').value; const b = $('rmPw2').value; if (!a && !b) return; say('rmPwState', a.length < 8 ? `A senha precisa ter pelo menos 8 caracteres (faltam ${8 - a.length}).` : b && a !== b ? 'As senhas ainda não são iguais.' : b ? '✅ Senhas iguais. Clique em Salvar senha.' : 'Repita a senha no campo abaixo.'); };
  $('rmPw1').addEventListener('input', pwHint); $('rmPw2').addEventListener('input', pwHint);
  $('rmNewCode').addEventListener('click', async () => { const r = await api.remoteNewPairing(); if (r && r.status) render(r.status); });
  $('rmCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(selectedUrl()); say('rmLast', 'Endereço copiado.'); } catch (_) { say('rmLast', 'Não consegui copiar. Selecione o endereço e copie manualmente.'); } });
  $('rmRevokeAll').addEventListener('click', async () => { if (!confirm('Revogar o acesso de TODOS os celulares pareados?')) return; const r = await api.remoteRevokeAll(); if (r && r.status) render(r.status); });
  $('rmPwSave').addEventListener('click', async () => {
    const r = await api.remoteSetPassword($('rmPw1').value, $('rmPw2').value);
    if (r && r.ok) { $('rmPw1').value = ''; $('rmPw2').value = ''; render(r.status); say('rmPwState', '✅ Senha salva. Sessões abertas foram encerradas.'); }
    else say('rmPwState', `⚠️ ${(r && r.error) || 'Não consegui salvar a senha.'}`);
  });
  $('rmPwClear').addEventListener('click', async () => { if (!confirm('Remover a senha? O controle do PC pelo celular será desativado.')) return; const r = await api.remoteClearPassword(); if (r && r.status) render(r.status); });

  const EVENTS = {
    paired: (e) => `📱 ${e.device} foi pareado.`, logout: (e) => `📱 ${e.device} se desconectou.`, revoked: (e) => `Acesso de ${e.device} revogado.`,
    unlocked: (e) => `🔓 Controle do PC liberado para ${e.device}.`, locked: (e) => `🔒 ${e.device} bloqueou o controle.`,
    'unlock-failed': (e) => `⚠️ Senha de controle errada vinda de ${e.device}${e.locked ? ' — controle bloqueado por um tempo' : ''}.`,
    'pair-failed': () => '⚠️ Código de pareamento errado.', 'pair-locked': () => '⚠️ Muitas tentativas: gere um novo código.',
    action: (e) => `▶ ${e.device}: ${e.action}`,
  };
  const logLines = [];
  function pushLog(text) {
    logLines.unshift({ at: new Date(), text }); logLines.length = Math.min(logLines.length, 8);
    const box = $('rmLog'); box.textContent = '';
    if (!logLines.length) return;
    for (const l of logLines) { const row = document.createElement('div'); const t = document.createElement('time'); t.textContent = l.at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); row.append(t, document.createTextNode(l.text)); box.appendChild(row); }
  }
  const logEmpty = () => { const box = $('rmLog'); if (!box.children.length) { const e = document.createElement('div'); e.textContent = 'Nada por aqui ainda. Pareamentos, bloqueios e comandos recebidos aparecem nesta lista.'; box.appendChild(e); } };
  logEmpty();
  if (api.onRemoteEvent) api.onRemoteEvent((e) => { const f = EVENTS[e.type]; if (f) { const text = f(e); say('rmLast', text); pushLog(text); } refresh(); });
  let autoRenewed = '';
  setInterval(() => { // contagem do código e atualização leve
    if (document.hidden) return;
    const bar = $('rmBar');
    if (st && st.pairing) {
      const total = 10 * 60 * 1000;
      const ms = Math.max(0, st.pairing.expiresAt - Date.now());
      const left = Math.round(ms / 1000);
      say('rmExpire', left ? `Expira em ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : 'Código expirado.');
      bar.style.width = `${Math.min(100, (ms / total) * 100)}%`; bar.classList.toggle('low', left > 0 && left <= 60);
      if (!left) {
        // gera sozinho um código novo (uma vez por código) para o QR nunca ficar inútil na tela
        if (st.running && autoRenewed !== st.pairing.code && $('tab-celular').classList.contains('active')) { autoRenewed = st.pairing.code; api.remoteNewPairing().then((r) => { if (r && r.status) render(r.status); }).catch(() => {}); }
        else refresh();
      }
    } else { bar.style.width = '0'; say('rmExpire', st && st.running ? 'Sem código ativo. Gere um novo.' : ''); }
  }, 1000);
  setInterval(() => { if (!document.hidden && $('tab-celular') && $('tab-celular').classList.contains('active')) refresh(); }, 6000);
  refresh();
})();
