import type { BlockCrushDropConfig } from './types';

/** Scrolling time, independent of action/effect/audio time and export FPS. */
export function blockCrushFieldClock(config: BlockCrushDropConfig, tick: number): number {
  const { pauses = [], rateChanges = [] } = config.rules.fieldMotion;
  const active = (start: number, end: number) =>
    end -
    start -
    pauses.reduce(
      (sum, range) =>
        sum + Math.max(0, Math.min(end, range.endTick) - Math.max(start, range.startTick)),
      0,
    );
  let cursor = 0,
    multiplier = 1,
    clock = 0;
  for (const change of rateChanges) {
    if (change.startTick >= tick) break;
    clock += active(cursor, change.startTick) * multiplier;
    cursor = change.startTick;
    multiplier = change.multiplier;
  }
  return clock + active(cursor, tick) * multiplier;
}
