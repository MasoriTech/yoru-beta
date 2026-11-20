'use strict';
// Controle do computador (Windows): volume, mídia, janelas, programas, print da tela e energia.
// Tudo passa por um "exec" injetável (nos testes é falso). Os textos que vêm da fala NUNCA entram
// no código do PowerShell: vão por variável de ambiente (YORU_Q), então não há injeção de comando.

const { execFile } = require('child_process');
const path = require('path');

const PS_HEAD = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type @"
using System; using System.Runtime.InteropServices;
public class Y {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$self = $env:YORU_SELF
function Key($vk, $ext) { $f = 0; if ($ext) { $f = 1 }; [Y]::keybd_event([byte]$vk, 0, $f, [UIntPtr]::Zero); [Y]::keybd_event([byte]$vk, 0, ($f -bor 2), [UIntPtr]::Zero) }
function Combo($mod, $vk) { [Y]::keybd_event([byte]$mod, 0, 0, [UIntPtr]::Zero); Key $vk $false; [Y]::keybd_event([byte]$mod, 0, 2, [UIntPtr]::Zero) }
function ProcOf($h) { $p = [uint32]0; [void][Y]::GetWindowThreadProcessId($h, [ref]$p); try { (Get-Process -Id $p).ProcessName } catch { '' } }
# janela em foco que não é o próprio avatar/painel (anda pela ordem das janelas, de cima para baixo)
function FrontWindow() {
  $h = [Y]::GetForegroundWindow()
  for ($i = 0; $i -lt 60 -and $h -ne [IntPtr]::Zero; $i++) {
    $n = ProcOf $h
    if ([Y]::IsWindowVisible($h) -and [Y]::GetWindowTextLength($h) -gt 0 -and $n -ne $self -and $n -ne 'explorer' -and $n -ne 'ShellExperienceHost' -and $n -ne 'SearchHost') { return $h }
    $h = [Y]::GetWindow($h, 2)
  }
  return [IntPtr]::Zero
}
function FindByQuery($q) {
  $cands = $q.ToLower().Split('|') | Where-Object { $_ }
  foreach ($c0 in $cands) {
    $c = [System.Management.Automation.WildcardPattern]::Escape($c0)
    $r = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -ne $self -and ($_.ProcessName.ToLower() -like "*$c*" -or $_.MainWindowTitle.ToLower() -like "*$c*") } | Select-Object -First 1
    if ($r) { return $r }
  }
  return $null
}
function Focus($h) {
  if ([Y]::IsIconic($h)) { [void][Y]::ShowWindow($h, 9) }
  [Y]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); [void][Y]::SetForegroundWindow($h); [Y]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
}
`;

const PS = {
  key: `Key ([int]$env:YORU_VK) $true; $n = [int]$env:YORU_N; for ($i = 1; $i -lt $n; $i++) { Start-Sleep -Milliseconds 15; Key ([int]$env:YORU_VK) $true }; 'OK'`,
  volumeSet: `for ($i = 0; $i -lt 50; $i++) { Key 0xAE $true }; $n = [int]([math]::Round([int]$env:YORU_N / 2)); for ($i = 0; $i -lt $n; $i++) { Key 0xAF $true }; 'OK'`,
  win: `
$act = $env:YORU_ACT; $q = $env:YORU_Q
if ($q) {
  $p = FindByQuery $q
  if (-not $p) { 'NOTFOUND'; exit 0 }
  $h = $p.MainWindowHandle; $name = $p.ProcessName
} else {
  $h = FrontWindow
  if ($h -eq [IntPtr]::Zero) { 'NOTFOUND'; exit 0 }
  $name = ProcOf $h
}
switch ($act) {
  'minimize' { [void][Y]::ShowWindow($h, 6) }
  'maximize' { [void][Y]::ShowWindow($h, 3) }
  'restore'  { [void][Y]::ShowWindow($h, 9) }
  'close'    { [void][Y]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
  'focus'    { Focus $h }
  'closetab' { Focus $h; Start-Sleep -Milliseconds 250; Combo 0x11 0x57 }
}
"OK|$name"`,
  switch: `Combo 0x12 0x09; 'OK'`,
  desktop: `(New-Object -ComObject Shell.Application).ToggleDesktop(); 'OK'`,
  list: `Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.ProcessName -ne $self -and $_.ProcessName -ne 'TextInputHost' } | ForEach-Object { $_.ProcessName + '|' + $_.MainWindowTitle }`,
  launch: `
