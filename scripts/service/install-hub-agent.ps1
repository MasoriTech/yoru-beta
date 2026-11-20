param([string]$Root = "$env:USERPROFILE\Documents\YoruHub-Compartilhado")
$ErrorActionPreference = 'Stop'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$project = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$agent = Join-Path $project 'scripts\yoru-hub-agent.js'
if (!(Test-Path $agent)) { throw "Agente não encontrado: $agent" }
New-Item -ItemType Directory -Force -Path $Root | Out-Null
$name = 'YoruHubAgent'
$action = New-ScheduledTaskAction -Execute $node -Argument ('"' + $agent + '" "' + $Root + '"') -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 2) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Agente local do Yoru Hub; acessível somente na rede privada mediante token.' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Write-Host "Agente Yoru Hub instalado para iniciar no logon. Pasta: $Root"
Write-Host 'Consulte o histórico/saída da tarefa no Agendador de Tarefas. Não exponha a porta à internet.'
