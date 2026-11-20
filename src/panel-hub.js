'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const history = [];
  const status = msg => {
    if ($('hubStatus')) $('hubStatus').textContent = msg || '';
    if (msg) { history.unshift({ t: new Date(), msg: String(msg) }); if (history.length > 40) history.pop(); if (typeof renderHistory === 'function') renderHistory(); }
  };
  const list = (id, items, render) => { const root=$(id); if(!root)return;root.textContent='';if(!items||!items.length){const e=document.createElement('div');e.className='hub-muted';e.textContent='Nenhum dispositivo identificado.';root.append(e);return;}for(const item of items){const el=document.createElement('div');el.className='hub-item';el.textContent=render(item);root.append(el);} };
  let localPath='',remotePath='';

  function renderBluetooth(items){
    window.__yoruBluetoothDevices=items;
    const root=$('hubBluetooth'); if(!root)return; root.textContent='';
    if(!items.length){const e=document.createElement('div');e.className='hub-muted';e.textContent='Nenhum dispositivo Bluetooth identificado pelo Windows.';root.append(e);return;}
    items.forEach((device,index)=>{
      const row=document.createElement('div');row.className='hub-item hub-bt-device';
      const name=document.createElement('span');name.className='hub-bt-device-name';name.textContent=`${index+1}. ${device.FriendlyName||'Dispositivo Bluetooth'}`;
      const meta=document.createElement('small');meta.textContent=`${device.Status||'Estado desconhecido'} · ${device.Class||'Bluetooth'}`;name.append(meta);
      const open=Object.assign(document.createElement('button'), { type: 'button' });open.className='b';open.textContent='Abrir central';open.addEventListener('click',()=>openBluetoothCenter(device));
      row.append(name,open);root.append(row);
    });
  }
  async function openBluetoothCenter(device){
    const box=$('hubBluetoothCenter');box.hidden=false;box.textContent='Carregando informações do dispositivo…';
    try{
      const d=await window.panel.hubBluetoothDetails(device.InstanceId);
      const type=d.kind==='speaker'?'🔊':d.kind==='headphone'?'🎧':d.kind==='phone'?'📱':'🔵';
      box.textContent='';
      const hero=document.createElement('div');hero.className='hub-bt-hero';
      const icon=document.createElement('div');icon.className='hub-bt-icon';icon.textContent=type;
      const meta=document.createElement('div');meta.className='hub-bt-meta';
      const title=document.createElement('strong');title.textContent=d.FriendlyName||'Dispositivo Bluetooth';
      const sub=document.createElement('small');sub.textContent=`${d.Status||'Estado desconhecido'} · ${d.Class||'Bluetooth'}`;
      meta.append(title,sub);hero.append(icon,meta);box.append(hero);
      const controls=document.createElement('div');controls.className='hub-bt-controls';
      const connect=Object.assign(document.createElement('button'), { type: 'button' });connect.className='b primary';connect.textContent='Abrir conexão / pareamento';connect.addEventListener('click',async()=>{try{const r=await window.panel.hubBluetoothOpenSettings();status(r.message)}catch(e){status(e.message)}});
      const refresh=Object.assign(document.createElement('button'), { type: 'button' });refresh.className='b';refresh.textContent='Atualizar estado';refresh.addEventListener('click',scan);
      controls.append(connect,refresh);box.append(controls);
      if(d.kind==='speaker'||d.kind==='headphone'){
        const label=document.createElement('div');label.className='hub-bt-note';label.textContent='Volume geral de saída do Windows (não é um controle independente do dispositivo).';
        const volume=document.createElement('div');volume.className='hub-bt-volume';
        const low=document.createElement('span');low.textContent='−';
        const slider=document.createElement('input');slider.type='range';slider.min='0';slider.max='100';slider.value='50';slider.setAttribute('aria-label','Volume geral do Windows');
        const value=document.createElement('strong');value.textContent='50%';
        slider.addEventListener('input',()=>{value.textContent=slider.value+'%';});
        slider.addEventListener('change',async()=>{try{await window.panel.hubBluetoothVolume(slider.value);status('Volume geral do Windows ajustado para '+slider.value+'%.')}catch(e){status('Não foi possível ajustar o volume: '+e.message)}});
        volume.append(low,slider,value);box.append(label,volume);
      }
      const note=document.createElement('p');note.className='hub-bt-note';
      note.textContent='O pareamento e a conexão são concluídos pelo Windows. Controles de LED, equalização, bateria e comandos específicos só aparecem quando o fabricante disponibiliza uma interface compatível; não há controle Bluetooth universal para essas funções.';
      box.append(note);
      status('Central aberta para '+(d.FriendlyName||'dispositivo Bluetooth')+'.');
    }catch(e){box.textContent='Não foi possível abrir a central: '+e.message;status(e.message);}
  }
  function renderGattInspection(box, result){
    const section=document.createElement('section');section.className='hub-bt-gatt';
    const heading=document.createElement('strong');heading.textContent='Serviços e características GATT';section.append(heading);
    if(!result?.ok){
      const error=document.createElement('p');error.className='hub-bt-note';error.textContent=result?.error||'O Windows não conseguiu consultar os serviços GATT.';section.append(error);box.append(section);return;
    }
    const summary=document.createElement('p');summary.className='hub-bt-note';
    summary.textContent=`${result.serviceCount} serviço(s) · ${result.characteristicCount} característica(s) · status ${result.status||'não informado'}`;
    section.append(summary);
    if(!result.services.length){const empty=document.createElement('p');empty.className='hub-muted';empty.textContent='O dispositivo não expôs serviços GATT nesta consulta.';section.append(empty);}
    result.services.forEach((service,index)=>{
      const card=document.createElement('div');card.className='hub-bt-gatt-service';
      const serviceTitle=document.createElement('strong');serviceTitle.textContent=`Serviço ${index+1}: ${service.label?service.label+' · ':''}${service.uuid}`;card.append(serviceTitle);
      if(!service.characteristics.length){const none=document.createElement('small');none.textContent=`Sem características listadas (${service.characteristicsStatus||'status não informado'}).`;card.append(none);}
      service.characteristics.forEach((ch,i)=>{
        const row=document.createElement('div');row.className='hub-bt-gatt-characteristic';
        const uuid=document.createElement('code');uuid.textContent=`${i+1}. ${ch.label?ch.label+' · ':''}${ch.uuid}`;row.append(uuid);
        const flags=document.createElement('small');
        const labels=[];if(ch.canRead)labels.push('Leitura');if(ch.canWrite)labels.push('Escrita');if(ch.canNotify)labels.push('Notificações');
        flags.textContent=labels.length?labels.join(' · '):'Sem propriedades de leitura/escrita/notificação reconhecidas';
        row.append(flags);card.append(row);
      });
      section.append(card);
    });
    box.append(section);
  }
  async function inspectGattForDevice(device, box){
    if(!device?.Address)return;
    const old=box.querySelector('.hub-bt-gatt');if(old)old.remove();
    const loading=document.createElement('p');loading.className='hub-bt-note';loading.textContent='Consultando serviços GATT no Windows…';box.append(loading);
    try{
      const result=await window.panel.hubBluetoothGattInspect(device.Address);
      loading.remove();renderGattInspection(box,result);
      status(result.ok?'Inspeção GATT concluída.':'Não foi possível concluir a inspeção GATT.');
    }catch(e){loading.remove();renderGattInspection(box,{ok:false,error:e.message});status(e.message);}
  }
  function openNearbyBluetoothCenter(device){
    const box=$('hubBluetoothCenter');if(!box)return;box.hidden=false;box.textContent='';
    const hero=document.createElement('div');hero.className='hub-bt-hero';
    const icon=document.createElement('div');icon.className='hub-bt-icon';icon.textContent='🔵';
    const meta=document.createElement('div');meta.className='hub-bt-meta';
    const title=document.createElement('strong');title.textContent=device.FriendlyName||'Dispositivo BLE sem nome';
    const sub=document.createElement('small');sub.textContent=`Bluetooth LE · ${device.Address||''} · ${device.RSSI ?? 'RSSI indisponível'} dBm`;
    meta.append(title,sub);hero.append(icon,meta);box.append(hero);
    const note=document.createElement('p');note.className='hub-bt-note';
    note.textContent=device.Connectable?'O anúncio informa que o dispositivo aceita conexão. A consulta GATT tentará abrir o dispositivo pelo Windows; alguns aparelhos exigem pareamento ou autorização.':'O anúncio BLE foi detectado, mas o dispositivo não informou que aceita conexão neste momento.';
    box.append(note);
    const actions=document.createElement('div');actions.className='hub-bt-controls';
    const inspect=Object.assign(document.createElement('button'), { type: 'button' });inspect.className='b primary';inspect.textContent='Analisar serviços GATT';inspect.disabled=!device.Connectable;inspect.addEventListener('click',()=>inspectGattForDevice(device,box));
    const connect=Object.assign(document.createElement('button'), { type: 'button' });connect.className='b';connect.textContent='Abrir configurações Bluetooth';connect.addEventListener('click',async()=>{try{const r=await window.panel.hubBluetoothOpenSettings();status(r.message)}catch(e){status(e.message)}});
    const again=Object.assign(document.createElement('button'), { type: 'button' });again.className='b';again.textContent='Buscar novamente';again.addEventListener('click',scanNearbyBluetooth);
    actions.append(inspect,connect,again);box.append(actions);
    status('Central BLE aberta para '+(device.FriendlyName||device.Address)+'.');
  }
  window.panel.onHubBluetoothVoiceSelect?.((device)=>{
    if(device && String(device.InstanceId||'').startsWith('BLE:')) return openNearbyBluetoothCenter(device);
    const id=typeof device==='string'?device:device?.InstanceId;
    const found=(window.__yoruBluetoothDevices||[]).find(d=>d.InstanceId===id);
    if(found) openBluetoothCenter(found);
    else if(id) { scan().then(()=>{const d=(window.__yoruBluetoothDevices||[]).find(x=>x.InstanceId===id);if(d)openBluetoothCenter(d);}); }
  });
  async function scanNearbyBluetooth(){
    const info=$('hubBluetoothNearbyStatus'),root=$('hubBluetoothNearbyList');
    if(info)info.textContent='Buscando anúncios Bluetooth LE próximos por até 8 segundos…';
    if(root)root.textContent='';
    try{
      const r=await window.panel.hubBluetoothNearbyScan(8);
      if(!r?.ok)throw new Error(r?.error||r?.guidance||'Falha na descoberta BLE');
      const items=r.items||[];
      if(info)info.textContent=r.message||`${items.length} dispositivo(s) BLE encontrado(s).`;
      if(!items.length){if(root)root.textContent='Nenhum anúncio BLE detectado. Dispositivos Bluetooth clássicos podem não aparecer nesta busca.';return;}
      items.forEach((d,index)=>{
        const device={FriendlyName:d.name||`Dispositivo BLE ${d.address}`,Address:d.address,RSSI:d.rssi,Connectable:d.connectable,InstanceId:`BLE:${d.address}`};
        const row=document.createElement('div');row.className='hub-item hub-bt-device';
        const name=document.createElement('span');name.className='hub-bt-device-name';name.textContent=`${index+1}. ${device.FriendlyName}`;
        const meta=document.createElement('small');meta.textContent=`${d.address} · ${d.rssi} dBm · ${d.connectable?'conectável':'sem indicação de conexão'}`;name.append(meta);
        const open=Object.assign(document.createElement('button'), { type: 'button' });open.className='b';open.textContent='Abrir central';open.addEventListener('click',()=>openNearbyBluetoothCenter(device));
        row.append(name,open);root.append(row);
      });
    }catch(e){if(info)info.textContent='Não foi possível buscar dispositivos próximos: '+e.message;}
  }
  $('hubBluetoothNearby')?.addEventListener('click',scanNearbyBluetooth);
  $('hubBluetoothSettings')?.addEventListener('click',async()=>{try{const r=await window.panel.hubBluetoothOpenSettings();status(r.message)}catch(e){status(e.message)}});
  $('hubBluetoothRefresh')?.addEventListener('click',scan);

  // ---------- utilidades ----------
  const fmtSize = (n) => { n = Number(n) || 0; if (n < 1024) return `${n} B`; const u = ['KB', 'MB', 'GB', 'TB']; let i = -1; do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1); return `${n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ${u[i]}`; };
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const mkBtn = (label, onClick, cls = 'b') => { const b = mk('button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const busy = (button, on, label) => { if (!button) return; button.disabled = on; if (on) { button.dataset.oldLabel = button.textContent; if (label) button.textContent = label; } else if (button.dataset.oldLabel) { button.textContent = button.dataset.oldLabel; } };
  const withBusy = async (button, label, fn) => { busy(button, true, label); try { return await fn(); } finally { busy(button, false); } };
  const safeGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

  function renderUniversalAdapters(data) {
    const root = $('hubAdaptersInfo'); if (!root) return;
    root.textContent = '';
    if (!data || !data.ok) { root.append(mk('div', 'hub-muted', data?.note || 'Inventário de adaptadores indisponível.')); return; }
    const wifi = data.wifi || { count:0, connected:false, adapters:[] };
    const bt = data.bluetooth || { adapterCount:0, service:'Unknown', devices:[] };
    root.append(mk('div', 'hub-item', `Wi-Fi: ${wifi.count} adaptador(es) · ${wifi.connected ? 'interface ativa' : 'nenhuma interface Wi-Fi ativa'}`));
    root.append(mk('div', 'hub-item', `Bluetooth: ${bt.adapterCount} interface(s) de rede · serviço Windows ${bt.service || 'desconhecido'} · ${(bt.devices || []).length} dispositivo(s) Bluetooth presente(s)`));
    const items = data.adapters || [];
    if (!items.length) root.append(mk('div', 'hub-muted', 'O Windows não retornou adaptadores de rede. Verifique os drivers no Gerenciador de Dispositivos.'));
    items.forEach((adapter) => {
      const icon = adapter.kind === 'wifi' ? '📶' : adapter.kind === 'bluetooth-network' ? '🔵' : adapter.kind === 'ethernet' ? '🔌' : '🧩';
      root.append(mk('div', 'hub-item', `${icon} ${adapter.name} · ${adapter.description || adapter.kind} · ${adapter.status}${adapter.linkSpeed ? ' · ' + adapter.linkSpeed : ''}`));
    });
    (data.unrecognized || []).forEach(item => root.append(mk('div', 'hub-item', `⚠️ ${item.name} · ${item.status} · ${item.class} · driver pode estar ausente ou incompleto`)));
    root.append(mk('p', 'hub-muted', data.note || 'Detecção feita pelo Windows.'));
  }
  async function refreshUniversalAdapters() {
    const button = $('hubUniversalRefresh'); busy(button, true, 'Detectando…');
    try {
      const result = await window.panel.hubConnectivityStatus();
      renderUniversalAdapters(result);
      status('Inventário universal atualizado pelo Windows.');
    } catch (error) { status('Falha ao consultar adaptadores: ' + error.message); }
    finally { busy(button, false); }
  }

  let tapoConfigured = false, tapoBusy = false, tapoInitialized = false;
  // Abas internas da lâmpada: mantém todos os controles montados e preserva os valores.
  document.querySelectorAll('[data-tapo-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('#hubTapoCard');
      if (!card) return;
      const key = button.dataset.tapoTab;
      card.querySelectorAll('[data-tapo-tab]').forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      card.querySelectorAll('[data-tapo-pane]').forEach((pane) => pane.classList.toggle('active', pane.dataset.tapoPane === key));
    });
  });

  function renderTapoState(state) {
    const box = $('hubTapoState'); if (!box) return;
    if (!state || !state.ok) { box.textContent = state?.error || 'Não foi possível consultar a lâmpada.'; return; }
    tapoConfigured = true;
    $('hubTapoControls').hidden = false;
    box.textContent = `${state.alias || 'Lâmpada Tapo'} · ${state.model} · ${state.isOn ? 'Ligada' : 'Desligada'} · brilho ${state.brightness == null ? '—' : state.brightness + '%'} · temperatura ${state.colorTemp == null ? '—' : state.colorTemp + ' K'} · ${state.host}`;
    if (state.brightness != null) { $('hubTapoBrightness').value = String(state.brightness); $('hubTapoBrightnessValue').textContent = state.brightness + '%'; }
    if (state.colorTemp != null) { $('hubTapoTemperature').value = String(state.colorTemp); $('hubTapoTemperatureValue').textContent = state.colorTemp + ' K'; }
    const effectsRoot = $('hubTapoEffects');
    if (effectsRoot) {
      effectsRoot.replaceChildren();
      (state.effects || []).forEach(effect => effectsRoot.append(mkBtn(`✨ ${effect}`, () => tapoRun('effect', { effect }))));
      if (!(state.effects || []).length) effectsRoot.textContent = 'Este firmware não informou efeitos nativos.';
    }
    const presetsRoot = $('hubTapoPresets');
    if (presetsRoot) {
      presetsRoot.replaceChildren();
      (state.presets || []).filter(preset => /^Light preset [1-7]$/i.test(preset)).forEach(preset => { const n = Number(preset.match(/[1-7]$/)?.[0]); presetsRoot.append(mkBtn(`Preset ${n}`, () => tapoRun('preset', { preset:n }))); });
      if (!(state.presets || []).length) presetsRoot.textContent = 'Nenhum preset foi exposto pelo firmware.';
    }
    const capabilities = $('hubTapoCapabilities');
    if (capabilities) capabilities.textContent = [
      state.effect ? `Efeito ativo: ${state.effect}` : '',
      state.preset ? `Preset: ${state.preset}` : '',
      state.smoothTransitionOn != null ? `Fade ao ligar: ${state.smoothTransitionOn}s` : '',
      state.smoothTransitionOff != null ? `Fade ao desligar: ${state.smoothTransitionOff}s` : '',
      state.overheated === true ? 'ALERTA: superaquecimento informado pela lâmpada' : state.overheated === false ? 'Sem alerta de superaquecimento' : '',
      state.signalLevel != null ? `Sinal Wi-Fi: ${state.signalLevel}` : '',
      (state.autoWhiteModes || []).length ? `Branco automático: ${state.autoWhiteModes.join(', ')}` : 'Auto White sem controle pela API local; configure pelo app Tapo.'
    ].filter(Boolean).join(' · ');
  }
  async function tapoRun(action, args = {}) {
    if (tapoBusy) return;
    tapoBusy = true;
    try {
      const result = await window.panel.hubTapoControl(action, args);
      if (!result?.ok) throw new Error(result?.error || 'O Yoru não recebeu confirmação da lâmpada.');
      renderTapoState(result);
      status(`Tapo L530E atualizado: ${action}.`);
    } catch (error) { $('hubTapoState').textContent = error.message; status('Tapo: ' + error.message); }
    finally { tapoBusy = false; }
  }
  async function refreshTapoState() { await tapoRun('state'); }
  function hexToHsv(hex) {
    const value = String(hex || '#ffffff').replace('#', '');
    const r = parseInt(value.slice(0,2),16)/255, g = parseInt(value.slice(2,4),16)/255, b = parseInt(value.slice(4,6),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), delta = max-min;
    let hue = 0;
    if (delta) { if (max === r) hue = 60 * (((g-b)/delta) % 6); else if (max === g) hue = 60 * ((b-r)/delta+2); else hue = 60 * ((r-g)/delta+4); }
    if (hue < 0) hue += 360;
    return { hue:Math.round(hue), saturation:Math.round(max ? delta/max*100 : 0), brightness:Math.max(1, Math.round(max*100)) };
  }
  async function initializeSmartHome() {
    if (tapoInitialized) return; tapoInitialized = true;
    try {
      const [config, runtime] = await Promise.all([window.panel.hubTapoConfigGet(), window.panel.hubTapoRuntime()]);
      tapoConfigured = !!config.configured;
      $('hubTapoEmail').value = config.email || '';
      $('hubTapoHost').value = config.host || '';
      $('hubTapoPassword').placeholder = config.configured ? 'Senha já armazenada com proteção do Windows (opcional para atualizar)' : 'Senha Tapo (armazenada protegida)';
      $('hubTapoRuntime').textContent = runtime?.installed ? `Conector python-kasa instalado · Python ${runtime.python || ''}` : (runtime?.error || 'Instale Python 3 e python-kasa para controlar a lâmpada.');
      if (!config.secureStorageAvailable) $('hubTapoRuntime').textContent += ' · Armazenamento seguro indisponível; senha não será salva.';
      if (config.configured) { $('hubTapoState').textContent = 'Acesso Tapo salvo. Clique em Encontrar L530E ou Consultar estado.'; }
      else $('hubTapoState').textContent = 'Informe o e-mail e a senha TP-Link/Tapo e clique em Salvar acesso.';
    } catch (error) { $('hubTapoRuntime').textContent = error.message; }
  }
  $('hubUniversalRefresh')?.addEventListener('click', refreshUniversalAdapters);
  $('hubOpenWifiSettings')?.addEventListener('click', async () => { try { const r = await window.panel.hubOpenWifiSettings(); status(r.message); } catch (error) { status(error.message); } });
  $('hubOpenBluetoothSettings')?.addEventListener('click', async () => { try { const r = await window.panel.hubBluetoothOpenSettings(); status(r.message); } catch (error) { status(error.message); } });
  $('hubTapoSave')?.addEventListener('click', async () => {
    try {
      const config = await window.panel.hubTapoConfigSet({ email:$('hubTapoEmail').value, password:$('hubTapoPassword').value, host:$('hubTapoHost').value });
      tapoConfigured = !!config.configured; $('hubTapoPassword').value = ''; $('hubTapoPassword').placeholder = 'Senha já armazenada com proteção do Windows (opcional para atualizar)';
      $('hubTapoState').textContent = 'Credenciais salvas com a proteção do Windows. Agora procure a lâmpada.';
      status('Acesso Tapo salvo com criptografia do Windows.');
    } catch (error) { $('hubTapoState').textContent = error.message; status(error.message); }
  });
  $('hubTapoClear')?.addEventListener('click', async () => {
    if (!confirm('Remover do computador o e-mail, a senha protegida e o endereço da lâmpada Tapo?')) return;
    await window.panel.hubTapoConfigClear(); tapoConfigured = false; $('hubTapoControls').hidden = true; $('hubTapoPassword').value = ''; $('hubTapoEmail').value = ''; $('hubTapoHost').value = ''; $('hubTapoState').textContent = 'Acesso Tapo removido.'; status('Credenciais Tapo removidas.');
  });
  $('hubTapoDiscover')?.addEventListener('click', async () => {
    if (!tapoConfigured) { $('hubTapoState').textContent = 'Salve primeiro o e-mail e a senha Tapo.'; return; }
    const button = $('hubTapoDiscover'); busy(button, true, 'Procurando…');
    try {
      if ($('hubTapoHost').value.trim()) await window.panel.hubTapoSelectHost($('hubTapoHost').value.trim());
      const result = await window.panel.hubTapoDiscover();
      const root = $('hubTapoDevices'); root.textContent = '';
      if (!result?.ok) throw new Error(result?.error || 'Falha na descoberta Tapo.');
      const items = result.items || [];
      if (!items.length) { root.textContent = result.message || 'Nenhuma L530E encontrada. Confirme se o computador e a lâmpada estão na mesma rede Wi-Fi.'; return; }
      items.forEach((device) => {
        const row = mk('div', 'hub-item'); row.append(mk('span', '', `${device.alias} · ${device.model} · ${device.host}`));
        row.append(mkBtn('Selecionar', async () => { try { await window.panel.hubTapoSelectHost(device.host); $('hubTapoHost').value = device.host; await refreshTapoState(); } catch (error) { status(error.message); } })); root.append(row);
      });
      status(`${items.length} dispositivo(s) Tapo L530 encontrados.`);
      if (items.length === 1) { await window.panel.hubTapoSelectHost(items[0].host); $('hubTapoHost').value = items[0].host; renderTapoState(items[0]); }
    } catch (error) { $('hubTapoDevices').textContent = error.message; $('hubTapoState').textContent = error.message; status('Tapo: ' + error.message); }
    finally { busy(button, false); }
  });
  $('hubTapoRefresh')?.addEventListener('click', refreshTapoState);
  $('hubTapoOn')?.addEventListener('click', () => tapoRun('on'));
  $('hubTapoOff')?.addEventListener('click', () => tapoRun('off'));
  $('hubTapoBrightness')?.addEventListener('input', () => { $('hubTapoBrightnessValue').textContent = $('hubTapoBrightness').value + '%'; });
  $('hubTapoBrightness')?.addEventListener('change', () => tapoRun('brightness', { brightness:Number($('hubTapoBrightness').value) }));
  $('hubTapoTemperature')?.addEventListener('input', () => { $('hubTapoTemperatureValue').textContent = $('hubTapoTemperature').value + ' K'; });
  $('hubTapoTemperature')?.addEventListener('change', () => tapoRun('temperature', { colorTemp:Number($('hubTapoTemperature').value) }));
  $('hubTapoColorApply')?.addEventListener('click', () => tapoRun('color', hexToHsv($('hubTapoColor').value)));
  document.querySelectorAll('[data-tapo-scene]').forEach(button => button.addEventListener('click', () => tapoRun('scene', { scene:button.dataset.tapoScene })));
  $('hubTapoCopyInstall')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText('py -3 -m pip install --user python-kasa'); status('Comando de instalação copiado.'); } catch (_) { $('hubTapoRuntime').textContent = 'Execute no PowerShell: py -3 -m pip install --user python-kasa'; } });

  // Electron não oferece prompt(): diálogo próprio de uma linha, sem dependências.
  function ask(title, value = '', hint = '') {
    return new Promise((resolve) => {
      const back = mk('div'); Object.assign(back.style, { position: 'fixed', inset: '0', background: 'rgba(0,0,0,.55)', display: 'grid', placeItems: 'center', zIndex: '100' });
      const box = mk('div'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', title);
      Object.assign(box.style, { width: 'min(460px,92vw)', padding: '18px', border: '1px solid var(--line)', borderRadius: '14px', background: 'var(--card)', color: 'var(--text)', boxShadow: '0 12px 40px rgba(0,0,0,.5)' });
      const h = mk('strong', '', title); h.style.display = 'block'; h.style.marginBottom = '8px';
      const input = mk('input'); input.type = 'text'; input.value = value; input.spellcheck = false; Object.assign(input.style, { width: '100%', padding: '10px', border: '1px solid var(--line)', borderRadius: '9px', background: 'var(--bg)', color: 'var(--text)', boxSizing: 'border-box' });
      const row = mk('div'); Object.assign(row.style, { display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '12px' });
      const done = (v) => { back.remove(); resolve(v); };
      row.append(mkBtn('Cancelar', () => done(null)), mkBtn('Confirmar', () => done(input.value.trim() || null), 'b primary'));
      box.append(h); if (hint) { const p = mk('p', 'hub-muted', hint); p.style.margin = '0 0 8px'; box.append(p); } box.append(input, row); back.append(box);
      back.addEventListener('mousedown', (e) => { if (e.target === back) done(null); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim() || null); if (e.key === 'Escape') done(null); });
      document.body.append(back); input.focus(); input.select();
    });
  }

  // ---------- resumo no topo ----------
  const state = { network: null, volumes: null, bluetooth: null, usb: null, android: null, agent: false, share: false };
  let summary = null, historyToggle = null;
  function renderSummary() {
    if (!summary) {
      const intro = document.querySelector('#tab-hub .hub-intro'); if (!intro) return;
      summary = mk('div'); summary.id = 'hubSummary'; Object.assign(summary.style, { display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '-6px 0 14px' }); intro.after(summary);
    }
    summary.replaceChildren();
    const chip = (label, value, on) => { const c = mk('span', 'hub-chip'); Object.assign(c.style, { display: 'inline-flex', gap: '6px', alignItems: 'center', padding: '5px 11px', border: '1px solid var(--line)', borderRadius: '99px', background: 'var(--card)', fontSize: '12px', color: on ? 'var(--text)' : 'var(--muted)' }); const dot = mk('span', '', '●'); dot.style.color = on ? 'var(--ok)' : 'var(--off)'; c.append(dot, document.createTextNode(`${label}: ${value}`)); summary.append(c); };
    const n = (v, unit) => (v == null ? 'não verificado' : `${v} ${unit}`);
    chip('Rede', n(state.network, 'interface(s)'), state.network > 0);
    chip('Armazenamento', n(state.volumes, 'unidade(s)'), state.volumes > 0);
    chip('Bluetooth', n(state.bluetooth, 'dispositivo(s)'), state.bluetooth > 0);
    chip('USB', n(state.usb, 'dispositivo(s)'), state.usb > 0);
    chip('Android', n(state.android, 'aparelho(s)'), state.android > 0);
    chip('Agente Windows', state.agent ? 'conectado' : 'desconectado', state.agent);
    chip('Compartilhamento', state.share ? 'ativo' : 'inativo', state.share);
    if (historyToggle) summary.append(historyToggle);
  }

  // ---------- verificação do computador ----------
  async function scan() {
    status('Verificando rede e dispositivos pelo Windows…');
    const button = $('hubScan'); busy(button, true, '⏳ Verificando…');
    try {
      const r = await window.panel.hubScan(); if (!r || r.error) throw new Error(r?.error || 'Falha na verificação');
      renderNetwork(r.network || []);
      const volumeRoot = $('hubVolumes'); volumeRoot.textContent = '';
      if (!(r.volumes || []).length) volumeRoot.textContent = 'Nenhum volume montado.';
      for (const v of r.volumes || []) {
        const row = mk('div', 'hub-item');
        row.append(mk('span', '', `${v.drive || ''} ${v.FileSystemLabel || 'Unidade'} · ${v.FileSystem || 'Sistema não informado'} · ${v.Size ? fmtSize(v.Size) : 'Tamanho indisponível'}`));
        if (v.drive) row.append(mkBtn('⏏ Ejetar com segurança', async () => {
          if (!confirm(`Ejetar ${v.drive}? Feche arquivos e programas que estejam usando esta unidade.`)) return;
          try { await window.panel.hubVolumeEject(v.drive); status(`Solicitação de ejeção enviada para ${v.drive}.`); await scan(); } catch (e) { status('Não foi possível ejetar: ' + e.message); }
        }));
        volumeRoot.append(row);
      }
      renderBluetooth(r.bluetooth || []);
      renderUniversalAdapters(r.adapters);
      list('hubUsb', r.usb, x => `${x.FriendlyName || 'Dispositivo USB'} · ${x.Status || 'Estado desconhecido'} · ${x.Class || ''}`);
      Object.assign(state, { network: (r.network || []).length, volumes: (r.volumes || []).length, bluetooth: (r.bluetooth || []).length, usb: (r.usb || []).length });
      renderSummary();
      status('Verificação concluída às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '. Inventário fornecido pelo Windows.');
    } catch (e) { status('Não foi possível verificar: ' + e.message); }
    finally { busy(button, false); }
  }

  // ---------- gerenciador de arquivos ----------
  const joinPath = (...p) => p.filter(Boolean).join('/');
  const parentPath = (p) => p.split('/').filter(Boolean).slice(0, -1).join('/');
  const sortItems = (items) => [...items].sort((a, b) => (a.type === 'directory' ? 0 : 1) - (b.type === 'directory' ? 0 : 1) || String(a.name).localeCompare(b.name, 'pt-BR', { numeric: true, sensitivity: 'base' }));
  function renderFiles(root, items, { path, onUp, onOpen, actions }) {
    root.textContent = '';
    if (path) root.append(mkBtn('↑ Voltar', onUp));
    if (!items.length) { root.append(mk('div', 'hub-muted', 'Pasta vazia.')); return; }
    for (const f of sortItems(items)) {
      const row = mk('div', 'hub-item'); const isDir = f.type === 'directory';
      row.append(mk('span', '', (isDir ? '📁 ' : '📄 ') + f.name + (isDir ? '' : ' · ' + fmtSize(f.size))));
      const box = mk('span'); box.style.display = 'inline-flex'; box.style.gap = '6px';
      if (isDir) box.append(mkBtn('Abrir', () => onOpen(f))); else for (const [label, fn] of actions(f)) box.append(mkBtn(label, fn));
      row.append(box); root.append(row);
    }
  }
  const failMsg = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  let localChosen = false;
  async function refreshLocal() {
    try {
      const r = await window.panel.hubLocalList(localPath); localChosen = true;
      $('hubLocalPath').textContent = 'Pasta: ' + (r.path || '(raiz selecionada)');
      renderFiles($('hubLocalFiles'), r.items, {
        path: localPath, onUp: () => { localPath = parentPath(localPath); refreshLocal(); }, onOpen: (f) => { localPath = joinPath(localPath, f.name); refreshLocal(); },
        actions: (f) => {
          const acts = [];
          if (state.agent) acts.push(['⬆ Enviar ao PC', () => sendToAgent(f)]);
          if (androidDevices.length) acts.push(['📱 Enviar ao Android', () => sendToAndroid(joinPath(localPath, f.name))]);
          return acts.length ? acts : [['⬆ Enviar', () => sendToAgent(f)]];
        },
      });
    } catch (e) { $('hubLocalFiles').textContent = ''; status(failMsg(e)); }
  }
  async function sendToAgent(f) {
    if (!state.agent) { status('Conecte um agente Windows antes de enviar arquivos.'); return; }
    status(`Enviando ${f.name} (${fmtSize(f.size)})…`);
    try { const x = await window.panel.hubAgentSend(joinPath(localPath, f.name), remotePath); status('Arquivo enviado e verificado: ' + x.name); await refreshRemote(); } catch (e) { status(failMsg(e)); }
  }
  async function refreshRemote() {
    try {
      const r = await window.panel.hubAgentList(remotePath);
      $('hubRemotePath').textContent = 'Pasta remota: ' + (r.path || '(raiz compartilhada)');
      renderFiles($('hubRemoteFiles'), r.items, {
        path: remotePath, onUp: () => { remotePath = parentPath(remotePath); refreshRemote(); }, onOpen: (f) => { remotePath = joinPath(remotePath, f.name); refreshRemote(); },
        actions: (f) => [['⬇ Baixar', async () => {
          if (!localChosen) { status('Escolha primeiro uma pasta deste PC para receber o arquivo.'); return; }
          status(`Baixando ${f.name} (${fmtSize(f.size)})…`);
          try { const x = await window.panel.hubAgentReceive(joinPath(remotePath, f.name), localPath); status('Arquivo recebido: ' + x.path); await refreshLocal(); } catch (e) { status(failMsg(e)); }
        }]],
      });
    } catch (e) { $('hubRemoteFiles').textContent = 'Conecte um agente Windows para listar arquivos.'; status(failMsg(e)); }
  }

  // ---------- iPhone / AirPlay (inalterado) ----------
  async function refreshIphoneUsb(){const box=$('hubIphoneUsbInfo');if(!box)return;box.textContent='Verificando dispositivos Apple USB…';try{const r=await window.panel.hubIphoneUsbStatus();box.textContent='';const summary=document.createElement('div');summary.className='hub-item';summary.textContent=r.connected?`${r.devices.length} dispositivo(s) Apple identificado(s) pelo Windows.`:'Nenhum iPhone identificado por USB.';box.append(summary);for(const d of r.devices||[]){const row=document.createElement('div');row.className='hub-item';row.textContent=`${d.name} · ${d.status} · ${d.class}`;box.append(row)}const note=document.createElement('p');note.className='hub-muted';note.textContent=r.guidance;box.append(note);status(r.connected?'iPhone detectado pelo Windows.':'iPhone não detectado.');}catch(e){box.textContent=e.message}}
  async function refreshAirplay(){const box=$('hubAirplayInfo');if(!box)return;try{const r=await window.panel.hubAirplayStatus();box.textContent='';const line=document.createElement('div');line.className='hub-item';line.textContent=`Receptor: ${r.name||'não configurado'} · ${r.running?'em execução':'parado'}`;box.append(line);const note=document.createElement('p');note.className='hub-muted';note.textContent=r.guidance;box.append(note)}catch(e){box.textContent=e.message}}
  $('hubIphoneScan')?.addEventListener('click',refreshIphoneUsb);
  $('hubIphoneImport')?.addEventListener('click',async()=>{try{const r=await window.panel.hubIphonePhotosImport();status(r.message||'Fotos do Windows aberto.')}catch(e){status(e.message)}});
  $('hubAirplayConfigure')?.addEventListener('click',async()=>{try{const r=await window.panel.hubAirplayConfigure();if(r.ok)status('Receptor configurado: '+r.name);await refreshAirplay()}catch(e){status(e.message)}});
  $('hubAirplayStart')?.addEventListener('click',async()=>{try{const r=await window.panel.hubAirplayStart();status(r.message);await refreshAirplay()}catch(e){status(e.message)}});
  $('hubAirplayStop')?.addEventListener('click',async()=>{try{const r=await window.panel.hubAirplayStop();status(r.message||'Receptor encerrado.');await refreshAirplay()}catch(e){status(e.message)}});
  refreshAirplay();
  $('hubScan')?.addEventListener('click', scan);

  // ---------- compartilhamento na rede local ----------
  let shareUrls = [], qrSelectedUrl = '';
  function showShareQr(url) { qrSelectedUrl = url; setQrKind('share'); renderQr(); $('hubQrCard')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  function renderShare(port, urls) {
    const root = $('hubShare'); root.textContent = '';
    root.append(mk('div', 'hub-item', `Compartilhamento ativo${port ? ' · porta ' + port : ''}`));
    for (const url of urls) {
      const row = mk('div', 'hub-item'); const a = mk('a', 'hub-url', url); a.href = url; a.target = '_blank'; a.rel = 'noreferrer'; row.append(a);
      row.append(mkBtn('Copiar endereço', async () => { try { await navigator.clipboard.writeText(url); status('Endereço copiado.'); } catch { status('Não foi possível copiar automaticamente. Selecione o endereço e use Ctrl+C.'); } }));
      row.append(mkBtn('QR Code', () => showShareQr(url)));
      root.append(row);
    }
    shareUrls = urls.slice();
    if (urls.length) { if ($('hubQrKind')?.value === 'share' || !$('hubQrText')?.value.trim()) { setQrKind('share'); qrSelectedUrl = urls[0]; } renderQr(); }
    else renderQr();
  }
  function renderSharedFiles(files) {
    let box = $('hubSharedFiles');
    if (!box) { box = mk('div', 'hub-list'); box.id = 'hubSharedFiles'; $('hubShare')?.after(box); }
    box.textContent = '';
    if (!files.length) return;
    const total = files.reduce((n, f) => n + (Number(f.size) || 0), 0);
    box.append(mk('div', 'hub-muted', `Disponíveis para baixar no celular: ${files.length} arquivo(s) · ${fmtSize(total)}`));
    files.slice(0, 20).forEach((f) => box.append(mk('div', 'hub-item', `📄 ${f.name} · ${fmtSize(f.size)}`)));
    if (files.length > 20) box.append(mk('div', 'hub-muted', `… e mais ${files.length - 20}.`));
  }
  function renderNetwork(items) {
    const root = $('hubNetwork'); if (!root) return; root.textContent = '';
    if (!items.length) { root.append(mk('div', 'hub-muted', 'Nenhuma interface de rede ativa encontrada.')); return; }
    for (const x of items) {
      const row = mk('div', 'hub-item'); row.append(mk('span', '', `${x.name}: ${x.address} (${x.netmask})`));
      row.append(mkBtn('Copiar IP', async () => { try { await navigator.clipboard.writeText(x.address); status(`IP ${x.address} copiado.`); } catch { status('Não foi possível copiar o IP.'); } }));
      root.append(row);
    }
  }
  $('hubStart')?.addEventListener('click', () => withBusy($('hubStart'), 'Iniciando…', async () => {
    status('Iniciando compartilhamento…');
    try {
      const r = await window.panel.hubStart(); if (!r?.ok) throw new Error(r?.error || 'Falha');
      renderShare(r.port, r.urls || []);
      state.share = true; renderSummary();
      status(r.urls?.length ? 'Compartilhamento ativo na rede local. Abra um dos endereços no celular (mesmo Wi-Fi).' : 'Sem interface IPv4 externa encontrada.');
    } catch (e) { status(failMsg(e)); }
  }));
  $('hubSelect')?.addEventListener('click', async () => {
    try {
      const r = await window.panel.hubSelectFiles();
      if (r?.ok) { renderSharedFiles(r.files || []); status(`${r.files.length} arquivo(s) selecionado(s) para baixar pelo celular.`); }
      else if (!r?.canceled) status(r?.error || 'Falha ao selecionar.');
    } catch (e) { status(failMsg(e)); }
  });
  $('hubStop')?.addEventListener('click', async () => { try { await window.panel.hubStop(); $('hubShare').textContent = ''; renderSharedFiles([]); state.share = false; shareUrls = []; qrSelectedUrl = ''; renderQr(); renderSummary(); status('Compartilhamento encerrado.'); } catch (e) { status(failMsg(e)); } });
  $('hubChooseLocal')?.addEventListener('click', async () => { try { const r = await window.panel.hubLocalFolder(); if (r?.ok) { localPath = ''; await refreshLocal(); status('Pasta local selecionada.'); } } catch (e) { status(failMsg(e)); } });

  // ---------- agente Windows ----------
  const AGENT_URL_KEY = 'yoru.hubAgentUrl'; // o token nunca é guardado
  if ($('hubAgentUrl') && !$('hubAgentUrl').value) $('hubAgentUrl').value = safeGet(AGENT_URL_KEY);
  async function connectAgent() {
    const url = $('hubAgentUrl').value.trim(), token = $('hubAgentToken').value.trim();
    if (!/^https?:\/\/[^\s/]+/i.test(url)) { status('Informe o endereço do agente, por exemplo http://192.168.1.10:PORTA.'); $('hubAgentUrl').focus(); return; }
    if (!token) { status('Informe o token gerado pelo agente.'); $('hubAgentToken').focus(); return; }
    await withBusy($('hubAgentConnect'), 'Conectando…', async () => {
      try {
        const r = await window.panel.hubAgentConnect(url, token); safeSet(AGENT_URL_KEY, url);
        $('hubAgentInfo').textContent = `Conectado a ${r.info.name} · ${r.info.platform} · pasta ${r.info.root}`;
        state.agent = true; remotePath = ''; renderSummary(); await refreshRemote(); if (localChosen) await refreshLocal(); status('Agente Windows conectado.');
      } catch (e) { state.agent = false; renderSummary(); status('Não foi possível conectar: ' + failMsg(e)); }
    });
  }
  $('hubDiscoverAgents')?.addEventListener('click', async () => {
    const button=$('hubDiscoverAgents'), root=$('hubDiscoveredAgents');
    if(!root)return; root.textContent='Procurando agentes Yoru anunciados na rede local…';
    await withBusy(button,'Buscando…',async()=>{
      try{
        const result=await window.panel.hubDiscoverAgents(); root.textContent='';
        if(!result?.items?.length){root.append(mk('div','hub-muted',result?.message||'Nenhum agente encontrado. Confirme que o agente está ativo e que os computadores estão na mesma rede.'));return;}
        for(const device of result.items){
          const row=mk('div','hub-item'); const info=mk('span','',`${device.name} · ${device.platform} · ${device.url}`);
          const select=mkBtn('Usar endereço',()=>{ $('hubAgentUrl').value=device.url; $('hubAgentToken').focus(); status('Endereço preenchido. Informe o token mostrado no computador remoto para autorizar a conexão.'); });
          row.append(info,select);root.append(row);
        }
        status(result.message||'Busca de agentes concluída.');
      }catch(e){root.textContent='Falha na descoberta: '+failMsg(e);}
    });
  });
  $('hubAgentConnect')?.addEventListener('click', connectAgent);
  ['hubAgentUrl', 'hubAgentToken'].forEach((id) => $(id)?.addEventListener('keydown', (e) => { if (e.key === 'Enter') connectAgent(); }));
  $('hubAgentDisconnect')?.addEventListener('click', async () => {
    try { await window.panel.hubAgentDisconnect(); } catch { /* já desconectado */ }
    $('hubAgentInfo').textContent = 'Agente desconectado.'; $('hubAgentToken').value = ''; $('hubRemoteFiles').textContent = ''; $('hubRemotePath').textContent = 'Nenhum agente conectado.';
    state.agent = false; remotePath = ''; renderSummary(); if (localChosen) refreshLocal(); status('Conexão encerrada.');
  });

  // ---------- Android (ADB) ----------
  let androidDevices = [], androidPath = '/sdcard/Download';
  const androidSerial = () => { const s = $('hubAndroidDevice').value; if (!s) throw new Error('Selecione um Android autorizado (clique em Detectar Android).'); return s; };
  async function scanAndroid() {
    const box = $('hubAndroidInfo'), select = $('hubAndroidDevice'); box.textContent = 'Procurando ADB e aparelhos…';
    await withBusy($('hubAndroidScan'), 'Procurando…', async () => {
      try {
        const r = await window.panel.hubAndroidStatus(); select.textContent = ''; androidDevices = (r.devices || []);
        for (const d of androidDevices) { const o = mk('option', '', d.serial + ' · ' + d.state); o.value = d.serial; select.append(o); }
        if (!androidDevices.length) { const o = mk('option', '', 'Nenhum aparelho detectado'); o.value = ''; select.append(o); }
        box.textContent = r.available ? `${r.version} · ${androidDevices.length} aparelho(s). ${r.guidance}` : `ADB indisponível. ${r.error} ${r.guidance}`;
        state.android = androidDevices.length; renderSummary(); if (localChosen) refreshLocal();
      } catch (e) { box.textContent = failMsg(e); }
    });
  }
  $('hubAndroidScan')?.addEventListener('click', scanAndroid);
  async function browseAndroid(nextPath) {
    const serial = androidSerial(); androidPath = nextPath || '/sdcard/Download';
    const r = await window.panel.hubAndroidList(serial, androidPath); androidPath = r.path || androidPath;
    if ($('hubAndroidPath')) $('hubAndroidPath').value = androidPath;
    const box = $('hubAndroidFiles'); box.textContent = ''; box.append(mk('div', 'hub-item', androidPath));
    if (!r.items.length) { box.append(mk('div', 'hub-muted', 'Pasta vazia.')); return; }
    for (const item of sortItems(r.items)) {
      const isDir = item.type === 'directory'; const row = mk('div', 'hub-item'); row.append(mk('span', '', (isDir ? '📁 ' : '📄 ') + item.name));
      row.append(mkBtn(isDir ? 'Abrir' : '⬇ Baixar', async () => {
        try {
          const target = androidPath.replace(/\/$/, '') + '/' + item.name;
          if (isDir) { await browseAndroid(target); return; }
          await pullAndroid(serial, target);
        } catch (e) { status(failMsg(e)); }
      })); box.append(row);
    }
  }
  async function pullAndroid(serial, file) {
    if (!localChosen) throw new Error('Escolha primeiro uma pasta deste PC (Gerenciador de arquivos) para receber o arquivo.');
    status('Baixando do Android…'); const out = await window.panel.hubAndroidPull(serial, file, localPath); status('Arquivo Android recebido: ' + out.path); await refreshLocal();
  }
  async function sendToAndroid(relPath) {
    try { const serial = androidSerial(); const dest = ($('hubAndroidPath').value.trim() || '/sdcard/Download'); status('Enviando ao Android…'); const r = await window.panel.hubAndroidPush(serial, relPath, dest); status('Arquivo enviado para ' + r.remotePath); } catch (e) { status(failMsg(e)); }
  }
  $('hubAndroidBrowse')?.addEventListener('click', () => browseAndroid($('hubAndroidPath').value.trim() || androidPath).catch(e => status(failMsg(e))));
  $('hubAndroidUp')?.addEventListener('click', () => { const parts = androidPath.split('/').filter(Boolean); parts.pop(); browseAndroid('/' + parts.join('/')).catch(e => status(failMsg(e))); });
  $('hubAndroidWifiConnect')?.addEventListener('click', async () => { try { const target=$('hubAndroidWifiTarget').value.trim(); const r=await window.panel.hubAndroidConnectWifi(target); status(r.message||'Conexão ADB Wi-Fi solicitada.'); await scanAndroid(); } catch(e) { status(failMsg(e)); } });
  $('hubAndroidScreenStart')?.addEventListener('click', async () => { try { const audio=$('hubAndroidScreenAudio')?.checked===true; const r = await window.panel.hubAndroidScreenStart(androidSerial(), {audio}); status(r.message || 'Espelhamento iniciado.'); } catch (e) { status(failMsg(e)); } });
  $('hubAndroidScreenStop')?.addEventListener('click', async () => { try { await window.panel.hubAndroidScreenStop(); status('Sessão de tela encerrada.'); } catch (e) { status(failMsg(e)); } });
  $('hubAndroidPull')?.addEventListener('click', async () => {
    try {
      const serial = androidSerial(); const file = await ask('Baixar do Android', ($('hubAndroidPath').value.trim() || androidPath).replace(/\/$/, '') + '/', 'Caminho completo do arquivo no aparelho (somente /sdcard/). Dica: use “Listar pasta” e o botão Baixar de cada arquivo.');
      if (file) await pullAndroid(serial, file);
    } catch (e) { status(failMsg(e)); }
  });
  $('hubAndroidPush')?.addEventListener('click', async () => {
    try {
      androidSerial(); if (!localChosen) throw new Error('Escolha primeiro uma pasta deste PC (Gerenciador de arquivos).');
      const source = await ask('Enviar ao Android', localPath ? localPath + '/' : '', 'Caminho do arquivo relativo à pasta local escolhida. Dica: na lista “Este computador” há o botão “Enviar ao Android” em cada arquivo.');
      if (source) await sendToAndroid(source);
    } catch (e) { status(failMsg(e)); }
  });
  $('hubRefreshFiles')?.addEventListener('click', async () => { await refreshLocal(); await refreshRemote(); });

  // ---------- gerador de QR Code (100% local, sem rede) ----------
  let qrCurrent = null; // { text, qr }
  function setQrKind(kind) { const k = $('hubQrKind'); if (k) k.value = kind; }
  function qrPayload() {
    const kind = $('hubQrKind').value;
    if (kind === 'wifi') return window.YoruQR.wifiPayload({ ssid: $('hubQrSsid').value.trim(), password: $('hubQrPass').value, security: $('hubQrSec').value, hidden: $('hubQrHidden').checked });
    if (kind === 'share') { if (!shareUrls.length) throw new Error('Inicie o compartilhamento na rede local para gerar o QR Code do endereço.'); return shareUrls.includes(qrSelectedUrl) ? qrSelectedUrl : shareUrls[0]; }
    const t = $('hubQrText').value; if (!t.trim()) throw new Error('Digite um texto ou link para gerar o QR Code.'); return t;
  }
  function renderQr() {
    const out = $('hubQrOut'); if (!out) return;
    const kind = $('hubQrKind').value;
    $('hubQrTextBox').hidden = kind !== 'text'; $('hubQrWifiBox').hidden = kind !== 'wifi';
    $('hubQrSec').closest('.hub-qr-wifi').querySelector('#hubQrPass').disabled = $('hubQrSec').value === 'nopass';
    out.textContent = ''; qrCurrent = null;
    const setBtns = (on) => ['hubQrPng', 'hubQrSvg', 'hubQrCopy'].forEach((id) => { $(id).disabled = !on; });
    try {
      if (!window.YoruQR) throw new Error('Gerador de QR Code indisponível.');
      const text = qrPayload(); const qr = window.YoruQR.encode(text, { ecl: $('hubQrEcl').value });
      qrCurrent = { text, qr };
      const img = document.createElement('img'); img.alt = 'QR Code gerado'; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(window.YoruQR.toSvg(text, { ecl: $('hubQrEcl').value }));
      out.append(img, mk('small', 'hub-muted', kind === 'share' ? `Aponte a câmera do celular (mesmo Wi-Fi) · ${text}` : `${qr.size}×${qr.size} módulos · versão ${qr.version} · ${qr.bytes} byte(s)`));
      setBtns(true);
    } catch (e) { out.append(mk('div', 'hub-muted', failMsg(e))); setBtns(false); }
  }
  function downloadBlob(blob, name) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function qrPngBlob(qr) {
    const border = 4, dim = qr.size + border * 2, scale = Math.max(4, Math.ceil(640 / dim)); const c = document.createElement('canvas'); c.width = c.height = dim * scale;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#000';
    for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) g.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
    return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível gerar a imagem.'))), 'image/png'));
  }
  if ($('hubQrKind')) {
    ['hubQrKind', 'hubQrEcl', 'hubQrSec', 'hubQrHidden'].forEach((id) => $(id).addEventListener('change', renderQr));
    ['hubQrText', 'hubQrSsid', 'hubQrPass'].forEach((id) => $(id).addEventListener('input', renderQr));
    $('hubQrPng').addEventListener('click', async () => { try { downloadBlob(await qrPngBlob(qrCurrent.qr), 'yoru-qrcode.png'); status('QR Code salvo como PNG (pasta de downloads).'); } catch (e) { status(failMsg(e)); } });
    $('hubQrSvg').addEventListener('click', () => { try { downloadBlob(new Blob([window.YoruQR.toSvg(qrCurrent.text, { ecl: $('hubQrEcl').value })], { type: 'image/svg+xml' }), 'yoru-qrcode.svg'); status('QR Code salvo como SVG (pasta de downloads).'); } catch (e) { status(failMsg(e)); } });
    $('hubQrCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(qrCurrent.text); status('Conteúdo do QR Code copiado.'); } catch { status('Não foi possível copiar automaticamente.'); } });
    renderQr();
  }

  // ---------- histórico de ações ----------
  let historyPanel = null;
  function renderHistory() {
    if (!historyPanel) return;
    historyPanel.textContent = '';
    if (!history.length) { historyPanel.append(mk('div', 'hub-muted', 'Nenhuma ação registrada nesta sessão.')); return; }
    history.forEach((h) => { const row = mk('div', 'hub-muted', `${h.t.toLocaleTimeString('pt-BR')} · ${h.msg}`); row.style.padding = '2px 0'; row.style.overflowWrap = 'anywhere'; historyPanel.append(row); });
  }
  function setupHistory() {
    const bar = $('hubStatus'); if (!bar || historyPanel) return;
    historyPanel = mk('div', 'hub-history'); historyPanel.hidden = true; historyPanel.setAttribute('aria-label', 'Histórico de ações');
    Object.assign(historyPanel.style, { maxHeight: '180px', overflow: 'auto', margin: '12px 0 0', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: '10px', background: 'var(--card)', fontSize: '12px' });
    bar.before(historyPanel);
    const toggle = historyToggle = mkBtn('🕘 Histórico', () => { historyPanel.hidden = !historyPanel.hidden; toggle.setAttribute('aria-expanded', String(!historyPanel.hidden)); if (!historyPanel.hidden) renderHistory(); });
    toggle.setAttribute('aria-expanded', 'false'); toggle.style.marginLeft = 'auto'; toggle.style.padding = '5px 11px'; toggle.style.fontSize = '12px';
    $('hubSummary')?.append(toggle);
  }

  // ---------- restaura o que já estava ativo (compartilhamento, agente, pasta local) ----------
  async function syncStatus() {
    try {
      const r = await window.panel.hubStatus(); if (!r || r.error || r.denied) return;
      if (r.running) { renderShare('', r.urls || []); state.share = true; }
      if (r.agent) { $('hubAgentInfo').textContent = `Conectado a ${r.agent.info?.name || r.agent.baseUrl} · ${r.agent.info?.platform || ''} · pasta ${r.agent.info?.root || ''}`; state.agent = true; remotePath = ''; refreshRemote(); }
      if (r.localFolder) { localPath = ''; refreshLocal(); }
      renderSummary();
    } catch { /* sem estado anterior */ }
  }

  // ---------- primeira verificação: só quando a aba é aberta ----------
  renderSummary();
  let scanned = false;
  const firstScan = () => { if (scanned || !$('hubScan')) return; scanned = true; scan(); syncStatus(); initializeSmartHome(); };
  setupHistory();
  document.querySelector('.tab[data-tab="hub"]')?.addEventListener('click', firstScan);
  if ($('tab-hub')?.classList.contains('active')) firstScan();
})();
