param(
  [ValidateRange(3,30)][int]$Seconds = 8
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
  $watcherType = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher, Windows, ContentType=WindowsRuntime]
  $modeType = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEScanningMode, Windows, ContentType=WindowsRuntime]
  $watcher = [Activator]::CreateInstance($watcherType)
  $watcher.ScanningMode = [Enum]::Parse($modeType, 'Active')
  $found = [System.Collections.Concurrent.ConcurrentDictionary[string,object]]::new()
  $receivedType = [Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementReceivedEventArgs, Windows, ContentType=WindowsRuntime]
  $handlerType = [Windows.Foundation.TypedEventHandler[Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher,$receivedType]]
  $handler = [Windows.Foundation.TypedEventHandler[Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementWatcher,Windows.Devices.Bluetooth.Advertisement.BluetoothLEAdvertisementReceivedEventArgs]]{
    param($sender, $eventArgs)
    try {
      $address = [string]::Format('{0:X12}', [uint64]$eventArgs.BluetoothAddress)
      $localName = [string]$eventArgs.Advertisement.LocalName
      $rssi = [int]$eventArgs.RawSignalStrengthInDBm
      $key = $address
      $entry = [pscustomobject]@{
        address = $address
        name = $localName
        rssi = $rssi
        connectable = [bool]$eventArgs.IsConnectable
        source = 'BLE próximo'
      }
      $found[$key] = $entry
    } catch {}
  }
  $watcher.add_Received($handler)
  $watcher.Start()
  Start-Sleep -Seconds $Seconds
  $watcher.Stop()
  $watcher.remove_Received($handler)
  $items = @($found.Values | Sort-Object -Property @{Expression='rssi';Descending=$true})
  [pscustomobject]@{ ok=$true; available=$true; items=$items; durationSeconds=$Seconds } | ConvertTo-Json -Depth 5 -Compress
} catch {
  [pscustomobject]@{ ok=$false; available=$false; items=@(); error=$_.Exception.Message; guidance='A descoberta BLE exige Windows compatível, Bluetooth ligado e adaptador com suporte a Bluetooth Low Energy.' } | ConvertTo-Json -Depth 4 -Compress
}
