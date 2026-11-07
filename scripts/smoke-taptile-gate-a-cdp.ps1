param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ArtifactDirectory = 'artifacts/design-qa/taptile'
)

$ErrorActionPreference = 'Stop'
$gateTargets = Invoke-RestMethod -Uri $Endpoint -TimeoutSec 5
$gateTarget = $gateTargets | Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl } | Select-Object -First 1
if (-not $gateTarget) { throw "No CDP page target found for $PageUrl" }

$gateSocket = [System.Net.WebSockets.ClientWebSocket]::new()
$gateSocket.ConnectAsync([Uri]$gateTarget.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:gateMessageId = 0

function Invoke-GateCdpCommand {
  param(
    [Parameter(Mandatory)][string]$Method,
    [hashtable]$Params = @{}
  )
  $script:gateMessageId += 1
  $gateId = $script:gateMessageId
  $gatePayload = @{ id = $gateId; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
  $gateBytes = [Text.Encoding]::UTF8.GetBytes($gatePayload)
  $gateSegment = [ArraySegment[byte]]::new($gateBytes)
  $gateSocket.SendAsync($gateSegment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  while ($true) {
    $gateStream = [IO.MemoryStream]::new()
    do {
      $gateBuffer = New-Object byte[] 65536
      $gateReceiveSegment = [ArraySegment[byte]]::new($gateBuffer)
      $gateResult = $gateSocket.ReceiveAsync($gateReceiveSegment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($gateResult.Count -gt 0) { $gateStream.Write($gateBuffer, 0, $gateResult.Count) }
    } until ($gateResult.EndOfMessage)
    $gateJson = [Text.Encoding]::UTF8.GetString($gateStream.ToArray()) | ConvertFrom-Json
    $gateStream.Dispose()
    if ($gateJson.id -eq $gateId) {
      if ($gateJson.error) { throw ($gateJson.error | ConvertTo-Json -Compress) }
      return $gateJson.result
    }
  }
}

function Invoke-GateExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $gateResult = Invoke-GateCdpCommand -Method 'Runtime.evaluate' -Params @{
    expression = $Expression
    returnByValue = $true
    awaitPromise = $true
  }
  return $gateResult.result.value
}

function Wait-GateSelector {
  param([Parameter(Mandatory)][string]$Selector)
  for ($gateAttempt = 0; $gateAttempt -lt 50; $gateAttempt += 1) {
    $gateFound = Invoke-GateExpression -Expression "Boolean(document.querySelector('$Selector'))"
    if ($gateFound) { return }
    Start-Sleep -Milliseconds 120
  }
  throw "Timed out waiting for $Selector"
}

function Save-GateScreenshot {
  param([Parameter(Mandatory)][string]$Path)
  $gateCapture = Invoke-GateCdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
  [IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String([string]$gateCapture.data))
}

Invoke-GateCdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-GateCdpCommand -Method 'Page.enable' | Out-Null
Invoke-GateCdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{
  width = 1440
  height = 1000
  deviceScaleFactor = 1
  mobile = $false
} | Out-Null

Invoke-GateExpression -Expression @'
(() => {
  localStorage.removeItem('taptile-director-project/autosave/v2');
  localStorage.removeItem('taptile-stack-studio/autosave/v1');
  return true;
})()
'@ | Out-Null
Invoke-GateCdpCommand -Method 'Page.reload' | Out-Null
Start-Sleep -Milliseconds 500
Wait-GateSelector -Selector '.tpt-studio'
Invoke-GateExpression -Expression @'
(() => {
  window.__tptGateErrors = [];
  window.addEventListener('error', (event) => window.__tptGateErrors.push(String(event.error?.stack || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__tptGateErrors.push(String(event.reason?.stack || event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    window.__tptGateErrors.push(args.map((value) => String(value)).join(' '));
    originalError(...args);
  };
  return true;
})()
'@ | Out-Null

$gateInitial = Invoke-GateExpression -Expression @'
JSON.stringify({
  tiles: document.querySelectorAll('.stack-tile').length,
  modes: [...document.querySelectorAll('.tpt-mode-switch button')].map((button) => button.textContent),
  format: JSON.parse(localStorage.getItem('taptile-director-project/autosave/v2') || 'null')?.format || 'pending-autosave'
})
'@ | ConvertFrom-Json
if ($gateInitial.tiles -ne 48 -or $gateInitial.modes.Count -ne 6) {
  throw "Unexpected initial Gate A DOM: $($gateInitial | ConvertTo-Json -Compress)"
}

Invoke-GateExpression -Expression "document.querySelector('[data-mode-id=validate]').click()" | Out-Null
Wait-GateSelector -Selector '.tpt-validation-banner'
$gateValidation = Invoke-GateExpression -Expression @'
JSON.stringify({
  valid: document.querySelector('.tpt-validation-banner')?.classList.contains('is-valid'),
  issues: [...document.querySelectorAll('.tpt-validation-issues button')].map((button) => button.textContent),
})
'@ | ConvertFrom-Json
if (-not $gateValidation.valid) { throw "Default fixture is invalid: $($gateValidation | ConvertTo-Json -Compress)" }
$gateEdgesBefore = [int](Invoke-GateExpression -Expression "document.querySelectorAll('.tpt-blocker-graph line').length")
if ($gateEdgesBefore -lt 1) { throw 'The hourglass fixture has no blocker edge to inspect.' }

$gatePair = Invoke-GateExpression -Expression @'
(() => {
  const edge = document.querySelector('.tpt-blocker-graph line');
  return JSON.stringify({ blockerId: edge.dataset.blockerId, blockedId: edge.dataset.blockedId });
})()
'@ | ConvertFrom-Json
$gateSelectPair = (@'
(() => {
  const first = document.querySelector('[data-tile-id="__BLOCKER__"]');
  const second = document.querySelector('[data-tile-id="__BLOCKED__"]');
  first.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 401 }));
  second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 402, shiftKey: true }));
  return true;
})()
'@).Replace('__BLOCKER__', [string]$gatePair.blockerId).Replace('__BLOCKED__', [string]$gatePair.blockedId)
Invoke-GateExpression -Expression $gateSelectPair | Out-Null
Start-Sleep -Milliseconds 100
$gateSelectedPair = [int](Invoke-GateExpression -Expression "document.querySelectorAll('.stack-tile.is-selected').length")
if ($gateSelectedPair -ne 2) { throw "Expected two validation-selected tiles; got $gateSelectedPair" }
Invoke-GateExpression -Expression "document.querySelector('.tpt-override-actions button').click()" | Out-Null
Start-Sleep -Milliseconds 180
$gateEdgesAfter = [int](Invoke-GateExpression -Expression "document.querySelectorAll('.tpt-blocker-graph line').length")
if ($gateEdgesAfter -ne $gateEdgesBefore - 1) { throw "Ignoring one blocker did not change edge count: $gateEdgesBefore -> $gateEdgesAfter" }

$gateArtifactRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ArtifactDirectory))
[IO.Directory]::CreateDirectory($gateArtifactRoot) | Out-Null
Save-GateScreenshot -Path (Join-Path $gateArtifactRoot 'gate-a-blocker-validation.png')

