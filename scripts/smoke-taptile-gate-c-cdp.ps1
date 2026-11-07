param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ArtifactDirectory = 'artifacts/design-qa/taptile'
)

$ErrorActionPreference = 'Stop'
$directorTargets = Invoke-RestMethod -Uri $Endpoint -TimeoutSec 5
$directorTarget = @($directorTargets) |
  Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl } |
  Select-Object -First 1
if (-not $directorTarget) { throw "No CDP page target found for $PageUrl" }
$directorSocket = [System.Net.WebSockets.ClientWebSocket]::new()
$directorSocket.ConnectAsync([Uri]$directorTarget.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:directorMessageId = 0

function Invoke-DirectorCdpCommand {
  param([Parameter(Mandatory)][string]$Method, [hashtable]$Params = @{})
  $script:directorMessageId += 1
  $directorId = $script:directorMessageId
  $directorPayload = @{ id = $directorId; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
  $directorBytes = [Text.Encoding]::UTF8.GetBytes($directorPayload)
  $directorSocket.SendAsync([ArraySegment[byte]]::new($directorBytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  while ($true) {
    $directorStream = [IO.MemoryStream]::new()
    do {
      $directorBuffer = New-Object byte[] 65536
      $directorReceive = $directorSocket.ReceiveAsync([ArraySegment[byte]]::new($directorBuffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($directorReceive.Count -gt 0) { $directorStream.Write($directorBuffer, 0, $directorReceive.Count) }
    } until ($directorReceive.EndOfMessage)
    $directorJson = [Text.Encoding]::UTF8.GetString($directorStream.ToArray()) | ConvertFrom-Json
    $directorStream.Dispose()
    if ($directorJson.id -eq $directorId) {
      if ($directorJson.error) { throw ($directorJson.error | ConvertTo-Json -Compress) }
      return $directorJson.result
    }
  }
}

function Invoke-DirectorExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $directorResult = Invoke-DirectorCdpCommand -Method 'Runtime.evaluate' -Params @{
    expression = $Expression; returnByValue = $true; awaitPromise = $true
  }
  return $directorResult.result.value
}

function Wait-DirectorExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 120)
  for ($directorAttempt = 0; $directorAttempt -lt $Attempts; $directorAttempt += 1) {
    if (Invoke-DirectorExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for: $Expression"
}

function Set-DirectorProfile {
  param([Parameter(Mandatory)][string]$ProfileId)
  $directorPreviousProfile = [string](Invoke-DirectorExpression -Expression "document.querySelector('.tpt-director-timeline')?.dataset.profileId || ''")
  $directorPreviousIdentity = [string](Invoke-DirectorExpression -Expression "document.querySelector('.tpt-canvas-preview')?.dataset.previewRenderIdentity || ''")
  $directorSetProfile = (@'
(() => {
  const select = document.querySelector('select[data-director-profile]');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, '__PROFILE__');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()
'@).Replace('__PROFILE__', $ProfileId)
  Invoke-DirectorExpression -Expression $directorSetProfile | Out-Null
  Wait-DirectorExpression -Expression "document.querySelector('.tpt-director-timeline')?.dataset.profileId === '$ProfileId'"
  if ($directorPreviousProfile -ne $ProfileId -and -not [string]::IsNullOrWhiteSpace($directorPreviousIdentity)) {
    Wait-DirectorExpression -Expression "document.querySelector('.tpt-canvas-preview')?.dataset.previewStatus === 'ready' && document.querySelector('.tpt-canvas-preview')?.dataset.previewRenderIdentity !== '$directorPreviousIdentity'"
  } else {
    Wait-DirectorExpression -Expression "document.querySelector('.tpt-canvas-preview')?.dataset.previewStatus === 'ready'"
  }
}

function Set-DirectorFrame {
  param([Parameter(Mandatory)][int]$Frame)
  $directorSetFrame = (@'
(() => {
  const input = document.querySelector('[data-director-seek]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '__FRAME__');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()
'@).Replace('__FRAME__', [string]$Frame)
  Invoke-DirectorExpression -Expression $directorSetFrame | Out-Null
  Wait-DirectorExpression -Expression "document.querySelector('.tpt-studio')?.dataset.directorFrame === '$Frame' && document.querySelector('.tpt-canvas-preview')?.dataset.previewStatus === 'ready' && document.querySelector('.tpt-canvas-preview')?.dataset.previewRenderedFrame === '$Frame'"
}

function Save-DirectorScreenshot {
  param([Parameter(Mandatory)][string]$Path)
  $directorCapture = Invoke-DirectorCdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
  [IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String([string]$directorCapture.data))
}

Invoke-DirectorCdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-DirectorCdpCommand -Method 'Page.enable' | Out-Null
Invoke-DirectorCdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{
  width = 1440; height = 1000; deviceScaleFactor = 1; mobile = $false
} | Out-Null
Invoke-DirectorExpression -Expression "localStorage.removeItem('taptile-director-project/autosave/v2'); true" | Out-Null
Invoke-DirectorCdpCommand -Method 'Page.reload' | Out-Null
Wait-DirectorExpression -Expression "Boolean(document.querySelector('.tpt-studio'))"
Invoke-DirectorExpression -Expression @'
(() => {
  window.__tptDirectorErrors = [];
  window.addEventListener('error', (event) => window.__tptDirectorErrors.push(String(event.error?.stack || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__tptDirectorErrors.push(String(event.reason?.stack || event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    window.__tptDirectorErrors.push(args.map((value) => String(value)).join(' '));
    originalError(...args);
  };
  document.querySelector('[data-mode-id="play"]').click();
  return true;
})()
'@ | Out-Null
Wait-DirectorExpression -Expression "Boolean(document.querySelector('[data-action=generate-agent-take]'))"
Invoke-DirectorExpression -Expression "document.querySelector('[data-action=generate-agent-take]').click(); true" | Out-Null
Wait-DirectorExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=replay][data-valid=true]'))" -Attempts 160
Invoke-DirectorExpression -Expression "document.querySelector('[data-mode-id=direct]').click(); true" | Out-Null
Wait-DirectorExpression -Expression "Boolean(document.querySelector('.tpt-director-timeline'))"

$directorArtifactRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ArtifactDirectory))
[IO.Directory]::CreateDirectory($directorArtifactRoot) | Out-Null
$directorResults = @()
$directorProfiles = @('human-natural', 'tight-fast', 'combo-rush')
foreach ($directorProfileId in $directorProfiles) {
  Set-DirectorProfile -ProfileId $directorProfileId
  $directorMeta = Invoke-DirectorExpression -Expression @'
(() => {
  const timeline = document.querySelector('.tpt-director-timeline');
  return JSON.stringify({
    profileId: timeline.dataset.profileId,
    totalFrames: Number(timeline.dataset.totalFrames),
    overlapCount: Number(timeline.dataset.overlapCount),
    firstOverlapFrame: Number(timeline.dataset.firstOverlapFrame || 0),
    actionCount: document.querySelectorAll('[data-director-action]').length,
    levelHash: timeline.dataset.levelHash,
    finalStateHash: timeline.dataset.finalStateHash,
  });
})()
'@ | ConvertFrom-Json
  $directorFrame = if ($directorMeta.firstOverlapFrame -gt 0) { [int]$directorMeta.firstOverlapFrame } else { [Math]::Floor($directorMeta.totalFrames * 0.34) }
  Set-DirectorFrame -Frame $directorFrame
  $directorSnapshotA = Invoke-DirectorExpression -Expression @'
JSON.stringify({
  stateHash: document.querySelector('.tpt-studio').dataset.stateHash,
  frame: document.querySelector('.tpt-studio').dataset.directorFrame,
  source: document.querySelector('.tpt-phone-stage').dataset.renderSource,
  renderIdentity: document.querySelector('.tpt-canvas-preview').dataset.previewRenderIdentity,
  pixelHash: document.querySelector('.tpt-canvas-preview').dataset.previewPixelHash,
})
'@
  Set-DirectorFrame -Frame ([Math]::Min($directorMeta.totalFrames - 1, $directorFrame + 7))
  Set-DirectorFrame -Frame $directorFrame
  $directorSnapshotB = Invoke-DirectorExpression -Expression @'
JSON.stringify({
  stateHash: document.querySelector('.tpt-studio').dataset.stateHash,
  frame: document.querySelector('.tpt-studio').dataset.directorFrame,
  source: document.querySelector('.tpt-phone-stage').dataset.renderSource,
  renderIdentity: document.querySelector('.tpt-canvas-preview').dataset.previewRenderIdentity,
  pixelHash: document.querySelector('.tpt-canvas-preview').dataset.previewPixelHash,
})
'@
  if ($directorSnapshotA -ne $directorSnapshotB) { throw "Direct seek drifted for $directorProfileId" }
  Save-DirectorScreenshot -Path (Join-Path $directorArtifactRoot "gate-c-$directorProfileId.png")
  $directorResults += ,$directorMeta
}

$directorDurations = @($directorResults | ForEach-Object { $_.totalFrames } | Sort-Object -Unique)
$directorLevelHashes = @($directorResults | ForEach-Object { $_.levelHash } | Sort-Object -Unique)
$directorFinalHashes = @($directorResults | ForEach-Object { $_.finalStateHash } | Sort-Object -Unique)
$directorActionCounts = @($directorResults | ForEach-Object { $_.actionCount } | Sort-Object -Unique)
$directorErrors = Invoke-DirectorExpression -Expression "JSON.stringify(window.__tptDirectorErrors || [])" | ConvertFrom-Json
if ($directorDurations.Count -lt 3) { throw 'Three DirectorProfiles did not produce distinct durations.' }
if ($directorLevelHashes.Count -ne 1 -or $directorFinalHashes.Count -ne 1 -or $directorActionCounts.Count -ne 1) { throw 'Profile switching changed gameplay identity.' }
if (($directorResults | Where-Object { $_.profileId -in @('tight-fast', 'combo-rush') -and $_.overlapCount -lt 1 }).Count -gt 0) { throw 'Fast profiles did not overlap match VFX with the next action.' }
if (@($directorErrors).Count -gt 0) { throw "Browser errors: $($directorErrors | ConvertTo-Json -Compress)" }

[ordered]@{
  profiles = $directorProfiles
  durations = $directorResults | ForEach-Object { $_.totalFrames }
  actions = $directorActionCounts[0]
  levelHash = $directorLevelHashes[0]
  finalStateHash = $directorFinalHashes[0]
  fastProfileOverlapCounts = $directorResults | Where-Object { $_.profileId -ne 'human-natural' } | ForEach-Object { $_.overlapCount }
  directSeekStable = $true
  consoleErrors = @($directorErrors).Count
  artifactDirectory = $directorArtifactRoot
} | ConvertTo-Json -Depth 6

Invoke-DirectorCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
$directorSocket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$directorSocket.Dispose()
