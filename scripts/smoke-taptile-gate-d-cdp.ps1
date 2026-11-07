param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ArtifactDirectory = 'artifacts/design-qa/taptile'
)

$ErrorActionPreference = 'Stop'
$target = Invoke-RestMethod -Uri $Endpoint -TimeoutSec 5 |
  Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl } |
  Select-Object -First 1
if (-not $target) { throw "No CDP page target found for $PageUrl" }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:messageId = 0

function Invoke-GateDCdpCommand {
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

function Invoke-GateDExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $result = Invoke-GateDCdpCommand -Method 'Runtime.evaluate' -Params @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress) }
  return $result.result.value
}

function Wait-GateDExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 600)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    if (Invoke-GateDExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for: $Expression"
}

function Set-GateDSelect {
  param([Parameter(Mandatory)][string]$Selector, [Parameter(Mandatory)][string]$Value)
  $expression = (@'
(() => {
  const select = document.querySelector('__SELECTOR__');
  if (!select) throw new Error('Missing select: __SELECTOR__');
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(select, '__VALUE__');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
})()
'@).Replace('__SELECTOR__', $Selector).Replace('__VALUE__', $Value)
  Invoke-GateDExpression -Expression $expression | Out-Null
}

function Save-GateDLink {
  param([Parameter(Mandatory)][string]$Selector, [Parameter(Mandatory)][string]$Path)
  $expression = (@'
(async () => {
  const link = document.querySelector('__SELECTOR__');
  if (!link) throw new Error('Missing download link: __SELECTOR__');
  const blob = await fetch(link.href).then((response) => response.blob());
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return JSON.stringify({ base64: btoa(binary), type: blob.type, bytes: bytes.length, fileName: link.download });
})()
'@).Replace('__SELECTOR__', $Selector)
  $result = Invoke-GateDExpression -Expression $expression | ConvertFrom-Json
  [IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String([string]$result.base64))
  return $result
}

function Save-GateDScreenshot {
  param([Parameter(Mandatory)][string]$Path)
  $capture = Invoke-GateDCdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
  [IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String([string]$capture.data))
}

Invoke-GateDCdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-GateDCdpCommand -Method 'Page.enable' | Out-Null
Invoke-GateDCdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{ width = 1440; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
Invoke-GateDExpression -Expression "localStorage.removeItem('taptile-director-project/autosave/v2'); true" | Out-Null
Invoke-GateDCdpCommand -Method 'Page.reload' | Out-Null
Wait-GateDExpression -Expression "Boolean(document.querySelector('.tpt-studio'))"
Invoke-GateDExpression -Expression @'
(() => {
  window.__tptGateDErrors = [];
  window.addEventListener('error', (event) => window.__tptGateDErrors.push(String(event.error?.stack || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__tptGateDErrors.push(String(event.reason?.stack || event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => { window.__tptGateDErrors.push(args.map(String).join(' ')); originalError(...args); };
  return true;
})()
'@ | Out-Null

function New-GateDAgentTake {
  param([Parameter(Mandatory)][string]$Profile, [Parameter(Mandatory)][int]$ExpectedTakeCount)
  Invoke-GateDExpression -Expression "document.querySelector('[data-mode-id=play]').click(); true" | Out-Null
  Wait-GateDExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=play]'))"
  Set-GateDSelect -Selector '[data-agent-profile]' -Value $Profile
  Invoke-GateDExpression -Expression "document.querySelector('[data-action=generate-agent-take]').click(); true" | Out-Null
  $takeWait = (@'
Boolean(document.querySelector('.tpt-session-bar[data-mode=replay][data-valid=true]')) && JSON.parse(localStorage.getItem('taptile-director-project/autosave/v2') || '{"takes":[]}').takes.length >= __COUNT__
'@).Replace('__COUNT__', [string]$ExpectedTakeCount)
  Wait-GateDExpression -Expression $takeWait -Attempts 1200
}

New-GateDAgentTake -Profile 'safe-win' -ExpectedTakeCount 1
New-GateDAgentTake -Profile 'combo-heavy' -ExpectedTakeCount 2
Invoke-GateDExpression -Expression "document.querySelector('[data-mode-id=export]').click(); true" | Out-Null
Wait-GateDExpression -Expression "Boolean(document.querySelector('.tpt-production-panel'))" -Attempts 400

$inventory = Invoke-GateDExpression -Expression @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  return JSON.stringify({
    takes: Number(panel.dataset.productionTakes),
    skins: Number(panel.dataset.productionSkins),
    directors: Number(panel.dataset.productionDirectors),
    audioPacks: Number(panel.dataset.productionAudioPacks),
    cuts: Number(panel.dataset.productionCuts),
    outros: Number(panel.dataset.productionOutros),
    matrixTotal: Number(panel.dataset.matrixTotal),
    matrixValid: Number(panel.dataset.matrixValid),
    matrixInvalid: Number(panel.dataset.matrixInvalid)
  });
})()
'@ | ConvertFrom-Json
if ($inventory.takes -lt 2 -or $inventory.skins -lt 2 -or $inventory.directors -lt 3 -or $inventory.audioPacks -lt 2 -or $inventory.cuts -lt 2 -or $inventory.outros -lt 1) {
  throw "Gate D inventory incomplete: $($inventory | ConvertTo-Json -Compress)"
}

Set-GateDSelect -Selector '[data-production-director]' -Value 'combo-rush'
Set-GateDSelect -Selector '[data-production-audio]' -Value 'bright-pop-v1'
Set-GateDSelect -Selector '[data-production-cut]' -Value 'opening-six'
Set-GateDSelect -Selector '[data-production-outro]' -Value 'play-now-v1'
Wait-GateDExpression -Expression "document.querySelector('.tpt-production-panel')?.dataset.productionValid === 'true' && document.querySelector('.tpt-production-preview')?.dataset.previewHash !== 'pending'"

$artifactRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ArtifactDirectory))
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
Save-GateDScreenshot -Path (Join-Path $artifactRoot 'gate-d-production-matrix.png')
Invoke-GateDExpression -Expression @'
(() => {
  const input = document.querySelector('[data-production-preview-seek]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, input.max);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()
'@ | Out-Null
Wait-GateDExpression -Expression "document.querySelector('.tpt-production-preview')?.dataset.previewPhase === 'outro' && document.querySelector('.tpt-production-preview')?.dataset.previewHash !== 'pending'"
$outroData = Invoke-GateDExpression -Expression "document.querySelector('.tpt-production-preview').toDataURL('image/png')"
[IO.File]::WriteAllBytes((Join-Path $artifactRoot 'gate-d-outro-final-frame.png'), [Convert]::FromBase64String(([string]$outroData).Substring(([string]$outroData).IndexOf(',') + 1)))

Invoke-GateDExpression -Expression "document.querySelector('[data-action=start-production-export]').click(); true" | Out-Null
Wait-GateDExpression -Expression "Boolean(document.querySelector('[data-action=cancel-production-export]'))"
Wait-GateDExpression -Expression "document.querySelector('.tpt-production-panel')?.dataset.singlePhase === 'done' && Number(document.querySelector('.tpt-production-panel')?.dataset.singleBytes) > 1000" -Attempts 1800
$firstIdentity = Invoke-GateDExpression -Expression @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  return JSON.stringify({
    sha256: panel.dataset.singleVideoSha,
    pcmHash: panel.dataset.singlePcmHash,
    combinationHash: panel.dataset.singleCombinationHash,
    frames: Number(panel.dataset.singleFrames),
    bytes: Number(panel.dataset.singleBytes)
  });
})()
'@ | ConvertFrom-Json
$singleVideo = Save-GateDLink -Selector '[data-production-video-download]' -Path (Join-Path $artifactRoot 'gate-d-single-audio.mp4')
$singleManifest = Save-GateDLink -Selector '[data-production-manifest-download]' -Path (Join-Path $artifactRoot 'gate-d-single-audio.mp4.manifest.json')
$manifestJson = Get-Content -LiteralPath (Join-Path $artifactRoot 'gate-d-single-audio.mp4.manifest.json') -Raw | ConvertFrom-Json
if ($manifestJson.audio.codec -ne 'aac' -or $manifestJson.audio.cueCount -le 0) { throw 'Single export manifest does not contain a semantic AAC mix.' }

Invoke-GateDExpression -Expression "document.querySelector('[data-action=start-production-export]').click(); true" | Out-Null
Wait-GateDExpression -Expression "Boolean(document.querySelector('[data-action=cancel-production-export]'))"
Wait-GateDExpression -Expression "document.querySelector('.tpt-production-panel')?.dataset.singlePhase === 'done' && Boolean(document.querySelector('[data-production-video-download]'))" -Attempts 1800
$secondIdentity = Invoke-GateDExpression -Expression @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  return JSON.stringify({ sha256: panel.dataset.singleVideoSha, pcmHash: panel.dataset.singlePcmHash, combinationHash: panel.dataset.singleCombinationHash });
})()
'@ | ConvertFrom-Json
Save-GateDLink -Selector '[data-production-video-download]' -Path (Join-Path $artifactRoot 'gate-d-single-audio-rerun.mp4') | Out-Null
$containerShaStable = $secondIdentity.sha256 -eq $firstIdentity.sha256
if ($secondIdentity.pcmHash -ne $firstIdentity.pcmHash -or $secondIdentity.combinationHash -ne $firstIdentity.combinationHash) {
  throw "Deterministic rerun mismatch: $($firstIdentity | ConvertTo-Json -Compress) -> $($secondIdentity | ConvertTo-Json -Compress)"
}

Invoke-GateDExpression -Expression "document.querySelector('[data-action=start-production-batch]').click(); true" | Out-Null
Wait-GateDExpression -Expression "Number(document.querySelector('.tpt-production-panel')?.dataset.batchTotal) === 3"
Wait-GateDExpression -Expression "Number(document.querySelector('.tpt-production-panel')?.dataset.batchCompleted) + Number(document.querySelector('.tpt-production-panel')?.dataset.batchFailed) + Number(document.querySelector('.tpt-production-panel')?.dataset.batchCanceled) === 3" -Attempts 3600
$batchSummary = Invoke-GateDExpression -Expression @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  return JSON.stringify({
    total: Number(panel.dataset.batchTotal),
    completed: Number(panel.dataset.batchCompleted),
    failed: Number(panel.dataset.batchFailed),
    canceled: Number(panel.dataset.batchCanceled),
    videos: document.querySelectorAll('[data-batch-video-download]').length,
    manifests: document.querySelectorAll('[data-batch-manifest-download]').length,
    statuses: [...document.querySelectorAll('[data-batch-task]')].map((node) => ({ id: node.dataset.batchTask, status: node.dataset.batchStatus }))
  });
})()
'@ | ConvertFrom-Json
if ($batchSummary.completed -lt 3 -or $batchSummary.videos -lt 3 -or $batchSummary.manifests -lt 3) { throw "Batch did not complete three variants: $($batchSummary | ConvertTo-Json -Compress)" }
for ($index = 0; $index -lt 3; $index += 1) {
  $saveVideoExpression = "[data-batch-task]:nth-child($($index + 1)) [data-batch-video-download]"
  Save-GateDLink -Selector $saveVideoExpression -Path (Join-Path $artifactRoot "gate-d-batch-$($index + 1).mp4") | Out-Null
  $saveManifestExpression = "[data-batch-task]:nth-child($($index + 1)) [data-batch-manifest-download]"
  Save-GateDLink -Selector $saveManifestExpression -Path (Join-Path $artifactRoot "gate-d-batch-$($index + 1).mp4.manifest.json") | Out-Null
  Invoke-GateDExpression -Expression "document.querySelector('[data-batch-task]:nth-child($($index + 1)) [data-batch-video-download]').setAttribute('data-saved-video', 'true'); true" | Out-Null
}
Save-GateDScreenshot -Path (Join-Path $artifactRoot 'gate-d-batch-complete.png')

Invoke-GateDExpression -Expression "document.querySelector('[data-action=export-project-bundle]').click(); true" | Out-Null
Wait-GateDExpression -Expression "Number(document.querySelector('.tpt-bundle-row')?.dataset.bundleBytes) > 0 && Boolean(document.querySelector('[data-project-bundle-download]'))" -Attempts 600
$bundle = Save-GateDLink -Selector '[data-project-bundle-download]' -Path (Join-Path $artifactRoot 'gate-d-project.taptile-project.zip')
$projectBefore = Invoke-GateDExpression -Expression "(() => { const p = JSON.parse(localStorage.getItem('taptile-director-project/autosave/v2')); return JSON.stringify({ id: p.id, revision: p.revision, levelId: p.level.id, takeIds: p.takes.map(t => t.id), selectedTakeId: p.selectedTakeId, audioPacks: Object.keys(p.production.audioPacks).sort(), cuts: Object.keys(p.production.cuts).sort(), outros: Object.keys(p.production.outros).sort() }); })()"
Invoke-GateDExpression -Expression @'
(async () => {
  const link = document.querySelector('[data-project-bundle-download]');
  const blob = await fetch(link.href).then((response) => response.blob());
  const file = new File([blob], link.download, { type: 'application/zip' });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = document.querySelector('[data-project-bundle-import]');
  Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return blob.size;
})()
'@ | Out-Null
Wait-GateDExpression -Expression "document.querySelector('.tpt-status-notice')?.textContent.includes('项目包 hash 校验通过并已回导')" -Attempts 600
Wait-GateDExpression -Expression "Boolean(localStorage.getItem('taptile-director-project/autosave/v2'))"
$projectAfter = Invoke-GateDExpression -Expression "(() => { const p = JSON.parse(localStorage.getItem('taptile-director-project/autosave/v2')); return JSON.stringify({ id: p.id, revision: p.revision, levelId: p.level.id, takeIds: p.takes.map(t => t.id), selectedTakeId: p.selectedTakeId, audioPacks: Object.keys(p.production.audioPacks).sort(), cuts: Object.keys(p.production.cuts).sort(), outros: Object.keys(p.production.outros).sort() }); })()"
if ($projectAfter -ne $projectBefore) { throw 'Project bundle round-trip changed project.json content.' }

$errors = Invoke-GateDExpression -Expression "JSON.stringify(window.__tptGateDErrors || [])" | ConvertFrom-Json
if (@($errors).Count -gt 0) { throw "Browser errors: $($errors | ConvertTo-Json -Compress)" }

[ordered]@{
  inventory = $inventory
  single = [ordered]@{
    frames = $firstIdentity.frames
    bytes = $firstIdentity.bytes
    sha256 = $firstIdentity.sha256
    pcmHash = $firstIdentity.pcmHash
    combinationHash = $firstIdentity.combinationHash
    cueCount = $manifestJson.audio.cueCount
    peakAfterLimit = $manifestJson.audio.peakAfterLimit
    video = (Join-Path $artifactRoot 'gate-d-single-audio.mp4')
    manifest = (Join-Path $artifactRoot 'gate-d-single-audio.mp4.manifest.json')
  }
  deterministicRerun = [ordered]@{ contentIdentity = $true; containerShaStable = $containerShaStable; secondSha256 = $secondIdentity.sha256 }
  batch = $batchSummary
  bundle = [ordered]@{ bytes = $bundle.bytes; roundTripExact = $true; path = (Join-Path $artifactRoot 'gate-d-project.taptile-project.zip') }
  consoleErrors = @($errors).Count
  artifactDirectory = $artifactRoot
} | ConvertTo-Json -Depth 10

Invoke-GateDCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
$socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$socket.Dispose()
