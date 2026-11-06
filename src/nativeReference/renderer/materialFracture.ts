import type { MaterialBehaviorProfile, MaterialClass } from '../headless/contracts';
import type { StyleSpec } from '../domain/types';

export function defaultMaterialBehavior(materialClass: MaterialClass): MaterialBehaviorProfile {
  switch (materialClass) {
    case 'glass':
      return {
        materialClass,
        density: 0.56,
        brittleness: 0.92,
        ductility: 0.04,
        elasticity: 0.08,
        hardness: 0.82,
        fractureMode: 'radial-shards',
        largeFragmentRatio: 0.36,
        dustAmount: 0.02,
        sparkAmount: 0.54,
        dropletAmount: 0,
        gravityScale: 0.82,
        drag: 0.06,
      };
    case 'jelly':
      return {
        materialClass,
        density: 0.34,
        brittleness: 0.08,
        ductility: 0.72,
        elasticity: 0.88,
        hardness: 0.12,
        fractureMode: 'soft-tear',
        largeFragmentRatio: 0.18,
        dustAmount: 0,
        sparkAmount: 0.08,
        dropletAmount: 0.42,
        gravityScale: 0.45,
        drag: 0.36,
      };
    case 'wood':
      return {
        materialClass,
        density: 0.48,
        brittleness: 0.36,
        ductility: 0.22,
        elasticity: 0.18,
        hardness: 0.44,
        fractureMode: 'splinters',
        largeFragmentRatio: 0.55,
        dustAmount: 0.22,
        sparkAmount: 0.02,
        dropletAmount: 0,
        gravityScale: 0.95,
        drag: 0.16,
      };
    case 'metal':
      return {
        materialClass,
        density: 0.9,
        brittleness: 0.18,
        ductility: 0.72,
        elasticity: 0.12,
        hardness: 0.8,
        fractureMode: 'chips',
        largeFragmentRatio: 0.7,
        dustAmount: 0.04,
        sparkAmount: 0.36,
        dropletAmount: 0,
        gravityScale: 1.1,
        drag: 0.12,
      };
    default:
      return {
        materialClass,
        density: 0.42,
        brittleness: 0.3,
        ductility: 0.26,
        elasticity: 0.42,
        hardness: 0.46,
        fractureMode: 'chips',
        largeFragmentRatio: 0.44,
        dustAmount: 0.08,
        sparkAmount: 0.12,
        dropletAmount: 0,
        gravityScale: 0.86,
        drag: 0.18,
      };
  }
}

export function resolveFractureBehavior(style?: StyleSpec | null): MaterialBehaviorProfile | undefined {
  if (style?.materialBehavior) return style.materialBehavior;
  const materialClass = style?.materialRuntime?.materialClass;
  return materialClass ? defaultMaterialBehavior(materialClass) : undefined;
}

export interface FractureScale {
  x: number;
  y: number;
  z: number;
}

/**
 * Deterministic shard aspect from a behavior profile.
 * This is kinematic instancing, not a G-buffer / true material-aware fracture solve.
 */
export function shardScaleForBehavior(
  behavior: MaterialBehaviorProfile | undefined,
  baseScale: number,
  largeFragmentRoll: number,
): FractureScale {
  const large = behavior ? largeFragmentRoll < behavior.largeFragmentRatio : false;
  const scale = baseScale * (large ? 1.18 : 0.82);
  const mode = behavior?.fractureMode ?? 'chips';
  switch (mode) {
    case 'splinters':
      return { x: scale * 0.32, y: scale * 1.85, z: scale * 0.28 };
    case 'plates':
      return { x: scale * 1.35, y: scale * 0.22, z: scale * 0.95 };
    case 'radial-shards':
      return { x: scale * 0.22, y: scale * 1.55, z: scale * 0.38 };
    case 'chunks':
      return { x: scale * 1.12, y: scale * 0.92, z: scale * 0.88 };
    case 'soft-tear':
      return { x: scale * 0.95, y: scale * 0.42, z: scale * 0.78 };
    case 'droplets':
      return { x: scale * 0.55, y: scale * 0.62, z: scale * 0.55 };
    case 'none':
      return { x: 0, y: 0, z: 0 };
    case 'custom':
    case 'chips':
    default:
      return { x: scale * 0.78, y: scale * 0.62, z: scale * 0.7 };
  }
}

export interface FractureMotion {
  speed: number;
  lift: number;
  gravity: number;
  drag: number;
}

export function shardMotionForBehavior(
  behavior: MaterialBehaviorProfile | undefined,
  speed: number,
  lift: number,
): FractureMotion {
  const gravityScale = behavior?.gravityScale ?? 1;
  const drag = behavior?.drag ?? 0.16;
  return {
    speed: speed * (1 - drag * 0.45),
    lift: lift * (0.75 + (behavior?.elasticity ?? 0.3) * 0.5),
    gravity: 1.3 * gravityScale,
    drag,
  };
}

export function particleCountForBehavior(
  behavior: MaterialBehaviorProfile | undefined,
  baseCount: number,
): number {
  if (!behavior) return baseCount;
  const dust = Math.round(baseCount * (0.55 + behavior.dustAmount * 1.8));
  const droplets = Math.round(behavior.dropletAmount * 4);
  return Math.max(1, dust + droplets);
}

export function sparkBoostForBehavior(behavior: MaterialBehaviorProfile | undefined): number {
  return 1 + (behavior?.sparkAmount ?? 0) * 0.35;
}
