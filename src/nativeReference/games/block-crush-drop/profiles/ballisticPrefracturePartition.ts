import type { DropReferenceCalibration } from './referenceCalibration';
import type { calibratedSampledBallisticFragments } from './sampledBallisticFragments';
import { calibratedFragmentSeed } from './fragmentSeed';
import { calibratedFragmentFlightSeconds, calibratedFragmentRadius } from './fragmentPhysics';
import {
  calibratedBallisticFragmentElapsedSeconds,
  calibratedBallisticFragmentExitSeconds,
} from './ballisticFragmentAgeOffset';

export interface BallisticPrefractureProfile {
  coarseSubdivisions: number;
  /** Released coarse size is cellWidth/coarseSubdivisions*coarseScale. */
  coarseScale: number;
  refineAfterReleaseSeconds: number;
  /** Deterministic wave-wide group fraction, rounded down; never duplicates children. */
  retainedCoarseFraction: number;
}
type NativePose = ReturnType<typeof calibratedSampledBallisticFragments>[number];
export const MAX_BALLISTIC_PREFRACTURE_FINE_POSES = 8192;
export interface BallisticCoarseProxy {
  groupId: string;
  cell: NativePose['cell'];
  ix: number;
  iy: number;
  childIds: string[];
  x: number;
  y: number;
  size: number;
  velocityX: number;
  velocityY: number;
  angle: number;
  rotationAge: number;
  releaseSeconds: number;
  age: number;
  released: boolean;
  visible: boolean;
  seedX: number;
  lightingY: number;
  retained: boolean;
}

/**
 * Mutually exclusive visual ownership, not source COM/forces or a new game cell.
 * Fine physics always runs; refinement forwards those same objects unchanged.
 */
