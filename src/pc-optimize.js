'use strict';
// Otimizar o PC (Windows): limpeza segura, energia, Modo de Jogo e programas que abrem com o Windows.
// Mesmo cuidado do pc-control.js: tudo passa por um "exec" injetável (nos testes é falso), só existem as ações
// da lista ACTIONS (um id desconhecido é recusado) e o único texto que vem de fora (o nome de um programa da
// inicialização) NUNCA entra no código do PowerShell: vai por variável de ambiente e só vale se já existir na lista.
// Não pede administrador: mexe só na conta do usuário (pasta temporária, chave HKCU, plano de energia).
const os = require('os');
const { defaultExec } = require('./pc-control');

const GUID = {
  high: '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c',
  balanced: '381b4222-f694-41f0-9685-ff5bb260df2e',
  saver: 'a1841308-3541-4fab-bc81-f71556f20b4a',
};

// o que o painel mostra (id, grupo, rótulo, explicação e se pede confirmação antes)
const ACTIONS = [
  { id: 'temp', group: 'limpeza', icon: '🧹', label: 'Limpar arquivos temporários', desc: 'Apaga da pasta temporária do seu usuário o que tem mais de 1 dia. Arquivos em uso são pulados.' },
  { id: 'dumps', group: 'limpeza', icon: '🧯', label: 'Limpar relatórios de erro', desc: 'Apaga despejos de memória e relatórios de erro do Windows (só do seu usuário).' },
  { id: 'browser', group: 'limpeza', icon: '🧭', label: 'Limpar o cache dos navegadores', desc: 'Chrome, Edge, Brave e Firefox: só o cache de páginas (senhas, histórico e logins ficam). Feche o navegador antes para limpar mais.' },
  { id: 'recycle', group: 'limpeza', icon: '🗑️', label: 'Esvaziar a lixeira', desc: 'Apaga de vez tudo o que está na lixeira. Não dá para desfazer.', confirm: true },
  { id: 'dns', group: 'limpeza', icon: '🌐', label: 'Limpar o cache de DNS', desc: 'Ajuda quando um site não abre ou abre o endereço antigo.' },
  { id: 'clean-all', group: 'limpeza', icon: '✨', label: 'Limpeza completa', desc: 'Faz de uma vez: temporários, relatórios de erro e cache dos navegadores. Não esvazia a lixeira.' },
  { id: 'power-high', group: 'energia', icon: '🚀', label: 'Alto desempenho', desc: 'Usa mais energia; em notebook gasta bateria mais rápido.' },
  { id: 'power-balanced', group: 'energia', icon: '⚖️', label: 'Equilibrado', desc: 'O plano padrão do Windows.' },
  { id: 'power-saver', group: 'energia', icon: '🔋', label: 'Economia de energia', desc: 'Reduz a velocidade do processador para gastar menos.' },
  { id: 'gamemode', group: 'energia', icon: '🎮', label: 'Ligar o Modo de Jogo do Windows', desc: 'O Windows dá prioridade ao jogo em tela cheia e segura atualizações durante a partida.' },
];
const ACTION_IDS = new Set(ACTIONS.map((a) => a.id));

// ---------- PowerShell (textos fixos; nada vindo de fora entra aqui) ----------
const HEAD = `$ErrorActionPreference = 'Continue'\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n`;

// apaga arquivos de uma lista fixa de pastas (mais velhos que N dias) e depois as pastas que ficaram vazias
function cleanScript(rootsExpr, days) {
  return `
$roots = ${rootsExpr}
$cut = (Get-Date).AddDays(-${days}); $freed = [int64]0
foreach ($root in $roots) {
  if (-not $root -or $root.Length -lt 12 -or -not (Test-Path -LiteralPath $root)) { continue }
  Get-ChildItem -LiteralPath $root -Recurse -Force -File -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt $cut -and -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
    ForEach-Object { $l = $_.Length; try { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop; $freed += $l } catch {} }
  Get-ChildItem -LiteralPath $root -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { -not ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) } |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object { try { if (-not (Get-ChildItem -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } } catch {} }
}
"OK|$freed"`;
}

