import type { DropReferenceCalibration } from './referenceCalibration';
import type { BlockCrushDropPresentationFrame } from '../presentation/presentationAdapter';
import {
  calibratedFragmentDisplayMaximumLag,
  calibratedFragmentDisplaySeconds,
  localFragmentDetachPose,
  localSheetReleaseSeconds,
  localSupportHermite,
  localSupportLift,
} from './localFragmentDetach';
import { calibratedFragmentFlightSeconds } from './fragmentPhysics';
import { simulateClearSheet } from './clearSheet';
import { calibratedFragmentSeed } from './fragmentSeed';
import {
  calibratedFieldRiseCompensation,
  calibratedFieldRiseTick,
  calibratedVisualFieldRise,
} from '../render/calibratedFieldRise';
import { frontLiftFalloffPixels } from './frontLiftFalloff';

type Sheet = ReturnType<typeof simulateClearSheet>;
const cache = new Map<string, Map<number, Sheet>>();
const order = new Map<string, { wave: string; step: number; count: number }>();
let cachedPoses = 0;
const MAX_CACHED_POSES = 100000;
/** Analysis/regression reset only; no mutable integration state is cached. */
export function clearLocalDetachSheetCache() {
  cache.clear();
  order.clear();
  cachedPoses = 0;
}
export function localDetachSheetCacheStats() {
  return { cachedPoses, maxCachedPoses: MAX_CACHED_POSES, steps: order.size };
}
const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const smooth = (u: number) => {
  const q = Math.max(0, Math.min(1, u));
  return q * q * (3 - 2 * q);
};
const smoothDerivative = (u: number, d: number) => (u > 0 && u < 1 ? (6 * u * (1 - u)) / d : 0);

