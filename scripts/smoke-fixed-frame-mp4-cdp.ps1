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

function Invoke-Mp4CdpCommand {
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

function Invoke-Mp4Expression {
  param([Parameter(Mandatory)][string]$Expression)
  $result = Invoke-Mp4CdpCommand -Method 'Runtime.evaluate' -Params @{ expression = $Expression; returnByValue = $true; awaitPromise = $true }
  if ($result.exceptionDetails) { throw ($result.exceptionDetails | ConvertTo-Json -Depth 8 -Compress) }
  return $result.result.value
}

Invoke-Mp4CdpCommand -Method 'Runtime.enable' | Out-Null
$result = Invoke-Mp4Expression -Expression @'
(async () => {
  const { exportFixedFrameVideo } = await import(`/src/exporter/fixedFrameExporter.ts?smoke=${Date.now()}`);
  const phases = [];
  const sampleRate = 48000;
  const numberOfChannels = 2;
  const audio = new Float32Array(Math.ceil(0.6 * sampleRate) * numberOfChannels);
  for (let frame = 0; frame < audio.length / numberOfChannels; frame += 1) {
    const sample = Math.sin(frame / sampleRate * Math.PI * 2 * 440) * 0.08;
    audio[frame * numberOfChannels] = sample;
    audio[frame * numberOfChannels + 1] = sample;
  }
  const result = await exportFixedFrameVideo({
    width: 320,
    height: 240,
    fps: 30,
    totalFrames: 18,
    evaluate: (index) => index,
    render: (index, canvas) => {
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = `hsl(${index * 20} 72% 42%)`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#fff';
      context.font = '700 42px sans-serif';
      context.fillText(String(index), 28, 62);
    },
  }, {
    bitrate: 1_500_000,
    fileName: 'fixed-frame-smoke.mp4',
    keyFrameIntervalSeconds: 0.2,
    onProgress: (progress) => phases.push(progress.phase),
    audio: { data: audio, sampleRate, numberOfChannels, bitrate: 192000 },
  });
  return JSON.stringify({
    bytes: result.blob.size,
    frameCount: result.frameCount,
    durationSeconds: result.durationSeconds,
    verification: result.verification,
    phases: [...new Set(phases)],
  });
})()
'@ | ConvertFrom-Json

if ($result.verification.width -ne 320 -or $result.verification.height -ne 240) { throw "Encoded dimensions failed verification: $($result | ConvertTo-Json -Depth 8 -Compress)" }
if ($result.verification.frameCount -ne 18) { throw 'Encoded frame count failed verification.' }
if ([Math]::Abs($result.verification.averageFrameRate - 30) -gt 0.01) { throw 'Encoded FPS failed verification.' }
if ($result.verification.audioTrackCount -ne 1 -or $result.verification.audioCodec -ne 'aac') { throw 'Encoded AAC track failed verification.' }
if (@($result.phases) -notcontains 'verifying') { throw 'Verification phase was not reported.' }
$result | ConvertTo-Json -Depth 8

$socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'done', [Threading.CancellationToken]::None).GetAwaiter().GetResult() | Out-Null
$socket.Dispose()
