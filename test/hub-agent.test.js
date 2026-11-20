'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {createHubService}=require('../src/hub-service');
const script=path.join(__dirname,'..','scripts','yoru-hub-agent.js');
test('agente Yoru permite listar, receber e baixar apenas dentro da pasta autorizada',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yoru-agent-'));fs.writeFileSync(path.join(dir,'origem.txt'),'arquivo remoto');
 const token='a'.repeat(48);const hubDir=fs.mkdtempSync(path.join(os.tmpdir(),'yoru-hub-client-'));const hub=createHubService({userDataDir:hubDir});hub.setLocalFolder(hubDir);fs.writeFileSync(path.join(hubDir,'local.txt'),'arquivo local');const child=spawn(process.execPath,[script,dir,token],{stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.setEncoding('utf8');child.stdout.on('data',d=>output+=d);
 t.after(async()=>{child.kill('SIGINT');await hub.stop();hub.disconnectAgent();fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(hubDir,{recursive:true,force:true})});
 let match;for(let i=0;i<60&&!match;i++){await new Promise(r=>setTimeout(r,100));match=output.match(/Porta: (\d+)/)}
 assert.ok(match,'agente iniciou');const base='http://127.0.0.1:'+match[1],headers={Authorization:'Bearer '+token};
 const info=await fetch(base+'/api/info',{headers});assert.equal(info.status,200);
 const list=await (await fetch(base+'/api/list',{headers})).json();assert.equal(list.items[0].name,'origem.txt');
 const denied=await fetch(base+'/api/list');assert.equal(denied.status,401);
 const upload=await fetch(base+'/api/upload?name=novo.txt',{method:'PUT',headers,body:'novo'});assert.equal(upload.status,201);assert.equal(fs.readFileSync(path.join(dir,'novo.txt'),'utf8'),'novo');
 const download=await fetch(base+'/api/download?path=origem.txt',{headers});assert.equal(await download.text(),'arquivo remoto');
 const traversal=await fetch(base+'/api/list?path=..%2F..',{headers});assert.equal(traversal.status,400);
 const connected=await hub.connectAgent(base,token);assert.equal(connected.ok,true);assert.equal((await hub.agentList()).items.length,2);
 const sent=await hub.transferToAgent('local.txt');assert.equal(sent.name,'local.txt');assert.equal(sent.verified,true);assert.match(sent.sha256,/^[a-f0-9]{64}$/);
 const received=await hub.receiveFromAgent('origem.txt');assert.equal(fs.readFileSync(received.path,'utf8'),'arquivo remoto');assert.equal(received.verified,true);assert.match(received.sha256,/^[a-f0-9]{64}$/);
});

test('Yoru Hub valida caminhos Android antes de chamar ADB',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yoru-android-'));const hub=createHubService({userDataDir:dir});
 t.after(async()=>{await hub.stop();fs.rmSync(dir,{recursive:true,force:true});});
 await assert.rejects(()=>hub.androidPull('SERIAL','/sdcard/../data/secret',''),/caminho dentro de \/sdcard/i);
 await assert.rejects(()=>hub.androidPush('SERIAL','arquivo.txt','/data/local/tmp'),/caminho dentro de \/sdcard/i);
 await assert.rejects(()=>hub.androidPull('../SERIAL','/sdcard/Download/a.txt',''),/Identificador Android inválido/);
});
