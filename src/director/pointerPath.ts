import type { PointerSample } from '../domain/types';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function path(points: Array<{ x: number; y: number }>, durationFrames: number): PointerSample[] {
  const last = Math.max(1, durationFrames);
  const count = Math.max(2, points.length);
  const samples: PointerSample[] = points.map((point, index) => {
    const t = index / Math.max(1, count - 1);
    return {
      frameOffset: index === 0 ? 0 : index === count - 1 ? last : Math.max(1, Math.round(t * last)),
      x: clamp01(point.x),
      y: clamp01(point.y),
    };
  });
  for (let index = 1; index < samples.length; index += 1) {
    const current = samples[index]!;
    const previous = samples[index - 1]!;
    current.frameOffset = Math.max(previous.frameOffset + 1, current.frameOffset);
  }
  const tail = samples[samples.length - 1];
  if (tail) tail.frameOffset = last;
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const current = samples[index]!;
    const next = samples[index + 1]!;
    current.frameOffset = Math.min(current.frameOffset, next.frameOffset - 1);
    current.frameOffset = Math.max(0, current.frameOffset);
  }
  if (samples[0]) samples[0].frameOffset = 0;
  return samples;
}

/** Agent drag shapes from the received pointer-path snapshot. Landing is caller-defined. */
export function buildAgentPointerPath(input: {
  actionIndex: number;
  slotIndex: number;
  landing: { x: number; y: number };
  durationFrames: number;
}): PointerSample[] {
  const last = Math.max(1, input.durationFrames);
  const start = { x: 0.27 + input.slotIndex * 0.23, y: 0.88 };
  const { landing } = input;
  if (last <= 3) return path([start, landing], last);

  const side = input.actionIndex % 2 === 0 ? 1 : -1;
  const mid = {
    x: (start.x + landing.x) * 0.5 + (landing.y - start.y) * 0.16 * side,
    y: (start.y + landing.y) * 0.5 - (landing.x - start.x) * 0.1 * side,
  };
  const kind = input.actionIndex % 5;

  if (kind === 1 && last >= 10) {
    const glance = { x: landing.x + side * 0.07, y: landing.y - 0.045 };
    return path(
      [start, mid, glance, { x: glance.x + side * 0.012, y: glance.y + 0.012 }, landing],
      last,
    );
  }

  if (kind === 3 && last >= 10) {
    return path([start, mid, { x: landing.x - side * 0.04, y: landing.y + 0.028 }, landing], last);
  }

  return path([start, mid, landing], last);
}
