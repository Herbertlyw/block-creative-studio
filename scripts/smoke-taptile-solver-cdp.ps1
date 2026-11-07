param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ArtifactDirectory = 'artifacts/design-qa/taptile',
  [ValidateSet('max-clear', 'safe-win', 'danger-rescue', 'combo-heavy', 'fast-clear', 'intentional-fail')]
  [string]$Profile = 'safe-win',
  [ValidateSet('fast', 'standard', 'deep')]
  [string]$SearchStrength = 'standard',
  [switch]$PartialFixture
)

$ErrorActionPreference = 'Stop'
$solverTargets = Invoke-RestMethod -Uri $Endpoint -TimeoutSec 5
$solverTarget = $solverTargets.Where({ $_.type -eq 'page' -and $_.url -eq $PageUrl }) |
  Select-Object -First 1
if (-not $solverTarget) { throw "No CDP page target found for $PageUrl" }

$solverSocket = [System.Net.WebSockets.ClientWebSocket]::new()
$solverSocket.ConnectAsync([Uri]$solverTarget.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:solverMessageId = 0

function Invoke-SolverCdpCommand {
  param([Parameter(Mandatory)][string]$Method, [hashtable]$Params = @{})
  $script:solverMessageId += 1
  $solverId = $script:solverMessageId
  $solverPayload = @{ id = $solverId; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
  $solverBytes = [Text.Encoding]::UTF8.GetBytes($solverPayload)
  $solverSocket.SendAsync([ArraySegment[byte]]::new($solverBytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  while ($true) {
    $solverStream = [IO.MemoryStream]::new()
    do {
      $solverBuffer = New-Object byte[] 65536
      $solverReceive = $solverSocket.ReceiveAsync([ArraySegment[byte]]::new($solverBuffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($solverReceive.Count -gt 0) { $solverStream.Write($solverBuffer, 0, $solverReceive.Count) }
    } until ($solverReceive.EndOfMessage)
    $solverJson = [Text.Encoding]::UTF8.GetString($solverStream.ToArray()) | ConvertFrom-Json
    $solverStream.Dispose()
    if ($solverJson.id -eq $solverId) {
      if ($solverJson.error) { throw ($solverJson.error | ConvertTo-Json -Compress) }
      return $solverJson.result
    }
  }
}

function Invoke-SolverExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $solverResult = Invoke-SolverCdpCommand -Method 'Runtime.evaluate' -Params @{
    expression = $Expression
    returnByValue = $true
    awaitPromise = $true
  }
  return $solverResult.result.value
}

function Wait-SolverExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 100)
  for ($solverAttempt = 0; $solverAttempt -lt $Attempts; $solverAttempt += 1) {
    if (Invoke-SolverExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for: $Expression"
}

Invoke-SolverCdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-SolverCdpCommand -Method 'Page.enable' | Out-Null
Invoke-SolverCdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{
  width = 1440; height = 1000; deviceScaleFactor = 1; mobile = $false
} | Out-Null
Invoke-SolverExpression -Expression "localStorage.removeItem('taptile-director-project/autosave/v2'); true" | Out-Null
Invoke-SolverCdpCommand -Method 'Page.reload' | Out-Null
Wait-SolverExpression -Expression "Boolean(document.querySelector('.tpt-studio'))"
if ($PartialFixture) {
  Wait-SolverExpression -Expression "Boolean(localStorage.getItem('taptile-director-project/autosave/v2'))"
  Invoke-SolverExpression -Expression @'
(() => {
  const storageKey = 'taptile-director-project/autosave/v2';
  const project = JSON.parse(localStorage.getItem(storageKey));
  const archetypeIds = Object.keys(project.visuals.archetypes).sort().slice(0, 6);
  const copies = [4, 4, 5, 4, 4, 2];
  const assignments = copies.flatMap((count, index) => Array.from({ length: count }, () => archetypeIds[index]));
  project.level.tileInstances = project.level.tileInstances.slice(0, assignments.length).map((tile, index) => ({
    ...tile,
    archetypeId: assignments[index],
    geometry: {
      ...tile.geometry,
      centerXPx: 165 + (index % 6) * 150,
      centerYPx: 460 + Math.floor(index / 6) * 150,
      widthPx: 140,
      heightPx: 140,
      rotationDeg: 0,
      layer: 0,
      order: index,
    },
  }));
  project.level.blockerOverrides = { forced: [], ignored: [] };
  project.takes = [];
  delete project.selectedTakeId;
  project.revision += 1;
  project.updatedAt = new Date().toISOString();
  localStorage.setItem(storageKey, JSON.stringify(project));
  return assignments.length === 23;
})()
'@ | Out-Null
  Invoke-SolverCdpCommand -Method 'Page.reload' | Out-Null
  Wait-SolverExpression -Expression "Boolean(document.querySelector('.tpt-studio'))"
}
Invoke-SolverExpression -Expression @'
(() => {
  window.__tptSolverErrors = [];
  window.addEventListener('error', (event) => window.__tptSolverErrors.push(String(event.error?.stack || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__tptSolverErrors.push(String(event.reason?.stack || event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    window.__tptSolverErrors.push(args.map((value) => String(value)).join(' '));
    originalError(...args);
  };
  document.querySelector('[data-mode-id="play"]').click();
  return true;
})()
'@ | Out-Null
Wait-SolverExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=play]'))"
$solverProfileJson = $Profile | ConvertTo-Json -Compress
$solverStrengthJson = $SearchStrength | ConvertTo-Json -Compress
Invoke-SolverExpression -Expression @"
(() => {
  const profileSelect = document.querySelector('[data-agent-profile]');
  profileSelect.value = $solverProfileJson;
  profileSelect.dispatchEvent(new Event('change', { bubbles: true }));
  const strengthSelect = document.querySelector('[data-agent-search-strength]');
  strengthSelect.value = $solverStrengthJson;
  strengthSelect.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelector('[data-action="generate-agent-take"]').click();
  return true;
})()
"@ | Out-Null
Wait-SolverExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=replay][data-valid=true]'))" -Attempts 300
if ($PartialFixture) {
  Wait-SolverExpression -Expression "document.querySelector('[data-agent-clear-summary]')?.textContent.includes('最大消除 15/23') === true" -Attempts 100
  Wait-SolverExpression -Expression "document.querySelector('[data-action=toggle-replay-autoplay]')?.textContent.includes('重新播放') === true" -Attempts 100
}
Start-Sleep -Milliseconds 500

$solverSummary = Invoke-SolverExpression -Expression @'
(() => {
  const project = JSON.parse(localStorage.getItem('taptile-director-project/autosave/v2'));
  const take = project.takes.find((candidate) => candidate.id === project.selectedTakeId);
  return JSON.stringify({
    name: take?.name,
    result: take?.result,
    actions: take?.actions.length,
    allAgent: take?.actions.every((action) => action.actor === 'agent'),
    finalStateHash: take?.finalStateHash,
    replayValid: document.querySelector('.tpt-session-bar[data-mode=replay]')?.dataset.valid === 'true',
    clearSummary: document.querySelector('[data-agent-clear-summary]')?.textContent || '',
    autoPlayControl: Boolean(document.querySelector('[data-action="toggle-replay-autoplay"]')),
    consoleErrors: window.__tptSolverErrors.length,
  });
})()
'@ | ConvertFrom-Json
$expectedResult = if ($PartialFixture) { 'unfinished' } elseif ($Profile -eq 'intentional-fail') { 'lost' } else { 'won' }
if ($solverSummary.result -ne $expectedResult -or -not $solverSummary.allAgent -or -not $solverSummary.replayValid -or -not $solverSummary.autoPlayControl) {
  throw "Agent Take did not pass browser verification: $($solverSummary | ConvertTo-Json -Compress)"
}
if ($PartialFixture -and ($solverSummary.name -notlike '*最大消除 15/23*' -or $solverSummary.clearSummary -notlike '*理论上限 15*')) {
  throw "Maximum-clear summary did not report the proved 15/23 partial path: $($solverSummary | ConvertTo-Json -Compress)"
}
if ($solverSummary.consoleErrors -gt 0) { throw "Browser console errors: $($solverSummary.consoleErrors)" }

$solverArtifactRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ArtifactDirectory))
[IO.Directory]::CreateDirectory($solverArtifactRoot) | Out-Null
$solverCapture = Invoke-SolverCdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
$solverCaptureName = if ($PartialFixture) { 'agent-max-clear-partial-replay.png' } else { "agent-$Profile-replay.png" }
[IO.File]::WriteAllBytes((Join-Path $solverArtifactRoot $solverCaptureName), [Convert]::FromBase64String([string]$solverCapture.data))
if ($PartialFixture) {
  Invoke-SolverExpression -Expression "document.querySelector('[data-mode-id=direct]').click(); true" | Out-Null
  Wait-SolverExpression -Expression "document.querySelectorAll('.tpt-director-action').length === 15"
  $directorActionCount = Invoke-SolverExpression -Expression "document.querySelectorAll('.tpt-director-action').length"
  Invoke-SolverExpression -Expression "document.querySelector('[data-mode-id=export]').click(); true" | Out-Null
  Wait-SolverExpression -Expression "Boolean(document.querySelector('.tpt-export-panel'))"
  $solverSummary | Add-Member -NotePropertyName directorActionCount -NotePropertyValue $directorActionCount
  $solverSummary | Add-Member -NotePropertyName exportReady -NotePropertyValue $true
}
$solverSummary | ConvertTo-Json -Depth 5

Invoke-SolverCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
$solverSocket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$solverSocket.Dispose()
