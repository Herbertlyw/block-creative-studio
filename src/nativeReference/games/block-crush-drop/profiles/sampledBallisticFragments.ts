import type { DropReferenceCalibration } from './referenceCalibration';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';
import { calibratedFragmentDisplaySeconds } from './localFragmentDetach';
import { calibratedFragmentPhysicsPose } from './fragmentPhysics';
import { calibratedFragmentSeed } from './fragmentSeed';
import { calibratedBallisticFragmentElapsedSeconds } from './ballisticFragmentAgeOffset';
import {
  calibratedFieldRiseCompensation,
  calibratedFieldRiseTick,
  calibratedVisualFieldRise,
} from '../render/calibratedFieldRise';

/** Limited plain ballistic screen-pixel sampling, not a whole-scene clock. */
export function calibratedSampledBallisticFragments(
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
) {
  const cue = f.lingeringClear,
    e = a.clear,
    physics = e?.fragmentPhysics;
  if (!cue || !e) return [];
  if (
    e.motionModel !== 'ballistic' ||
    !physics ||
    (e.fragmentGeometry !== 'rounded-cube' && e.fragmentGeometry !== 'rounded-polyhedron') ||
    physics.sheetDetachSeconds !== undefined ||
    physics.sheetDetachAfterReleaseSeconds !== undefined ||
    e.layeredCurve ||
    e.fragmentDepthRenderer ||
    e.fragmentPerspectiveCamera ||
    (e.fragmentDepthLayers !== undefined && e.fragmentDepthLayers !== 1) ||
    e.prefractureRefineSeconds !== undefined
  )
    throw new Error('DROP_FRAGMENT_DISPLAY_PLAIN_BALLISTIC_UNSUPPORTED');
  if (
    cue.observedFragmentMotion ||
    cue.observedFragmentMotionV2 ||
    a.observedFragmentMotionCues?.length
  )
    throw new Error('DROP_FRAGMENT_DISPLAY_OBSERVED_MOTION_CONFLICT');
  const ids = new Set(cue.eliminatedCells.map((c) => c.id));
  if (f.lateMovementOffsets?.some((o) => ids.has(o.id) && (o.x !== 0 || o.y !== 0)))
    throw new Error('DROP_FRAGMENT_DISPLAY_BIRTH_ANCHOR_LATE_MOVEMENT_UNSUPPORTED');
  const n = e.subdivisions,
    b = a.board,
    scale = b.verticalScale ?? 1,
    columns = f.before.config.columns;
  const sampledSeconds = calibratedFragmentDisplaySeconds(
    cue.elapsedFrames / f.fps,
    e.fragmentDisplayFps,
    e.fragmentDisplayPhaseSeconds,
  );
  const cueStart = calibratedFieldRiseTick(f) - (cue.elapsedFrames * 30) / f.fps,
    visualRise = calibratedVisualFieldRise(f, a),
    compensation = calibratedFieldRiseCompensation(f, a, cueStart);
  const frontDistance = (u: number) =>
    e.frontOrigin === 'right'
      ? 1 - u
      : e.frontOrigin === 'center'
        ? Math.abs(u - 0.5) * 2
        : e.frontOrigin === 'edges'
          ? 1 - Math.abs(u - 0.5) * 2
          : u;
  const poses = [];
  for (const cell of [...cue.eliminatedCells].sort((l, r) => r.y - l.y || l.x - r.x)) {
    const motherX = b.x + cell.x * b.cell,
      logicalY = b.y + (f.before.config.rows - 1 - cell.y - visualRise) * b.cell;
    // The cue's native row basis and full field-clock delta cancel current
    // scrolling. No live rise term is added after this screen-space birth anchor.
    const lightingY = b.y + (logicalY + b.cell / 2 - b.y) * scale + compensation * b.cell * scale;
    const motherY = lightingY - (b.cell * scale) / 2;
    for (let iy = 0; iy < n; iy++)
      for (let ix = 0; ix < n; ix++) {
        const id = `${cell.id}:fragment-${ix}-${iy}`,
          seedX = calibratedFragmentSeed(id),
          seedY = calibratedFragmentSeed(id + ':vertical');
        const x = motherX + ((ix + 0.5) * b.cell) / n,
          y = lightingY - (b.cell * scale) / 2 + (((iy + 0.5) * b.cell) / n) * scale;
        const u = Math.max(0, Math.min(1, (x - b.x) / (b.cell * columns))),
          releaseSeconds = Math.pow(frontDistance(u), 1 / (e.frontExponent ?? 1)) * e.frontSeconds;
        const freeSize =
          (b.cell / n) * (e.fragmentScale ?? 1.1) * (1 + (e.sizeSpread ?? 0) * (2 * seedX - 1));
        const elapsedSeconds = calibratedBallisticFragmentElapsedSeconds(
          sampledSeconds,
          releaseSeconds,
          e.fragmentAgeOffsetSeconds,
        );
        const pose = calibratedFragmentPhysicsPose({
          elapsedSeconds,
          releaseSeconds,
          x,
          y,
          size: freeSize,
          seedX,
          seedY,
          physics,
        });
        poses.push({
          ...pose,
          size: pose.released ? freeSize : (b.cell / n) * (e.prefractureScale ?? 1),
          id,
          cell,
          ix,
          iy,
          seedX,
          seedY,
          releaseSeconds,
          sampledSeconds,
          angle: pose.age * (seedX - 0.5) * 0.65,
          rotationAge: pose.released ? pose.age * (e.fragmentCubeRotationAgeScale ?? 1) : 0,
          motherX,
          motherY,
          lightingY,
        });
      }
  }
  return poses;
}
