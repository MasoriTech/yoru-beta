$ErrorActionPreference = 'Stop'
$name = 'YoruHubAgent'
$task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if ($task) { Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Host 'Inicialização automática do Yoru Hub removida.' }
else { Write-Host 'A tarefa YoruHubAgent não está instalada.' }