const PS = {
  temp: cleanScript('@($env:TEMP)', 1),
  dumps: cleanScript('@("$env:LOCALAPPDATA\\CrashDumps", "$env:LOCALAPPDATA\\Microsoft\\Windows\\WER\\ReportArchive", "$env:LOCALAPPDATA\\Microsoft\\Windows\\WER\\ReportQueue")', 0),
  // só as pastas de cache de cada navegador (nunca Cookies, Login Data, History ou Preferences)
  browser: cleanScript(`@(
  "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\*\\Cache", "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\*\\Code Cache", "$env:LOCALAPPDATA\\Google\\Chrome\\User Data\\*\\GPUCache",
  "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\*\\Cache", "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\*\\Code Cache", "$env:LOCALAPPDATA\\Microsoft\\Edge\\User Data\\*\\GPUCache",
  "$env:LOCALAPPDATA\\BraveSoftware\\Brave-Browser\\User Data\\*\\Cache", "$env:LOCALAPPDATA\\BraveSoftware\\Brave-Browser\\User Data\\*\\Code Cache",
  "$env:LOCALAPPDATA\\Mozilla\\Firefox\\Profiles\\*\\cache2"
) | ForEach-Object { Resolve-Path -Path $_ -ErrorAction SilentlyContinue } | ForEach-Object { $_.ProviderPath }`, 0),
  recycle: `Clear-RecycleBin -Force -ErrorAction SilentlyContinue; 'OK|0'`,
  power: (guid) => `
powercfg /setactive ${guid} 2>$null
if ($LASTEXITCODE -ne 0 -and '${guid}' -eq '${GUID.high}') {
  $o = (powercfg /duplicatescheme ${guid}) -join ' '
  if ($o -match '([0-9a-fA-F-]{36})') { powercfg /setactive $Matches[1] 2>$null }
}
if ($LASTEXITCODE -eq 0) { 'OK|0' } else { 'FAIL' }`,
  gamemode: `
$k = 'HKCU:\\Software\\Microsoft\\GameBar'
if (-not (Test-Path $k)) { New-Item -Path $k -Force | Out-Null }
New-ItemProperty -Path $k -Name 'AutoGameModeEnabled' -Value 1 -PropertyType DWord -Force | Out-Null
New-ItemProperty -Path $k -Name 'AllowAutoGameMode' -Value 1 -PropertyType DWord -Force | Out-Null
'OK|0'`,
  // diagnóstico (só leitura): disco, pasta temporária, plano de energia e os processos que mais usam memória
  info: `
$sd = $env:SystemDrive.TrimEnd(':')
$d = Get-PSDrive -Name $sd -ErrorAction SilentlyContinue
$t = [int64]0
if ($env:TEMP -and (Test-Path -LiteralPath $env:TEMP)) { $t = [int64](Get-ChildItem -LiteralPath $env:TEMP -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum }
$plan = ((powercfg /getactivescheme) -join ' ')
$g = ''; $n = ''
if ($plan -match '([0-9a-fA-F-]{36})\\s*\\((.*)\\)') { $g = $Matches[1]; $n = $Matches[2] }
$top = @(Get-Process -ErrorAction SilentlyContinue | Sort-Object WorkingSet64 -Descending | Select-Object -First 6 | ForEach-Object { @{ name = $_.ProcessName; mb = [int]($_.WorkingSet64 / 1MB) } })
$o = @{ drive = $sd; freeB = [int64]$d.Free; usedB = [int64]$d.Used; tempB = $t; planGuid = $g.ToLower(); planName = $n; top = $top }
$o | ConvertTo-Json -Compress -Depth 4`,
  // programas que abrem com o Windows (só a chave do usuário: não precisa de administrador)
  startupList: `
$run = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$ap = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
$items = @()
$p = Get-ItemProperty -Path $run -ErrorAction SilentlyContinue
if ($p) {
  foreach ($prop in $p.PSObject.Properties) {
    if ($prop.Name -match '^PS(Path|ParentPath|ChildName|Drive|Provider)$') { continue }
    $v = $null; try { $v = (Get-ItemProperty -Path $ap -Name $prop.Name -ErrorAction Stop).($prop.Name) } catch {}
    $on = $true; if ($v -and ($v[0] -band 1)) { $on = $false }
    $items += @{ name = [string]$prop.Name; on = $on; cmd = [string]$prop.Value }
  }
}
ConvertTo-Json -Compress -InputObject @($items)`,
  startupSet: `
$run = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
$ap = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
$n = $env:YORU_Q; $on = ($env:YORU_ON -eq '1')
$p = Get-ItemProperty -Path $run -ErrorAction SilentlyContinue
$known = @(); if ($p) { $known = @($p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS(Path|ParentPath|ChildName|Drive|Provider)$' } | ForEach-Object { $_.Name }) }
if (-not $n -or ($known -notcontains $n)) { 'NOTFOUND'; exit 0 }
if (-not (Test-Path $ap)) { New-Item -Path $ap -Force | Out-Null }
$b = New-Object byte[] 12; if ($on) { $b[0] = 2 } else { $b[0] = 3 }
Set-ItemProperty -Path $ap -Name $n -Value $b -Type Binary
'OK|0'`,
};

const fmtMB = (b) => { const mb = (Number(b) || 0) / 1048576; return mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : (mb >= 10 ? Math.round(mb) : mb.toFixed(1)) + ' MB'; };
const GB = (b) => Math.round((Number(b) || 0) / 1e8) / 10;
const validName = (s) => typeof s === 'string' && s.length > 0 && s.length <= 200 && !/[\u0000-\u001f]/.test(s);

