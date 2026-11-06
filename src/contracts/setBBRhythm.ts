import { openBBWorkPackage, updateBBWorkPackageProject, type BBWorkPackage } from './bbWorkPackage';
import { hasReferenceCalibration } from './hasReferenceCalibration';
import { compileNativeTake } from './compileNativeTake';
import { parseWorkbenchView } from './reference2dView';
import { resolveSavedWorkbenchVariant } from './workbenchVariant';
import { RHYTHM_PRESETS } from '../nativeReference/director/rhythmPresets';

export const BB_RHYTHM_FIELDS = [
  'globalSpeed',
  'dragFrames',
  'pickupDelayFrames',
  'placementSettleFrames',
  'betweenActionFrames',
  'clearDelayFrames',
  'clearDurationFrames',
  'cameraRecoveryFrames',
] as const;
type RhythmField = (typeof BB_RHYTHM_FIELDS)[number];
type RhythmProject = {
  direction?: {
    rhythm?: Record<string, unknown>;
    style?: { workbenchView2D?: unknown; workbenchVariantV1?: unknown };
  };
  takes?: Array<{ takeId: string; actions: unknown[] }>;
};

/** Recompile every Take before committing a deliberate rhythm change. */
export async function setBBRhythm(
  work: BBWorkPackage,
  field: RhythmField,
  value: number,
): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  if (!(BB_RHYTHM_FIELDS as readonly string[]).includes(field))
    throw new Error(`不支持的节奏字段：${String(field)}`);
  if (
    !Number.isFinite(value) ||
    (field === 'globalSpeed'
      ? value < 0.1 || value > 8
      : !Number.isInteger(value) ||
        value < (field === 'dragFrames' || field === 'clearDurationFrames' ? 1 : 0) ||
        value > 1000)
  )
    throw new Error(`节奏字段 ${field} 的值无效。`);
  if (original.source || original.pointer || hasReferenceCalibration(original.project))
    throw new Error('作品包含已确认的来源或轨道；请在观察编辑器重新确认时间，原作品未修改。');
  const project = structuredClone(original.project) as RhythmProject;
  const rhythm = project.direction?.rhythm;
  if (!rhythm || !Object.hasOwn(rhythm, field))
    throw new Error(`作品缺少节奏字段 ${field}；原作品未修改。`);
  rhythm[field] = value;
  return validateRhythm(original, project);
}

/** Replace the complete known rhythm profile, keeping unsupported extensions safe. */
export async function setBBRhythmPreset(work: BBWorkPackage, id: string): Promise<BBWorkPackage> {
  if (!Object.hasOwn(RHYTHM_PRESETS, id)) throw new Error('不支持的节奏模板。');
  const original = await openBBWorkPackage(work);
  if (original.source || original.pointer || hasReferenceCalibration(original.project))
    throw new Error('作品包含已确认的来源或轨道；请在观察编辑器重新确认时间，原作品未修改。');
  const project = structuredClone(original.project) as RhythmProject,
    rhythm = project.direction?.rhythm;
  const preset = RHYTHM_PRESETS[id as keyof typeof RHYTHM_PRESETS];
  if (!rhythm || !Object.keys(rhythm).every((key) => Object.hasOwn(preset, key)))
    throw new Error('节奏包含未知字段，不能安全替换模板。');
  project.direction!.rhythm = structuredClone(preset) as unknown as Record<string, unknown>;
  return validateRhythm(original, project);
}

async function validateRhythm(
  original: BBWorkPackage,
  project: RhythmProject,
): Promise<BBWorkPackage> {
  const candidate = await updateBBWorkPackageProject(original, project);
  for (const take of project.takes ?? []) {
    if (!take.actions.length) continue;
    try {
      const { compiled } = compileNativeTake(candidate.project, take.takeId),
        style = project.direction?.style;
      if (style?.workbenchView2D !== undefined)
        parseWorkbenchView(style.workbenchView2D, compiled.fps, compiled.totalFrames);
      if (style?.workbenchVariantV1 !== undefined)
        resolveSavedWorkbenchVariant(candidate.project, take.takeId);
    } catch (error) {
      throw new Error(
        `Take ${take.takeId} 的时间或依赖重验失败：${error instanceof Error ? error.message : String(error)}；原作品未修改。`,
      );
    }
  }
  return candidate;
}