$q = $env:YORU_Q.ToLower()
$apps = Get-StartApps | Where-Object { $_.Name -and $_.Name.ToLower() -notmatch 'uninstall|desinstal' }
$app = $apps | Where-Object { $_.Name.ToLower() -eq $q } | Select-Object -First 1
if (-not $app) { $app = $apps | Where-Object { $_.Name.ToLower().Contains($q) } | Sort-Object { $_.Name.Length } | Select-Object -First 1 }
if (-not $app) {
  $parts = $q -split ' ' | Where-Object { $_.Length -gt 2 }
  if ($parts) { $app = $apps | Where-Object { $n = $_.Name.ToLower(); -not ($parts | Where-Object { -not $n.Contains($_) }) } | Select-Object -First 1 }
}
if ($app) { Start-Process ('shell:AppsFolder\\' + $app.AppID); 'OK|' + $app.Name } else { 'NOTFOUND' }`,
  screenshot: `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$b = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)
$dir = [Environment]::GetFolderPath('MyPictures'); if (-not $dir) { $dir = $env:USERPROFILE }
$f = Join-Path $dir ('Yoru-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
$bmp.Save($f, [System.Drawing.Imaging.ImageFormat]::Png)
try { [System.Windows.Forms.Clipboard]::SetImage($bmp) } catch {}
'OK|' + $f`,
};

const VK = { 'arrow-left': 0x25, 'arrow-right': 0x27, 'volume-mute': 0xAD, 'volume-down': 0xAE, 'volume-up': 0xAF, 'media-next': 0xB0, 'media-prev': 0xB1, 'media-playpause': 0xB3 };

function defaultExec(file, args, { env = {}, timeout = 15000 } = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { env: { ...process.env, ...env }, timeout, windowsHide: true, encoding: 'utf8' }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, out: String(stdout || '').trim(), err: String(stderr || (err && err.message) || '').trim() });
    });
  });
}

function createPc({ platform = process.platform, exec = defaultExec, selfName = path.basename(process.execPath || '', '.exe') } = {}) {
  const supported = platform === 'win32';

  function ps(body, env = {}) {
    const script = PS_HEAD + '\n' + body;
    const enc = Buffer.from(script, 'utf16le').toString('base64');
    return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { env: { YORU_SELF: selfName, ...env }, timeout: 20000 });
  }
  const ok = (r) => r && r.code === 0 && !/^NOTFOUND/.test(r.out);

  return {
    supported,

    async volume(op, arg) {
      if (op === 'set') return ok(await ps(PS.volumeSet, { YORU_N: String(Math.max(0, Math.min(100, Math.round(arg)))) }));
      const vk = VK['volume-' + op];
      if (!vk) return false;
      return ok(await ps(PS.key, { YORU_VK: String(vk), YORU_N: String(op === 'mute' ? 1 : Math.max(1, Math.min(50, arg || 5))) }));
    },

    // seta esquerda/direita (passar slides); a tecla vai para a janela em foco
    async arrow(dir) {
      const vk = VK['arrow-' + dir];
      return vk ? ok(await ps(PS.key, { YORU_VK: String(vk), YORU_N: '1' })) : false;
    },

    async media(op) {
      const vk = VK['media-' + op];
      return vk ? ok(await ps(PS.key, { YORU_VK: String(vk), YORU_N: '1' })) : false;
    },

    // act: minimize | maximize | restore | close | closetab | focus; query: "chrome|msedge" ou '' (janela em foco)
    async window(act, query) {
      const r = await ps(PS.win, { YORU_ACT: act, YORU_Q: query || '' });
      if (!ok(r)) return { ok: false, found: !/NOTFOUND/.test(r.out || ''), error: r.err };
      return { ok: true, found: true, name: (r.out.split('|')[1] || '').trim() };
    },

    async switchWindow() { return ok(await ps(PS.switch)); },
    async desktop() { return ok(await ps(PS.desktop)); },

    async list() {
      const r = await ps(PS.list);
      if (r.code !== 0) return [];
      return r.out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf('|'); return { proc: l.slice(0, i), title: l.slice(i + 1) }; });
    },

    async launch(name) {
      const r = await ps(PS.launch, { YORU_Q: String(name || '').slice(0, 60) });
      return ok(r) ? { ok: true, name: (r.out.split('|')[1] || name).trim() } : { ok: false };
    },

    async screenshot() {
      const r = await ps(PS.screenshot);
      return ok(r) ? { ok: true, file: r.out.split('|')[1] } : { ok: false };
    },

    async lock() { return (await exec('rundll32.exe', ['user32.dll,LockWorkStation'])).code === 0; },
    async sleep() { return (await exec('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'])).code === 0; },
    // 30 s de aviso: dá tempo de cancelar ("cancelar desligamento")
    async shutdown() { return (await exec('shutdown.exe', ['/s', '/t', '30', '/c', 'Yoru: desligando em 30 segundos'])).code === 0; },
    async restart() { return (await exec('shutdown.exe', ['/r', '/t', '30', '/c', 'Yoru: reiniciando em 30 segundos'])).code === 0; },
    async cancelPower() { return (await exec('shutdown.exe', ['/a'])).code === 0; },
  };
}

module.exports = { createPc, PS_HEAD, PS, VK, defaultExec };
