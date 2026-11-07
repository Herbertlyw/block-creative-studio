/** Compact screen-space contour keys for one genuine native clear band. */
export interface DropLayeredCurve {
  keys: Array<{
    seconds: number;
    centerDropPixels: number;
    midDropPixels: number;
    edgeDropPixels: number;
    centerThickness?: number;
    midThickness?: number;
    edgeThickness?: number;
  }>;
  frontSeconds: number;
  thicknessGrowth: number;
  horizontalCompression: number;
  scatterPixels: number;
  /** A second, initially occluded volume slice; native clear identities stay unchanged. */
  depthLayers?: 1 | 2;
  /** Measured source-band row span used for absolute thickness growth across waves. */
  referenceBandRows?: number;
  /** Rear-only horizontal staggering in output pixels, gradually revealed from zero. */
  depthStaggerPixels?: number;
  /** Rear-only interpolation toward an independent rotation hash; default 0. */
  depthRotationSpread?: number;
  /** Independent vertical offsets in fractions of one expanded course step; endpoints stay pinned. */
  rowStagger?: number;
  /** Relative fragment-size growth over the existing .12–.40 second reveal; default 0. */
  sizeGrowth?: number;
  /** Measured band-origin corrections in output pixels, scoped to native waves. */
  waveOriginOffsets?: Array<{ actionIndex: number; cycleIndex: number; offsetY: number }>;
}

