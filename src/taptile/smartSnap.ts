import { STACK_STAGE, type StackTile } from './stackModel';
import { TAPTILE_EXPORT_SCALE } from './pixelGeometry';
import {
  DEFAULT_TAPTILE_SNAP_GAP_PX,
  formatTapTileSnapGapPx,
  normalizeTapTileSnapGapPx,
} from './snapGap';

export type SnapAxis = 'x' | 'y';
export type SnapAnchor = 'start' | 'center' | 'end';
export type SnapKind = 'gap' | 'seam' | 'center' | 'edge' | 'spacing' | 'stage' | 'track';

export interface SnapGuide {
  axis: SnapAxis;
  value: number;
  kind: SnapKind;
  label: string;
  sourceAnchor: SnapAnchor;
  targetIds: string[];
}

export interface SnapLocks {
  x: SnapGuide | null;
  y: SnapGuide | null;
}

export interface SmartSnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
  locks: SnapLocks;
  targetIds: string[];
}

export interface SmartSnapInput {
  tiles: readonly StackTile[];
  movingIds: ReadonlySet<string> | readonly string[];
  rawDx: number;
  rawDy: number;
  enabled: boolean;
  snapGapPx?: number;
  previousLocks?: SnapLocks;
  threshold?: number;
  releaseThreshold?: number;
}

interface Bounds {
  startX: number;
  centerX: number;
  endX: number;
  startY: number;
  centerY: number;
  endY: number;
}

interface SnapTarget {
  axis: SnapAxis;
  value: number;
  kind: SnapKind;
  label: string;
  sourceAnchors: readonly SnapAnchor[];
  targetIds: string[];
}

const KIND_PRIORITY: Record<SnapKind, number> = {
  gap: -0.1,
  seam: 0,
  center: 0.15,
  spacing: 0.28,
  stage: 0.34,
  edge: 0.46,
  track: 0.82,
};

function tileRadius(tile: StackTile): number {
  const halfSize = (STACK_STAGE.tileSize * tile.scale) / 2;
  const radians = (tile.rotation * Math.PI) / 180;
  return halfSize * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)));
}

function boundsFor(tiles: readonly StackTile[]): Bounds | null {
  if (tiles.length === 0) return null;
  let startX = Number.POSITIVE_INFINITY;
  let endX = Number.NEGATIVE_INFINITY;
  let startY = Number.POSITIVE_INFINITY;
  let endY = Number.NEGATIVE_INFINITY;
  for (const tile of tiles) {
    const radius = tileRadius(tile);
    startX = Math.min(startX, tile.x - radius);
    endX = Math.max(endX, tile.x + radius);
    startY = Math.min(startY, tile.y - radius);
    endY = Math.max(endY, tile.y + radius);
  }
  return {
    startX,
    centerX: (startX + endX) / 2,
    endX,
    startY,
    centerY: (startY + endY) / 2,
    endY,
  };
}

function anchorValue(bounds: Bounds, axis: SnapAxis, anchor: SnapAnchor, delta: number): number {
  if (axis === 'x') {
    return (anchor === 'start' ? bounds.startX : anchor === 'center' ? bounds.centerX : bounds.endX) + delta;
  }
  return (anchor === 'start' ? bounds.startY : anchor === 'center' ? bounds.centerY : bounds.endY) + delta;
}

function snapGapLabel(snapGapPx: number): string {
  return snapGapPx === DEFAULT_TAPTILE_SNAP_GAP_PX
    ? '默认缝隙 0px'
    : `吸附缝隙 ${formatTapTileSnapGapPx(snapGapPx)}`;
}

