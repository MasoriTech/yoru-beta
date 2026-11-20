param([ValidateRange(3,30)][int]$Seconds = 10)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
  $null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows, ContentType=WindowsRuntime]
  $null = [Windows.Devices.Enumeration.DeviceInformation, Windows, ContentType=WindowsRuntime]
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $items = @{}
  foreach ($paired in @($false, $true)) {
    $aqs = [Windows.Devices.Bluetooth.BluetoothDevice]::GetDeviceSelectorFromPairingState($paired)
    $op = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync($aqs)
    $task = $method.MakeGenericMethod([Windows.Devices.Enumeration.DeviceInformationCollection]).Invoke($null, @($op))
    $deadline = (Get-Date).AddSeconds($Seconds)
    while (-not $task.IsCompleted -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 150 }
    if (-not $task.IsCompleted) { continue }
    foreach ($d in $task.Result) {
      $m = [regex]::Match([string]$d.Id, '([0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5})')
      if (-not $m.Success -or -not $d.Name) { continue }
      $address = $m.Groups[1].Value.Replace(':','').ToUpper()
      $items[$address] = [pscustomobject]@{ address=$address; name=[string]$d.Name; paired=[bool]$d.Pairing.IsPaired; connectable=$true; source='Bluetooth próximo' }
    }
  }
  [pscustomobject]@{ ok=$true; items=@($items.Values) } | ConvertTo-Json -Depth 4 -Compress
} catch {
  [pscustomobject]@{ ok=$false; items=@(); error=$_.Exception.Message } | ConvertTo-Json -Depth 4 -Compress
}
