param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ArtifactDirectory = 'artifacts/design-qa/taptile-production',
  [string]$BlenderGlbPath = '',
  [switch]$ExerciseCancellation,
  [switch]$UseCurrentProject
)

$ErrorActionPreference = 'Stop'
$targets = (Invoke-WebRequest -Uri $Endpoint -TimeoutSec 5).Content | ConvertFrom-Json
$target = @($targets | Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl })[0]
if (-not $target) { throw "No CDP page target found for $PageUrl" }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:messageId = 0

function Invoke-ProductionCdpCommand {
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

function Invoke-ProductionExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $result = Invoke-ProductionCdpCommand -Method 'Runtime.evaluate' -Params @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress) }
  return $result.result.value
}

function Wait-ProductionExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 2400)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    if (Invoke-ProductionExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for: $Expression"
}

function Set-ProductionSelect {
  param([Parameter(Mandatory)][string]$Selector, [Parameter(Mandatory)][string]$Value)
  $expression = (@'
(() => {
  const select = document.querySelector('__SELECTOR__');
  if (!select) throw new Error('Missing select: __SELECTOR__');
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, '__VALUE__');
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return select.value;
})()
'@).Replace('__SELECTOR__', $Selector).Replace('__VALUE__', $Value)
  Invoke-ProductionExpression -Expression $expression | Out-Null
}

$artifactRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ArtifactDirectory))
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
Invoke-ProductionCdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-ProductionCdpCommand -Method 'Page.enable' | Out-Null
Invoke-ProductionCdpCommand -Method 'Browser.setDownloadBehavior' -Params @{ behavior = 'allow'; downloadPath = $artifactRoot; eventsEnabled = $true } | Out-Null
Invoke-ProductionCdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{ width = 1440; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
if (-not $UseCurrentProject) {
  Invoke-ProductionExpression -Expression "localStorage.removeItem('taptile-director-project/autosave/v2'); true" | Out-Null
}
if ($BlenderGlbPath) {
  Invoke-ProductionExpression -Expression "Object.keys(localStorage).filter((key) => key.startsWith('taptile-blender-vfx/v1/')).forEach((key) => localStorage.removeItem(key)); true" | Out-Null
}
Invoke-ProductionCdpCommand -Method 'Page.reload' | Out-Null
Start-Sleep -Milliseconds 350
Wait-ProductionExpression -Expression "document.readyState === 'complete' && Boolean(document.querySelector('.tpt-studio'))"
Invoke-ProductionExpression -Expression @'
(() => {
  window.__tptProductionErrors = [];
  window.addEventListener('error', (event) => window.__tptProductionErrors.push(String(event.error?.stack || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__tptProductionErrors.push(String(event.reason?.stack || event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => { window.__tptProductionErrors.push(args.map(String).join(' ')); originalError(...args); };
  return true;
})()
'@ | Out-Null

if (-not $UseCurrentProject) {
  Wait-ProductionExpression -Expression "Boolean(document.querySelector('[data-mode-id=play]'))"
  Invoke-ProductionExpression -Expression "document.querySelector('[data-mode-id=play]')?.click(); true" | Out-Null
  Wait-ProductionExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=play]'))"
  Set-ProductionSelect -Selector '[data-agent-profile]' -Value 'max-clear'
  Set-ProductionSelect -Selector '[data-agent-search-strength]' -Value 'standard'
  Wait-ProductionExpression -Expression "Boolean(document.querySelector('[data-action=generate-agent-take]'))"
  Invoke-ProductionExpression -Expression "document.querySelector('[data-action=generate-agent-take]')?.click(); true" | Out-Null
  Wait-ProductionExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=replay][data-valid=true]'))"
}
Invoke-ProductionExpression -Expression "document.querySelector('[data-mode-id=export]')?.click(); true" | Out-Null
Wait-ProductionExpression -Expression "Boolean(document.querySelector('.tpt-production-panel[data-production-valid=true]'))"
Set-ProductionSelect -Selector '[data-production-quality]' -Value 'standard'
Wait-ProductionExpression -Expression "document.querySelector('[data-production-quality]')?.value === 'standard'"
Wait-ProductionExpression -Expression "Boolean(document.querySelector('[data-preview-hash]')?.dataset.previewHash) && document.querySelector('[data-preview-hash]').dataset.previewHash !== 'pending'"
$nativePreviewHash = Invoke-ProductionExpression -Expression "document.querySelector('[data-preview-hash]')?.dataset.previewHash || ''"
Set-ProductionSelect -Selector '[data-production-quality]' -Value 'cinematic'
Wait-ProductionExpression -Expression "document.querySelector('[data-production-quality]')?.value === 'cinematic'"
Wait-ProductionExpression -Expression "Boolean(document.querySelector('[data-preview-hash]')?.dataset.previewHash) && document.querySelector('[data-preview-hash]').dataset.previewHash !== 'pending' && document.querySelector('[data-preview-hash]').dataset.previewHash !== '$nativePreviewHash'" -Attempts 300
$cinematicPreviewHash = Invoke-ProductionExpression -Expression "document.querySelector('[data-preview-hash]')?.dataset.previewHash || ''"
$blenderVfxSummary = $null
if ($BlenderGlbPath) {
  $absoluteBlenderGlbPath = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $BlenderGlbPath))
  if (-not (Test-Path -LiteralPath $absoluteBlenderGlbPath)) { throw "Blender VFX GLB missing: $absoluteBlenderGlbPath" }
  $low = 0
  $high = [int](Invoke-ProductionExpression -Expression "Number(document.querySelector('[data-production-preview-seek]').max)")
  $bestFrame = 0
  $bestDistance = [int]::MaxValue
  while ($low -le $high) {
    $middle = [Math]::Floor(($low + $high) / 2)
    Invoke-ProductionExpression -Expression "(() => { const input=document.querySelector('[data-production-preview-seek]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'$middle'); input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()" | Out-Null
    Wait-ProductionExpression -Expression "Number(document.querySelector('[data-preview-hash]')?.dataset.previewFrame) === $middle"
    $sourceFrame = [int](Invoke-ProductionExpression -Expression "Number(document.querySelector('[data-preview-hash]')?.dataset.previewSourceFrame)")
    $distance = [Math]::Abs($sourceFrame - 134)
    if ($distance -lt $bestDistance) { $bestDistance = $distance; $bestFrame = $middle }
    if ($sourceFrame -lt 134) { $low = $middle + 1 } elseif ($sourceFrame -gt 134) { $high = $middle - 1 } else { break }
  }
  Invoke-ProductionExpression -Expression "(() => { const input=document.querySelector('[data-production-preview-seek]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'$bestFrame'); input.dispatchEvent(new Event('change',{bubbles:true})); return true; })()" | Out-Null
  Wait-ProductionExpression -Expression "Number(document.querySelector('[data-preview-hash]')?.dataset.previewFrame) === $bestFrame && document.querySelector('[data-preview-hash]').dataset.previewHash !== 'pending'"
  $twoDimensionalHash = Invoke-ProductionExpression -Expression "document.querySelector('[data-preview-hash]').dataset.previewHash"
  $inputObject = Invoke-ProductionCdpCommand -Method 'Runtime.evaluate' -Params @{ expression = "document.querySelector('[data-blender-vfx-input]')"; returnByValue = $false }
  if (-not $inputObject.result.objectId) { throw 'Blender VFX input was not rendered.' }
  Invoke-ProductionCdpCommand -Method 'DOM.setFileInputFiles' -Params @{ files = @($absoluteBlenderGlbPath); objectId = $inputObject.result.objectId } | Out-Null
  Invoke-ProductionExpression -Expression "document.querySelector('[data-blender-vfx-input]').dispatchEvent(new Event('change', { bubbles: true })); true" | Out-Null
  Wait-ProductionExpression -Expression "document.querySelector('.tpt-production-panel')?.dataset.blenderVfxLoaded === 'true' && document.querySelector('.tpt-production-panel')?.dataset.blenderVfxEnabled === 'true'"
  Wait-ProductionExpression -Expression "document.querySelector('[data-preview-hash]')?.dataset.previewHash !== 'pending' && document.querySelector('[data-preview-hash]')?.dataset.previewHash !== '$twoDimensionalHash'" -Attempts 1200
  $blenderSummaryExpression = @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  const canvas = document.querySelector('[data-preview-hash]');
  return JSON.stringify({
    fileName: document.querySelector('[data-blender-vfx-file]')?.textContent || '',
    sha256: panel.dataset.blenderVfxSha || '',
    eventCount: Number(panel.dataset.blenderVfxEvents || 0),
    enabled: panel.dataset.blenderVfxEnabled === 'true',
    isolated: panel.dataset.blenderVfxIsolated === 'true',
    finalFrame: Number(canvas.dataset.previewFrame),
    sourceFrame: Number(canvas.dataset.previewSourceFrame),
    twoDimensionalHash: '__TWO_DIMENSIONAL_HASH__',
    compositeHash: canvas.dataset.previewHash || '',
    error: document.querySelector('[data-blender-vfx-error]')?.textContent || ''
  });
})()
'@
  $blenderVfxSummary = Invoke-ProductionExpression -Expression $blenderSummaryExpression.Replace('__TWO_DIMENSIONAL_HASH__', $twoDimensionalHash) | ConvertFrom-Json
  if ($blenderVfxSummary.error -or -not $blenderVfxSummary.enabled -or $blenderVfxSummary.sha256.Length -ne 64 -or $blenderVfxSummary.eventCount -lt 1 -or $blenderVfxSummary.twoDimensionalHash -eq $blenderVfxSummary.compositeHash -or [Math]::Abs($blenderVfxSummary.sourceFrame - 134) -gt 2) {
    throw "Blender VFX composite preview is invalid: $($blenderVfxSummary | ConvertTo-Json -Compress)"
  }
}
$cancellationSummary = $null
if ($ExerciseCancellation) {
  Invoke-ProductionExpression -Expression "document.querySelector('[data-action=start-production-export]')?.click(); true" | Out-Null
  Wait-ProductionExpression -Expression "document.querySelector('.tpt-production-panel')?.dataset.singlePhase === 'rendering' && Boolean(document.querySelector('[data-action=cancel-production-export]'))" -Attempts 1200
  Invoke-ProductionExpression -Expression "document.querySelector('[data-action=cancel-production-export]')?.click(); true" | Out-Null
  Wait-ProductionExpression -Expression "Boolean(document.querySelector('[data-action=start-production-export]')) && document.querySelector('.tpt-production-panel')?.dataset.singleError.includes('已取消')" -Attempts 1200
  $cancellationSummary = Invoke-ProductionExpression -Expression @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  return {
    message: panel?.dataset.singleError || '',
    blenderStillLoaded: panel?.dataset.blenderVfxLoaded === 'true',
    blenderStillEnabled: panel?.dataset.blenderVfxEnabled === 'true',
    previewHash: document.querySelector('[data-preview-hash]')?.dataset.previewHash || '',
    browserErrors: window.__tptProductionErrors || []
  };
})()
'@
  if (-not $cancellationSummary.message.Contains('已取消') -or ($BlenderGlbPath -and (-not $cancellationSummary.blenderStillLoaded -or -not $cancellationSummary.blenderStillEnabled)) -or $cancellationSummary.previewHash.StartsWith('error:') -or @($cancellationSummary.browserErrors).Count -gt 0) {
    throw "Production cancellation did not release cleanly: $($cancellationSummary | ConvertTo-Json -Compress)"
  }
}
Invoke-ProductionExpression -Expression "document.querySelector('[data-action=start-production-export]')?.click(); true" | Out-Null
Wait-ProductionExpression -Expression "Boolean(document.querySelector('[data-action=cancel-production-export]')) && !document.querySelector('.tpt-production-panel')?.dataset.singleError" -Attempts 1200
Wait-ProductionExpression -Expression "document.querySelector('.tpt-production-panel')?.dataset.singlePhase === 'done' || Boolean(document.querySelector('.tpt-production-panel')?.dataset.singleError)" -Attempts 3600
$summary = Invoke-ProductionExpression -Expression @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  const link = document.querySelector('[data-production-video-download]');
  return JSON.stringify({
    bytes: Number(panel?.dataset.singleBytes || 0),
    frames: Number(panel?.dataset.singleFrames || 0),
    containerVerified: panel?.dataset.singleContainerVerified === 'true',
    fps: Number(panel?.dataset.singleActualFps || 0),
    bitrate: Number(panel?.dataset.singleActualVideoBitrate || 0),
    minimumPsnr: Number(panel?.dataset.singleMinimumPsnr || 0),
    visualSampleCount: Number(panel?.dataset.singleVisualSampleCount || 0),
    visualSampleFrames: panel?.dataset.singleVisualSampleFrames || '',
    renderScale: Number(panel?.dataset.singleRenderScale || 0),
    fileName: link?.getAttribute('download') || '',
    verificationText: document.querySelector('[data-encode-verification]')?.textContent || '',
    exportError: panel?.dataset.singleError || '',
    errors: window.__tptProductionErrors || []
  });
})()
'@ | ConvertFrom-Json
$summary | Add-Member -NotePropertyName nativePreviewHash -NotePropertyValue $nativePreviewHash
$summary | Add-Member -NotePropertyName cinematicPreviewHash -NotePropertyValue $cinematicPreviewHash
$summary | Add-Member -NotePropertyName blenderVfx -NotePropertyValue $blenderVfxSummary
$summary | Add-Member -NotePropertyName cancellation -NotePropertyValue $cancellationSummary
if ($summary.exportError) { throw "Production export failed: $($summary.exportError)" }
if (-not $summary.containerVerified) { throw 'Production MP4 did not pass container verification.' }
if ($summary.frames -lt 1 -or $summary.bytes -lt 100000) { throw "Production MP4 output is incomplete: $($summary | ConvertTo-Json -Compress)" }
if ([Math]::Abs($summary.fps - 30) -gt 0.01) { throw "Production FPS is $($summary.fps), expected 30." }
if ($summary.minimumPsnr -lt 26) { throw "Production PSNR is $($summary.minimumPsnr), expected at least 26." }
if ($summary.visualSampleCount -lt 4 -or -not $summary.visualSampleFrames) { throw "Production visual verification missed semantic match frames: $($summary | ConvertTo-Json -Compress)" }
if ([Math]::Abs($summary.renderScale - 1.5) -gt 0.001) { throw "Production render scale is $($summary.renderScale), expected cinematic 1.5x." }
if ($summary.nativePreviewHash -eq $summary.cinematicPreviewHash) { throw 'Cinematic supersampling did not change the production preview pixels.' }
if (@($summary.errors).Count -gt 0) { throw "Browser errors: $($summary.errors | ConvertTo-Json -Compress)" }
Invoke-ProductionExpression -Expression "document.querySelector('[data-production-video-download]').click(); true" | Out-Null
$downloadPath = Join-Path $artifactRoot $summary.fileName
$deadline = (Get-Date).AddSeconds(30)
do {
  if ((Test-Path -LiteralPath $downloadPath) -and (Get-Item -LiteralPath $downloadPath).Length -eq $summary.bytes) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if (-not (Test-Path -LiteralPath $downloadPath)) { throw "Downloaded production MP4 missing: $downloadPath" }
$manifestFileName = Invoke-ProductionExpression -Expression "document.querySelector('[data-production-manifest-download]')?.getAttribute('download') || ''"
if (-not $manifestFileName) { throw 'Production manifest download link is missing.' }
Invoke-ProductionExpression -Expression "document.querySelector('[data-production-manifest-download]').click(); true" | Out-Null
$manifestPath = Join-Path $artifactRoot $manifestFileName
$manifestDeadline = (Get-Date).AddSeconds(30)
do {
  if (Test-Path -LiteralPath $manifestPath) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $manifestDeadline)
if (-not (Test-Path -LiteralPath $manifestPath)) { throw "Downloaded production manifest missing: $manifestPath" }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.identities.combinationHash -ne $summary.fileName.Split('__')[-1].Replace('.mp4', '')) {
  throw 'Production manifest combination identity differs from the MP4 file name.'
}
if ($BlenderGlbPath) {
  if ($manifest.identities.blenderVfxHash -ne $blenderVfxSummary.sha256 -or $manifest.source.blenderVfx.sha256 -ne $blenderVfxSummary.sha256 -or $manifest.source.blenderVfx.isolated -ne $blenderVfxSummary.isolated) {
    throw "Production manifest did not freeze the Blender VFX identity: $($manifest.source.blenderVfx | ConvertTo-Json -Compress)"
  }
  if (@($manifest.source.blenderVfx.matchEventIds).Count -ne $blenderVfxSummary.eventCount) {
    throw "Production manifest lost Blender match event bindings: $($manifest.source.blenderVfx | ConvertTo-Json -Compress)"
  }
}
$summary | Add-Member -NotePropertyName manifestFileName -NotePropertyValue $manifestFileName
$summary | Add-Member -NotePropertyName manifestBlenderVfxHash -NotePropertyValue ($manifest.source.blenderVfx.sha256 ?? '')
$capture = Invoke-ProductionCdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
$screenshotPath = Join-Path $artifactRoot 'production-mp4-verified.png'
[IO.File]::WriteAllBytes($screenshotPath, [Convert]::FromBase64String([string]$capture.data))
$restoredAfterReload = $null
if ($BlenderGlbPath) {
  Invoke-ProductionCdpCommand -Method 'Page.reload' | Out-Null
  Wait-ProductionExpression -Expression "document.readyState === 'complete' && Boolean(document.querySelector('.tpt-studio'))"
  Wait-ProductionExpression -Expression "Boolean(document.querySelector('[data-mode-id=export]'))"
  Invoke-ProductionExpression -Expression "document.querySelector('[data-mode-id=export]')?.click(); true" | Out-Null
  Wait-ProductionExpression -Expression "Boolean(document.querySelector('.tpt-production-panel'))"
  Wait-ProductionExpression -Expression "document.querySelector('.tpt-production-panel')?.dataset.blenderVfxPersistence === 'stored' && document.querySelector('.tpt-production-panel')?.dataset.blenderVfxLoaded === 'true'" -Attempts 600
  $restoredAfterReload = Invoke-ProductionExpression -Expression @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  return {
    stored: panel?.dataset.blenderVfxPersistence === 'stored',
    loaded: panel?.dataset.blenderVfxLoaded === 'true',
    enabled: panel?.dataset.blenderVfxEnabled === 'true',
    isolated: panel?.dataset.blenderVfxIsolated === 'true',
    sha256: panel?.dataset.blenderVfxSha || '',
    error: panel?.querySelector('[data-blender-vfx-error]')?.textContent || ''
  };
})()
'@
  if (-not $restoredAfterReload.stored -or -not $restoredAfterReload.loaded -or -not $restoredAfterReload.enabled -or $restoredAfterReload.isolated -ne $blenderVfxSummary.isolated -or $restoredAfterReload.sha256 -ne $blenderVfxSummary.sha256 -or $restoredAfterReload.error) {
    throw "Blender VFX did not restore after reload: $($restoredAfterReload | ConvertTo-Json -Compress)"
  }
}
$summary | Add-Member -NotePropertyName blenderVfxRestoredAfterReload -NotePropertyValue $restoredAfterReload

[ordered]@{
  summary = $summary
  mp4Path = $downloadPath
  screenshot = $screenshotPath
} | ConvertTo-Json -Depth 8

Invoke-ProductionCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
$socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$socket.Dispose()
