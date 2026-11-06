export interface ReferenceMeasurement {
  version: '1.0.0';
  source: {
    sha256: string;
    width: number;
    height: number;
    fps: string;
    frameCount: number;
    firstTimestamp: number;
    timeBase: string;
  };
  timing: { mode: 'constant'; timestampTicks: number[] };
}

function ratio(raw: unknown): number {
  if (typeof raw !== 'string' || !/^\d+(?:\/\d+)?$/.test(raw))
    throw new Error('帧率或时间基准格式无效。');
  const [n, d = 1] = raw.split('/').map(Number);
  const v = n! / d;
  if (!Number.isFinite(v) || v <= 0) throw new Error('帧率或时间基准无效。');
  return v;
}

/** Never infer frames from the browser playback clock. */
export function validateReferenceMeasurement(
  raw: unknown,
  hash: string,
  width: number,
  height: number,
): ReferenceMeasurement {
  const data = raw as ReferenceMeasurement,
    src = data?.source,
    ts = data?.timing?.timestampTicks;
  if (data?.version !== '1.0.0' || !src || src.sha256 !== hash)
    throw new Error('测量文件与当前视频的 SHA-256 不匹配或版本无效。');
  if (src.width !== width || src.height !== height) throw new Error('测量尺寸与当前视频不匹配。');
  if (
    data.timing?.mode !== 'constant' ||
    !Array.isArray(ts) ||
    !Number.isSafeInteger(src.frameCount) ||
    src.frameCount < 2 ||
    src.frameCount !== ts.length ||
    !Number.isSafeInteger(src.firstTimestamp) ||
    ts[0] !== src.firstTimestamp
  )
    throw new Error('仅接受完整的恒帧率时间戳。');
  const fps = ratio(src.fps),
    base = ratio(src.timeBase);
  for (let i = 0; i < ts.length; i++) {
    if (
      !Number.isSafeInteger(ts[i]) ||
      (i > 0 && ts[i]! <= ts[i - 1]!) ||
      Math.abs((ts[i]! - src.firstTimestamp) * base - i / fps) > base / 2 + 1e-9
    )
      throw new Error(`第 ${i} 帧时间戳无效或属于变帧率。`);
  }
  return structuredClone(data);
}

export function measuredFrameSeconds(data: ReferenceMeasurement, frame: number): number {
  if (!Number.isInteger(frame) || frame < 0 || frame >= data.source.frameCount)
    throw new Error(`帧 ${frame} 超出测量范围。`);
  return (
    (data.timing.timestampTicks[frame]! - data.source.firstTimestamp) * ratio(data.source.timeBase)
  );
}
