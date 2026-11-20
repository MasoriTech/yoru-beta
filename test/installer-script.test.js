'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const bat = fs.readFileSync(path.join(root, 'iniciar.bat'), 'utf8');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('iniciar.bat existe na raiz e inicia sempre a partir da pasta do pacote', () => {
  assert.match(bat, /cd \/d "%~dp0"/i);
  assert.match(bat, /call npm start/i);
  assert.match(pkg.version, /^0\.63\.0$/);
  assert.match(readme, /^# Yoru v0\.63\.0/m);
});

test('iniciar.bat valida Node x64 20+ e tenta WinGet quando estiver ausente', () => {
  assert.match(bat, /OpenJS\.NodeJS\.LTS/);
  assert.match(bat, /process\.arch/);
  assert.match(bat, /NODE_MAJOR! LSS 20/);
  assert.match(bat, /npm ci --no-audit --no-fund/);
  assert.match(bat, /npm install --no-audit --no-fund/);
  assert.match(bat, /if exist \"package-lock\.json\"/i);
});

test('iniciar.bat prepara Python e python-kasa para o conector Tapo', () => {
  assert.match(bat, /Python\.Python\.3\.12/);
  assert.match(bat, /python-kasa/);
  assert.match(bat, /import kasa/);
  assert.match(bat, /TAPO_READY/);
});

test('iniciar.bat prepara recursos locais e mantém Faster-Whisper opcional', () => {
  assert.match(bat, /npm run vendor/);
  assert.match(bat, /hand_landmarker\.task/);
  assert.match(bat, /--instalar-whisper/);
  assert.match(bat, /faster-whisper/);
});

test('iniciar.bat diagnostica integrações externas sem fingir instalá-las', () => {
  assert.match(bat, /where ollama/);
  assert.match(bat, /where adb/);
  assert.match(bat, /where scrcpy/);
  assert.match(readme, /não instala drivers Bluetooth\/Wi-Fi/i);
  assert.match(readme, /não baixa modelos Ollama/i);
});
