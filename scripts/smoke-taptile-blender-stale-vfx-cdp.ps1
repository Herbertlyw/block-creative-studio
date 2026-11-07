param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/'
)

$ErrorActionPreference = 'Stop'
$targets = (Invoke-WebRequest -Uri $Endpoint -TimeoutSec 5).Content | ConvertFrom-Json
$target = @($targets | Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl })[0]
if (-not $target) { throw "No CDP page target found for $PageUrl" }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:messageId = 0

function Invoke-StaleVfxCommand {
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

function Invoke-StaleVfxExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $result = Invoke-StaleVfxCommand -Method 'Runtime.evaluate' -Params @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress) }
  return $result.result.value
}

function Wait-StaleVfxExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 600)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    if (Invoke-StaleVfxExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 50
  }
  throw "Timed out waiting for: $Expression"
}

$autosaveKey = 'taptile-director-project/autosave/v2'
$originalAutosave = Invoke-StaleVfxExpression -Expression "localStorage.getItem('$autosaveKey')"
if (-not $originalAutosave) { throw 'Missing TapTile autosave snapshot' }

try {
  Invoke-StaleVfxExpression -Expression "document.querySelector('[data-mode-id=export]').click(); true" | Out-Null
  Wait-StaleVfxExpression -Expression "document.querySelector('[data-blender-vfx-loaded]')?.dataset.blenderVfxEnabled === 'true'"
  Invoke-StaleVfxExpression -Expression "document.querySelector('[data-mode-id=play]').click(); true" | Out-Null
  Wait-StaleVfxExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=play]'))"
  Invoke-StaleVfxExpression -Expression @'
(async () => {
  for (let index = 0; index < 6; index += 1) {
    const tile = document.querySelector('.stack-tile.is-playable');
    if (!tile) throw new Error(`No playable tile found at action ${index}`);
    const rect = tile.getBoundingClientRect();
    tile.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      pointerId: index + 1,
      pointerType: 'mouse',
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return true;
})()
'@ | Out-Null
  Wait-StaleVfxExpression -Expression "[...document.querySelectorAll('.tpt-session-actions button')].some((button) => button.textContent.includes('结束并保存') && !button.disabled)"
  Invoke-StaleVfxExpression -Expression "[...document.querySelectorAll('.tpt-session-actions button')].find((button) => button.textContent.includes('结束并保存')).click(); true" | Out-Null
  Wait-StaleVfxExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=replay]'))"
  Invoke-StaleVfxExpression -Expression "document.querySelector('[data-mode-id=export]').click(); true" | Out-Null
  Wait-StaleVfxExpression -Expression "Boolean(document.querySelector('[data-blender-vfx-loaded]'))"
  Start-Sleep -Milliseconds 1500
  $summary = Invoke-StaleVfxExpression -Expression @'
JSON.stringify((() => {
  const panel = document.querySelector('[data-blender-vfx-loaded]');
  return {
    vfxLoaded: panel.dataset.blenderVfxLoaded,
    vfxEnabled: panel.dataset.blenderVfxEnabled,
    vfxSha: panel.dataset.blenderVfxSha,
    previewHash: document.querySelector('[data-preview-hash]').dataset.previewHash,
    error: document.querySelector('[data-blender-vfx-error]')?.textContent || '',
    productionError: document.querySelector('[data-production-error]')?.textContent || '',
  };
})())
'@ | ConvertFrom-Json
  if ($summary.vfxLoaded -ne 'true') { throw "VFX asset disappeared instead of remaining selectable: $($summary | ConvertTo-Json -Compress)" }
  if ($summary.vfxEnabled -ne 'false') { throw "Stale VFX was not automatically disabled: $($summary | ConvertTo-Json -Compress)" }
  if (-not $summary.error.Contains('已自动停用') -or -not $summary.error.Contains('2D 预览仍可继续')) {
    throw "Missing actionable fallback message: $($summary | ConvertTo-Json -Compress)"
  }
  if (-not $summary.previewHash.StartsWith('pixels-')) { throw "2D fallback did not render: $($summary | ConvertTo-Json -Compress)" }
  $summary | ConvertTo-Json -Depth 6
} finally {
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($originalAutosave))
  Invoke-StaleVfxExpression -Expression "localStorage.setItem('$autosaveKey', new TextDecoder().decode(Uint8Array.from(atob('$encoded'), c => c.charCodeAt(0)))); location.reload(); true" | Out-Null
  $socket.Dispose()
}