export function ballisticPrefracturePartition(
  poses: readonly NativePose[],
  clear: NonNullable<DropReferenceCalibration['clear']>,
  cellWidth: number,
) {
  const profile = clear.ballisticPrefracture;
  if (profile === undefined)
    return { coarse: [] as BallisticCoarseProxy[], fine: poses, heldMotherIds: [] as string[] };
  const {
      coarseSubdivisions: m,
      coarseScale,
      refineAfterReleaseSeconds: refine,
      retainedCoarseFraction: fraction,
    } = profile,
    n = clear.subdivisions,
    physics = clear.fragmentPhysics;
  if (
    clear.motionModel !== 'ballistic' ||
    (clear.fragmentGeometry !== 'rounded-cube' &&
      clear.fragmentGeometry !== 'rounded-polyhedron') ||
    clear.fragmentDisplayFps === undefined ||
    clear.prefracture !== false ||
    !physics ||
    physics.sheetDetachSeconds !== undefined ||
    physics.sheetDetachAfterReleaseSeconds !== undefined ||
    clear.layeredCurve ||
    clear.fragmentDepthRenderer ||
    clear.fragmentPerspectiveCamera ||
    clear.prefractureRefineSeconds !== undefined ||
    (clear.fragmentDepthLayers !== undefined && clear.fragmentDepthLayers !== 1) ||
    clear.fragmentSurface === 'tile-repeat' ||
    !Number.isInteger(n) ||
    n < 2 ||
    n > 8 ||
    !Number.isInteger(m) ||
    m < 1 ||
    m >= n ||
    n % m !== 0 ||
    !Number.isFinite(coarseScale) ||
    coarseScale < 0.5 ||
    coarseScale > 2 ||
    !Number.isFinite(refine) ||
    refine <= 0 ||
    refine > 2 ||
    !Number.isFinite(fraction) ||
    fraction < 0 ||
    fraction > 0.25 ||
    !Number.isFinite(cellWidth) ||
    cellWidth <= 0
  )
    throw new Error('DROP_BALLISTIC_PREFRACTURE_UNSUPPORTED');
  if (poses.length > MAX_BALLISTIC_PREFRACTURE_FINE_POSES)
    throw new Error('DROP_BALLISTIC_PREFRACTURE_POSE_BUDGET');
  const byCell = new Map<string, NativePose[]>(),
    seen = new Set<string>();
  for (const p of poses) {
    if (
      seen.has(p.id) ||
      !Number.isInteger(p.ix) ||
      p.ix < 0 ||
      p.ix >= n ||
      !Number.isInteger(p.iy) ||
      p.iy < 0 ||
      p.iy >= n ||
      ![
        p.x,
        p.y,
        p.size,
        p.velocityX,
        p.velocityY,
        p.angle,
        p.rotationAge,
        p.releaseSeconds,
        p.sampledSeconds,
      ].every(Number.isFinite) ||
      p.size <= 0 ||
      p.releaseSeconds < 0 ||
      p.sampledSeconds < 0
    )
      throw new Error('DROP_BALLISTIC_PREFRACTURE_INVALID_NATIVE_POSE');
    seen.add(p.id);
    const list = byCell.get(p.cell.id) ?? [];
    list.push(p);
    byCell.set(p.cell.id, list);
  }
  const heldMotherIds: string[] = [],
    groups: Array<{
      id: string;
      children: NativePose[];
      ix: number;
      iy: number;
      heldMother: boolean;
    }> = [],
    ratio = n / m;
  for (const children of byCell.values()) {
    if (
      children.length !== n * n ||
      new Set(children.map((p) => `${p.ix}:${p.iy}`)).size !== n * n ||
      children.some((p) => p.sampledSeconds !== children[0]!.sampledSeconds)
    )
      throw new Error('DROP_BALLISTIC_PREFRACTURE_INCOMPLETE_NATIVE_LATTICE');
    const heldMother = children.every((p) => !p.released);
    if (heldMother) heldMotherIds.push(children[0]!.cell.id);
    for (let iy = 0; iy < m; iy++)
      for (let ix = 0; ix < m; ix++)
        groups.push({
          id: `${children[0]!.cell.id}:coarse-${ix}-${iy}`,
          children: children.filter(
            (p) => Math.floor(p.ix / ratio) === ix && Math.floor(p.iy / ratio) === iy,
          ),
          ix,
          iy,
          heldMother,
        });
  }
  const ranked = [...groups].sort(
    (a, b) =>
      calibratedFragmentSeed(a.id) - calibratedFragmentSeed(b.id) || a.id.localeCompare(b.id),
  );
  const retained = new Set(ranked.slice(0, Math.floor(groups.length * fraction)).map((g) => g.id));
  const coarse: BallisticCoarseProxy[] = [],
    fineIds = new Set<string>();
  for (const group of groups) {
    if (group.heldMother) continue;
    const children = group.children,
      first = children[0]!,
      t = first.sampledSeconds,
      releaseSeconds = Math.min(...children.map((p) => p.releaseSeconds)),
      released = t >= releaseSeconds,
      age = Math.max(
        0,
        calibratedBallisticFragmentElapsedSeconds(
          t,
          releaseSeconds,
          clear.fragmentAgeOffsetSeconds,
        ) - releaseSeconds,
      );
    // Refine no later than a child's real exit: do not hide visible siblings
    // behind an already-departed proxy and bring them back at a later deadline.
    const earliestChildExit = Math.min(
      ...children.map((p) => {
        const initialVy = p.velocityY - physics.gravityPixelsPerSecondSquared * p.age;
        const originY =
          p.y - initialVy * p.age - 0.5 * physics.gravityPixelsPerSecondSquared * p.age * p.age;
        const freeSize =
          (cellWidth / n) *
          (clear.fragmentScale ?? 1.1) *
          (1 + (clear.sizeSpread ?? 0) * (2 * p.seedX - 1));
        return calibratedBallisticFragmentExitSeconds(
          p.releaseSeconds,
          calibratedFragmentFlightSeconds(originY, freeSize, physics, initialVy),
          clear.fragmentAgeOffsetSeconds,
        );
      }),
    );
    const isRetained = retained.has(group.id);
    const refineSeconds = calibratedBallisticFragmentExitSeconds(
      releaseSeconds,
      refine,
      clear.fragmentAgeOffsetSeconds,
    );
    if (!isRetained && t >= Math.min(refineSeconds, earliestChildExit)) {
      children.forEach((p) => fineIds.add(p.id));
      continue;
    }
    const mean = (key: 'x' | 'y' | 'velocityX' | 'velocityY' | 'angle' | 'rotationAge') =>
      children.reduce((v, p) => v + p[key], 0) / children.length;
    const size = (cellWidth / m) * (released ? coarseScale : 1),
      y = mean('y');
    coarse.push({
      groupId: group.id,
      cell: first.cell,
      ix: group.ix,
      iy: group.iy,
      childIds: children.map((p) => p.id),
      x: mean('x'),
      y,
      size,
      velocityX: mean('velocityX'),
      velocityY: mean('velocityY'),
      angle: released ? mean('angle') : 0,
      rotationAge: released ? mean('rotationAge') : 0,
      releaseSeconds,
      age,
      released,
      visible: y - calibratedFragmentRadius(size) <= (physics.exitY ?? 1920),
      seedX: calibratedFragmentSeed(group.id),
      lightingY: first.lightingY,
      retained: isRetained,
    });
  }
  const fine = fineIds.size === poses.length ? poses : poses.filter((p) => fineIds.has(p.id));
  return { coarse, fine, heldMotherIds };
}
