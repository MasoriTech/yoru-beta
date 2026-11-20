param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Fa-f0-9]{12}$')][string]$Address,
  [ValidateSet('check','connect')][string]$Action = 'check'
)
$ErrorActionPreference = 'Stop'
function Out-Json($obj) { $obj | ConvertTo-Json -Depth 4 -Compress }
function Wait-WinRT($operation, [Type]$resultType, [int]$seconds = 15) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and
    $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  } | Select-Object -First 1
  $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $deadline = (Get-Date).AddSeconds($seconds)
  while (-not $task.IsCompleted) { if ((Get-Date) -gt $deadline) { throw 'Tempo esgotado ao consultar o Windows.' }; Start-Sleep -Milliseconds 150 }
  if ($task.IsFaulted) { throw $task.Exception.InnerException }
  $task.Result
}
function Get-State {
  $addr = [Convert]::ToUInt64($Address, 16)
  $d = Wait-WinRT ([Windows.Devices.Bluetooth.BluetoothDevice]::FromBluetoothAddressAsync($addr)) ([Windows.Devices.Bluetooth.BluetoothDevice])
  if (-not $d) { return $null }
  [pscustomobject]@{ name=[string]$d.Name; paired=[bool]$d.DeviceInformation.Pairing.IsPaired; connected=([string]$d.ConnectionStatus -eq 'Connected') }
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue
  $null = [Windows.Devices.Bluetooth.BluetoothDevice, Windows, ContentType=WindowsRuntime]
  $state = Get-State
  if (-not $state) { Out-Json @{ ok=$false; error='O Windows não encontrou o dispositivo. Ligue-o e tente de novo.' }; exit 0 }
  if ($Action -eq 'check' -or $state.connected) { Out-Json @{ ok=$true; name=$state.name; paired=$state.paired; connected=$state.connected }; exit 0 }
  if (-not $state.paired) { Out-Json @{ ok=$false; name=$state.name; paired=$false; connected=$false; error='O dispositivo ainda não está pareado.' }; exit 0 }

  # Reativa os perfis de áudio/mãos-livres do dispositivo pareado: o Windows reconecta ao reabilitá-los.
  Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class YoruBt {
  [StructLayout(LayoutKind.Sequential)] public struct SYSTEMTIME { public ushort a,b,c,d,e,f,g,h; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct DEVINFO {
    public int dwSize; public ulong Address; public uint ulClassofDevice; public bool fConnected, fRemembered, fAuthenticated;
    public SYSTEMTIME stLastSeen, stLastUsed; [MarshalAs(UnmanagedType.ByValTStr, SizeConst=248)] public string szName; }
  [StructLayout(LayoutKind.Sequential)] public struct FINDRADIO { public int dwSize; }
  [DllImport("bthprops.cpl")] static extern IntPtr BluetoothFindFirstRadio(ref FINDRADIO p, out IntPtr h);
  [DllImport("bthprops.cpl")] static extern bool BluetoothFindRadioClose(IntPtr h);
  [DllImport("bthprops.cpl")] static extern uint BluetoothGetDeviceInfo(IntPtr radio, ref DEVINFO info);
  [DllImport("bthprops.cpl")] static extern uint BluetoothSetServiceState(IntPtr radio, ref DEVINFO info, ref Guid g, uint flags);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static int Reconnect(ulong address) {
    FINDRADIO p = new FINDRADIO(); p.dwSize = Marshal.SizeOf(typeof(FINDRADIO)); IntPtr radio;
    IntPtr find = BluetoothFindFirstRadio(ref p, out radio); if (find == IntPtr.Zero) return -1;
    int done = 0;
    try {
      DEVINFO info = new DEVINFO(); info.dwSize = Marshal.SizeOf(typeof(DEVINFO)); info.Address = address;
      if (BluetoothGetDeviceInfo(radio, ref info) != 0) return -2;
      string[] guids = { "0000110b-0000-1000-8000-00805f9b34fb", "0000111e-0000-1000-8000-00805f9b34fb", "00001108-0000-1000-8000-00805f9b34fb", "00001124-0000-1000-8000-00805f9b34fb" };
      foreach (string s in guids) { Guid g = new Guid(s); BluetoothSetServiceState(radio, ref info, ref g, 0); System.Threading.Thread.Sleep(400); if (BluetoothSetServiceState(radio, ref info, ref g, 1) == 0) done++; }
    } finally { CloseHandle(radio); BluetoothFindRadioClose(find); }
    return done;
  }
}
'@
  $n = [YoruBt]::Reconnect([Convert]::ToUInt64($Address, 16))
  for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Milliseconds 500; $state = Get-State; if ($state -and $state.connected) { break } }
  if ($state -and $state.connected) { Out-Json @{ ok=$true; name=$state.name; paired=$true; connected=$true } }
  else { Out-Json @{ ok=$false; name=$state.name; paired=$true; connected=$false; error='O Windows não confirmou a conexão. Verifique se o dispositivo está ligado e por perto.' } }
} catch { Out-Json @{ ok=$false; error=$_.Exception.Message } }
