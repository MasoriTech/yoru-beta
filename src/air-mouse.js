'use strict';
// Mouse no ar (Windows): move o cursor e clica a partir dos gestos da mão. Um PowerShell fica aberto lendo comandos de uma linha
// (mexer o cursor 25 vezes por segundo abrindo um PowerShell a cada vez seria lento demais). Só 4 comandos existem:
//   m <x> <y> (posição 0..1 da tela) | d (botão esquerdo para baixo) | u (solta) | r (clique direito) | w <n> (roda do mouse, -1200..1200)
// Nada que vem do painel vira texto de comando: só números limitados a 0..1 e letras fixas.
const { spawn } = require('child_process');

const PS = `
$ErrorActionPreference = 'Stop'
Add-Type @"
using System; using System.Runtime.InteropServices;
public class M {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
}
"@
$w = [M]::GetSystemMetrics(0); $h = [M]::GetSystemMetrics(1)
$ci = [Globalization.CultureInfo]::InvariantCulture
while (($l = [Console]::In.ReadLine()) -ne $null) {
  $p = $l.Split(' ')
  switch ($p[0]) {
    'm' { [void][M]::SetCursorPos([int]([double]::Parse($p[1], $ci) * ($w - 1)), [int]([double]::Parse($p[2], $ci) * ($h - 1))) }
    'd' { [M]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero) }
    'u' { [M]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
    'r' { [M]::mouse_event(8, 0, 0, 0, [UIntPtr]::Zero); [M]::mouse_event(16, 0, 0, 0, [UIntPtr]::Zero) }
    'w' { [M]::mouse_event(2048, 0, 0, [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$p[1]), 0), [UIntPtr]::Zero) }
    'q' { exit }
  }
}
`;

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));

function createAirMouse({ platform = process.platform, spawnFn = spawn, idleMs = 10000 } = {}) {
  const supported = platform === 'win32';
  let proc = null;
  let idle = null;
  let down = false; // botão esquerdo apertado por nós: sempre soltamos ao parar

  function ensure() {
    if (proc) return true;
    if (!supported) return false;
    try {
      const enc = Buffer.from(PS, 'utf16le').toString('base64');
      proc = spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      const gone = () => { proc = null; down = false; };
      proc.on('exit', gone);
      proc.on('error', gone);
      if (proc.stdin) proc.stdin.on('error', () => {});
    } catch (_) { proc = null; return false; }
    return true;
  }
  function write(line) {
    if (!ensure()) return false;
    try { proc.stdin.write(line + '\n'); } catch (_) { return false; }
    clearTimeout(idle);
    // painel travou ou fechou sem avisar: solta o botão e encerra
    idle = setTimeout(() => stop(), idleMs);
    if (idle.unref) idle.unref();
    return true;
  }
  function stop() {
    clearTimeout(idle);
    if (!proc) return;
    const p = proc;
    try { if (down) p.stdin.write('u\n'); p.stdin.write('q\n'); p.stdin.end(); } catch (_) { /* já fechou */ }
    setTimeout(() => { try { p.kill(); } catch (_) {} }, 500).unref();
    proc = null; down = false;
  }

  // msg vem do painel (não é de confiança): { t: 'm', x, y } | { t: 'd' | 'u' | 'r' } | { t: 'w', d } | { t: 'off' }
  function handle(msg) {
    if (!msg || typeof msg !== 'object') return false;
    switch (msg.t) {
      case 'm':
        if (!Number.isFinite(Number(msg.x)) || !Number.isFinite(Number(msg.y))) return false;
        return write(`m ${clamp01(msg.x).toFixed(4)} ${clamp01(msg.y).toFixed(4)}`);
      case 'd': down = true; return write('d');
      case 'u': down = false; return write('u');
      case 'r': return write('r');
      case 'w': {   // roda do mouse: número inteiro limitado, nunca texto
        const n = Math.round(Number(msg.d));
        if (!Number.isFinite(n) || n === 0) return false;
        return write(`w ${Math.max(-1200, Math.min(1200, n))}`);
      }
      case 'off': stop(); return true;
      default: return false;
    }
  }
  return { supported, handle, stop, isRunning: () => !!proc };
}

module.exports = { createAirMouse, PS };
