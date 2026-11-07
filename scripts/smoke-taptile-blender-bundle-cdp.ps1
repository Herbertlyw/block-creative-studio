param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ArtifactDirectory = 'artifacts/design-qa/taptile-blender',
  [string]$GlbPath = 'artifacts/blender/browser-bundle-e2e-r1/scene.glb'
)

$ErrorActionPreference = 'Stop'
$targets = (Invoke-WebRequest -Uri $Endpoint -TimeoutSec 5).Content | ConvertFrom-Json
$target = @($targets | Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl })[0]
if (-not $target) { throw "No CDP page target found for $PageUrl" }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:messageId = 0

function Invoke-BlenderCdpCommand {
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

function Invoke-BlenderExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $result = Invoke-BlenderCdpCommand -Method 'Runtime.evaluate' -Params @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress) }
  return $result.result.value
}

function Wait-BlenderExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 1200)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    if (Invoke-BlenderExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 100
  }
  throw "Timed out waiting for: $Expression"
}

function Set-BlenderSelect {
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
  Invoke-BlenderExpression -Expression $expression | Out-Null
}

function Save-BlenderScreenshot {
  param([Parameter(Mandatory)][string]$Path)
  $capture = Invoke-BlenderCdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
  [IO.File]::WriteAllBytes($Path, [Convert]::FromBase64String([string]$capture.data))
}

$artifactRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ArtifactDirectory))
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
Invoke-BlenderCdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-BlenderCdpCommand -Method 'Page.enable' | Out-Null
Invoke-BlenderCdpCommand -Method 'Browser.setDownloadBehavior' -Params @{ behavior = 'allow'; downloadPath = $artifactRoot; eventsEnabled = $true } | Out-Null
Invoke-BlenderCdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{ width = 1440; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
Invoke-BlenderExpression -Expression "localStorage.removeItem('taptile-director-project/autosave/v2'); true" | Out-Null
Invoke-BlenderExpression -Expression "Object.keys(localStorage).filter((key) => key.startsWith('taptile-blender-vfx/v1/')).forEach((key) => localStorage.removeItem(key)); true" | Out-Null
Invoke-BlenderCdpCommand -Method 'Page.reload' | Out-Null
Wait-BlenderExpression -Expression "Boolean(document.querySelector('.tpt-studio'))"
Invoke-BlenderExpression -Expression @'
(() => {
  window.__tptBlenderErrors = [];
  window.addEventListener('error', (event) => window.__tptBlenderErrors.push(String(event.error?.stack || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__tptBlenderErrors.push(String(event.reason?.stack || event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => { window.__tptBlenderErrors.push(args.map(String).join(' ')); originalError(...args); };
  return true;
})()
'@ | Out-Null

Wait-BlenderExpression -Expression "Boolean(document.querySelector('[data-face-group-select]'))"
Set-BlenderSelect -Selector '[data-face-group-select]' -Value 'chain-combo-ui-v1'
Wait-BlenderExpression -Expression "document.querySelector('.tpt-studio')?.dataset.selectedTheme === 'chain-combo-ui-v1'"
Invoke-BlenderExpression -Expression "document.querySelector('[data-mode-id=play]').click(); true" | Out-Null
Wait-BlenderExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=play]'))"
Set-BlenderSelect -Selector '[data-agent-profile]' -Value 'max-clear'
Invoke-BlenderExpression -Expression "document.querySelector('[data-action=generate-agent-take]').click(); true" | Out-Null
Wait-BlenderExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=replay][data-valid=true]'))" -Attempts 2400
Invoke-BlenderExpression -Expression "document.querySelector('[data-mode-id=export]').click(); true" | Out-Null
Wait-BlenderExpression -Expression "Boolean(document.querySelector('.tpt-production-panel[data-production-valid=true]'))"
Set-BlenderSelect -Selector '[data-production-skin]' -Value 'chain-combo-ui-v1'
Wait-BlenderExpression -Expression "document.querySelector('[data-production-skin]')?.value === 'chain-combo-ui-v1' && document.querySelector('.tpt-production-preview')?.dataset.previewHash !== 'pending'"
Save-BlenderScreenshot -Path (Join-Path $artifactRoot 'blender-bundle-before-export.png')
Invoke-BlenderExpression -Expression "document.querySelector('[data-action=export-blender-exchange]').click(); true" | Out-Null
Wait-BlenderExpression -Expression "document.querySelector('.tpt-production-panel')?.dataset.blenderExporting === 'false' && Number(document.querySelector('.tpt-production-panel')?.dataset.blenderExchangeBytes) > 0" -Attempts 1200
$summary = Invoke-BlenderExpression -Expression @'
(() => {
  const panel = document.querySelector('.tpt-production-panel');
  return JSON.stringify({
    fileName: document.querySelector('[data-blender-exchange-file]')?.textContent.split(' · ')[0],
    bytes: Number(panel.dataset.blenderExchangeBytes),
    entities: Number(panel.dataset.blenderExchangeEntities),
    tracks: Number(panel.dataset.blenderExchangeTracks),
    events: Number(panel.dataset.blenderExchangeEvents),
    frames: Number(panel.dataset.blenderExchangeFrames),
    assets: Number(panel.dataset.blenderExchangeAssets),
    checksums: Number(panel.dataset.blenderExchangeChecksums),
    error: document.querySelector('[data-blender-exchange-error]')?.textContent || ''
  });
})()
'@ | ConvertFrom-Json
if ($summary.error) { throw "Blender bundle UI reported: $($summary.error)" }
if ($summary.assets -lt 1 -or $summary.checksums -lt ($summary.assets + 2) -or $summary.events -lt 1) {
  throw "Blender bundle summary is incomplete: $($summary | ConvertTo-Json -Compress)"
}
$downloadPath = Join-Path $artifactRoot $summary.fileName
$deadline = (Get-Date).AddSeconds(30)
do {
  if ((Test-Path -LiteralPath $downloadPath) -and (Get-Item -LiteralPath $downloadPath).Length -eq $summary.bytes) { break }
  Start-Sleep -Milliseconds 200
} while ((Get-Date) -lt $deadline)
if (-not (Test-Path -LiteralPath $downloadPath)) { throw "Blender bundle download missing: $downloadPath" }
Save-BlenderScreenshot -Path (Join-Path $artifactRoot 'blender-bundle-complete.png')

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($downloadPath)
try {
  $entryNames = @($archive.Entries | ForEach-Object { $_.FullName })
  foreach ($required in @('scene-exchange.json', 'checksums.json', 'manifests/blender-bundle.json', 'README.txt')) {
    if ($entryNames -notcontains $required) { throw "Bundle entry missing: $required" }
  }
  $assetEntries = @($entryNames | Where-Object { $_ -like 'assets/*' })
  if ($assetEntries.Count -ne $summary.assets) { throw "Expected $($summary.assets) embedded assets, found $($assetEntries.Count)" }
  $checksumsEntry = $archive.GetEntry('checksums.json')
  $reader = [IO.StreamReader]::new($checksumsEntry.Open())
  try { $checksums = $reader.ReadToEnd() | ConvertFrom-Json -AsHashtable }
  finally { $reader.Dispose() }
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    foreach ($path in $checksums.Keys) {
      $entry = $archive.GetEntry($path)
      if (-not $entry) { throw "Checksum target missing: $path" }
      $stream = $entry.Open()
      try { $actual = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
      finally { $stream.Dispose() }
      if ($actual -ne [string]$checksums[$path]) { throw "Checksum mismatch: $path" }
    }
  } finally { $sha.Dispose() }
} finally { $archive.Dispose() }

$absoluteGlbPath = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $GlbPath))
if (-not (Test-Path -LiteralPath $absoluteGlbPath)) { throw "Compiled GLB missing: $absoluteGlbPath" }
$inputObject = Invoke-BlenderCdpCommand -Method 'Runtime.evaluate' -Params @{ expression = "document.querySelector('[data-blender-glb-input]')"; returnByValue = $false }
if (-not $inputObject.result.objectId) { throw 'Blender GLB input was not rendered.' }
Invoke-BlenderCdpCommand -Method 'DOM.setFileInputFiles' -Params @{ files = @($absoluteGlbPath); objectId = $inputObject.result.objectId } | Out-Null
Invoke-BlenderExpression -Expression "document.querySelector('[data-blender-glb-input]').dispatchEvent(new Event('change', { bubbles: true })); true" | Out-Null
Wait-BlenderExpression -Expression "document.querySelector('.tpt-blender-preview-card')?.dataset.blenderPreviewLoaded === 'true'" -Attempts 1200
$preview = Invoke-BlenderExpression -Expression @'
(() => {
  const card = document.querySelector('.tpt-blender-preview-card');
  const canvas = document.querySelector('[data-blender-preview-canvas]');
  return JSON.stringify({
    frames: Number(card.dataset.blenderPreviewFrames),
    frameStart: Number(card.dataset.blenderPreviewFrameStart),
    fps: Number(card.dataset.blenderPreviewFps),
    timingSource: card.dataset.blenderPreviewTimingSource || '',
    nodes: Number(card.dataset.blenderPreviewNodes),
    triangles: Number(card.dataset.blenderPreviewTriangles),
    textures: Number(card.dataset.blenderPreviewTextures),
    animations: Number(card.dataset.blenderPreviewAnimations),
    vfxObjects: Number(card.dataset.blenderPreviewVfxObjects),
    vfxFragments: Number(card.dataset.blenderPreviewVfxFragments),
    vfxStyles: card.dataset.blenderPreviewVfxStyles || '',
    isolateVfx: card.dataset.blenderPreviewIsolateVfx === 'true',
    visibleMeshes: Number(card.dataset.blenderPreviewVisibleMeshes),
    visibleVfxMeshes: Number(card.dataset.blenderPreviewVisibleVfxMeshes),
    pixels: canvas.toDataURL('image/png').length,
    error: document.querySelector('[data-blender-preview-error]')?.textContent || ''
  });
})()
'@ | ConvertFrom-Json
if ($preview.error) { throw "Blender preview reported: $($preview.error)" }
if ($preview.frames -ne $summary.frames -or $preview.frameStart -ne 1 -or $preview.fps -ne 30 -or $preview.timingSource -ne 'contract' -or $preview.nodes -lt 1 -or $preview.triangles -lt 1 -or $preview.textures -lt 1 -or $preview.animations -lt 1 -or $preview.vfxObjects -lt 1 -or $preview.vfxFragments -lt $preview.vfxObjects -or $preview.visibleMeshes -le $preview.visibleVfxMeshes -or $preview.pixels -lt 50000) {
  throw "Blender preview metrics are incomplete: $($preview | ConvertTo-Json -Compress)"
}
Invoke-BlenderExpression -Expression @'
(() => {
  const seek = document.querySelector('[data-blender-preview-seek]');
  const target = Math.min(Number(seek.max), 134);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(seek, String(target));
  seek.dispatchEvent(new Event('input', { bubbles: true }));
  seek.dispatchEvent(new Event('change', { bubbles: true }));
  return target;
})()
'@ | Out-Null
Wait-BlenderExpression -Expression "Number(document.querySelector('.tpt-blender-preview-card')?.dataset.blenderPreviewFrame) === 134"
Invoke-BlenderExpression -Expression "document.querySelector('.tpt-blender-preview-card').scrollIntoView({ block: 'center' }); true" | Out-Null
Start-Sleep -Milliseconds 250
Save-BlenderScreenshot -Path (Join-Path $artifactRoot 'blender-glb-frame-0135.png')
$canvasData = Invoke-BlenderExpression -Expression "document.querySelector('[data-blender-preview-canvas]').toDataURL('image/png')"
[IO.File]::WriteAllBytes((Join-Path $artifactRoot 'blender-glb-canvas-frame-0135.png'), [Convert]::FromBase64String(([string]$canvasData).Substring(([string]$canvasData).IndexOf(',') + 1)))
Invoke-BlenderExpression -Expression "document.querySelector('[data-action=toggle-blender-vfx-isolation]').click(); true" | Out-Null
Wait-BlenderExpression -Expression "document.querySelector('.tpt-blender-preview-card')?.dataset.blenderPreviewIsolateVfx === 'true'"
Start-Sleep -Milliseconds 250
$isolatedPreview = Invoke-BlenderExpression -Expression @'
(() => {
  const card = document.querySelector('.tpt-blender-preview-card');
  const canvas = document.querySelector('[data-blender-preview-canvas]');
  return JSON.stringify({
    isolateVfx: card.dataset.blenderPreviewIsolateVfx === 'true',
    visibleMeshes: Number(card.dataset.blenderPreviewVisibleMeshes),
    visibleVfxMeshes: Number(card.dataset.blenderPreviewVisibleVfxMeshes),
    pixels: canvas.toDataURL('image/png').length
  });
})()
'@ | ConvertFrom-Json
if (-not $isolatedPreview.isolateVfx -or $isolatedPreview.visibleMeshes -lt 1 -or $isolatedPreview.visibleMeshes -ne $isolatedPreview.visibleVfxMeshes -or $isolatedPreview.visibleMeshes -ge $preview.visibleMeshes) {
  throw "Blender VFX isolation is incomplete: $($isolatedPreview | ConvertTo-Json -Compress)"
}
Save-BlenderScreenshot -Path (Join-Path $artifactRoot 'blender-glb-vfx-isolated-frame-0135.png')
$isolatedCanvasData = Invoke-BlenderExpression -Expression "document.querySelector('[data-blender-preview-canvas]').toDataURL('image/png')"
[IO.File]::WriteAllBytes((Join-Path $artifactRoot 'blender-glb-vfx-isolated-canvas-frame-0135.png'), [Convert]::FromBase64String(([string]$isolatedCanvasData).Substring(([string]$isolatedCanvasData).IndexOf(',') + 1)))
Invoke-BlenderExpression -Expression "document.querySelector('[data-action=toggle-blender-vfx-isolation]').click(); true" | Out-Null
Wait-BlenderExpression -Expression "document.querySelector('.tpt-blender-preview-card')?.dataset.blenderPreviewIsolateVfx === 'false'"
Invoke-BlenderExpression -Expression "document.querySelector('[data-action=toggle-blender-preview]').click(); true" | Out-Null
Wait-BlenderExpression -Expression "Number(document.querySelector('.tpt-blender-preview-card')?.dataset.blenderPreviewFrame) > 134"
Invoke-BlenderExpression -Expression "document.querySelector('[data-action=toggle-blender-preview]').click(); true" | Out-Null

$errors = Invoke-BlenderExpression -Expression "JSON.stringify(window.__tptBlenderErrors || [])" | ConvertFrom-Json
if (@($errors).Count -gt 0) { throw "Browser errors: $($errors | ConvertTo-Json -Compress)" }

[ordered]@{
  summary = $summary
  zipPath = $downloadPath
  zipEntryCount = $entryNames.Count
  embeddedAssetCount = $assetEntries.Count
  checksumsVerified = $checksums.Count
  glbPreview = $preview
  isolatedVfxPreview = $isolatedPreview
  consoleErrors = @($errors).Count
  screenshots = @(
    (Join-Path $artifactRoot 'blender-bundle-before-export.png'),
    (Join-Path $artifactRoot 'blender-bundle-complete.png'),
    (Join-Path $artifactRoot 'blender-glb-frame-0135.png'),
    (Join-Path $artifactRoot 'blender-glb-canvas-frame-0135.png'),
    (Join-Path $artifactRoot 'blender-glb-vfx-isolated-frame-0135.png'),
    (Join-Path $artifactRoot 'blender-glb-vfx-isolated-canvas-frame-0135.png')
  )
} | ConvertTo-Json -Depth 8

Invoke-BlenderCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
$socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$socket.Dispose()
