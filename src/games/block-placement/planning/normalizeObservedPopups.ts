import type { ReferenceCalibration } from '../calibrated/parseCalibration';
import type { CalibratedReplayStep } from '../../../contracts/calibratedFrame';
import type { BBScorePopupTrack } from './scorePopupTimeline';

/** Resolve authored or rule-derived score labels at plan creation. */
export function normalizeObservedPopups(
  spec: ReferenceCalibration,
  steps: readonly CalibratedReplayStep[],
  boardCols: number,
): BBScorePopupTrack[] {
  const config = spec.scoreFeedback;
  if (!config?.enabled) return [];
  const [gx, gy, pitch] = spec.board;
  return steps.flatMap((step, index) => {
    const action = spec.actions[index];
    if (!action || !step.clear.cells.length) return [];
    const authored = action.scorePopup;
    if (config.source === 'authored' && !authored) return [];
    const value = config.source === 'authored' ? authored!.value : step.clearBonusPoints;
    if (!(value > 0)) return [];
    const cells = step.clear.cells,
      cx = gx + (cells.reduce((sum, cell) => sum + cell.col, 0) / cells.length + 0.5) * pitch;
    const cy = gy + (cells.reduce((sum, cell) => sum + cell.row, 0) / cells.length + 0.5) * pitch;
    const position = authored?.position ?? [cx, cy - 50];
    const halfWidth = Math.max(
      90,
      String(value).length * config.fontSize * 0.34 + config.fontSize * 0.45,
    );
    return [
      {
        actionIndex: index,
        clearSeconds: action.clear,
        delaySeconds: authored?.delaySeconds ?? config.delaySeconds,
        durationSeconds: authored?.durationSeconds ?? config.durationSeconds,
        text: `${authored?.prefix === false ? '' : '+'}${value}`,
        x: Math.max(gx + halfWidth, Math.min(gx + pitch * boardCols - halfWidth, position[0]!)),
        y: position[1]!,
        risePx: config.risePx,
        minY: gy + config.fontSize * 0.8,
        fontSize: config.fontSize,
        style: authored?.style ?? (value >= 40 ? 'gold' : 'white'),
      },
    ];
  });
}
