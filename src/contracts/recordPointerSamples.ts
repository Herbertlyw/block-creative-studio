export interface TimedPointerSample {
  timeMs: number;
  x: number;
  y: number;
}

/** Quantize recorded elapsed time once, retaining the first and last position. */
export function quantizeRecordedPointer(
  samples: readonly TimedPointerSample[],
  fps: number,
): { durationFrames: number; path: Array<{ frameOffset: number; x: number; y: number }> } {
  if (!Number.isFinite(fps) || fps <= 0 || samples.length < 2)
    throw new Error('录制轨迹或帧率无效。');
  const first = samples[0]!,
    last = samples[samples.length - 1]!;
  let previous = -Infinity;
  for (const p of samples) {
    if (
      ![p.timeMs, p.x, p.y].every(Number.isFinite) ||
      p.timeMs < previous ||
      p.x < 0 ||
      p.x > 1 ||
      p.y < 0 ||
      p.y > 1
    )
      throw new Error('录制轨迹的时间或坐标无效。');
    previous = p.timeMs;
  }
  const durationFrames = Math.max(1, Math.round(((last.timeMs - first.timeMs) * fps) / 1000));
  if (durationFrames > 100000) throw new Error('录制动作超过允许时长。');
  const points = new Map<number, { frameOffset: number; x: number; y: number }>();
  for (const point of samples) {
    const frameOffset = Math.min(
      durationFrames,
      Math.max(0, Math.round(((point.timeMs - first.timeMs) * fps) / 1000)),
    );
    points.set(frameOffset, { frameOffset, x: point.x, y: point.y });
  }
  points.set(0, { frameOffset: 0, x: first.x, y: first.y });
  points.set(durationFrames, { frameOffset: durationFrames, x: last.x, y: last.y });
  return {
    durationFrames,
    path: [...points.values()].sort((a, b) => a.frameOffset - b.frameOffset),
  };
}