/** Native identities and native sheet samples; only the support clock is continuous. */
export function calibratedLocalDetachFragments(
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
) {
  const cue = f.lingeringClear,
    e = a.clear,
    physics = e?.fragmentPhysics;
  if (
    e?.fragmentDisplayFps !== undefined &&
    (e.motionModel !== 'constrained-sheet' || physics?.sheetDetachAfterReleaseSeconds === undefined)
  )
    throw new Error('DROP_FRAGMENT_DISPLAY_CLOCK_REQUIRES_LOCAL_SUPPORT');
  if (!cue || !e || physics?.sheetDetachAfterReleaseSeconds === undefined) return [];
  if ((e.fragmentAgeOffsetSeconds ?? 0) !== 0)
    throw new Error('DROP_LOCAL_DETACH_FRAGMENT_AGE_OFFSET_UNSUPPORTED');
  if (e.motionModel !== 'constrained-sheet')
    throw new Error('DROP_LOCAL_DETACH_REQUIRES_CONSTRAINED_SHEET');
  if (
    cue.observedFragmentMotion ||
    cue.observedFragmentMotionV2 ||
    a.observedFragmentMotionCues?.length
  )
    throw new Error('DROP_LOCAL_DETACH_OBSERVED_MOTION_CONFLICT');
  const n = e.subdivisions,
    columns = f.before.config.columns,
    rate = e.sheetMotionRate ?? 1,
    stepSeconds = 1 / (30 * rate),
    t = calibratedFragmentDisplaySeconds(
      cue.elapsedFrames / f.fps,
      e.fragmentDisplayFps,
      e.fragmentDisplayPhaseSeconds,
    );
  const b = a.board,
    scale = b.verticalScale ?? 1,
    rows = [...new Set(cue.eliminatedCells.map((c) => c.y))].sort((l, r) => l - r);
  const mirrored = e.frontOrigin === 'right',
    origin = e.frontOrigin === 'right' ? 'left' : (e.frontOrigin ?? 'left');
  const cells = mirrored
    ? cue.eliminatedCells.map((c) => ({ ...c, x: columns - 1 - c.x }))
    : cue.eliminatedCells;
  const frontSteps = Math.round(e.frontSeconds * 30 * rate);
  const key = JSON.stringify([
    cells.map((c) => [c.id, c.x, c.y]),
    rows,
    columns,
    n,
    origin,
    frontSteps,
    e.sheetTearSeconds ?? null,
    rate,
  ]);
  const raw = (step: number): Sheet => {
    const k = Math.max(0, step),
      token = key + '|' + k;
    const found = cache.get(key)?.get(k);
    if (found) {
      const record = order.get(token)!;
      order.delete(token);
      order.set(token, record);
      return found;
    }
    const result = simulateClearSheet(cells, rows, columns, k / 55, undefined, 0, {
      origin,
      steps: frontSteps,
      subdivisions: n,
      ...(e.sheetTearSeconds === undefined
        ? {}
        : { tearAfterSteps: e.sheetTearSeconds * 30 * rate }),
    });
    if (result.size <= MAX_CACHED_POSES) {
      while (cachedPoses + result.size > MAX_CACHED_POSES && order.size) {
        const [old, entry] = order.entries().next().value!;
        order.delete(old);
        cachedPoses -= entry.count;
        const wave = cache.get(entry.wave)!;
        wave.delete(entry.step);
        if (!wave.size) cache.delete(entry.wave);
      }
      const wave = cache.get(key) ?? new Map<number, Sheet>();
      wave.set(k, result);
      cache.set(key, wave);
      cachedPoses += result.size;
      order.set(token, { wave: key, step: k, count: result.size });
    }
    return result;
  };
  const cueStart = calibratedFieldRiseTick(f) - (cue.elapsedFrames * 30) / f.fps;
  const compensation = calibratedFieldRiseCompensation(f, a, cueStart);
  const riseDown = (seconds: number) =>
    -(compensation - calibratedFieldRiseCompensation(f, a, cueStart + seconds * 30)) *
    b.cell *
    scale;
  const riseVelocity = (seconds: number) => {
    const delta = 1e-4;
    return (riseDown(seconds + delta) - riseDown(seconds - delta)) / (2 * delta);
  };
  const angles = new Map<string, Map<number, number>>();
  const unwrapped = (id: string, step: number, start: number) => {
    const first = Math.round(start / stepSeconds),
      k = Math.max(first, step),
      token = id + '|' + first;
    const values = angles.get(token) ?? new Map<number, number>([[first, 0]]);
    angles.set(token, values);
    let last = Math.max(...values.keys());
    while (last < k) {
      values.set(
        last + 1,
        values.get(last)! +
          angleDelta(raw(last).get(id)!.rotationZ, raw(last + 1).get(id)!.rotationZ),
      );
      last++;
    }
    return values.get(k)!;
  };
  const native = (id: string, seconds: number, release: number) => {
    const at = Math.max(0, seconds / stepSeconds),
      k = Math.floor(at),
      u = at - k,
      p = raw(k).get(id)!,
      q = raw(k + 1).get(id)!,
      before = raw(k - 1).get(id)!,
      after = raw(k + 2).get(id)!;
    const slope = (time: number, prev: number, next: number) =>
      time <= release + 1e-12 ? 0 : (next - prev) / (2 * stepSeconds);
    const x = localSupportHermite(
      p.x,
      q.x,
      slope(k * stepSeconds, before.x, q.x),
      slope((k + 1) * stepSeconds, p.x, after.x),
      u,
      stepSeconds,
    );
    const y = localSupportHermite(
      p.y,
      q.y,
      slope(k * stepSeconds, before.y, q.y),
      slope((k + 1) * stepSeconds, p.y, after.y),
      u,
      stepSeconds,
    );
    const angle0 = unwrapped(id, k, release),
      angle1 = unwrapped(id, k + 1, release);
    const angle = localSupportHermite(
      angle0,
      angle1,
      k * stepSeconds <= release + 1e-12
        ? 0
        : (angle1 - unwrapped(id, k - 1, release)) / (2 * stepSeconds),
      (k + 1) * stepSeconds <= release + 1e-12
        ? 0
        : (unwrapped(id, k + 2, release) - angle0) / (2 * stepSeconds),
      u,
      stepSeconds,
    );
    return {
      x: x.value,
      y: y.value,
      vx: x.velocity,
      vy: y.velocity,
      angle: angle.value,
      angularVelocity: angle.velocity,
    };
  };
  const poses = [];
  for (const cell of [...cue.eliminatedCells].sort((l, r) => r.y - l.y || l.x - r.x)) {
    const shift = (f.lateMovementOffsets ?? [])
      .filter((o) => o.id === cell.id)
      .reduce((v, o) => ({ x: v.x + o.x, y: v.y + o.y }), { x: 0, y: 0 });
    const p = {
      x: b.x + (cell.x + shift.x) * b.cell,
      y:
        b.y +
        (f.before.config.rows - 1 - cell.y - shift.y - calibratedVisualFieldRise(f, a)) * b.cell,
    };
    const birthCenterY = b.y + (p.y + b.cell / 2 - b.y) * scale + compensation * b.cell * scale;
    const liftPixels =
      e.sheetLiftFrontFalloffPower === undefined
        ? (e.sheetLiftPixels ?? 0)
        : frontLiftFalloffPixels(
            e.sheetLiftPixels ?? 0,
            cell.x,
            columns,
            e.frontOrigin,
            e.sheetLiftFrontFalloffPower,
          );
    for (let iy = 0; iy < n; iy++)
      for (let ix = 0; ix < n; ix++) {
        const id = `${cell.id}:fragment-${ix}-${iy}`,
          sampleId = `${cell.id}:fragment-${mirrored ? n - 1 - ix : ix}-${iy}`,
          seed = calibratedFragmentSeed(id),
          seedY = calibratedFragmentSeed(id + ':vertical');
        const subColumn = cell.x * n + ix,
          release = localSheetReleaseSeconds(
            subColumn,
            columns * n,
            e.frontSeconds,
            rate,
            e.frontOrigin,
          );
        const initialX =
          (mirrored ? columns - 1 - cell.x : cell.x) +
          (mirrored ? n - 1 - ix + 0.5 : ix + 0.5) / n -
          0.5;
        const initialY = cell.y + (iy + 0.5) / n - 0.5,
          baseX = p.x + ((ix + 0.5) * b.cell) / n,
          baseY = birthCenterY + (0.5 - (iy + 0.5) / n) * b.cell * scale;
        const boardAtRelease = riseDown(release),
          boardVelocity = riseVelocity(release);
        const supportAt = (seconds: number) => {
          if (seconds <= release)
            return {
              x: baseX,
              y: baseY + riseDown(seconds),
              angle: 0,
              velocityX: 0,
              velocityY: riseVelocity(seconds),
              angularVelocity: 0,
            };
          const age = seconds - release,
            q = native(sampleId, seconds, release),
            lift = localSupportLift(age, liftPixels, e.sheetLiftSeconds ?? 0.35);
          const sign = mirrored ? -1 : 1,
            side =
              e.frontOrigin === 'center'
                ? (cell.x / Math.max(1, columns - 1) - 0.5) * 2
                : e.frontOrigin === 'edges'
                  ? (0.5 - cell.x / Math.max(1, columns - 1)) * 2
                  : mirrored
                    ? 1
                    : -1;
          const scatterX =
              (e.scatterHorizontalRatio ?? 1) * e.scatterPixels * (side + (seed - 0.5) * 0.3),
            scatterY = (seedY - 0.5) * e.scatterPixels * (e.scatterVerticalRatio ?? 0) * scale;
          const thickness =
            -(cell.y + (iy + 0.5) / n - 0.5 - (rows[0]! + rows.at(-1)!) / 2) *
            b.cell *
            scale *
            ((e.sheetThicknessScale ?? 1) - 1);
          const thickAge = age / 0.25;
          return {
            x: baseX + sign * (q.x - initialX) * b.cell + age * age * scatterX,
            y:
              baseY +
              boardAtRelease +
              boardVelocity * age -
              (q.y - initialY) * b.cell * scale -
              lift.value +
              thickness * smooth(thickAge) +
              age * age * scatterY,
            angle: -sign * q.angle,
            velocityX: sign * q.vx * b.cell + 2 * age * scatterX,
            velocityY:
              boardVelocity -
              q.vy * b.cell * scale -
              lift.velocity +
              thickness * smoothDerivative(thickAge, 0.25) +
              2 * age * scatterY,
            angularVelocity: -sign * q.angularVelocity,
          };
        };
        const age = Math.max(0, t - release),
          growth = smooth(age / 0.06),
          size =
            (b.cell / n) *
            ((e.prefractureScale ?? 1) +
              ((e.fragmentScale ?? 1.1) - (e.prefractureScale ?? 1)) * growth) *
            (1 + (e.sizeSpread ?? 0) * (2 * seed - 1));
        const pose = localFragmentDetachPose({
          elapsedSeconds: t,
          releaseSeconds: release,
          supportSeconds: physics.sheetDetachAfterReleaseSeconds,
          gravityPixelsPerSecondSquared: physics.gravityPixelsPerSecondSquared,
          size,
          exitY: physics.exitY ?? 1920,
          supportAt,
        });
        poses.push({
          ...pose,
          id,
          cell,
          ix,
          iy,
          rotationAge: age * (e.fragmentCubeRotationAgeScale ?? 1),
        });
      }
  }
  return poses;
}

