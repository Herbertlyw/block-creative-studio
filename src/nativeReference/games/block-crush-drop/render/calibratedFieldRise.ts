import type { DropReferenceCalibration } from '../profiles/referenceCalibration';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';
import { blockCrushFieldClock } from '../fieldClock';

/** A signed visual correction, sampled on the full Take's canonical 30-fps clock. */
export function sampleCalibratedFieldRiseOffset(a: DropReferenceCalibration, tick: number): number {
  const keys = a.fieldRiseOffsetKeys;
  if (!keys || tick < keys[0]!.canonicalFrame || tick > keys.at(-1)!.canonicalFrame) return 0;
  let lo = 0,
    hi = keys.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (keys[mid]!.canonicalFrame < tick) lo = mid + 1;
    else hi = mid;
  }
  const end = keys[lo]!,
    start = keys[Math.max(0, lo - 1)]!;
  if (start.canonicalFrame === end.canonicalFrame) return end.offsetCells;
  const u = (tick - start.canonicalFrame) / (end.canonicalFrame - start.canonicalFrame);
  return start.offsetCells + (end.offsetCells - start.offsetCells) * u;
}

export const calibratedFieldRiseTick = (f: BlockCrushDropPresentationFrame): number =>
  f.canonicalTick ?? (f.frameIndex * 30) / f.fps;

/** Never wrap a visual correction into another native row's identity basis. */
export function calibratedVisualFieldRise(
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
): number {
  if (a.fieldRiseOffsetKeys === undefined) return f.fieldRiseOffsetCells;
  const tick = calibratedFieldRiseTick(f),
    offset = sampleCalibratedFieldRiseOffset(a, tick);
  const effective = f.fieldRiseOffsetCells + offset;
  if (!Number.isFinite(effective) || effective < -1e-10 || effective >= 1) {
    throw new Error(
      `DROP_FIELD_RISE_NATIVE_ROW_BASIS_CROSSING: canonicalFrame=${tick}, nativeFraction=${f.fieldRiseOffsetCells}, offsetCells=${offset}, effectiveFraction=${effective}; visual field rise must retain the native integer row basis [0,1).`,
    );
  }
  // Only absorb subtraction roundoff at zero, never wrap/clamp a real row crossing.
  return effective < 0 ? 0 : effective;
}

/** A renderer-local projection; the semantic frame and its clocks remain intact. */
export function calibratedFieldRiseBoardFrame(
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
): BlockCrushDropPresentationFrame {
  if (a.fieldRiseOffsetKeys === undefined) return f;
  return { ...f, fieldRiseOffsetCells: calibratedVisualFieldRise(f, a) };
}

/** Public preparation can preflight its actual compiled native clip, without drawing. */
export function validateCalibratedFieldRiseFrames(
  frames: Iterable<BlockCrushDropPresentationFrame>,
  a: DropReferenceCalibration,
): void {
  if (a.fieldRiseOffsetKeys === undefined) return;
  for (const frame of frames) calibratedVisualFieldRise(frame, a);
}

/** Freeze released origins at their visually calibrated birth height. */
export function calibratedFieldRiseCompensation(
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
  start: number,
): number {
  const current = calibratedFieldRiseTick(f);
  const native =
    (blockCrushFieldClock(f.before.config, current) -
      blockCrushFieldClock(f.before.config, start)) /
    f.before.config.rules.fieldMotion.ticksPerCell;
  if (a.fieldRiseOffsetKeys === undefined) return native;
  return (
    native + sampleCalibratedFieldRiseOffset(a, current) - sampleCalibratedFieldRiseOffset(a, start)
  );
}
