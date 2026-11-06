import Ajv from 'ajv/dist/2020';
import schema from '../../contracts/bb/workbench-extensions/export-quality-v1.schema.json';
import type { BBWorkPackage } from './bbWorkPackage';

export const BB_EXPORT_QUALITY = {
  preview: { bitrate: 8_000_000, scale: 1 },
  standard: { bitrate: 14_000_000, scale: 1.35 },
  cinematic: { bitrate: 24_000_000, scale: 2 },
} as const;
export type BBExportPreset = keyof typeof BB_EXPORT_QUALITY;
const validate = new Ajv({ strict: false }).compile(schema);

export function readBBExportQuality(document: unknown): BBExportPreset {
  const value = (document as any)?.direction?.style?.workbenchExportQualityV1;
  if (value === undefined) return 'preview';
  if (!validate(value)) throw new Error('导出质量合同无效或版本不支持。');
  return value.preset as BBExportPreset;
}
export async function setBBExportQuality(
  work: BBWorkPackage,
  preset: BBExportPreset,
): Promise<BBWorkPackage> {
  if (!Object.hasOwn(BB_EXPORT_QUALITY, preset)) throw new Error('不支持的导出质量。');
  const { openBBWorkPackage, updateBBWorkPackageProject } = await import('./bbWorkPackage');
  const original = await openBBWorkPackage(work),
    project = structuredClone(original.project) as any;
  if (!project.direction?.style) throw new Error('作品缺少外观设置。');
  if (preset === 'preview') delete project.direction.style.workbenchExportQualityV1;
  else
    project.direction.style.workbenchExportQualityV1 = {
      contract: 'bcs.workbench.export-quality',
      version: '1.0.0',
      preset,
    };
  readBBExportQuality(project);
  return updateBBWorkPackageProject(original, project);
}
