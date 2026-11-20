#!/usr/bin/env node
'use strict';
// Prepara o OpenClaw para o Yoru usar as skills dele.
//
// O gateway do OpenClaw traz o endpoint de chat (/v1/chat/completions) DESLIGADO. Este script liga
// gateway.http.endpoints.chatCompletions.enabled no ~/.openclaw/openclaw.json e mostra onde está o token.
//
//   npm run setup:openclaw                  só mostra o que mudaria (não grava nada)
//   npm run setup:openclaw -- --apply       grava (antes faz uma cópia de segurança ao lado do arquivo)
//   npm run setup:openclaw -- --config C:\caminho\openclaw.json
//   npm run setup:openclaw -- --show-token  mostra o token inteiro (por padrão aparece mascarado)
//
// Só edita arquivos em JSON puro. Se o seu openclaw.json tiver comentários ou vírgulas sobrando (JSON5),
// o script NÃO reescreve: mostra o trecho para você colar à mão.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { plan, mask, SNIPPET } = require('../src/openclaw-detect'); // mesma lógica do botão "Detectar OpenClaw" do painel

function parseArgs(argv) {
  const o = { apply: false, showToken: false, config: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--apply') o.apply = true;
    else if (argv[i] === '--show-token') o.showToken = true;
    else if (argv[i] === '--config') o.config = argv[++i] || '';
    else if (argv[i] === '-h' || argv[i] === '--help') o.help = true;
  }
  return o;
}

function main(argv = process.argv.slice(2), out = console.log) {
  const a = parseArgs(argv);
  if (a.help) { out(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return 0; }
  const file = a.config || path.join(os.homedir(), '.openclaw', 'openclaw.json');
  if (!fs.existsSync(file)) {
    out(`Não encontrei ${file}.\nO OpenClaw está instalado e já passou pelo onboarding (openclaw onboard)? Se o arquivo estiver em outro lugar, use --config <caminho>.`);
    return 1;
  }
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) {
    out(`${file} não é JSON puro (deve ter comentários ou vírgulas sobrando), então não vou reescrever. Abra o arquivo e junte este trecho:\n\n${SNIPPET}\n`);
    return 2;
  }
  const p = plan(cfg);
  out(`Arquivo: ${file}`);
  out(p.changed ? 'Endpoint de chat (gateway.http.endpoints.chatCompletions.enabled): DESLIGADO → vai ligar.' : 'Endpoint de chat: já está ligado, nada a mudar.');
  if (p.secret) out(`Token do gateway (modo ${p.mode}): ${a.showToken ? p.secret : mask(p.secret)}${a.showToken ? '' : '  (use --show-token para ver inteiro)'}`);
  p.notes.forEach((n) => out(`Atenção: ${n}`));

  if (p.changed) {
    if (!a.apply) out('\nNada foi gravado. Rode de novo com --apply para aplicar.');
    else {
      const bak = `${file}.yoru-bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      fs.copyFileSync(file, bak);
      fs.writeFileSync(file, JSON.stringify(p.next, null, 2) + '\n');
      out(`\nGravado. Cópia de segurança: ${bak}\nO gateway recarrega a configuração sozinho; se as skills não aparecerem, reinicie o gateway.`);
    }
  }
  out('\nNo Yoru: painel › aba IA › provedor "OpenClaw (agente)" › cole o token › modelo "openclaw/default" › Salvar.');
  return 0;
}

if (require.main === module) process.exit(main());
module.exports = { plan, mask, parseArgs, main, SNIPPET };
