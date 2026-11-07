param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [int]$SeekCount = 120,
  [double]$MaximumRetainedHeapMiB = 64
)

$ErrorActionPreference = 'Stop'
$targets = (Invoke-WebRequest -Uri $Endpoint -TimeoutSec 5).Content | ConvertFrom-Json
$target = @($targets | Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl })[0]
if (-not $target) { throw "No CDP page target found for $PageUrl" }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:messageId = 0

function Invoke-MemoryCdpCommand {
  param([Parameter(Mandatory)][string]$Method, [hashtable]$Params = @{})
  $script:messageId += 1
  $id = $script:messageId
  $payload = @{ id = $id; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $socket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  while ($true) {
    $stream = [IO.MemoryStream]::new()
    do {
      $buffer = New-Object byte[] 1048576
      $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($received.Count -gt 0) { $stream.Write($buffer, 0, $received.Count) }
    } until ($received.EndOfMessage)
    $json = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
    $stream.Dispose()
    if ($json.id -eq $id) {
      if ($json.error) { throw ($json.error | ConvertTo-Json -Compress) }
      return $json.result
    }
  }
}

function Invoke-MemoryExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $result = Invoke-MemoryCdpCommand -Method 'Runtime.evaluate' -Params @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress) }
  return $result.result.value
}

function Wait-MemoryExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 1200)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    if (Invoke-MemoryExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 50
  }
  throw "Timed out waiting for: $Expression"
}

function Get-PerformanceMetrics {
  $raw = Invoke-MemoryCdpCommand -Method 'Performance.getMetrics'
  $values = @{}
  foreach ($metric in $raw.metrics) { $values[$metric.name] = [double]$metric.value }
  return [ordered]@{
    jsHeapUsedBytes = $values.JSHeapUsedSize
    jsHeapTotalBytes = $values.JSHeapTotalSize
    nodes = $values.Nodes
    documents = $values.Documents
    layoutCount = $values.LayoutCount
    taskDurationSeconds = $values.TaskDuration
  }
}

try {
  Invoke-MemoryCdpCommand -Method 'Runtime.enable' | Out-Null
  Invoke-MemoryCdpCommand -Method 'Performance.enable' | Out-Null
  Wait-MemoryExpression -Expression "Boolean(document.querySelector('[data-production-preview-seek]')) && document.querySelector('[data-preview-hash]')?.dataset.previewHash?.startsWith('pixels-')"
  Invoke-MemoryCdpCommand -Method 'HeapProfiler.collectGarbage' | Out-Null
  $before = Get-PerformanceMetrics
  $seekExpression = @'
(async () => {
  window.__tptPreviewMemoryErrors = [];
  const onError = (event) => window.__tptPreviewMemoryErrors.push(String(event.error?.stack || event.message));
  const onRejection = (event) => window.__tptPreviewMemoryErrors.push(String(event.reason?.stack || event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  const input = document.querySelector('[data-production-preview-seek]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const maximum = Number(input.max);
  for (let index = 0; index < __SEEK_COUNT__; index += 1) {
    setter.call(input, String((index * 97) % (maximum + 1)));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onRejection);
  return true;
})()
'@
  Invoke-MemoryExpression -Expression $seekExpression.Replace('__SEEK_COUNT__', [string]$SeekCount) | Out-Null
  Wait-MemoryExpression -Expression "document.querySelector('[data-preview-hash]')?.dataset.previewHash?.startsWith('pixels-')" -Attempts 2400
  Invoke-MemoryCdpCommand -Method 'HeapProfiler.collectGarbage' | Out-Null
  $after = Get-PerformanceMetrics
  $state = Invoke-MemoryExpression -Expression "JSON.stringify({hash:document.querySelector('[data-preview-hash]')?.dataset.previewHash||'',frame:Number(document.querySelector('[data-preview-hash]')?.dataset.previewFrame||-1),errors:window.__tptPreviewMemoryErrors||[]})" | ConvertFrom-Json
  $retainedMiB = ($after.jsHeapUsedBytes - $before.jsHeapUsedBytes) / 1MB
  if (-not $state.hash.StartsWith('pixels-') -or @($state.errors).Count -gt 0) {
    throw "Rapid seek left the preview invalid: $($state | ConvertTo-Json -Compress)"
  }
  if ($retainedMiB -gt $MaximumRetainedHeapMiB) {
    throw "Rapid seek retained $([Math]::Round($retainedMiB, 2)) MiB; budget is $MaximumRetainedHeapMiB MiB."
  }
  [ordered]@{
    seekCount = $SeekCount
    before = $before
    after = $after
    retainedHeapMiB = [Math]::Round($retainedMiB, 3)
    maximumRetainedHeapMiB = $MaximumRetainedHeapMiB
    finalFrame = $state.frame
    finalHash = $state.hash
    browserErrors = @($state.errors).Count
  } | ConvertTo-Json -Depth 5
} finally {
  try { Invoke-MemoryCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null } catch { }
  try { $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null } catch { }
  $socket.Dispose()
}
