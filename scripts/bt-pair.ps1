param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{12}$')][string]$Address,
  [ValidateRange(10,90)][int]$TimeoutSeconds = 40
)
$ErrorActionPreference = 'Stop'
function Out-Json($obj) { $obj | ConvertTo-Json -Depth 5 -Compress }
# Espera uma operação assíncrona do Windows Runtime sem bloquear a thread (permite que o handler de pareamento rode).
function Wait-WinRT($operation, [Type]$resultType, [int]$seconds) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  if (-not $method) { throw 'Não foi possível preparar a chamada assíncrona do Windows Runtime.' }
  $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $deadline = (Get-Date).AddSeconds($seconds)
  while (-not $task.IsCompleted) {
    if ((Get-Date) -gt $deadline) { throw 'Tempo esgotado. Coloque o dispositivo em modo de pareamento e tente de novo.' }
    Start-Sleep -Milliseconds 150
  }
  if ($task.IsFaulted) { throw $task.Exception.InnerException }
  $task.Result
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
  $null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows, ContentType=WindowsRuntime]
  $null = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows, ContentType=WindowsRuntime]
  $null = [Windows.Devices.Enumeration.DeviceInformationCustomPairing, Windows, ContentType=WindowsRuntime]
  $null = [Windows.Devices.Enumeration.DevicePairingResult, Windows, ContentType=WindowsRuntime]
  $addr = [Convert]::ToUInt64($Address, 16)

  # Bluetooth clássico (caixas de som, fones, teclados) primeiro; BLE como alternativa.
  $device = Wait-WinRT ([Windows.Devices.Bluetooth.BluetoothDevice]::FromBluetoothAddressAsync($addr)) ([Windows.Devices.Bluetooth.BluetoothDevice]) 15
  $kind = 'classic'
  if (-not $device) {
    $device = Wait-WinRT ([Windows.Devices.Bluetooth.BluetoothLEDevice]::FromBluetoothAddressAsync($addr)) ([Windows.Devices.Bluetooth.BluetoothLEDevice]) 15
    $kind = 'ble'
  }
  if (-not $device) { Out-Json @{ ok=$false; status='NotFound'; error='O Windows não encontrou o dispositivo. Ligue-o, ative o modo de pareamento e faça uma nova busca.' }; exit 0 }

  $info = $device.DeviceInformation
  $name = [string]$info.Name
  if ($info.Pairing.IsPaired) { Out-Json @{ ok=$true; alreadyPaired=$true; paired=$true; name=$name; kind=$kind; status='AlreadyPaired' }; exit 0 }
  if (-not $info.Pairing.CanPair) { Out-Json @{ ok=$false; status='CannotPair'; name=$name; needsManual=$true; error='O Windows informou que este dispositivo não pode ser pareado por aqui.' }; exit 0 }

  $custom = $info.Pairing.Custom
  $script:needsManual = $false
  $handler = [Windows.Foundation.TypedEventHandler[Windows.Devices.Enumeration.DeviceInformationCustomPairing,Windows.Devices.Enumeration.DevicePairingRequestedEventArgs]]{
    param($sender, $e)
    try {
      $k = [string]$e.PairingKind
      # Só aceita pareamentos que não exigem digitar PIN: ConfirmOnly (Just Works) e ConfirmPinMatch.
      if ($k -eq 'ConfirmOnly' -or $k -eq 'ConfirmPinMatch') { $e.Accept() } else { $script:needsManual = $true }
    } catch { $script:needsManual = $true }
  }
  $custom.add_PairingRequested($handler)
  try {
    $kinds = [Windows.Devices.Enumeration.DevicePairingKinds]::ConfirmOnly -bor [Windows.Devices.Enumeration.DevicePairingKinds]::ConfirmPinMatch
    $result = Wait-WinRT ($custom.PairAsync($kinds)) ([Windows.Devices.Enumeration.DevicePairingResult]) $TimeoutSeconds
  } finally { $custom.remove_PairingRequested($handler) }

  $status = [string]$result.Status
  $paired = ($status -eq 'Paired' -or $status -eq 'AlreadyPaired')
  $msg = switch ($status) {
    'Paired' { 'Pareado com sucesso.' }
    'AlreadyPaired' { 'Já estava pareado.' }
    'PairingCanceled' { 'O pareamento foi cancelado.' }
    'AuthenticationFailure' { 'O dispositivo recusou o pareamento. Ele precisa estar em modo de pareamento.' }
    'AuthenticationTimeout' { 'O dispositivo não respondeu a tempo.' }
    'RequiredHandlerNotRegistered' { 'Este dispositivo exige PIN ou confirmação manual no Windows.' }
    'ConnectionRejected' { 'O dispositivo rejeitou a conexão.' }
    default { "O Windows retornou: $status." }
  }
  Out-Json @{ ok=$paired; paired=$paired; name=$name; kind=$kind; status=$status; needsManual=($script:needsManual -or $status -eq 'RequiredHandlerNotRegistered'); error=$(if($paired){''}else{$msg}); message=$msg }
} catch {
  Out-Json @{ ok=$false; status='Error'; error=$_.Exception.Message }
}
