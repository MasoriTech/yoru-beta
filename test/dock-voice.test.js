'use strict';
// Float Dock: a aba Conversa abre numa janela solo e é ela que ouve o microfone (antes ficava morta).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

test('voice-panel roda na janela solo da Conversa e não no dock nem em outras solo', () => {
  const v = read('voice-panel.js');
  assert.match(v, /get\('dockOnly'\) === '1'\) return/);
  assert.match(v, /get\('solo'\) && qs\.get\('solo'\) !== 'conversa'\) return/);
});
test('eventos de voz vão para quem ouve; fora do dock a Conversa leva ao painel principal', () => {
  const w = read('windows.js'), m = read('main.js');
  assert.match(m, /panel: \(\) => voicePanel\(\)/);
  assert.match(w, /function voicePanel\(\)/);
  assert.match(w, /tab === 'conversa' && !dockWin\(\)/);
  assert.match(w, /backgroundThrottling: false \} : \{\}/); // continua ouvindo escondida
  assert.match(w, /settings\.convListening\) setImmediate\(\(\) => openSolo\('conversa'/);
});
test('ligar a escuta por atalho/bandeja cria a janela que ouve (Float Dock)', () => {
  assert.match(read('main.js'), /convListening' in partial && settings\.convListening\) ensureVoiceWindow\(\)/);
  assert.match(read('windows.js'), /function ensureVoiceWindow\(\)[\s\S]{0,120}openSolo\('conversa', \{ show: false \}\)/);
});
