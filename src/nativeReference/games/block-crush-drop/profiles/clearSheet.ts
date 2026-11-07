import type { BlockCrushDropCell } from '../types';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';

function smoothstep(value: number) {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

interface ClearSheetNode {
  id: string;
  subColumn: number;
  subRow: number;
  initialX: number;
  initialY: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  releaseStep: number;
}

interface ClearSheetPose {
  x: number;
  y: number;
  rotationZ: number;
  releaseAge: number;
  velocityX: number;
  velocityY: number;
}

/**
 * Deterministic position-based sheet used only between semantic clear and row
 * compaction endpoints. The source breaks every logical cell into a 2x2
 * lattice, releases columns from left to right, and keeps local neighbours
 * constrained long enough to form a dense folding band instead of particles.
 */
export function simulateClearSheet(
  eliminatedCells: BlockCrushDropCell[],
  eliminatedRows: number[],
  columns: number,
  motionProgress: number,
  appearance: NonNullable<BlockCrushDropPresentationFrame['lingeringClear']>['fragmentAppearance'],
  rowStaggerProgress = 0,
  releaseFront: {
    origin: 'left' | 'center' | 'edges';
    steps: number;
    tearAfterSteps?: number;
    subdivisions?: number;
  } = { origin: 'left', steps: 24 },
): Map<string, ClearSheetPose> {
  const subdivisions = releaseFront.subdivisions ?? 2;
  const fragmentPitch = 1 / subdivisions;
  const subColumns = columns * subdivisions;
  const rowIndexByY = new Map(eliminatedRows.map((row, index) => [row, index]));
  const nodes: ClearSheetNode[] = [];
  const nodeIndex = new Map<string, number>();
  for (const cell of eliminatedCells) {
    const logicalRow = rowIndexByY.get(cell.y);
    if (logicalRow === undefined) continue;
    for (let fragmentY = 0; fragmentY < subdivisions; fragmentY += 1) {
      for (let fragmentX = 0; fragmentX < subdivisions; fragmentX += 1) {
        const id = `${cell.id}:fragment-${fragmentX}-${fragmentY}`;
        const subColumn = cell.x * subdivisions + fragmentX;
        const subRow = logicalRow * subdivisions + fragmentY;
        const x = cell.x + (fragmentX + 0.5) * fragmentPitch - 0.5;
        const y = cell.y + (fragmentY + 0.5) * fragmentPitch - 0.5;
        nodeIndex.set(`${subColumn}:${subRow}`, nodes.length);
        nodes.push({
          id,
          subColumn,
          subRow,
          initialX: x,
          initialY: y,
          x,
          y,
          previousX: x,
          previousY: y,
          // Source f80-f105: the release front crosses 36 sub-columns in
          // about 25 frames, with the first column moving immediately.
          releaseStep:
            1 +
            Math.round(
              releaseFront.steps *
                (releaseFront.origin === 'center'
                  ? Math.abs(subColumn / Math.max(1, subColumns - 1) - 0.5) * 2
                  : releaseFront.origin === 'edges'
                    ? 1 - Math.abs(subColumn / Math.max(1, subColumns - 1) - 0.5) * 2
                    : subColumn / Math.max(1, subColumns - 1)),
            ) +
            Math.round(26 * logicalRow * Math.max(0, Math.min(1, rowStaggerProgress))),
        });
      }
    }
  }

  const constraints: Array<[number, number, number]> = [];
  for (const node of nodes) {
    const current = nodeIndex.get(`${node.subColumn}:${node.subRow}`)!;
    const right = nodeIndex.get(`${node.subColumn + 1}:${node.subRow}`);
    const above = nodeIndex.get(`${node.subColumn}:${node.subRow + 1}`);
    const diagonal = nodeIndex.get(`${node.subColumn + 1}:${node.subRow + 1}`);
    if (right !== undefined) constraints.push([current, right, fragmentPitch]);
    if (above !== undefined) constraints.push([current, above, fragmentPitch]);
    if (diagonal !== undefined) constraints.push([current, diagonal, Math.SQRT2 * fragmentPitch]);
  }

  // Both source events use the same physical cadence; the second event's
  // authored motion curve already maps its longer lifetime onto this clock.
  const simulationSteps = Math.max(0, Math.round(motionProgress * 55));
  // The source ribbon remains tightly connected through the release-front
  // crossing, then loosens over four canonical steps as the collision plume
  // begins. A fixed low iteration count tears too early; keeping the high
  // count for the whole lifetime leaves the tail visibly over-constrained.
  const constraintIterations =
    simulationSteps <= 30
      ? 8
      : appearance?.relaxConstraintsAfterMotionStep !== undefined &&
          appearance.relaxedConstraintIterations !== undefined &&
          simulationSteps > appearance.relaxConstraintsAfterMotionStep
        ? appearance.relaxedConstraintIterations
        : Math.max(4, 8 - (simulationSteps - 30));
  // Source-track A/B: while the release front is crossing the first half of
  // the row, surviving features travel farther left but stay roughly one cell
  // higher than the original solve. Fade this calibration back before the
  // collision fold; extending it through steps 26-33 improves area but lowers
  // same-frame SSIM at f105/f109.
  const earlyReleaseCalibration = 1 - smoothstep((simulationSteps - 18) / 10);
  for (let step = 1; step <= simulationSteps; step += 1) {
    for (const node of nodes) {
      if (step < node.releaseStep) {
        node.x = node.initialX;
        node.y = node.initialY;
        node.previousX = node.initialX;
        node.previousY = node.initialY;
        continue;
      }
      const position = node.subColumn / Math.max(1, subColumns - 1);
      const xNormal =
        releaseFront.origin === 'center'
          ? Math.abs(position - 0.5) * 2
          : releaseFront.origin === 'edges'
            ? 1 - Math.abs(position - 0.5) * 2
            : position;
      const velocityX =
        step === node.releaseStep
          ? releaseFront.origin === 'left'
            ? 0.04 - (0.22 + 0.08 * earlyReleaseCalibration) * (1 - xNormal)
            : (0.5 - position) * 0.25
          : (node.x - node.previousX) * 0.93;
      const velocityY =
        step === node.releaseStep
          ? -(0.25 - 0.1 * earlyReleaseCalibration) -
            (0.35 - 0.07 * earlyReleaseCalibration) * (1 - xNormal)
          : (node.y - node.previousY) * 0.93;
      node.previousX = node.x;
      node.previousY = node.y;
      node.x += velocityX;
      // The measured source fold receives a sharp downward release impulse,
      // then travels at a bounded speed: it is already five-to-six cells below
      // the band around f95 but remains visible around f121. Constant strong
      // acceleration incorrectly throws the whole sheet beyond the board.
      node.y +=
        velocityY -
        (0.012 - 0.004 * earlyReleaseCalibration) -
        (0.053 - 0.018 * earlyReleaseCalibration) * Math.pow(1 - xNormal, 1.5);
    }

    // The adaptive constraint budget preserves the connected ribbon while
    // the authored horizontal rest length controls how broadly it unfolds.
    for (let iteration = 0; iteration < constraintIterations; iteration += 1) {
      for (const [leftIndex, rightIndex, restLength] of constraints) {
        const left = nodes[leftIndex]!;
        const right = nodes[rightIndex]!;
        if (
          releaseFront.tearAfterSteps !== undefined &&
          step - Math.max(left.releaseStep, right.releaseStep) > releaseFront.tearAfterSteps
        )
          continue;
        const leftPinned = step < left.releaseStep;
        const rightPinned = step < right.releaseStep;
        if (leftPinned && rightPinned) continue;
        const deltaX = right.x - left.x;
        const deltaY = right.y - left.y;
        const distance = Math.max(0.0001, Math.hypot(deltaX, deltaY));
        const correction = (distance - restLength) / distance;
        const correctionX = deltaX * correction;
        const correctionY = deltaY * correction;
        if (leftPinned) {
          right.x -= correctionX;
          right.y -= correctionY;
        } else if (rightPinned) {
          left.x += correctionX;
          left.y += correctionY;
        } else {
          left.x += correctionX * 0.5;
          left.y += correctionY * 0.5;
          right.x -= correctionX * 0.5;
          right.y -= correctionY * 0.5;
        }
      }
      for (const node of nodes) {
        if (step >= node.releaseStep) continue;
        node.x = node.initialX;
        node.y = node.initialY;
      }
    }
  }

  const poses = new Map<string, ClearSheetPose>();
  for (const node of nodes) {
    const neighbourIndex =
      nodeIndex.get(`${Math.min(subColumns - 1, node.subColumn + 1)}:${node.subRow}`) ??
      nodeIndex.get(`${Math.max(0, node.subColumn - 1)}:${node.subRow}`);
    const neighbour = neighbourIndex === undefined ? node : nodes[neighbourIndex]!;
    const direction = neighbour.subColumn >= node.subColumn ? 1 : -1;
    const releaseAge = Math.max(0, Math.min(1, (simulationSteps - node.releaseStep + 1) / 18));
    poses.set(node.id, {
      x: node.x,
      y: node.y,
      rotationZ: Math.atan2((neighbour.y - node.y) * direction, (neighbour.x - node.x) * direction),
      releaseAge,
      velocityX: node.x - node.previousX,
      velocityY: node.y - node.previousY,
    });
  }
  return poses;
}