function addTileTargets(
  targets: SnapTarget[],
  tile: StackTile,
  sharesMovingLayer: boolean,
  snapGapPx: number,
  movingBounds: Bounds,
  rawDx: number,
  rawDy: number,
): void {
  const radius = tileRadius(tile);
  targets.push(
    {
      axis: 'x', value: tile.x, kind: 'center', label: '中心对齐', sourceAnchors: ['center'], targetIds: [tile.id],
    },
    {
      axis: 'y', value: tile.y, kind: 'center', label: '中心对齐', sourceAnchors: ['center'], targetIds: [tile.id],
    },
    {
      axis: 'x', value: tile.x - radius, kind: 'edge', label: '边缘对齐', sourceAnchors: ['start', 'end'], targetIds: [tile.id],
    },
    {
      axis: 'x', value: tile.x + radius, kind: 'edge', label: '边缘对齐', sourceAnchors: ['start', 'end'], targetIds: [tile.id],
    },
    {
      axis: 'y', value: tile.y - radius, kind: 'edge', label: '边缘对齐', sourceAnchors: ['start', 'end'], targetIds: [tile.id],
    },
    {
      axis: 'y', value: tile.y + radius, kind: 'edge', label: '边缘对齐', sourceAnchors: ['start', 'end'], targetIds: [tile.id],
    },
  );
  if (!sharesMovingLayer) return;
  const label = snapGapLabel(snapGapPx);
  const authoringGap = snapGapPx / TAPTILE_EXPORT_SCALE;
  const overlapsX = movingBounds.startX + rawDx < tile.x + radius
    && movingBounds.endX + rawDx > tile.x - radius;
  const overlapsY = movingBounds.startY + rawDy < tile.y + radius
    && movingBounds.endY + rawDy > tile.y - radius;
  if (overlapsY) {
    targets.push(
      {
        axis: 'x', value: tile.x - radius - authoringGap, kind: 'gap', label, sourceAnchors: ['end'], targetIds: [tile.id],
      },
      {
        axis: 'x', value: tile.x + radius + authoringGap, kind: 'gap', label, sourceAnchors: ['start'], targetIds: [tile.id],
      },
    );
  }
  if (overlapsX) {
    targets.push(
      {
        axis: 'y', value: tile.y - radius - authoringGap, kind: 'gap', label, sourceAnchors: ['end'], targetIds: [tile.id],
      },
      {
        axis: 'y', value: tile.y + radius + authoringGap, kind: 'gap', label, sourceAnchors: ['start'], targetIds: [tile.id],
      },
    );
  }
}

function addPairTargets(targets: SnapTarget[], tiles: readonly StackTile[]): void {
  for (let leftIndex = 0; leftIndex < tiles.length; leftIndex += 1) {
    const left = tiles[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < tiles.length; rightIndex += 1) {
      const right = tiles[rightIndex];
      if (!right) continue;
      const averageSize = (tileRadius(left) + tileRadius(right));
      const dx = Math.abs(left.x - right.x);
      const dy = Math.abs(left.y - right.y);
      const alignedTolerance = Math.max(10, averageSize * 0.2);
      const minimumStep = averageSize * 0.54;
      const maximumStep = averageSize * 1.46;
      const targetIds = [left.id, right.id];

      if (dy <= alignedTolerance && dx >= minimumStep && dx <= maximumStep) {
        const minimumX = Math.min(left.x, right.x);
        const maximumX = Math.max(left.x, right.x);
        targets.push(
          {
            axis: 'x', value: (left.x + right.x) / 2, kind: 'seam', label: '两牌中线', sourceAnchors: ['center'], targetIds,
          },
          {
            axis: 'x', value: minimumX - dx, kind: 'spacing', label: '等距轨道', sourceAnchors: ['center'], targetIds,
          },
          {
            axis: 'x', value: maximumX + dx, kind: 'spacing', label: '等距轨道', sourceAnchors: ['center'], targetIds,
          },
        );
      }

      if (dy <= alignedTolerance && dx > averageSize * 1.55 && dx <= averageSize * 2.8) {
        targets.push({
          axis: 'x', value: (left.x + right.x) / 2, kind: 'spacing', label: '等距插入', sourceAnchors: ['center'], targetIds,
        });
      }

      if (dx <= alignedTolerance && dy >= minimumStep && dy <= maximumStep) {
        const minimumY = Math.min(left.y, right.y);
        const maximumY = Math.max(left.y, right.y);
        targets.push(
          {
            axis: 'y', value: (left.y + right.y) / 2, kind: 'seam', label: '两牌中线', sourceAnchors: ['center'], targetIds,
          },
          {
            axis: 'y', value: minimumY - dy, kind: 'spacing', label: '等距轨道', sourceAnchors: ['center'], targetIds,
          },
          {
            axis: 'y', value: maximumY + dy, kind: 'spacing', label: '等距轨道', sourceAnchors: ['center'], targetIds,
          },
        );
      }


      if (dx <= alignedTolerance && dy > averageSize * 1.55 && dy <= averageSize * 2.8) {
        targets.push({
          axis: 'y', value: (left.y + right.y) / 2, kind: 'spacing', label: '等距插入', sourceAnchors: ['center'], targetIds,
        });
      }
    }
  }
}

