import { openBBWorkPackage, updateBBWorkPackageProject, type BBWorkPackage } from './bbWorkPackage';
import type { ReferenceCalibration } from '../games/block-placement/calibrated/parseCalibration';

export const OBSERVED_THEMES = ['grey', 'pink', 'purple'] as const;
export const OBSERVED_CLEAR_STYLES = [
  'spectrum',
  'spark-strip',
  'fracture',
  'tile-tumble',
  'ice-shatter',
  'jewel-burst',
  'neon-strip',
] as const;
export type ObservedVisualChange =
  | { theme: (typeof OBSERVED_THEMES)[number] }
  | { clearStyle: (typeof OBSERVED_CLEAR_STYLES)[number] };
type Track = { takeId: string; calibration: ReferenceCalibration };
export function observedVisualTracks(project: unknown): Track[] {
  const doc = project as {
    direction?: {
      style?: {
        referenceCalibration?: ReferenceCalibration;
        workbenchCalibrationV2?: { tracks: Track[] };
      };
    };
    takes: Array<{ takeId: string }>;
  };
  const style = doc.direction?.style;
  if (style?.workbenchCalibrationV2) return style.workbenchCalibrationV2.tracks;
  return style?.referenceCalibration && doc.takes[0]
    ? [{ takeId: doc.takes[0].takeId, calibration: style.referenceCalibration }]
    : [];
}
/** Presentation-only edit. Timings, gameplay, image bindings and all mix fields are retained. */
export async function setObservedWorkVisual(
  work: BBWorkPackage,
  scope: string,
  change: ObservedVisualChange,
): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work),
    project = structuredClone(original.project);
  if (
    Object.keys(change).length !== 1 ||
    ('theme' in change
      ? !OBSERVED_THEMES.includes(change.theme)
      : !('clearStyle' in change) || !OBSERVED_CLEAR_STYLES.includes(change.clearStyle))
  )
    throw new Error('不支持的校准外观设置。');
  const tracks = observedVisualTracks(project),
    chosen = scope === 'all' ? tracks : tracks.filter((track) => track.takeId === scope);
  if (!chosen.length) throw new Error('找不到待修改的校准 Take。');
  for (const { calibration } of chosen) {
    if ('theme' in change) calibration.theme = change.theme;
    else for (const action of calibration.actions) action.clearStyle = change.clearStyle;
  }
  const { prepareCalibratedRenderer } = await import('./calibratedRenderer');
  for (const { takeId } of tracks) prepareCalibratedRenderer(project, takeId);
  return updateBBWorkPackageProject(original, project);
}
