'use strict';
// Agente opcional para outro computador Windows. Execute: node scripts/yoru-hub-agent.js <pasta-compartilhada> [token]
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const dgram = require('dgram');
const requestedRoot = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(requestedRoot) || !fs.statSync(requestedRoot).isDirectory()) {
  console.error('Uso: node scripts/yoru-hub-agent.js <pasta-compartilhada> [token]'); process.exit(2);
}
const root = fs.realpathSync(requestedRoot);
const token = process.argv[3] || crypto.randomBytes(24).toString('hex');
const safe = (rel='') => {
  const target = path.resolve(root, String(rel).replace(/\\/g, '/'));
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Caminho fora da pasta compartilhada');
  let cursor = root;
  for (const part of path.relative(root, target).split(path.sep).filter(Boolean)) { cursor = path.join(cursor, part); if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Links simbólicos não são permitidos'); }
  return target;
};
const auth = (req,res) => { const h=String(req.headers.authorization||''); const got=h.startsWith('Bearer ')?h.slice(7):''; if(got.length!==token.length || !crypto.timingSafeEqual(Buffer.from(got),Buffer.from(token))){res.writeHead(401);res.end('Unauthorized');return false;} return true; };
const TLS_CERT = process.env.YORU_HUB_TLS_CERT;
const TLS_KEY = process.env.YORU_HUB_TLS_KEY;
if (Boolean(TLS_CERT) !== Boolean(TLS_KEY)) { console.error('Defina YORU_HUB_TLS_CERT e YORU_HUB_TLS_KEY juntos.'); process.exit(2); }
const transport = TLS_CERT ? https : http;
function hashFile(file) { const h=crypto.createHash('sha256'); const fd=fs.openSync(file,'r'); try { const b=Buffer.allocUnsafe(1024*1024); let n; while((n=fs.readSync(fd,b,0,b.length,null))>0) h.update(b.subarray(0,n)); } finally { fs.closeSync(fd); } return h.digest('hex'); }
const server=transport.createServer(TLS_CERT ? { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY), minVersion: 'TLSv1.2' } : {}, (req,res)=>{
  if(!auth(req,res))return;
  const u=new URL(req.url,'http://localhost');
  try {
    if(req.method==='GET'&&u.pathname==='/api/info'){res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({name:os.hostname(),platform:process.platform,root:path.basename(root)}));}
    if(req.method==='GET'&&u.pathname==='/api/list'){const dir=safe(u.searchParams.get('path')||'');const items=fs.readdirSync(dir,{withFileTypes:true}).map(d=>{const p=path.join(dir,d.name);let st;try{if(d.isSymbolicLink())return null;st=fs.statSync(p)}catch(_){return null}return {name:d.name,type:d.isDirectory()?'directory':'file',size:st.size,modifiedAt:st.mtime.toISOString()}}).filter(Boolean).slice(0,1000);res.writeHead(200,{'content-type':'application/json'});return res.end(JSON.stringify({path:u.searchParams.get('path')||'',items}));}
    if(req.method==='GET'&&u.pathname==='/api/download'){const p=safe(u.searchParams.get('path')||'');if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);return res.end('Not found')}const st=fs.statSync(p);res.writeHead(200,{'content-type':'application/octet-stream','content-length':st.size,'x-yoru-sha256':hashFile(p),'content-disposition':`attachment; filename="${path.basename(p).replace(/[\"\r\n]/g,'_')}"`});return fs.createReadStream(p).pipe(res)}
    if(req.method==='PUT'&&u.pathname==='/api/upload'){const rel=u.searchParams.get('path')||'';const name=path.basename(u.searchParams.get('name')||'arquivo.bin').replace(/[<>:"|?*\x00-\x1f]/g,'_');const dest=safe(path.join(rel,name));if(!dest.startsWith(root+path.sep)){res.writeHead(400);return res.end('Invalid path')}if(fs.existsSync(dest)){res.writeHead(409);return res.end('File exists')}let size=0,failed=false;const digest=crypto.createHash('sha256');const out=fs.createWriteStream(dest,{flags:'wx'});req.on('data',c=>{size+=c.length;digest.update(c);if(size>100*1024*1024){failed=true;req.destroy();out.destroy()}});req.pipe(out);out.on('finish',()=>{res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({ok:true,size,name,sha256:digest.digest('hex')}))});out.on('error',()=>{if(!res.headersSent){res.writeHead(failed?413:500);res.end('Upload failed')}});return;}
    res.writeHead(404);res.end('Not found');
  } catch(e){res.writeHead(400,{'content-type':'text/plain'});res.end(e.message)}
});
let discoverySocket=null, advertiseTimer=null;
server.listen(0,'0.0.0.0',()=>{
  const port=server.address().port;
  discoverySocket=dgram.createSocket('udp4');
  const advertise=()=>{
    for(const xs of Object.values(os.networkInterfaces())) for(const x of xs||[]) if(!x.internal&&x.family==='IPv4'){
      const payload=Buffer.from(JSON.stringify({service:'yoru-hub-agent',name:os.hostname(),platform:process.platform,address:x.address,port,protocol:TLS_CERT?'https':'http',seenAt:Date.now()}));
      discoverySocket.send(payload,47777,'239.255.77.77',()=>{});
      const ip=x.address.split('.').map(Number), mask=String(x.netmask||'255.255.255.0').split('.').map(Number);
      if(ip.length===4&&mask.length===4){const broadcast=ip.map((v,i)=>(v&mask[i])|(255^mask[i])).join('.');try{discoverySocket.setBroadcast(true);}catch(_){}discoverySocket.send(payload,47777,broadcast,()=>{});}
    }
  };
  discoverySocket.on('error',()=>{}); try{discoverySocket.setMulticastTTL(1);}catch(_){}
  advertise(); advertiseTimer=setInterval(advertise,5000);
  console.log('\nYoru Hub Agent ativo'); console.log(`Computador: ${os.hostname()}`); console.log(`Pasta compartilhada: ${root}`); console.log(`Porta: ${port}`); console.log(`Token: ${token}`);
  for(const xs of Object.values(os.networkInterfaces())) for(const x of xs||[]) if(!x.internal&&x.family==='IPv4') console.log(`Endereço: ${TLS_CERT ? 'https' : 'http'}://${x.address}:${port}`);
  console.log(TLS_CERT ? 'TLS ativo. Use certificado confiável no cliente.' : 'AVISO: HTTP sem criptografia. Use somente em rede privada confiável; nunca exponha à internet.'); console.log('CTRL+C encerra.\n');
});
process.on('SIGINT',()=>{if(advertiseTimer)clearInterval(advertiseTimer);try{discoverySocket?.close()}catch(_){}server.close(()=>process.exit(0));});