export interface DropLayeredCurveCell {
  id: string;
  x: number;
  y: number;
}
export interface DropLayeredCurvePoseInput {
  curve: DropLayeredCurve;
  elapsedSeconds: number;
  /** Cell upper-left corners already converted to output screen pixels. */
  cells: readonly DropLayeredCurveCell[];
  boardX: number;
  columns: number;
  cellWidth: number;
  cellHeight: number;
  subdivisions: number;
  fragmentScale?: number;
  prefractureScale?: number;
  rotationAgeScale?: number;
  frontOrigin?: 'left' | 'right' | 'center' | 'edges';
  exitY?: number;
}
export interface DropLayeredCurveFragmentPose {
  id: string;
  cellId: string;
  ix: number;
  iy: number;
  latticeRow: number;
  latticeColumn: number;
  x: number;
  y: number;
  size: number;
  age: number;
  rotationAge: number;
  rotationZ: number;
  released: boolean;
  releaseSeconds: number;
  thickness: number;
  rowNormalized: number;
  seedX: number;
  seedY: number;
  alpha: 0 | 1;
  visible: boolean;
  /** Omitted by the original single-slice profile to preserve its pose contract. */
  depthIndex?: 0 | 1;
  /** Optional rear rotation variation; seedX/seedY continue owning physical scatter. */
  rotationSeed?: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smoothstep = (value: number) => {
  const u = clamp(value);
  return u * u * (3 - 2 * u);
};
/** C¹ center/mid/edge contour, with zero edge tangents and no overshoot. */
export function calibratedLayeredCurveAcross(
  center: number,
  middle: number,
  edge: number,
  distance: number,
) {
  const d = clamp(distance),
    left = (middle - center) * 2,
    right = (edge - middle) * 2;
  const middleSlope = left * right > 0 ? (2 * left * right) / (left + right) : 0;
  const second = d > 0.5,
    u = (d - (second ? 0.5 : 0)) * 2,
    u2 = u * u,
    u3 = u2 * u;
  const start = second ? middle : center,
    end = second ? edge : middle,
    startSlope = second ? middleSlope : 0,
    endSlope = second ? 0 : middleSlope;
  return (
    (2 * u3 - 3 * u2 + 1) * start +
    (u3 - 2 * u2 + u) * 0.5 * startSlope +
    (-2 * u3 + 3 * u2) * end +
    (u3 - u2) * 0.5 * endSlope
  );
}
function seed(id: string) {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Clamped linear interpolation, including random access before/after the keys. */
export function calibratedLayeredCurveDrops(curve: DropLayeredCurve, seconds: number) {
  const keys = curve.keys;
  if (!keys.length) throw new Error('DROP_LAYERED_CURVE_KEYS_REQUIRED');
  const next = keys.findIndex((key) => key.seconds >= seconds);
  const end = keys[next < 0 ? keys.length - 1 : next]!;
  const start = keys[Math.max(0, (next < 0 ? keys.length - 1 : next) - 1)]!;
  const u =
    end.seconds === start.seconds
      ? 0
      : clamp((seconds - start.seconds) / (end.seconds - start.seconds));
  return {
    centerDropPixels: start.centerDropPixels + (end.centerDropPixels - start.centerDropPixels) * u,
    midDropPixels: start.midDropPixels + (end.midDropPixels - start.midDropPixels) * u,
    edgeDropPixels: start.edgeDropPixels + (end.edgeDropPixels - start.edgeDropPixels) * u,
    ...(start.centerThickness === undefined
      ? {}
      : {
          centerThickness:
            start.centerThickness + (end.centerThickness! - start.centerThickness) * u,
          midThickness: start.midThickness! + (end.midThickness! - start.midThickness!) * u,
          edgeThickness: start.edgeThickness! + (end.edgeThickness! - start.edgeThickness!) * u,
        }),
  };
}

/** No stepping state, lifetime fade, synthetic native cells, or source-video pixels. */
export function calibratedLayeredCurvePoses(
  input: DropLayeredCurvePoseInput,
): DropLayeredCurveFragmentPose[] {
  const { curve, cells, cellWidth, cellHeight, columns } = input,
    n = input.subdivisions;
  if (!cells.length) return [];
  if (!Number.isInteger(n) || n < 2 || cellWidth <= 0 || cellHeight <= 0 || columns < 1)
    throw new Error('DROP_LAYERED_CURVE_GRID_INVALID');
  if (
    (curve.depthLayers !== undefined && curve.depthLayers !== 1 && curve.depthLayers !== 2) ||
    (curve.referenceBandRows !== undefined &&
      (!Number.isInteger(curve.referenceBandRows) ||
        curve.referenceBandRows < 1 ||
        curve.referenceBandRows > 28))
  )
    throw new Error('DROP_LAYERED_CURVE_DEPTH_INVALID');
  if (
    (curve.depthStaggerPixels !== undefined &&
      (!Number.isFinite(curve.depthStaggerPixels) ||
        curve.depthStaggerPixels < 0 ||
        curve.depthStaggerPixels > 150)) ||
    (curve.depthRotationSpread !== undefined &&
      (!Number.isFinite(curve.depthRotationSpread) ||
        curve.depthRotationSpread < 0 ||
        curve.depthRotationSpread > 1))
  )
    throw new Error('DROP_LAYERED_CURVE_DEPTH_VARIATION_INVALID');
  if (
    (curve.rowStagger !== undefined &&
      (!Number.isFinite(curve.rowStagger) || curve.rowStagger < 0 || curve.rowStagger > 0.45)) ||
    (curve.sizeGrowth !== undefined &&
      (!Number.isFinite(curve.sizeGrowth) || curve.sizeGrowth < 0 || curve.sizeGrowth > 0.3))
  )
    throw new Error('DROP_LAYERED_CURVE_COURSE_VARIATION_INVALID');
  const bandTop = Math.min(...cells.map((cell) => cell.y));
  const bandBottom = Math.max(...cells.map((cell) => cell.y));
  const rowCount = Math.round((bandBottom - bandTop) / cellHeight) + 1;
  const depthLayers = curve.depthLayers ?? 1,
    baseRows = rowCount * n,
    step = cellHeight / n;
  const initialSpan = (baseRows - 1) * step,
    referenceSpan = ((curve.referenceBandRows ?? rowCount) * n - 1) * step;
  const subColumns = columns * n,
    width = cellWidth * columns,
    mid = input.boardX + width / 2,
    verticalScale = cellHeight / cellWidth;
  const fragmentSize = (cellWidth / n) * (input.fragmentScale ?? 1);
  // All three contour samples describe one shared source instant. The release
  // front delays rotation/thickening/scatter, never the measured contour again.
  const drops = calibratedLayeredCurveDrops(curve, input.elapsedSeconds);
  const distance = (u: number) =>
    input.frontOrigin === 'center'
      ? Math.abs(u - 0.5) * 2
      : input.frontOrigin === 'edges'
        ? 1 - Math.abs(u - 0.5) * 2
        : input.frontOrigin === 'right'
          ? 1 - u
          : u;
  const position = (column: number, row: number, depthIndex: 0 | 1) => {
    const u = clamp((column + 0.5) / subColumns),
      d = Math.abs(u - 0.5) * 2;
    const releaseSeconds = distance(u) * curve.frontSeconds,
      age = Math.max(0, input.elapsedSeconds - releaseSeconds);
    const dy = calibratedLayeredCurveAcross(
      drops.centerDropPixels,
      drops.midDropPixels,
      drops.edgeDropPixels,
      d,
    );
    const originalRowNormalized = row / Math.max(1, baseRows - 1),
      thickness =
        drops.centerThickness === undefined
          ? 1 + curve.thicknessGrowth * age * age
          : calibratedLayeredCurveAcross(
              drops.centerThickness,
              drops.midThickness!,
              drops.edgeThickness!,
              d,
            );
    // Preserve the original arithmetic exactly unless one of the new volume
    // controls is used. In particular, old row gaps and painter order survive.
    let rowNormalized = originalRowNormalized,
      y = bandTop + (((row + 0.5) * cellHeight) / n) * thickness + dy;
    if (depthLayers === 2 || curve.referenceBandRows !== undefined) {
      const targetSpan = initialSpan + referenceSpan * (thickness - 1),
        expandedRows = baseRows * depthLayers;
      const expandedNormalized = (row * depthLayers + depthIndex) / Math.max(1, expandedRows - 1);
      const reveal = depthLayers === 2 ? smoothstep((age - 0.12) / 0.28) : 1;
      const baseOffset = row * step,
        expandedOffset = expandedNormalized * targetSpan;
      rowNormalized = originalRowNormalized + (expandedNormalized - originalRowNormalized) * reveal;
      y =
        bandTop + 0.5 * step * thickness + baseOffset + (expandedOffset - baseOffset) * reveal + dy;
    }
    const originalX = input.boardX + ((column + 0.5) * cellWidth) / n;
    return {
      x:
        mid +
        (originalX - mid) * (1 - Math.min(0.25, age * curve.horizontalCompression) * rowNormalized),
      y,
      age,
      releaseSeconds,
      thickness,
      rowNormalized,
    };
  };
  const result: DropLayeredCurveFragmentPose[] = [];
  // Sorting by screen Y makes the lattice and painter order independent of the
  // game's bottom-origin row coordinates and the input cell-array ordering.
  const sortedCells = [...cells].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  // Paint every rear slice first. A co-projected front slice then completely
  // hides it at reveal=0, including across neighboring mother-tile boundaries.
  const depths: readonly (0 | 1)[] = depthLayers === 2 ? [1, 0] : [0];
  for (const depthIndex of depths)
    for (const cell of sortedCells) {
      const cellColumn = Math.round((cell.x - input.boardX) / cellWidth),
        cellRow = Math.round((cell.y - bandTop) / cellHeight);
      for (let iy = 0; iy < n; iy++)
        for (let ix = 0; ix < n; ix++) {
          const column = cellColumn * n + ix,
            row = cellRow * n + iy,
            frontId = `${cell.id}:fragment-${ix}-${iy}`,
            id = depthIndex === 0 ? frontId : `${frontId}:depth-1`;
          const p = position(column, row, depthIndex),
            left = position(Math.max(0, column - 1), row, depthIndex),
            right = position(Math.min(subColumns - 1, column + 1), row, depthIndex);
          const reveal = smoothstep((p.age - 0.12) / 0.28),
            baseSize = p.age === 0 ? (cellWidth / n) * (input.prefractureScale ?? 1) : fragmentSize;
          const size =
              (curve.sizeGrowth ?? 0) > 0 && reveal > 0
                ? baseSize * (1 + curve.sizeGrowth! * reveal)
                : baseSize,
            radius = (Math.sqrt(3) / 2) * size * verticalScale;
          // Matching seeds make the rear/front silhouettes exactly co-projected
          // before reveal; their stable IDs still distinguish the volume slices.
          const seedX = seed(frontId),
            seedY = seed(frontId + ':vertical'),
            scatter = curve.scatterPixels * (1 - Math.exp(-Math.max(0, p.age - 0.08) * 5));
          const rearX =
            depthIndex === 1 && (curve.depthStaggerPixels ?? 0) > 0
              ? (seed(id + ':horizontal') - 0.5) * curve.depthStaggerPixels! * reveal
              : 0;
          // Perturb interior ranks, never add particles or fill missing mother rows.
          // At most .45 of an expanded step prevents adjacent ranks from crossing;
          // rank 0/last remain exact anchors of the measured center envelope. Shared
          // pre-existing physical scatter is deliberately not re-clamped here.
          const rank = row * depthLayers + depthIndex,
            lastRank = baseRows * depthLayers - 1;
          const span =
            depthLayers === 2 || curve.referenceBandRows !== undefined
              ? initialSpan + referenceSpan * (p.thickness - 1)
              : initialSpan * p.thickness;
          const rowOffset =
            (curve.rowStagger ?? 0) > 0 && rank > 0 && rank < lastRank && reveal > 0
              ? (((seed(id + ':course') * 2 - 1) * curve.rowStagger! * span) /
                  Math.max(1, lastRank)) *
                reveal
              : 0;
          const originalX = p.x + (seedX - 0.5) * scatter,
            x = rearX === 0 ? originalX : originalX + rearX,
            originalY = p.y + (seedY - 0.5) * scatter,
            y = rowOffset === 0 ? originalY : originalY + rowOffset;
          const rotationSeed =
            depthIndex === 1 && (curve.depthRotationSpread ?? 0) > 0
              ? seedX + (seed(id + ':rotation') - seedX) * reveal * curve.depthRotationSpread!
              : undefined;
          // The caller retains its board transform, so express the curve tangent in
          // that logical coordinate space; its screen projection follows the band.
          const rotationZ = Math.atan2((right.y - left.y) / verticalScale, right.x - left.x);
          const visible = y - radius <= (input.exitY ?? 1920);
          result.push({
            id,
            cellId: cell.id,
            ix,
            iy,
            latticeRow: row,
            latticeColumn: column,
            x,
            y,
            size,
            age: p.age,
            rotationAge: Math.min(1, p.age) * (input.rotationAgeScale ?? 1),
            rotationZ,
            released: input.elapsedSeconds >= p.releaseSeconds,
            releaseSeconds: p.releaseSeconds,
            thickness: p.thickness,
            rowNormalized: p.rowNormalized,
            seedX,
            seedY,
            alpha: visible ? 1 : 0,
            visible,
            ...(depthLayers === 2 ? { depthIndex } : {}),
            ...(rotationSeed === undefined ? {} : { rotationSeed }),
          });
        }
    }
  return result;
}
