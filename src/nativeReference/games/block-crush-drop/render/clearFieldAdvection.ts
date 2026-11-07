import type { DropReferenceCalibration } from '../profiles/referenceCalibration';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';
import { calibratedFieldRiseCompensation, calibratedFieldRiseTick } from './calibratedFieldRise';

/**
 * Optional board-space advection for historical screen-anchored clear models.
 * At constant field speed this is exactly a release-time origin plus the
 * board's inherited velocity; it does not change gravity or the release front.
 * Absent/false leaves historical projects' coordinates untouched.
 */
export function calibratedClearFieldAdvection(
  frame: BlockCrushDropPresentationFrame,
  calibration: DropReferenceCalibration,
): number {
  const cue = frame.lingeringClear;
  if (calibration.clear?.followFieldRise !== true || !cue) return 0;
  const start = calibratedFieldRiseTick(frame) - (cue.elapsedFrames * 30) / frame.fps;
  return -calibratedFieldRiseCompensation(frame, calibration, start) * calibration.board.cell;
}
