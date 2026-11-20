param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{12}$')][string]$Address
)
$ErrorActionPreference = 'Stop'
function Await-WinRT($operation, [Type]$resultType) {
  $methods = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1
  }
  $method = $methods | Select-Object -First 1
  if (-not $method) { throw 'Não foi possível preparar a chamada assíncrona do Windows Runtime.' }
  $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.GetAwaiter().GetResult()
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
  $deviceType = [Windows.Devices.Bluetooth.BluetoothLEDevice, Windows, ContentType=WindowsRuntime]
  $deviceResultType = [Windows.Devices.Bluetooth.BluetoothLEDevice]
  $addressValue = [Convert]::ToUInt64($Address, 16)
  $device = Await-WinRT ($deviceType::FromBluetoothAddressAsync($addressValue)) $deviceResultType
  if (-not $device) { throw 'O Windows não conseguiu abrir o dispositivo. Ele pode ter saído do alcance ou exigir pareamento.' }
  try {
    $servicesResultType = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattDeviceServicesResult]
    $servicesStatusType = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCommunicationStatus]
    $servicesResult = Await-WinRT ($device.GetGattServicesAsync([Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached)) $servicesResultType
    $status = [string]$servicesResult.Status
    if ($status -ne 'Success') {
      [pscustomobject]@{ok=$false;address=$Address;name=$device.Name;status=$status;error="O Windows retornou $status ao consultar os serviços GATT.";services=@()} | ConvertTo-Json -Depth 8 -Compress
      exit 0
    }
    $services = @()
    foreach ($service in $servicesResult.Services) {
      try {
        $characteristicsResultType = [Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicsResult]
        $characteristicsResult = Await-WinRT ($service.GetCharacteristicsAsync([Windows.Devices.Bluetooth.BluetoothCacheMode]::Uncached)) $characteristicsResultType
        $characteristics = @()
        if ([string]$characteristicsResult.Status -eq 'Success') {
          foreach ($characteristic in $characteristicsResult.Characteristics) {
            $properties = @()
            foreach ($flag in [Enum]::GetValues([Windows.Devices.Bluetooth.GenericAttributeProfile.GattCharacteristicProperties])) {
              if ($flag -ne 0 -and (($characteristic.CharacteristicProperties -band $flag) -eq $flag)) { $properties += [string]$flag }
            }
            $characteristics += [pscustomobject]@{
              uuid=[string]$characteristic.Uuid
              properties=$properties
              canRead=($properties -contains 'Read')
              canWrite=($properties -contains 'Write' -or $properties -contains 'WriteWithoutResponse')
              canNotify=($properties -contains 'Notify' -or $properties -contains 'Indicate')
            }
          }
        }
        $services += [pscustomobject]@{uuid=[string]$service.Uuid;characteristics=$characteristics;characteristicsStatus=[string]$characteristicsResult.Status}
      } finally { if ($service) { $service.Dispose() } }
    }
    [pscustomobject]@{ok=$true;address=$Address;name=$device.Name;status=$status;services=$services;serviceCount=$services.Count;characteristicCount=(@($services | ForEach-Object {$_.characteristics}).Count)} | ConvertTo-Json -Depth 10 -Compress
  } finally { if ($device) { $device.Dispose() } }
} catch {
  [pscustomobject]@{ok=$false;address=$Address;error=$_.Exception.Message;services=@()} | ConvertTo-Json -Depth 8 -Compress
}
