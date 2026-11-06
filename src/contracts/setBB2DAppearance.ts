import { openBBWorkPackage, updateBBWorkPackageProject, type BBWorkPackage } from './bbWorkPackage';
import { hasReferenceCalibration } from './hasReferenceCalibration';
import { compileNativeTake } from './compileNativeTake';

export const BB_2D_APPEARANCE_OPTIONS = {
  tileMaterial: ['soft-bevel', 'flat-matte', 'candy-blast'],
  tileFaceSet: ['botanical-reference', 'none'],
  previewFx: ['full-line-tint', 'cells-only'],
  clearFx: [
    'sweep-score-spark',
    'sweep-only',
    'neon-shatter',
    'pixel-burst',
    'laser-slice',
    'fire-wave',
    'lightning-chain',
  ],
  feedbackFx: ['praise-combo', 'score-only'],
  ambientFx: ['garden-petals', 'none'],
  screenFx: ['default', 'none', 'edge-glow', 'clear-bloom', 'edge-glow+clear-bloom'],
} as const;
type Property = keyof typeof BB_2D_APPEARANCE_OPTIONS;

/** Apply one supported drawing setting; never silently discard dependent tracks. */
export async function setBB2DAppearance(
  work: BBWorkPackage,
  property: Property,
  value: string,
): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  if (
    !Object.hasOwn(BB_2D_APPEARANCE_OPTIONS, property) ||
    !(BB_2D_APPEARANCE_OPTIONS[property] as readonly string[]).includes(value)
  )
    throw new Error(`不支持的 2D 外观选项：${String(property)}=${value}`);
  if (hasReferenceCalibration(original.project))
    throw new Error('观察作品使用已确认的外观轨道；请在观察编辑器修改并重新确认。');
  const project = structuredClone(original.project) as {
    direction?: { style?: { reference2d?: Record<string, unknown>; workbenchVariantV1?: unknown } };
    takes?: Array<{ takeId: string; actions: unknown[] }>;
  };
  const style = project.direction?.style;
  if (!style?.reference2d) throw new Error('作品缺少 2D 外观配置；原作品未修改。');
  if (style.workbenchVariantV1 !== undefined)
    throw new Error('作品使用已保存的外观变体；请先在变体编辑器修改，避免新设置被覆盖。');
  if (property === 'screenFx' && value === 'default') delete style.reference2d.screenFx;
  else style.reference2d[property] = value;
  const candidate = await updateBBWorkPackageProject(original, project);
  for (const take of project.takes ?? [])
    if (take.actions.length) compileNativeTake(candidate.project, take.takeId);
  return candidate;
}

/** Shared ordinary 2D/3D pointer visibility and the 2D best-score display. */
export async function setBBDisplaySetting(
  work: BBWorkPackage,
  property: 'showPointer' | 'bestScore',
  value: boolean | number,
): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  if (hasReferenceCalibration(original.project))
    throw new Error('观察作品的指针和计分显示由已确认的观察设置控制；请在观察编辑器重新确认。');
  const project = structuredClone(original.project) as {
    direction?: {
      style?: {
        showPointer?: boolean;
        reference2d?: Record<string, unknown>;
        workbenchVariantV1?: unknown;
      };
    };
    takes?: Array<{ takeId: string; actions: unknown[] }>;
  };
  const style = project.direction?.style;
  if (!style?.reference2d) throw new Error('作品缺少 2D 外观配置。');
  if (style.workbenchVariantV1 !== undefined)
    throw new Error('作品使用已保存的外观变体；请先在变体编辑器修改。');
  if (property === 'showPointer' && typeof value === 'boolean') style.showPointer = value;
  else if (
    property === 'bestScore' &&
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 2147483647
  )
    style.reference2d.bestScore = value;
  else throw new Error('显示设置无效。');
  const candidate = await updateBBWorkPackageProject(original, project);
  for (const take of project.takes ?? [])
    if (take.actions.length) compileNativeTake(candidate.project, take.takeId);
  return candidate;
}
