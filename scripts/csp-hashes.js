'use strict';
// A janela do avatar (src/index.html) mantém dois scripts inline (tratamento de erro e escolha do caminho do three.js)
// e monta um importmap em tempo de execução. Com a CSP sem 'unsafe-inline', cada um deles precisa de um hash.
// Este script calcula os hashes a partir do próprio HTML (o importmap é obtido rodando o carregador com um DOM falso,
// uma vez com cada caminho disponível) e, com --write, atualiza a <meta> de CSP do index.html.
//   node scripts/csp-hashes.js          -> mostra a CSP esperada
//   node scripts/csp-hashes.js --write  -> grava no src/index.html
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, '..', 'src', 'index.html');
const sha = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;

function inlineScripts(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

// roda o carregador de caminhos e devolve o texto do importmap que ele montaria quando o sondado existe (ou não)
function importMaps(loaderSrc) {
  const SOURCES_PROBES = [...loaderSrc.matchAll(/probe: '([^']+)'/g)].map((m) => m[1]);
  const maps = [];
  for (const okProbe of SOURCES_PROBES) {
    const el = { };
    const doc = { createElement: () => el, currentScript: { after: () => {} } };
    class XHR { open(_m, u) { this.u = u; } send() { this.status = this.u === okProbe ? 200 : 404; this.responseText = ''; } }
    new Function('document', 'XMLHttpRequest', 'showErr', 'console', loaderSrc)(doc, XHR, () => {}, { log() {} });
    maps.push(el.textContent);
  }
  return [...new Set(maps)];
}

function policy(html) {
  const scripts = inlineScripts(html);
  const loader = scripts.find((s) => s.includes('importmap'));
  if (!loader) throw new Error('carregador do importmap não encontrado no index.html');
  const hashes = [...scripts, ...importMaps(loader)].map(sha);
  return [
    "default-src 'none'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file:",
    "media-src 'self' blob: data: file:",
    "connect-src 'self' file: blob: data:",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'",
  ].join('; ');
}

const META = /<meta http-equiv="Content-Security-Policy" content="[^"]*" \/>/;
function apply(html) {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy(html)}" />`;
  return META.test(html) ? html.replace(META, tag) : html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n  ${tag}`);
}

module.exports = { policy, apply, inlineScripts, importMaps, META };

if (require.main === module) {
  const html = fs.readFileSync(FILE, 'utf8');
  if (process.argv.includes('--write')) { fs.writeFileSync(FILE, apply(html)); console.log('CSP do index.html atualizada.'); }
  else console.log(policy(html));
}