function createOptimizer({ platform = process.platform, exec = defaultExec } = {}) {
  const supported = platform === 'win32';
  const NO = { ok: false, error: 'Só funciona no Windows.' };

  function ps(body, env = {}, timeout = 60000) {
    const enc = Buffer.from(HEAD + body, 'utf16le').toString('base64');
    return exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc], { env, timeout });
  }
  const good = (r) => !!r && r.code === 0 && /^OK\|/m.test(r.out || '');
  const bytesOf = (r) => { const m = /^OK\|(\d+)/m.exec((r && r.out) || ''); return m ? Number(m[1]) : 0; };
  const json = (r, fallback) => { try { return JSON.parse((r.out || '').trim()); } catch (_) { return fallback; } };

  async function info() {
    if (!supported) return NO;
    const r = await ps(PS.info, {}, 90000);
    const d = json(r, null);
    if (!d || typeof d !== 'object') return { ok: false, error: 'Não consegui ler o estado do PC.' };
    const plan = Object.keys(GUID).find((k) => GUID[k] === d.planGuid) || null;
    const total = Number(d.freeB || 0) + Number(d.usedB || 0);
    return {
      ok: true,
      drive: String(d.drive || 'C'), freeGB: GB(d.freeB), totalGB: GB(total), freePct: total ? Math.round((Number(d.freeB) / total) * 100) : 0,
      tempMB: Math.round((Number(d.tempB) || 0) / 1048576), ramFreeGB: GB(os.freemem()), ramTotalGB: GB(os.totalmem()),
      plan, planName: String(d.planName || ''), top: (Array.isArray(d.top) ? d.top : (d.top ? [d.top] : [])).map((t) => ({ name: String(t.name), mb: Number(t.mb) || 0 })),
    };
  }

  async function runOne(id) {
    if (id === 'dns') {
      const r = await exec('ipconfig.exe', ['/flushdns'], { timeout: 15000 });
      return r.code === 0 ? { ok: true, message: 'Cache de DNS limpo.' } : { ok: false, error: 'Não consegui limpar o DNS.' };
    }
    const body = ['temp', 'dumps', 'browser', 'recycle', 'gamemode'].includes(id) ? PS[id] : PS.power(GUID[id.slice(6)]);
    const r = await ps(body, {}, ['temp', 'dumps', 'browser'].includes(id) ? 180000 : 30000);
    if (!good(r)) {
      if (id === 'power-high') return { ok: false, error: 'Este PC não aceitou o plano de alto desempenho.' };
      return { ok: false, error: 'Não deu certo.' + (r && r.err ? ' ' + r.err.split(/\r?\n/)[0].slice(0, 120) : '') };
    }
    switch (id) {
      case 'temp': case 'dumps': case 'browser': { const b = bytesOf(r); return { ok: true, freed: b, message: b > 0 ? `Pronto: ${fmtMB(b)} liberados.` : 'Nada para limpar agora.' }; }
      case 'recycle': return { ok: true, message: 'Lixeira esvaziada.' };
      case 'gamemode': return { ok: true, message: 'Modo de Jogo ligado.' };
      default: return { ok: true, message: 'Plano de energia trocado.' };
    }
  }

  async function run(id) {
    if (!supported) return NO;
    id = String(id || '');
    if (!ACTION_IDS.has(id)) return { ok: false, error: 'Ação desconhecida.' };
    if (id !== 'clean-all') return runOne(id);
    // limpeza completa: temporários + relatórios de erro + cache dos navegadores (a lixeira fica de fora de propósito)
    let freed = 0, okAny = false;
    for (const part of ['temp', 'dumps', 'browser']) { const r = await runOne(part); if (r.ok) { okAny = true; freed += r.freed || 0; } }
    if (!okAny) return { ok: false, error: 'Não consegui limpar nada.' };
    return { ok: true, freed, message: freed > 0 ? `Pronto: ${fmtMB(freed)} liberados (temporários, relatórios de erro e cache dos navegadores).` : 'Nada para limpar agora.' };
  }

  async function startupList() {
    if (!supported) return NO;
    const r = await ps(PS.startupList, {}, 20000);
    if (r.code !== 0) return { ok: false, error: 'Não consegui ler a lista.' };
    const arr = json(r, []);
    const list = (Array.isArray(arr) ? arr : [arr]).filter((x) => x && validName(x.name)).map((x) => ({ name: x.name, on: x.on !== false, cmd: String(x.cmd || '').slice(0, 300) }));
    return { ok: true, items: list };
  }

  async function startupSet(name, on) {
    if (!supported) return NO;
    if (!validName(name)) return { ok: false, error: 'Nome inválido.' };
    const r = await ps(PS.startupSet, { YORU_Q: name, YORU_ON: on ? '1' : '0' }, 20000);
    if (/^NOTFOUND/m.test(r.out || '')) return { ok: false, error: 'Esse programa não está mais na lista.' };
    return good(r) ? { ok: true } : { ok: false, error: 'Não consegui mudar.' };
  }

  return { supported, catalog: () => ACTIONS.map((a) => ({ ...a })), info, run, startupList, startupSet };
}

module.exports = { createOptimizer, ACTIONS, GUID, PS, fmtMB };
