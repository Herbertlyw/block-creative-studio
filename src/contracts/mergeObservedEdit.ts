import type { BBWorkPackage } from './bbWorkPackage';
import { parseReferenceCalibration } from '../games/block-placement/calibrated/parseCalibration';
import { observedCalibrationIdentity } from './observedSourceLink';

/** Rebuild measured gameplay/geometry while retaining the current work's identity,
 * materials, effect choices and full audio configuration. Original work is untouched. */
export function mergeObservedEdit(template: BBWorkPackage, measured: unknown): unknown {
  const original = template.project as any,
    next = structuredClone(measured) as any;
  if (!template.source) throw new Error('缺少观察记录，不能恢复观察编辑。');
  if (
    original.takes.length !== 1 ||
    next.takes.length !== 1 ||
    original.takes[0].takeId !== next.takes[0].takeId
  )
    throw new Error('本次观察编辑需要同一条来源 Take；其他 Take 不会被删除，请单独保留。');
  const before = original.direction.style.referenceCalibration,
    after = next.direction.style.referenceCalibration;
  const changed =
    JSON.stringify(observedCalibrationIdentity(before)) !==
    JSON.stringify(observedCalibrationIdentity(after));
  if (
    changed &&
    (before.previewDrags?.length ||
      before.shakeTrack?.length ||
      before.scoreTrack?.length ||
      before.endCardStart !== undefined)
  )
    throw new Error('作品包含额外的独立时间轨道；请先调整对应轨道，未覆盖原作品。');
  const result = structuredClone(original);
  result.game = next.game;
  result.takes = next.takes;
  result.production = { ...result.production, output: next.production.output };
  const calibration = {
    ...structuredClone(before),
    ...after,
    actions: after.actions.map((action: any) => ({
      ...structuredClone(before.actions.find((old: any) => old.actionId === action.actionId) ?? {}),
      ...action,
    })),
  };
  // These are visual choices on the current work, not observations that must be reconstructed.
  for (const field of [
    'sprites',
    'legacySpriteAssetIds',
    'appearance',
    'effects',
    'tileColors',
    'tileMaterial',
    'backdrop',
    'scoreFeedback',
    'trophies',
    'scoreTrack',
    'shakeTrack',
    'previewDrags',
    'endCardStart',
  ] as const)
    if (before[field] !== undefined) calibration[field] = structuredClone(before[field]);
  // Reset a formerly non-default center when the new measurement returns to default.
  if (after.rackCenters === undefined) {
    if (before.rackCenters !== undefined || before.appearance?.rackCenters !== undefined)
      calibration.rackCenters = [236, 540, 844];
    else delete calibration.rackCenters;
  }
  result.direction.style.referenceCalibration = parseReferenceCalibration(
    calibration,
    result,
    result.takes[0].takeId,
  );
  return result;
}
