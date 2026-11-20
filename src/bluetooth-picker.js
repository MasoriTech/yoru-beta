'use strict';
(() => {
  const $ = id => document.getElementById(id);
  let devices = [];
  const status = (message, tone = '') => { const el=$('status'); el.textContent=String(message || ''); el.className='status'+(tone?' '+tone:''); };
  const make = (tag, className, text) => { const el=document.createElement(tag); if(className)el.className=className; if(text!=null)el.textContent=String(text); return el; };
  const iconFor = d => d.Kind==='speaker'?'🔊':d.Kind==='headphone'?'🎧':d.Kind==='phone'?'📱':d.Kind==='input'?'⌨️':'🔵';
  function renderList(data) {
    devices=Array.isArray(data.devices)?data.devices:[];
    $('confirm').hidden=true; $('list').hidden=false; $('list').replaceChildren();
    $('heading').textContent=devices.length?'Qual dispositivo você quer conectar?':'Nenhum dispositivo encontrado';
    $('subheading').textContent=data.message||'Dispositivos reconhecidos pelo Windows e encontrados por Bluetooth LE.';
    $('count').textContent=devices.length?(devices.length===1?'1 encontrado':`${devices.length} encontrados`):'';
    if(!devices.length){$('list').append(make('div','empty','Ligue o dispositivo ou coloque-o em modo de pareamento e peça uma nova busca.'));status(data.message||'Nenhum dispositivo encontrado.');return;}
    devices.forEach((device,index)=>{
      const row=make('article','device');
      const num=make('div','number',String(index+1));
      const info=make('div','');
      info.append(make('div','name',`${iconFor(device)}  ${device.FriendlyName||'Dispositivo sem nome'}`));
      info.append(make('div','meta',`${device.Status||'Estado não informado'} · ${device.Class||'Bluetooth'}`));
      info.append(make('span','tag',device.Source==='BLE próximo'||device.Source==='Bluetooth próximo'?'Encontrado nas proximidades':'Reconhecido pelo Windows'));
      const btn=make('button','btn','Selecionar');btn.type='button';btn.addEventListener('click',()=>window.bluetoothPicker.select(index));
      row.append(num,info,btn);$('list').append(row);
    });
    status('Lista pronta. Diga o número ou clique em Selecionar.');
  }
  function renderStage(data) {
    if(data.stage==='list'){renderList(data);return;}
    if(data.stage==='empty'){renderList({devices:[],message:data.message});return;}
    if(data.stage==='confirm'){
      $('list').hidden=true;$('confirm').hidden=false;$('heading').textContent='Confirme a conexão';$('subheading').textContent='A Yoru vai parear o dispositivo indicado.';$('count').textContent='';
      $('selectedName').textContent=data.device?.FriendlyName||'Dispositivo Bluetooth';$('selectedMeta').textContent=`${data.device?.Status||'Estado não informado'} · ${data.device?.Class||'Bluetooth'}`;$('confirmText').textContent=data.message||'Deseja iniciar a conexão com este dispositivo?';status('Aguardando sua confirmação.');return;
    }
    if(data.stage==='result'||data.stage==='error'||data.stage==='cancelled'){
      $('list').hidden=true;$('confirm').hidden=true;$('heading').textContent=data.stage==='result'?'Pareamento concluído':data.stage==='error'?'Não foi possível iniciar':'Seleção cancelada';$('subheading').textContent=data.device?.FriendlyName||'Bluetooth';$('count').textContent='';status(data.message||'',data.stage==='result'?'success':data.stage==='error'?'error':'');return;
    }
  }
  window.bluetoothPicker.onData(renderStage);
  $('confirmConnect').addEventListener('click',()=>window.bluetoothPicker.confirm());
  $('cancelConfirm').addEventListener('click',()=>window.bluetoothPicker.cancel());
  $('rescan').addEventListener('click',()=>{status('Buscando dispositivos…');window.bluetoothPicker.rescan();});
  $('close').addEventListener('click',()=>window.bluetoothPicker.close());
})();