function coalesceTargets(targets: readonly SnapTarget[]): SnapTarget[] {
  const merged: SnapTarget[] = [];
  for (const target of targets) {
    const match = merged.find((candidate) => candidate.axis === target.axis
      && candidate.kind === target.kind
      && Math.abs(candidate.value - target.value) < 0.25);
    if (!match) {
      merged.push({ ...target, targetIds: [...target.targetIds] });
      continue;
    }
    match.targetIds = [...new Set([...match.targetIds, ...target.targetIds])];
  }
  return merged;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  if (upper === undefined) return null;
  if (ordered.length % 2 === 1) return upper;
  const lower = ordered[middle - 1];
  return lower === undefined ? upper : (lower + upper) / 2;
}

function inferStep(tiles: readonly StackTile[], axis: SnapAxis): number {
  const values = tiles.map((tile) => axis === 'x' ? tile.x : tile.y).sort((left, right) => left - right);
  const differences: number[] = [];
  for (let index = 1; index < values.length; index += 1) {
    const before = values[index - 1];
    const after = values[index];
    if (before === undefined || after === undefined) continue;
    const difference = after - before;
    if (difference >= 38 && difference <= 86) differences.push(difference);
  }
  return median(differences) ?? (axis === 'x' ? 58 : 50);
}

function buildTargets(
  moving: readonly StackTile[],
  stationary: readonly StackTile[],
  bounds: Bounds,
  rawDx: number,
  rawDy: number,
  snapGapPx: number,
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const movingLayers = new Set(moving.map((tile) => tile.layer));
  for (const tile of stationary) {
    addTileTargets(targets, tile, movingLayers.has(tile.layer), snapGapPx, bounds, rawDx, rawDy);
  }
  addPairTargets(targets, stationary);

  const boardCenterY = (142 + (STACK_STAGE.height - 26)) / 2;
  targets.push(
    {
      axis: 'x', value: STACK_STAGE.width / 2, kind: 'stage', label: '画布中心', sourceAnchors: ['center'], targetIds: [],
    },
    {
      axis: 'y', value: boardCenterY, kind: 'stage', label: '画布中心', sourceAnchors: ['center'], targetIds: [],
    },
  );

  const xStep = inferStep(stationary, 'x');
  const yStep = inferStep(stationary, 'y');
  const rawCenterX = bounds.centerX + rawDx;
  const rawCenterY = bounds.centerY + rawDy;
  targets.push(
    {
      axis: 'x',
      value: STACK_STAGE.width / 2 + Math.round((rawCenterX - STACK_STAGE.width / 2) / xStep) * xStep,
      kind: 'track',
      label: '隐形轨道',
      sourceAnchors: ['center'],
      targetIds: [],
    },
    {
      axis: 'y',
      value: boardCenterY + Math.round((rawCenterY - boardCenterY) / yStep) * yStep,
      kind: 'track',
      label: '隐形轨道',
      sourceAnchors: ['center'],
      targetIds: [],
    },
  );
  return coalesceTargets(targets);
}

function retainLock(
  axis: SnapAxis,
  lock: SnapGuide | null,
  bounds: Bounds,
  delta: number,
  releaseThreshold: number,
): { guide: SnapGuide; correction: number } | null {
  if (!lock) return null;
  const current = anchorValue(bounds, axis, lock.sourceAnchor, delta);
  const correction = lock.value - current;
  return Math.abs(correction) <= releaseThreshold ? { guide: lock, correction } : null;
}