Invoke-GateExpression -Expression "document.querySelector('.tpt-validation-play').click()" | Out-Null
Wait-GateSelector -Selector '.tpt-session-bar[data-mode="play"]'
$gateSequence = @('hourglass-43', 'hourglass-44', 'hourglass-45', 'hourglass-46', 'hourglass-47', 'hourglass-48')
foreach ($gateTileId in $gateSequence) {
  $gateTapExpression = (@'
(() => {
  const tile = document.querySelector('[data-tile-id="__TILE_ID__"]');
  if (!tile) return JSON.stringify({ ok: false, reason: 'missing' });
  if (tile.dataset.playable !== 'true') return JSON.stringify({ ok: false, reason: 'blocked', blockers: tile.dataset.playable });
  const rect = tile.getBoundingClientRect();
  tile.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    pointerId: 500,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }));
  return JSON.stringify({ ok: true });
})()
'@).Replace('__TILE_ID__', $gateTileId)
  $gateTap = Invoke-GateExpression -Expression $gateTapExpression | ConvertFrom-Json
  if (-not $gateTap.ok) { throw "Could not tap ${gateTileId}: $($gateTap | ConvertTo-Json -Compress)" }
  Start-Sleep -Milliseconds 120
}

$gatePlaySummary = Invoke-GateExpression -Expression @'
(() => {
  const bar = document.querySelector('.tpt-session-bar[data-mode="play"]');
  return JSON.stringify({
    actions: Number((bar.querySelector('small')?.textContent.match(/^(\d+)/) || [])[1] || 0),
    matches: Number(bar.dataset.matchCount),
    unlocked: Number(bar.dataset.unlockCount),
    occupied: Number(document.querySelector('.tpt-gameplay-tray')?.dataset.occupied),
  });
})()
'@ | ConvertFrom-Json
if ($gatePlaySummary.actions -ne 6 -or $gatePlaySummary.matches -lt 2 -or $gatePlaySummary.unlocked -lt 1) {
  throw "Gate A gameplay criteria were not met: $($gatePlaySummary | ConvertTo-Json -Compress)"
}
Save-GateScreenshot -Path (Join-Path $gateArtifactRoot 'gate-a-play-two-matches.png')