/** Exact per-native-ID detach states; visual lifetime only, never Take duration. */
export function calibratedLocalDetachLifetimeSeconds(
  f: BlockCrushDropPresentationFrame,
  a: DropReferenceCalibration,
) {
  const cue = f.lingeringClear,
    e = a.clear,
    physics = e?.fragmentPhysics;
  if (!cue || !e || physics?.sheetDetachAfterReleaseSeconds === undefined)
    throw new Error('DROP_LOCAL_DETACH_LIFETIME_REQUIRES_OPT_IN');
  const rate = e.sheetMotionRate ?? 1,
    last = e.frontSeconds + 1 / (30 * rate) + physics.sheetDetachAfterReleaseSeconds;
  const lastFrame = {
    ...f,
    frameIndex: f.frameIndex + (last - cue.elapsedFrames / f.fps) * f.fps,
    canonicalTick: calibratedFieldRiseTick(f) + (last - cue.elapsedFrames / f.fps) * 30,
    lingeringClear: { ...cue, elapsedFrames: last * f.fps },
  };
  // Taking fieldRiseOffset back to its synthetic frame's canonical clock
  // cancels out in the anchored birth/field-clock construction. For lifetime
  // use the highest (most conservative) native origin rather than a later row.
  // Exit is solved on the underlying continuous motion. Quantization can lag
  // it by at most half a display sample, including a very short support phase.
  const {
    fragmentDisplayFps: displayFps,
    fragmentDisplayPhaseSeconds: phaseSeconds,
    ...continuousClear
  } = e;
  const lifetimeCalibration = displayFps === undefined ? a : { ...a, clear: continuousClear };
  const poses = calibratedLocalDetachFragments(lastFrame, lifetimeCalibration);
  const size =
    (a.board.cell / e.subdivisions) *
    Math.max(e.prefractureScale ?? 1, e.fragmentScale ?? 1.1) *
    (1 + (e.sizeSpread ?? 0));
  const durations = poses.map((p) => {
    const origin = p.detachAnchor!;
    const upwardOrigin = Math.min(origin.y, a.board.y - (e.sheetLiftPixels ?? 0));
    return (
      p.detachSeconds +
      calibratedFragmentFlightSeconds(upwardOrigin, size, physics, origin.velocityY)
    );
  });
  const continuous = Math.max(last, ...durations);
  return e.fragmentDisplayFps === undefined
    ? continuous
    : continuous + calibratedFragmentDisplayMaximumLag(displayFps, phaseSeconds);
}