function findBestTarget(
  axis: SnapAxis,
  targets: readonly SnapTarget[],
  bounds: Bounds,
  delta: number,
  threshold: number,
): { guide: SnapGuide; correction: number; score: number } | null {
  let best: { guide: SnapGuide; correction: number; score: number } | null = null;
  for (const target of targets) {
    if (target.axis !== axis) continue;
    for (const sourceAnchor of target.sourceAnchors) {
      const current = anchorValue(bounds, axis, sourceAnchor, delta);
      const correction = target.value - current;
      if (Math.abs(correction) > threshold) continue;
      const score = Math.abs(correction) + KIND_PRIORITY[target.kind];
      if (best && best.score <= score) continue;
      best = {
        correction,
        score,
        guide: {
          axis,
          value: target.value,
          kind: target.kind,
          label: target.label,
          sourceAnchor,
          targetIds: target.targetIds,
        },
      };
    }
  }
  return best;
}

interface SameLayerCollision {
  moving: StackTile;
  stationary: StackTile;
  movingRadius: number;
  stationaryRadius: number;
}

interface GapCorrectionCandidate {
  dx: number;
  dy: number;
  guide: SnapGuide;
}

function sameLayerCollisions(
  moving: readonly StackTile[],
  stationary: readonly StackTile[],
  dx: number,
  dy: number,
  authoringGap: number,
): SameLayerCollision[] {
  const collisions: SameLayerCollision[] = [];
  for (const movingTile of moving) {
    const movingRadius = tileRadius(movingTile);
    for (const stationaryTile of stationary) {
      if (movingTile.layer !== stationaryTile.layer) continue;
      const stationaryRadius = tileRadius(stationaryTile);
      const minimumDistance = movingRadius + stationaryRadius + authoringGap;
      const distanceX = Math.abs(movingTile.x + dx - stationaryTile.x);
      const distanceY = Math.abs(movingTile.y + dy - stationaryTile.y);
      if (distanceX < minimumDistance - 0.001 && distanceY < minimumDistance - 0.001) {
        collisions.push({ moving: movingTile, stationary: stationaryTile, movingRadius, stationaryRadius });
      }
    }
  }
  return collisions;
}

function correctionCandidates(
  collision: SameLayerCollision,
  dx: number,
  dy: number,
  snapGapPx: number,
): GapCorrectionCandidate[] {
  const { moving, stationary, movingRadius, stationaryRadius } = collision;
  const authoringGap = snapGapPx / TAPTILE_EXPORT_SCALE;
  const distance = movingRadius + stationaryRadius + authoringGap;
  const label = snapGapLabel(snapGapPx);
  return [
    {
      dx: stationary.x - distance - moving.x,
      dy,
      guide: {
        axis: 'x',
        value: stationary.x - stationaryRadius - authoringGap,
        kind: 'gap',
        label,
        sourceAnchor: 'end',
        targetIds: [stationary.id],
      },
    },
    {
      dx: stationary.x + distance - moving.x,
      dy,
      guide: {
        axis: 'x',
        value: stationary.x + stationaryRadius + authoringGap,
        kind: 'gap',
        label,
        sourceAnchor: 'start',
        targetIds: [stationary.id],
      },
    },
    {
      dx,
      dy: stationary.y - distance - moving.y,
      guide: {
        axis: 'y',
        value: stationary.y - stationaryRadius - authoringGap,
        kind: 'gap',
        label,
        sourceAnchor: 'end',
        targetIds: [stationary.id],
      },
    },
    {
      dx,
      dy: stationary.y + distance - moving.y,
      guide: {
        axis: 'y',
        value: stationary.y + stationaryRadius + authoringGap,
        kind: 'gap',
        label,
        sourceAnchor: 'start',
        targetIds: [stationary.id],
      },
    },
  ];
}

