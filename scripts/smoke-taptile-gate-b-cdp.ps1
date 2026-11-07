param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ArtifactDirectory = 'artifacts/design-qa/taptile'
)

$ErrorActionPreference = 'Stop'
$skinTargets = Invoke-RestMethod -Uri $Endpoint -TimeoutSec 5
$skinTarget = @($skinTargets | Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl })[0]
if (-not $skinTarget) { throw "No CDP page target found for $PageUrl" }
$skinSocket = [System.Net.WebSockets.ClientWebSocket]::new()
$skinSocket.ConnectAsync([Uri]$skinTarget.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:skinMessageId = 0

function Invoke-SkinCdpCommand {
  param([Parameter(Mandatory)][string]$Method, [hashtable]$Params = @{})
  $script:skinMessageId += 1
  $skinId = $script:skinMessageId
  $skinPayload = @{ id = $skinId; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
  $skinBytes = [Text.Encoding]::UTF8.GetBytes($skinPayload)
  $skinSocket.SendAsync([ArraySegment[byte]]::new($skinBytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
  while ($true) {
    $skinStream = [IO.MemoryStream]::new()
    do {
      $skinBuffer = New-Object byte[] 65536
      $skinReceive = $skinSocket.ReceiveAsync([ArraySegment[byte]]::new($skinBuffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($skinReceive.Count -gt 0) { $skinStream.Write($skinBuffer, 0, $skinReceive.Count) }
    } until ($skinReceive.EndOfMessage)
    $skinJson = [Text.Encoding]::UTF8.GetString($skinStream.ToArray()) | ConvertFrom-Json
    $skinStream.Dispose()
    if ($skinJson.id -eq $skinId) {
      if ($skinJson.error) { throw ($skinJson.error | ConvertTo-Json -Compress) }
      return $skinJson.result
    }
  }
}

function Invoke-SkinExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $skinResult = Invoke-SkinCdpCommand -Method 'Runtime.evaluate' -Params @{
    expression = $Expression; returnByValue = $true; awaitPromise = $true
  }
  return $skinResult.result.value
}

function Wait-SkinExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 120)
  for ($skinAttempt = 0; $skinAttempt -lt $Attempts; $skinAttempt += 1) {
    if (Invoke-SkinExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for: $Expression"
}

function Save-SkinScreenshot {
  param([Parameter(Mandatory)][string]$Path)
  $skinCapture = Invoke-SkinCdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
  [IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String([string]$skinCapture.data))
}

function Get-SkinTrace {
  param([Parameter(Mandatory)][string]$ScreenshotPath)
  Invoke-SkinExpression -Expression "document.querySelector('[data-mode-id=replay]').click(); true" | Out-Null
  Wait-SkinExpression -Expression "document.querySelector('.tpt-replay-controls input')?.value === '0'"
  $skinMaximum = [int](Invoke-SkinExpression -Expression "Number(document.querySelector('.tpt-replay-controls input').max)")
  $skinTrace = @()
  $skinRoleCheck = $null
  for ($skinIndex = 0; $skinIndex -le $skinMaximum; $skinIndex += 1) {
    $skinSnapshot = Invoke-SkinExpression -Expression @'
JSON.stringify({
  index: Number(document.querySelector('.tpt-replay-controls input').value),
  stateHash: document.querySelector('.tpt-studio').dataset.stateHash,
  boardIds: [...document.querySelectorAll('.stack-tile')].map((tile) => tile.dataset.tileId).sort(),
  trayIds: [...document.querySelectorAll('.tpt-gameplay-tray i.is-occupied')].map((slot) => slot.dataset.tileId),
})
'@ | ConvertFrom-Json
    $skinTrace += ,$skinSnapshot
    if ($skinIndex -eq 1) {
      $skinRoleCheck = Invoke-SkinExpression -Expression @'
(() => {
  const tray = document.querySelector('.tpt-gameplay-tray i.is-occupied .tpt-tile-visual');
  const board = [...document.querySelectorAll('.stack-tile .tpt-tile-visual')]
    .find((visual) => visual.dataset.visualArchetype === tray?.dataset.visualArchetype);
  return JSON.stringify({
    theme: document.querySelector('.tpt-studio').dataset.selectedTheme,
    trayRole: tray?.dataset.presentationRole,
    boardRole: board?.dataset.presentationRole,
    sameIdentity: Boolean(tray && board && tray.dataset.visualIdentity === board.dataset.visualIdentity),
    identity: tray?.dataset.visualIdentity,
  });
})()
'@ | ConvertFrom-Json
      Save-SkinScreenshot -Path $ScreenshotPath
    }
    if ($skinIndex -lt $skinMaximum) {
      Invoke-SkinExpression -Expression "[...document.querySelectorAll('.tpt-replay-controls button')].at(-1).click(); true" | Out-Null
      Wait-SkinExpression -Expression "document.querySelector('.tpt-replay-controls input')?.value === '$($skinIndex + 1)'"
    }
  }
  return @{ maximum = $skinMaximum; trace = $skinTrace; roleCheck = $skinRoleCheck }
}

Invoke-SkinCdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-SkinCdpCommand -Method 'Page.enable' | Out-Null
Invoke-SkinCdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{
  width = 1440; height = 1000; deviceScaleFactor = 1; mobile = $false
} | Out-Null
Invoke-SkinExpression -Expression "localStorage.removeItem('taptile-director-project/autosave/v2'); true" | Out-Null
Invoke-SkinCdpCommand -Method 'Page.reload' | Out-Null
Wait-SkinExpression -Expression "Boolean(document.querySelector('.tpt-studio'))"
Invoke-SkinExpression -Expression @'
(() => {
  window.__tptSkinErrors = [];
  window.addEventListener('error', (event) => window.__tptSkinErrors.push(String(event.error?.stack || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__tptSkinErrors.push(String(event.reason?.stack || event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => {
    window.__tptSkinErrors.push(args.map((value) => String(value)).join(' '));
    originalError(...args);
  };
  document.querySelector('[data-mode-id="play"]').click();
  return true;
})()
'@ | Out-Null
Wait-SkinExpression -Expression "Boolean(document.querySelector('[data-action=generate-agent-take]'))"
Invoke-SkinExpression -Expression "document.querySelector('[data-action=generate-agent-take]').click(); true" | Out-Null
Wait-SkinExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=replay][data-valid=true]'))" -Attempts 160
Start-Sleep -Milliseconds 450

$skinArtifactRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ArtifactDirectory))
[IO.Directory]::CreateDirectory($skinArtifactRoot) | Out-Null
$skinAnimalLevelHash = [string](Invoke-SkinExpression -Expression "document.querySelector('.tpt-studio').dataset.levelHash")
$skinAnimalCompatibility = Invoke-SkinExpression -Expression "document.querySelector('[data-skin-valid]')?.dataset.skinValid === 'true'"
$skinAnimalPalette = Invoke-SkinExpression -Expression "JSON.stringify({ theme: document.querySelector('.tpt-face-grid')?.dataset.matchGroupTheme, faces: [...document.querySelectorAll('.tpt-face-grid [data-match-key]')].map((button) => ({ key: button.dataset.matchKey, assembly: button.dataset.previewFaceAssembly, label: button.querySelector('small')?.textContent })) })" | ConvertFrom-Json
$skinAnimal = Get-SkinTrace -ScreenshotPath (Join-Path $skinArtifactRoot 'gate-b-animals-v1-replay.png')

Invoke-SkinExpression -Expression @'
(() => {
  const select = [...document.querySelectorAll('.tpt-field select')].find((candidate) => candidate.value === 'animals-v1');
  select.value = 'food-v1';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()
'@ | Out-Null
Wait-SkinExpression -Expression "document.querySelector('.tpt-studio').dataset.selectedTheme === 'food-v1'"
$skinFoodLevelHash = [string](Invoke-SkinExpression -Expression "document.querySelector('.tpt-studio').dataset.levelHash")
$skinFoodCompatibility = Invoke-SkinExpression -Expression "document.querySelector('[data-skin-valid]')?.dataset.skinValid === 'true'"
$skinFoodPalette = Invoke-SkinExpression -Expression "JSON.stringify({ theme: document.querySelector('.tpt-face-grid')?.dataset.matchGroupTheme, faces: [...document.querySelectorAll('.tpt-face-grid [data-match-key]')].map((button) => ({ key: button.dataset.matchKey, assembly: button.dataset.previewFaceAssembly, label: button.querySelector('small')?.textContent })) })" | ConvertFrom-Json
$skinFood = Get-SkinTrace -ScreenshotPath (Join-Path $skinArtifactRoot 'gate-b-food-v1-replay.png')

$skinAnimalTraceJson = $skinAnimal.trace | ConvertTo-Json -Depth 8 -Compress
$skinFoodTraceJson = $skinFood.trace | ConvertTo-Json -Depth 8 -Compress
$skinProject = Invoke-SkinExpression -Expression "localStorage.getItem('taptile-director-project/autosave/v2')" | ConvertFrom-Json
$skinTake = $skinProject.takes | Where-Object { $_.id -eq $skinProject.selectedTakeId } | Select-Object -First 1
$skinErrors = Invoke-SkinExpression -Expression "JSON.stringify(window.__tptSkinErrors || [])" | ConvertFrom-Json

if ($skinAnimalLevelHash -ne $skinFoodLevelHash) { throw "levelHash changed across skins: $skinAnimalLevelHash -> $skinFoodLevelHash" }
if ($skinAnimalTraceJson -ne $skinFoodTraceJson) { throw 'Replay state/board/tray trace changed across skins.' }
if (-not $skinAnimalCompatibility -or -not $skinFoodCompatibility) { throw 'A SkinPack failed compatibility validation.' }
if ($skinAnimalPalette.theme -ne 'animals-v1' -or $skinFoodPalette.theme -ne 'food-v1') { throw 'Match-group palette did not follow the selected SkinPack.' }
if (@($skinAnimalPalette.faces).Count -ne 16 -or @($skinFoodPalette.faces).Count -ne 16) { throw 'Match-group palette must keep 16 stable gameplay keys.' }
if (@($skinAnimalPalette.faces | Where-Object { -not $_.assembly -or -not $_.label }).Count -gt 0 -or @($skinFoodPalette.faces | Where-Object { -not $_.assembly -or -not $_.label }).Count -gt 0) { throw 'A match-group preview is missing its resolved face or label.' }
if (($skinAnimalPalette.faces | ConvertTo-Json -Depth 5 -Compress) -eq ($skinFoodPalette.faces | ConvertTo-Json -Depth 5 -Compress)) { throw 'Match-group palette visuals stayed unchanged across SkinPacks.' }
if (-not $skinAnimal.roleCheck.sameIdentity -or -not $skinFood.roleCheck.sameIdentity) { throw 'Board and tray did not resolve one visual identity.' }
if ($skinAnimal.roleCheck.identity -eq $skinFood.roleCheck.identity) { throw 'The two SkinPacks resolved the same visual identity.' }
if (@($skinErrors).Count -gt 0) { throw "Browser errors: $($skinErrors | ConvertTo-Json -Compress)" }

[ordered]@{
  levelHash = $skinAnimalLevelHash
  takeActions = $skinTake.actions.Count
  replayStatesCompared = $skinAnimal.trace.Count
  finalStateHash = [string]$skinTake.finalStateHash
  animalsCompatibility = [bool]$skinAnimalCompatibility
  foodCompatibility = [bool]$skinFoodCompatibility
  boardTrayIdentity = $true
  visualIdentityChanged = $true
  matchGroupPaletteChanged = $true
  consoleErrors = @($skinErrors).Count
  artifactDirectory = $skinArtifactRoot
} | ConvertTo-Json -Depth 5

Invoke-SkinCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
$skinSocket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$skinSocket.Dispose()
