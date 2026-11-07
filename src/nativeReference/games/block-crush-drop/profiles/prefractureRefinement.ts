import type { DropReferenceCalibration } from './referenceCalibration';
import type { calibratedLocalDetachFragments } from './localFragmentSupport';

type NativePose = ReturnType<typeof calibratedLocalDetachFragments>[number];
export const MAX_PREFRACTURE_REFINEMENT_FINE_POSES = 8192;
export interface CoarsePrefractureProxy {
  cell: NativePose['cell'];
  ix: number;
  iy: number;
  x: number;
  y: number;
  size: number;
  motherWorldY: number;
  /** Diagnostic ownership only: the factory keeps all native children alive. */
  childIds: string[];
}
/** A display partition, never a new physics cell, release clock or particle ID. */
export function prefractureRefinementPartition(
  poses: readonly NativePose[],
  clear: NonNullable<DropReferenceCalibration['clear']>,
  displaySeconds: number,
) {
  const refine = clear.prefractureRefineSeconds;
  if (refine === undefined) return { coarse: [] as CoarsePrefractureProxy[], fine: poses };
  const n = clear.subdivisions,
    m = clear.prefractureSubdivisions;
  if (
    !Number.isFinite(refine) ||
    refine <= 0 ||
    refine > 2 ||
    clear.prefracture !== true ||
    clear.motionModel !== 'constrained-sheet' ||
    clear.fragmentPhysics?.sheetDetachAfterReleaseSeconds === undefined ||
    !Number.isInteger(n) ||
    n < 2 ||
    n > 8 ||
    m === undefined ||
    !Number.isInteger(m) ||
    m < 1 ||
    m >= n ||
    n % m !== 0 ||
    clear.fragmentSurface === 'tile-repeat' ||
    !Number.isFinite(displaySeconds)
  )
    throw new Error('DROP_PREFRACTURE_REFINEMENT_UNSUPPORTED');
  if (poses.length > MAX_PREFRACTURE_REFINEMENT_FINE_POSES)
    throw new Error('DROP_PREFRACTURE_REFINEMENT_POSE_BUDGET');
  if (displaySeconds >= refine) return { coarse: [] as CoarsePrefractureProxy[], fine: poses };
  const byCell = new Map<string, NativePose[]>();
  for (const pose of poses) {
    const group = byCell.get(pose.cell.id) ?? [];
    group.push(pose);
    byCell.set(pose.cell.id, group);
  }
  const coarse: CoarsePrefractureProxy[] = [],
    fine: NativePose[] = [];
  for (const children of byCell.values()) {
    // age>0 owns the transition, including an already-supported/free child. The
    // same ongoing fine pose objects are forwarded, without reseeding or reset.
    if (children.some((p) => p.age > 0 || !p.visible || p.alpha !== 1)) {
      fine.push(...children);
      continue;
    }
    if (
      children.length !== n * n ||
      new Set(children.map((p) => `${p.ix}:${p.iy}`)).size !== n * n ||
      children.some(
        (p) =>
          p.ix < 0 ||
          p.ix >= n ||
          p.iy < 0 ||
          p.iy >= n ||
          !Number.isInteger(p.ix) ||
          !Number.isInteger(p.iy),
      )
    )
      throw new Error('DROP_PREFRACTURE_REFINEMENT_INCOMPLETE_NATIVE_LATTICE');
    const motherWorldY = children.reduce((v, p) => v + p.y, 0) / children.length,
      ratio = n / m;
    const groups = new Map<string, NativePose[]>();
    for (const child of children) {
      const ix = Math.floor(child.ix / ratio),
        iy = Math.floor(child.iy / ratio),
        key = `${ix}:${iy}`,
        group = groups.get(key) ?? [];
      group.push(child);
      groups.set(key, group);
    }
    for (let iy = 0; iy < m; iy++)
      for (let ix = 0; ix < m; ix++) {
        const group = groups.get(`${ix}:${iy}`)!;
        coarse.push({
          cell: children[0]!.cell,
          ix,
          iy,
          x: group.reduce((v, p) => v + p.x, 0) / group.length,
          y: group.reduce((v, p) => v + p.y, 0) / group.length,
          size: (group.reduce((v, p) => v + p.size, 0) / group.length) * ratio,
          motherWorldY,
          childIds: group.map((p) => p.id),
        });
      }
  }
  return { coarse, fine };
}