function enforceSameLayerGap(
  moving: readonly StackTile[],
  stationary: readonly StackTile[],
  dx: number,
  dy: number,
  snapGapPx: number,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const authoringGap = snapGapPx / TAPTILE_EXPORT_SCALE;
  let resolvedDx = dx;
  let resolvedDy = dy;
  const guides = new Map<SnapAxis, SnapGuide>();
  const visited = new Set<string>();
  const maximumPasses = Math.max(1, Math.min(16, moving.length * stationary.length));

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const collisions = sameLayerCollisions(moving, stationary, resolvedDx, resolvedDy, authoringGap);
    if (collisions.length === 0) break;
    const collision = collisions[0];
    if (!collision) break;
    const candidates = correctionCandidates(collision, resolvedDx, resolvedDy, snapGapPx)
      .filter((candidate) => !visited.has(`${candidate.dx.toFixed(3)}:${candidate.dy.toFixed(3)}`))
      .map((candidate) => ({
        ...candidate,
        remaining: sameLayerCollisions(moving, stationary, candidate.dx, candidate.dy, authoringGap).length,
        movement: Math.hypot(candidate.dx - resolvedDx, candidate.dy - resolvedDy),
      }))
      .sort((left, right) => left.remaining - right.remaining || left.movement - right.movement);
    const best = candidates[0];
    if (!best) break;
    visited.add(`${best.dx.toFixed(3)}:${best.dy.toFixed(3)}`);
    resolvedDx = best.dx;
    resolvedDy = best.dy;
    guides.set(best.guide.axis, best.guide);
  }

  return { dx: resolvedDx, dy: resolvedDy, guides: [...guides.values()] };
}

export function solveSmartSnap(input: SmartSnapInput): SmartSnapResult {
  const movingIds = new Set(input.movingIds);
  const moving = input.tiles.filter((tile) => movingIds.has(tile.id));
  const stationary = input.tiles.filter((tile) => !movingIds.has(tile.id));
  const bounds = boundsFor(moving);
  const emptyLocks: SnapLocks = { x: null, y: null };
  if (!input.enabled || !bounds || stationary.length === 0) {
    return { dx: input.rawDx, dy: input.rawDy, guides: [], locks: emptyLocks, targetIds: [] };
  }

  const threshold = input.threshold ?? 8;
  const releaseThreshold = input.releaseThreshold ?? 16;
  const snapGapPx = normalizeTapTileSnapGapPx(input.snapGapPx ?? DEFAULT_TAPTILE_SNAP_GAP_PX);
  const targets = buildTargets(moving, stationary, bounds, input.rawDx, input.rawDy, snapGapPx);
  const previous = input.previousLocks ?? emptyLocks;
  const retainedX = retainLock('x', previous.x, bounds, input.rawDx, releaseThreshold);
  const retainedY = retainLock('y', previous.y, bounds, input.rawDy, releaseThreshold);
  const xMatch = retainedX ?? findBestTarget('x', targets, bounds, input.rawDx, threshold);
  const yMatch = retainedY ?? findBestTarget('y', targets, bounds, input.rawDy, threshold);
  let guides = [xMatch?.guide, yMatch?.guide].filter((guide): guide is SnapGuide => Boolean(guide));
  let dx = input.rawDx + (xMatch?.correction ?? 0);
  let dy = input.rawDy + (yMatch?.correction ?? 0);
  if (guides.length > 0) {
    const gapResolution = enforceSameLayerGap(moving, stationary, dx, dy, snapGapPx);
    dx = gapResolution.dx;
    dy = gapResolution.dy;
    for (const gapGuide of gapResolution.guides) {
      guides = [...guides.filter((guide) => guide.axis !== gapGuide.axis), gapGuide];
    }
  }
  const locks: SnapLocks = {
    x: guides.find((guide) => guide.axis === 'x') ?? null,
    y: guides.find((guide) => guide.axis === 'y') ?? null,
  };
  const targetIds = [...new Set(guides.flatMap((guide) => guide.targetIds))];

  return {
    dx,
    dy,
    guides,
    locks,
    targetIds,
  };
}
