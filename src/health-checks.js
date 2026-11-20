'use strict';
// Verificações locais e somente de leitura para orientar o diagnóstico do Yoru.
const fs = require('node:fs');
const path = require('node:path');

function createHealthChecks({ app, os, processRef = process, fsRef = fs, pathRef = path, rootDir = __dirname, userDataDir } = {}) {
  return async function run() {
    const checks = [];
    const add = (id, title, status, detail, action = '') => checks.push({ id, title, status, detail, action });
    const bytesToGb = (value) => Math.round(Number(value) / 1024 ** 3 * 10) / 10;
    const ramBytes = Number(os.totalmem()) || 0;
    const ram = bytesToGb(ramBytes);
    const freeRam = bytesToGb(Number(os.freemem?.()) || 0);
    const dataDir = userDataDir || app.getPath('userData');
    const root = pathRef.resolve(rootDir);

    add('runtime', 'Ambiente do Yoru', processRef.versions?.electron ? 'ok' : 'warning', `Electron ${processRef.versions?.electron || '?'} · Node ${processRef.versions?.node || '?'} · ${processRef.platform}/${processRef.arch}`, processRef.versions?.electron ? '' : 'Reinstale o aplicativo usando o instalador oficial.');
    add('ram', 'Memória instalada', ram >= 8 ? 'ok' : ram >= 4 ? 'warning' : 'error', `${ram} GB de RAM detectados`, ram < 8 ? 'Feche programas pesados e use o perfil leve em Desempenho.' : '');
    if (ramBytes > 0 && typeof os.freemem === 'function') {
      add('memory-free', 'Memória disponível agora', freeRam < 0.5 ? 'error' : freeRam < 1.5 ? 'warning' : 'ok', `${freeRam} GB livres no momento da verificação`, freeRam < 1.5 ? 'Feche aplicativos que estejam consumindo muita memória e repita a verificação.' : '');
    }

    let writable = false;
    try { await fsRef.promises.access(dataDir, fsRef.constants.W_OK); writable = true; } catch (_) {}
    add('userdata', 'Pasta de dados', writable ? 'ok' : 'error', writable ? 'A pasta de configurações permite gravação.' : 'O Yoru não consegue gravar na pasta de dados.', writable ? '' : 'Verifique as permissões da pasta de dados ou o espaço disponível no disco.');

    // statfs existe nas versões modernas do Node/Electron. Se o sistema não oferecer a API, o teste é omitido.
    if (typeof fsRef.promises.statfs === 'function') {
      try {
        const stat = await fsRef.promises.statfs(dataDir);
        const blockSize = Number(stat.bsize) || 0;
        const freeBytes = (Number(stat.bavail ?? stat.bfree) || 0) * blockSize;
        const freeGb = bytesToGb(freeBytes);
        add('disk-space', 'Espaço livre no disco', freeBytes < 512 * 1024 ** 2 ? 'error' : freeBytes < 2 * 1024 ** 3 ? 'warning' : 'ok', `${freeGb} GB livres no disco dos dados do Yoru`, freeBytes < 2 * 1024 ** 3 ? 'Libere espaço no disco antes de criar backups ou instalar modelos.' : '');
      } catch (_) { add('disk-space', 'Espaço livre no disco', 'warning', 'Não foi possível consultar o espaço livre deste disco.', 'Confira o espaço disponível pelo Explorador de Arquivos do Windows.'); }
    }

    const modules = [
      ['three', 'Renderização 3D', true, 'Se faltar, reinstale o Yoru.'],
      ['@pixiv/three-vrm', 'Leitor de avatar VRM', true, 'Se faltar, reinstale o Yoru.'],
      ['msedge-tts', 'Voz neural Edge TTS', false, 'A voz do sistema continua como alternativa.'],
      ['@huggingface/transformers', 'Reconhecimento integrado', true, 'Reinstale o Yoru para recuperar o componente.'],
      ['@mediapipe/tasks-vision', 'Gestos por câmera', false, 'Reinstale os componentes do Yoru se quiser usar Gestos.'],
      ['@whiskeysockets/baileys', 'Integração WhatsApp', false, 'Reinstale as dependências opcionais para usar a integração WhatsApp.'],
    ];
    for (const [name, title, required, action] of modules) {
      let found = false;
      try { require.resolve(name, { paths: [root, pathRef.join(root, '..')] }); found = true; } catch (_) {}
      add(`dep:${name}`, title, found ? 'ok' : required ? 'error' : 'warning', found ? 'Componente encontrado.' : required ? 'Componente obrigatório não encontrado.' : 'Componente opcional não encontrado.', found ? '' : action);
    }

    const assets = [
      { id: 'avatar-asset', file: pathRef.join(root, '..', 'assets', 'avatar.vrm'), title: 'Avatar padrão', action: 'Restaure o arquivo assets/avatar.vrm a partir do pacote oficial.' },
      { id: 'tapo-bridge', file: pathRef.join(root, 'tapo-bridge.py'), title: 'Conector Smart Home', action: 'Reinstale o Yoru para recuperar o conector da lâmpada Tapo.' },
      { id: 'bluetooth-tools', file: pathRef.join(root, '..', 'scripts', 'bt-classic-scan.ps1'), title: 'Ferramentas Bluetooth', action: 'Reinstale o Yoru para recuperar os scripts de conectividade.' },
    ];
    for (const item of assets) {
      let found = false;
      try { const st = await fsRef.promises.stat(item.file); found = st.isFile(); } catch (_) {}
      const optional = item.id === 'tapo-bridge' || item.id === 'bluetooth-tools';
      add(item.id, item.title, found ? 'ok' : optional ? 'warning' : 'error', found ? 'Arquivo encontrado.' : 'Arquivo esperado não encontrado.', found ? '' : item.action);
    }

    const errors = checks.filter((x) => x.status === 'error').length;
    const warnings = checks.filter((x) => x.status === 'warning').length;
    return { app: app.getName(), version: app.getVersion(), checkedAt: new Date().toISOString(), summary: errors ? 'attention' : warnings ? 'warning' : 'ok', counts: { ok: checks.length - errors - warnings, warning: warnings, error: errors }, checks };
  };
}

module.exports = { createHealthChecks };
