param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ScreenshotPath = '',
  [string]$InspectorScreenshotPath = '',
  [string]$CleanScreenshotPath = '',
  [int]$ViewportWidth = 0,
  [int]$ViewportHeight = 0
)

$ErrorActionPreference = 'Stop'
$taskTargets = Invoke-RestMethod -Uri $Endpoint -TimeoutSec 5
$taskTarget = $taskTargets | Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl } | Select-Object -First 1
if (-not $taskTarget) {
  throw "No CDP page target found for $PageUrl"
}

$taskSocket = [System.Net.WebSockets.ClientWebSocket]::new()
$taskSocket.ConnectAsync([Uri]$taskTarget.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:taskMessageId = 0

function Invoke-CdpCommand {
  param(
    [Parameter(Mandatory)][string]$Method,
    [hashtable]$Params = @{}
  )
  $script:taskMessageId += 1
  $taskId = $script:taskMessageId
  $taskPayload = @{ id = $taskId; method = $Method; params = $Params } | ConvertTo-Json -Depth 12 -Compress
  $taskBytes = [Text.Encoding]::UTF8.GetBytes($taskPayload)
  $taskSegment = [ArraySegment[byte]]::new($taskBytes)
  $taskSocket.SendAsync($taskSegment, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null

  while ($true) {
    $taskStream = [IO.MemoryStream]::new()
    do {
      $taskBuffer = New-Object byte[] 65536
      $taskReceiveSegment = [ArraySegment[byte]]::new($taskBuffer)
      $taskResult = $taskSocket.ReceiveAsync($taskReceiveSegment, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($taskResult.Count -gt 0) {
        $taskStream.Write($taskBuffer, 0, $taskResult.Count)
      }
    } until ($taskResult.EndOfMessage)
    $taskJson = [Text.Encoding]::UTF8.GetString($taskStream.ToArray()) | ConvertFrom-Json
    $taskStream.Dispose()
    if ($taskJson.id -eq $taskId) {
      if ($taskJson.error) { throw ($taskJson.error | ConvertTo-Json -Compress) }
      return $taskJson.result
    }
  }
}

function Invoke-PageExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $taskResult = Invoke-CdpCommand -Method 'Runtime.evaluate' -Params @{
    expression = $Expression
    returnByValue = $true
    awaitPromise = $true
  }
  return $taskResult.result.value
}

Invoke-CdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-CdpCommand -Method 'Page.enable' | Out-Null
if ($ViewportWidth -gt 0 -and $ViewportHeight -gt 0) {
  Invoke-CdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{
    width = $ViewportWidth
    height = $ViewportHeight
    deviceScaleFactor = 1
    mobile = $false
  } | Out-Null
  Start-Sleep -Milliseconds 120
}

$taskInitial = Invoke-PageExpression -Expression @'
JSON.stringify({
  studio: document.querySelectorAll('.tpt-studio').length,
  tiles: document.querySelectorAll('.stack-tile').length,
  templates: document.querySelectorAll('.tpt-template-grid button').length,
  faces: document.querySelectorAll('.tpt-face-grid button').length,
  errors: window.__tptSmokeErrors ?? []
})
'@ | ConvertFrom-Json
if ($taskInitial.studio -ne 1 -or $taskInitial.templates -ne 4 -or $taskInitial.faces -lt 12) {
  throw "Unexpected initial editor DOM: $($taskInitial | ConvertTo-Json -Compress)"
}

Invoke-PageExpression -Expression @'
(() => {
  const select = document.querySelectorAll('.tpt-inspector-panel select')[1];
  select.value = 'porcelain';
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()
'@ | Out-Null
Start-Sleep -Milliseconds 80

Invoke-PageExpression -Expression "document.querySelectorAll('.tpt-template-grid button')[3].click()" | Out-Null
Start-Sleep -Milliseconds 120
$taskMarqueeDrag = Invoke-PageExpression -Expression @'
(() => {
  const stage = document.querySelector('.tpt-phone-stage');
  const rect = stage.getBoundingClientRect();
  const point = (x, y) => ({
    x: rect.left + (x / 430) * rect.width,
    y: rect.top + (y / 764) * rect.height,
  });
  return JSON.stringify({ start: point(80, 180), end: point(320, 330) });
})()
'@ | ConvertFrom-Json
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mousePressed'; x = $taskMarqueeDrag.start.x; y = $taskMarqueeDrag.start.y; button = 'left'; buttons = 1; clickCount = 1 } | Out-Null
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mouseMoved'; x = $taskMarqueeDrag.end.x; y = $taskMarqueeDrag.end.y; button = 'left'; buttons = 1 } | Out-Null
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mouseReleased'; x = $taskMarqueeDrag.end.x; y = $taskMarqueeDrag.end.y; button = 'left'; buttons = 0; clickCount = 1 } | Out-Null
Start-Sleep -Milliseconds 100
$taskMarqueeSelected = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile.is-selected').length")
if ($taskMarqueeSelected -ne 5) { throw "Expected five marquee-selected tiles; got $taskMarqueeSelected" }

$taskGroupBefore = Invoke-PageExpression -Expression @'
(() => {
  const tiles = [...document.querySelectorAll('.stack-tile.is-selected')];
  const leader = tiles.sort((a, b) => Number(getComputedStyle(b).zIndex) - Number(getComputedStyle(a).zIndex))[0];
  const rect = leader.getBoundingClientRect();
  return JSON.stringify({
    leaderX: rect.left + rect.width / 2,
    leaderY: rect.top + rect.height / 2,
    positions: [...document.querySelectorAll('.stack-tile.is-selected')].map((tile) => ({ id: tile.dataset.tileId, left: parseFloat(tile.style.left), top: parseFloat(tile.style.top) })),
  });
})()
'@ | ConvertFrom-Json
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mousePressed'; x = $taskGroupBefore.leaderX; y = $taskGroupBefore.leaderY; button = 'left'; buttons = 1; clickCount = 1 } | Out-Null
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mouseMoved'; x = $taskGroupBefore.leaderX + 31; y = $taskGroupBefore.leaderY + 19; button = 'left'; buttons = 1 } | Out-Null
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mouseReleased'; x = $taskGroupBefore.leaderX + 31; y = $taskGroupBefore.leaderY + 19; button = 'left'; buttons = 0; clickCount = 1 } | Out-Null
Start-Sleep -Milliseconds 100
$taskGroupAfter = Invoke-PageExpression -Expression "JSON.stringify([...document.querySelectorAll('.stack-tile.is-selected')].map((tile) => ({ id: tile.dataset.tileId, left: parseFloat(tile.style.left), top: parseFloat(tile.style.top) })))" | ConvertFrom-Json
$taskGroupDeltas = @()
foreach ($taskBeforePosition in $taskGroupBefore.positions) {
  $taskAfterPosition = $taskGroupAfter | Where-Object { $_.id -eq $taskBeforePosition.id } | Select-Object -First 1
  $taskGroupDeltas += [pscustomobject]@{
    x = [double]$taskAfterPosition.left - [double]$taskBeforePosition.left
    y = [double]$taskAfterPosition.top - [double]$taskBeforePosition.top
  }
}
$taskGroupXSpread = (($taskGroupDeltas | Measure-Object -Property x -Maximum).Maximum - ($taskGroupDeltas | Measure-Object -Property x -Minimum).Minimum)
$taskGroupYSpread = (($taskGroupDeltas | Measure-Object -Property y -Maximum).Maximum - ($taskGroupDeltas | Measure-Object -Property y -Minimum).Minimum)
if ($taskGroupXSpread -gt 0.01 -or $taskGroupYSpread -gt 0.01) {
  throw "Marquee-selected tiles did not move as one group: x spread $taskGroupXSpread, y spread $taskGroupYSpread"
}

$taskCountBeforeBatchDelete = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile').length")
Invoke-PageExpression -Expression "[...document.querySelectorAll('.tpt-stage-toolbar button')].find((button) => button.textContent.includes('删除')).click()" | Out-Null
Start-Sleep -Milliseconds 100
$taskCountAfterBatchDelete = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile').length")
if ($taskCountBeforeBatchDelete - $taskCountAfterBatchDelete -ne $taskMarqueeSelected) {
  throw "Batch delete removed the wrong number of tiles: $taskCountBeforeBatchDelete -> $taskCountAfterBatchDelete"
}

Invoke-PageExpression -Expression "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true }))" | Out-Null
Start-Sleep -Milliseconds 60
$taskSelectAllCount = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile.is-selected').length")
if ($taskSelectAllCount -ne $taskCountAfterBatchDelete) { throw "Ctrl+A selected $taskSelectAllCount of $taskCountAfterBatchDelete tiles" }
Invoke-PageExpression -Expression "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))" | Out-Null
Start-Sleep -Milliseconds 60
$taskAfterEscape = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile.is-selected').length")
if ($taskAfterEscape -ne 0) { throw "Escape did not clear the selection" }

Invoke-PageExpression -Expression "document.querySelectorAll('.tpt-template-grid button')[3].click()" | Out-Null
Start-Sleep -Milliseconds 120
$taskSnapPair = Invoke-PageExpression -Expression @'
(() => {
  const tiles = [...document.querySelectorAll('.stack-tile')]
    .sort((a, b) => Number(getComputedStyle(b).zIndex) - Number(getComputedStyle(a).zIndex));
  const moving = tiles[0];
  if (!moving) return null;
  const movingRect = moving.getBoundingClientRect();
  const movingX = movingRect.left + movingRect.width / 2;
  const candidates = tiles.slice(1).map((tile) => ({ tile, rect: tile.getBoundingClientRect() }));
  let pair = null;
  for (let leftIndex = 0; leftIndex < candidates.length && !pair; leftIndex += 1) {
    const left = candidates[leftIndex];
    if (!left) continue;
    const leftX = left.rect.left + left.rect.width / 2;
    const leftY = left.rect.top + left.rect.height / 2;
    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];
      if (!right) continue;
      const rightX = right.rect.left + right.rect.width / 2;
      const rightY = right.rect.top + right.rect.height / 2;
      const seamX = (leftX + rightX) / 2;
      if (Math.abs(leftY - rightY) < 4
        && Math.abs(leftX - rightX) > 32
        && Math.abs(leftX - rightX) < 90
        && Math.abs(seamX - movingX) > 25) {
        pair = { left, right, seamX };
        break;
      }
    }
  }
  if (!pair) return null;
  return JSON.stringify({
    movingId: moving.dataset.tileId,
    startX: movingX,
    startY: movingRect.top + movingRect.height / 2,
    targetX: pair.seamX,
    targetIds: [pair.left.tile.dataset.tileId, pair.right.tile.dataset.tileId],
  });
})()
'@ | ConvertFrom-Json
if (-not $taskSnapPair) { throw 'Could not identify a browser pair for smart-snap smoke testing.' }

Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mousePressed'; x = $taskSnapPair.startX; y = $taskSnapPair.startY; button = 'left'; buttons = 1; clickCount = 1 } | Out-Null
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mouseMoved'; x = $taskSnapPair.targetX + 4; y = $taskSnapPair.startY + 29; button = 'left'; buttons = 1 } | Out-Null
Start-Sleep -Milliseconds 80
$taskSnapFeedback = Invoke-PageExpression -Expression @'
JSON.stringify({
  guides: document.querySelectorAll('.tpt-snap-guide').length,
  seams: document.querySelectorAll('.tpt-snap-guide[data-snap-kind="seam"]').length,
  targets: document.querySelectorAll('.stack-tile.is-snap-target').length,
  label: document.querySelector('.tpt-snap-readout span')?.textContent ?? ''
})
'@ | ConvertFrom-Json
if ($ScreenshotPath) {
  $taskCapture = Invoke-CdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
  [IO.File]::WriteAllBytes($ScreenshotPath, [Convert]::FromBase64String([string]$taskCapture.data))
}
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mouseReleased'; x = $taskSnapPair.targetX + 4; y = $taskSnapPair.startY + 29; button = 'left'; buttons = 0; clickCount = 1 } | Out-Null
if ($taskSnapFeedback.seams -lt 1 -or $taskSnapFeedback.targets -lt 2) {
  throw "Smart-snap feedback did not activate: $($taskSnapFeedback | ConvertTo-Json -Compress)"
}
Start-Sleep -Milliseconds 120

$taskTopTile = Invoke-PageExpression -Expression @'
(() => {
  const tiles = [...document.querySelectorAll('.stack-tile')];
  const tile = tiles.sort((a, b) => Number(getComputedStyle(b).zIndex) - Number(getComputedStyle(a).zIndex))[0];
  const rect = tile.getBoundingClientRect();
  return JSON.stringify({ id: tile.dataset.tileId, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, left: tile.style.left, top: tile.style.top });
})()
'@ | ConvertFrom-Json

Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mousePressed'; x = $taskTopTile.x; y = $taskTopTile.y; button = 'left'; buttons = 1; clickCount = 1 } | Out-Null
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mouseMoved'; x = $taskTopTile.x + 54; y = $taskTopTile.y + 28; button = 'left'; buttons = 1 } | Out-Null
Invoke-CdpCommand -Method 'Input.dispatchMouseEvent' -Params @{ type = 'mouseReleased'; x = $taskTopTile.x + 54; y = $taskTopTile.y + 28; button = 'left'; buttons = 0; clickCount = 1 } | Out-Null
Start-Sleep -Milliseconds 180

$taskMovedExpression = (@'
(() => {
  const tile = document.querySelector('[data-tile-id="__TILE_ID__"]');
  return JSON.stringify({ left: tile.style.left, top: tile.style.top, selected: tile.classList.contains('is-selected') });
})()
'@).Replace('__TILE_ID__', [string]$taskTopTile.id)
$taskMoved = Invoke-PageExpression -Expression $taskMovedExpression | ConvertFrom-Json
if (-not $taskMoved.selected -or ($taskMoved.left -eq $taskTopTile.left -and $taskMoved.top -eq $taskTopTile.top)) {
  throw "Pointer drag did not update the selected tile."
}

Invoke-PageExpression -Expression @'
(() => {
  const input = document.querySelectorAll('.tpt-number-grid input')[2];
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, '48');
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()
'@ | Out-Null
Start-Sleep -Milliseconds 100
$taskDeepLayer = Invoke-PageExpression -Expression @'
(() => {
  const selected = document.querySelector('.stack-tile.is-selected');
  const others = [...document.querySelectorAll('.stack-tile:not(.is-selected)')];
  return JSON.stringify({
    value: Number(document.querySelectorAll('.tpt-number-grid input')[2].value),
    selectedZ: Number(getComputedStyle(selected).zIndex),
    otherMaxZ: Math.max(...others.map((tile) => Number(getComputedStyle(tile).zIndex))),
  });
})()
'@ | ConvertFrom-Json
if ($taskDeepLayer.value -ne 48 -or $taskDeepLayer.selectedZ -le $taskDeepLayer.otherMaxZ) {
  throw "High layer did not remain visually above lower layers: $($taskDeepLayer | ConvertTo-Json -Compress)"
}
Invoke-PageExpression -Expression "document.querySelector('.tpt-layer-stepper button').click()" | Out-Null
Start-Sleep -Milliseconds 80
$taskLayerAfterMinus = [int](Invoke-PageExpression -Expression "Number(document.querySelectorAll('.tpt-number-grid input')[2].value)")
if ($taskLayerAfterMinus -ne 47) { throw "Layer decrement did not produce 47; got $taskLayerAfterMinus" }

Invoke-PageExpression -Expression @'
(() => {
  const tile = document.querySelector('.stack-tile:not(.is-selected)');
  tile.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 91, shiftKey: true }));
})()
'@ | Out-Null
Start-Sleep -Milliseconds 60
Invoke-PageExpression -Expression @'
(() => {
  const tile = document.querySelector('.stack-tile:not(.is-selected)');
  tile.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 92, shiftKey: true }));
})()
'@ | Out-Null
Start-Sleep -Milliseconds 80
$taskSelectedForAlignment = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile.is-selected').length")
if ($taskSelectedForAlignment -ne 3) { throw "Expected three selected tiles for alignment; got $taskSelectedForAlignment" }
Invoke-PageExpression -Expression "document.querySelector('.tpt-align-grid button').click()" | Out-Null
Start-Sleep -Milliseconds 100
$taskAlignmentSpread = [double](Invoke-PageExpression -Expression @'
(() => {
  const lefts = [...document.querySelectorAll('.stack-tile.is-selected')].map((tile) => tile.getBoundingClientRect().left);
  return Math.max(...lefts) - Math.min(...lefts);
})()
'@)
if ($taskAlignmentSpread -gt 1) { throw "Left-edge alignment spread is too large: $taskAlignmentSpread" }
if ($InspectorScreenshotPath) {
  $taskInspectorCapture = Invoke-CdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
  [IO.File]::WriteAllBytes($InspectorScreenshotPath, [Convert]::FromBase64String([string]$taskInspectorCapture.data))
}

$taskCountBeforeFace = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile').length")
Invoke-PageExpression -Expression "document.querySelector('.tpt-phone-stage').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 77 }))" | Out-Null
Invoke-PageExpression -Expression "document.querySelector('.tpt-face-grid button').click()" | Out-Null
Start-Sleep -Milliseconds 120
$taskCountAfterFace = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile').length")
if ($taskCountAfterFace -ne $taskCountBeforeFace + 1) {
  throw "Face-library add action did not create a tile."
}

Invoke-PageExpression -Expression "document.querySelectorAll('.tpt-template-grid button')[1].click()" | Out-Null
Start-Sleep -Milliseconds 120
$taskTCount = [int](Invoke-PageExpression -Expression "document.querySelectorAll('.stack-tile').length")
if ($taskTCount -eq $taskCountAfterFace) {
  throw "Template selection did not replace the stack."
}

Invoke-PageExpression -Expression @'
(() => {
  const select = document.querySelectorAll('.tpt-inspector-panel select')[1];
  select.value = 'jelly';
  select.dispatchEvent(new Event('change', { bubbles: true }));
})()
'@ | Out-Null
Start-Sleep -Milliseconds 120
$taskJelly = Invoke-PageExpression -Expression "document.querySelector('.tpt-studio').classList.contains('material-jelly')"
if (-not $taskJelly) { throw 'Material selector did not update the scene.' }

if ($CleanScreenshotPath) {
  Invoke-PageExpression -Expression @'
(() => {
  const select = document.querySelectorAll('.tpt-inspector-panel select')[1];
  select.value = 'porcelain';
  select.dispatchEvent(new Event('change', { bubbles: true }));
  document.querySelectorAll('.tpt-template-grid button')[0].click();
  [...document.querySelectorAll('.tpt-stage-toolbar button')].find((button) => button.textContent.includes('取消选择'))?.click();
})()
'@ | Out-Null
  Start-Sleep -Milliseconds 240
  $taskCleanCapture = Invoke-CdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
  [IO.File]::WriteAllBytes($CleanScreenshotPath, [Convert]::FromBase64String([string]$taskCleanCapture.data))
}

$taskConsoleErrors = Invoke-PageExpression -Expression "JSON.stringify(window.__tptSmokeErrors ?? [])" | ConvertFrom-Json
$taskSummary = [ordered]@{
  initialTiles = $taskInitial.tiles
  marquee = "$taskMarqueeSelected tiles"
  batchMove = "delta spread $([Math]::Round($taskGroupXSpread, 4))% / $([Math]::Round($taskGroupYSpread, 4))%"
  batchDelete = "$taskCountBeforeBatchDelete -> $taskCountAfterBatchDelete"
  selectAll = "$taskSelectAllCount selected -> $taskAfterEscape after Escape"
  smartSnap = "$($taskSnapFeedback.guides) guide(s), $($taskSnapFeedback.targets) target(s), $($taskSnapFeedback.label)"
  deepLayer = "48 -> $taskLayerAfterMinus; z $($taskDeepLayer.selectedZ) > $($taskDeepLayer.otherMaxZ)"
  multiAlign = "$taskSelectedForAlignment tiles; spread $([Math]::Round($taskAlignmentSpread, 3))px"
  movedTile = $taskTopTile.id
  faceAdd = "$taskCountBeforeFace -> $taskCountAfterFace"
  tTemplateTiles = $taskTCount
  material = 'jelly'
  consoleErrors = @($taskConsoleErrors).Count
}
$taskSummary | ConvertTo-Json -Depth 4

if ($ViewportWidth -gt 0 -and $ViewportHeight -gt 0) {
  Invoke-CdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
}
$taskSocket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$taskSocket.Dispose()
