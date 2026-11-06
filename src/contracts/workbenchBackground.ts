import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/reference2d-background-v1.schema.json';
import { hasReferenceCalibration } from './hasReferenceCalibration';
import type { BBWorkPackage } from './bbWorkPackage';

type Background = {
  contract: 'bcs.workbench.reference2d-background';
  version: '1.0.0';
  color: string;
};
const validate = new Ajv({ strict: false }).compile(schema);

/** The solid backdrop is explicit and cannot silently hide a bound image. */
export function readWorkbenchBackground(document: unknown): Background | null {
  const style = (document as any)?.direction?.style;
  const value = style?.workbenchBackground2DV1;
  if (value === undefined) return null;
  if (!validate(value)) throw new Error('2D 背景颜色合同无效或版本不支持。');
  if (hasReferenceCalibration(document)) throw new Error('观察作品不支持普通 2D 背景颜色合同。');
  if (style?.agentAssets?.bindings?.['background.base'])
    throw new Error('2D 纯色背景与背景图片同时绑定；请先移除其中一项。');
  if (style?.workbenchVariantV1 !== undefined)
    throw new Error('2D 纯色背景不能与当前保存的外观变体同时使用。');
  return value as Background;
}

export async function setWorkbenchBackground(
  work: BBWorkPackage,
  color: string | null,
): Promise<BBWorkPackage> {
  const { openBBWorkPackage, updateBBWorkPackageProject } = await import('./bbWorkPackage');
  const original = await openBBWorkPackage(work);
  if (hasReferenceCalibration(original.project)) throw new Error('观察作品的背景由观察素材控制。');
  const project = structuredClone(original.project) as any,
    style = project.direction?.style;
  if (!style) throw new Error('作品缺少外观配置。');
  if (color === null) delete style.workbenchBackground2DV1;
  else
    style.workbenchBackground2DV1 = {
      contract: 'bcs.workbench.reference2d-background',
      version: '1.0.0',
      color,
    };
  readWorkbenchBackground(project);
  return updateBBWorkPackageProject(original, project);
}