Invoke-GateExpression -Expression "document.querySelector('.tpt-session-bar[data-mode=play] .tpt-action-primary').click()" | Out-Null
Wait-GateSelector -Selector '.tpt-session-bar[data-mode="replay"]'
$gateReplayMaximum = [int](Invoke-GateExpression -Expression "Number(document.querySelector('.tpt-replay-controls input').max)")
for ($gateStep = 0; $gateStep -lt $gateReplayMaximum; $gateStep += 1) {
  Invoke-GateExpression -Expression "document.querySelectorAll('.tpt-replay-controls button')[1].click()" | Out-Null
  Start-Sleep -Milliseconds 60
}
$gateReplay = Invoke-GateExpression -Expression @'
JSON.stringify({
  valid: document.querySelector('.tpt-session-bar[data-mode="replay"]').dataset.valid === 'true',
  index: Number(document.querySelector('.tpt-replay-controls input').value),
  maximum: Number(document.querySelector('.tpt-replay-controls input').max),
})
'@ | ConvertFrom-Json
if (-not $gateReplay.valid -or $gateReplay.index -ne $gateReplay.maximum) {
  throw "Replay did not validate or seek from start to finish: $($gateReplay | ConvertTo-Json -Compress)"
}
Save-GateScreenshot -Path (Join-Path $gateArtifactRoot 'gate-a-deterministic-replay.png')

Start-Sleep -Milliseconds 420
$gateProjectJson = [string](Invoke-GateExpression -Expression "localStorage.getItem('taptile-director-project/autosave/v2')")
if (-not $gateProjectJson) { throw 'V2 autosave was not written.' }
$gateProject = $gateProjectJson | ConvertFrom-Json
if ($gateProject.format -ne 'taptile-director-project' -or $gateProject.takes.Count -lt 1) { throw 'Saved project does not contain a V2 Take.' }
[IO.File]::WriteAllText((Join-Path $gateArtifactRoot 'gate-a-example-project.json'), $gateProjectJson, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $gateArtifactRoot 'gate-a-example-take.json'), ($gateProject.takes[-1] | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))

$gateErrors = Invoke-GateExpression -Expression "JSON.stringify(window.__tptGateErrors || [])" | ConvertFrom-Json
$gateSummary = [ordered]@{
  initialTiles = $gateInitial.tiles
  blockerCorrection = "$gateEdgesBefore -> $gateEdgesAfter"
  correctedEdge = "$($gatePair.blockerId) -> $($gatePair.blockedId)"
  actions = $gatePlaySummary.actions
  matches = $gatePlaySummary.matches
  unlocked = $gatePlaySummary.unlocked
  replay = "$($gateReplay.index) / $($gateReplay.maximum)"
  finalStateHash = [string]$gateProject.takes[-1].finalStateHash
  consoleErrors = @($gateErrors).Count
  artifactDirectory = $gateArtifactRoot
}
$gateSummary | ConvertTo-Json -Depth 5
if (@($gateErrors).Count -gt 0) { throw "Browser errors: $($gateErrors | ConvertTo-Json -Compress)" }

Invoke-GateCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
$gateSocket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$gateSocket.Dispose()
