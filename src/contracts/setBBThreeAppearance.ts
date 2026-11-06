import { openBBWorkPackage, updateBBWorkPackageProject, type BBWorkPackage } from './bbWorkPackage';
import { GEOMETRY_PRESETS } from '../renderer/stylePresets';

const allowed = {
  material: ['glossy-plastic', 'candy-resin', 'crystal-glass'],
  lighting: ['clean-studio', 'soft-candy', 'neon-contrast'],
  camera: ['flat-gameplay', 'premium-perspective', 'dynamic-clear'],
  fx: ['clean-pop', 'crystal-shatter', 'energy-burst'],
  geometry: ['soft-cube', 'premium-beveled', 'candy-rounded'],
} as const;
type Property = keyof typeof allowed | 'background';

/** Edit one declared appearance field and validate the entire candidate work. */
export async function setBBThreeAppearance(
  work: BBWorkPackage,
  property: Property,
  value: string,
): Promise<BBWorkPackage> {
  const original = await openBBWorkPackage(work);
  if (property !== 'background' && !Object.hasOwn(allowed, property))
    throw new Error(`不支持的 3D 外观字段：${String(property)}`);
  if (property === 'background') {
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error('3D 背景颜色须为六位十六进制颜色。');
  } else if (!(allowed[property] as readonly string[]).includes(value))
    throw new Error(`不支持的 3D ${property} 选项：${value}`);
  const project = structuredClone(original.project) as {
    direction?: { style?: Record<string, unknown> };
  };
  const style = project.direction?.style;
  if (!style) throw new Error('作品缺少外观配置；原作品未修改。');
  if (property === 'geometry')
    style.geometry = structuredClone(GEOMETRY_PRESETS[value as keyof typeof GEOMETRY_PRESETS]);
  else style[property] = value;
  return updateBBWorkPackageProject(original, project);
}

/** Change one geometric dimension without replacing the other appearance fields. */
export async function setBBThreeGeometry(
  work: BBWorkPackage,
  property: 'depth' | 'bevel' | 'gap',
  value: number,
): Promise<BBWorkPackage> {
  const limits = { depth: [0.18, 0.72], bevel: [0.04, 0.24], gap: [0.04, 0.18] } as const;
  if (
    !Object.hasOwn(limits, property) ||
    !Number.isFinite(value) ||
    value < limits[property][0] ||
    value > limits[property][1]
  )
    throw new Error('3D 几何参数超出支持范围。');
  const original = await openBBWorkPackage(work);
  const project = structuredClone(original.project) as {
    direction?: { style?: { geometry?: Record<string, unknown> } };
  };
  const geometry = project.direction?.style?.geometry;
  if (
    !geometry ||
    !Object.keys(geometry).every((key) => ['id', 'depth', 'bevel', 'gap'].includes(key))
  )
    throw new Error('3D 几何含未知字段或缺失，原作品保留。');
  geometry[property] = value;
  return updateBBWorkPackageProject(original, project);
}
