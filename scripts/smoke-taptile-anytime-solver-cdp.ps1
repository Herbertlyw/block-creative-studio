param(
  [string]$Endpoint = 'http://127.0.0.1:9223/json',
  [string]$PageUrl = 'http://127.0.0.1:4173/',
  [string]$ArtifactDirectory = 'artifacts/design-qa/taptile-solver'
)

$ErrorActionPreference = 'Stop'
$targets = (Invoke-WebRequest -Uri $Endpoint -TimeoutSec 5).Content | ConvertFrom-Json
$target = @($targets | Where-Object { $_.type -eq 'page' -and $_.url -eq $PageUrl })[0]
if (-not $target) { throw "No CDP page target found for $PageUrl" }
$socket = [System.Net.WebSockets.ClientWebSocket]::new()
$socket.ConnectAsync([Uri]$target.webSocketDebuggerUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$script:messageId = 0

function Invoke-SolverCdpCommand {
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

function Invoke-SolverExpression {
  param([Parameter(Mandatory)][string]$Expression)
  $result = Invoke-SolverCdpCommand -Method 'Runtime.evaluate' -Params @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress) }
  return $result.result.value
}

function Wait-SolverExpression {
  param([Parameter(Mandatory)][string]$Expression, [int]$Attempts = 600)
  for ($attempt = 0; $attempt -lt $Attempts; $attempt += 1) {
    if (Invoke-SolverExpression -Expression $Expression) { return }
    Start-Sleep -Milliseconds 50
  }
  throw "Timed out waiting for: $Expression"
}

function Set-SolverSelect {
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
  Invoke-SolverExpression -Expression $expression | Out-Null
}

$artifactRoot = [IO.Path]::GetFullPath((Join-Path (Get-Location).Path $ArtifactDirectory))
[IO.Directory]::CreateDirectory($artifactRoot) | Out-Null
Invoke-SolverCdpCommand -Method 'Runtime.enable' | Out-Null
Invoke-SolverCdpCommand -Method 'Page.enable' | Out-Null
Invoke-SolverCdpCommand -Method 'Emulation.setDeviceMetricsOverride' -Params @{ width = 1440; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
Invoke-SolverExpression -Expression "localStorage.removeItem('taptile-director-project/autosave/v2'); true" | Out-Null
Invoke-SolverCdpCommand -Method 'Page.reload' | Out-Null
Wait-SolverExpression -Expression "Boolean(document.querySelector('.tpt-studio'))"
Invoke-SolverExpression -Expression @'
(() => {
  window.__tptSolverErrors = [];
  window.addEventListener('error', (event) => window.__tptSolverErrors.push(String(event.error?.stack || event.message)));
  window.addEventListener('unhandledrejection', (event) => window.__tptSolverErrors.push(String(event.reason?.stack || event.reason)));
  const originalError = console.error.bind(console);
  console.error = (...args) => { window.__tptSolverErrors.push(args.map(String).join(' ')); originalError(...args); };
  return true;
})()
'@ | Out-Null

Invoke-SolverExpression -Expression "document.querySelector('[data-mode-id=play]').click(); true" | Out-Null
Wait-SolverExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=play]'))"
Set-SolverSelect -Selector '[data-agent-profile]' -Value 'max-clear'
Set-SolverSelect -Selector '[data-agent-search-strength]' -Value 'deep'
$cancelRequest = Invoke-SolverExpression -Expression @'
(() => new Promise((resolve, reject) => {
  const button = document.querySelector('[data-action="generate-agent-take"]');
  if (!button) return reject(new Error('Missing Agent button'));
  button.click();
  const startedAt = performance.now();
  const timer = setInterval(() => {
    const play = document.querySelector('.tpt-session-bar[data-mode="play"]');
    const replay = document.querySelector('.tpt-session-bar[data-mode="replay"]');
    if (replay) {
      clearInterval(timer);
      resolve(JSON.stringify({ completedBeforeCancel: true }));
      return;
    }
    const best = Number(play?.dataset.agentBestCleared || 0);
    const expanded = Number(play?.dataset.agentExpandedStates || 0);
    if (play?.dataset.agentBusy === 'true' && best >= 3) {
      document.querySelector('[data-action="cancel-agent-take"]')?.click();
      clearInterval(timer);
      resolve(JSON.stringify({ completedBeforeCancel: false, best, expanded, requestMs: performance.now() - startedAt }));
      return;
    }
    if (performance.now() - startedAt > 15000) {
      clearInterval(timer);
      reject(new Error(`No cancellable best-so-far path after ${expanded} states`));
    }
  }, 4);
}))()
'@ | ConvertFrom-Json
Wait-SolverExpression -Expression "Boolean(document.querySelector('.tpt-session-bar[data-mode=replay][data-valid=true]'))" -Attempts 1200
$summary = Invoke-SolverExpression -Expression @'
(() => {
  const replay = document.querySelector('.tpt-session-bar[data-mode="replay"]');
  return JSON.stringify({
    termination: replay?.dataset.agentTermination || '',
    summary: replay?.querySelector('[data-agent-clear-summary]')?.textContent || '',
    notice: document.querySelector('.tpt-status-notice')?.textContent || '',
    valid: replay?.dataset.valid === 'true',
    errors: window.__tptSolverErrors || []
  });
})()
'@ | ConvertFrom-Json
if (-not $summary.valid) { throw 'Canceled Agent Take did not pass deterministic replay validation.' }
if (-not $cancelRequest.completedBeforeCancel -and $summary.termination -ne 'canceled') { throw "Expected canceled termination, got '$($summary.termination)'" }
if (@($summary.errors).Count -gt 0) { throw "Browser errors: $($summary.errors | ConvertTo-Json -Compress)" }
Invoke-SolverExpression -Expression "document.querySelector('[data-mode-id=edit]').click(); true" | Out-Null
Wait-SolverExpression -Expression "document.querySelector('.tpt-studio')?.classList.contains('mode-edit')"
$capture = Invoke-SolverCdpCommand -Method 'Page.captureScreenshot' -Params @{ format = 'png'; captureBeyondViewport = $false }
$screenshotPath = Join-Path $artifactRoot 'anytime-solver-complete.png'
[IO.File]::WriteAllBytes($screenshotPath, [Convert]::FromBase64String([string]$capture.data))

[ordered]@{
  cancelRequest = $cancelRequest
  replay = $summary
  screenshot = $screenshotPath
} | ConvertTo-Json -Depth 8

Invoke-SolverCdpCommand -Method 'Emulation.clearDeviceMetricsOverride' | Out-Null
$socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$socket.Dispose()
