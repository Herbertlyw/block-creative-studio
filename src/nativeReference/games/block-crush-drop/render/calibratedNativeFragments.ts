import type {
  BlockCrushDropPresentationFrame,
  BlockCrushDropFragmentAppearanceProfile,
} from '../presentation/presentationAdapter';
import type { DropReferenceCalibration } from '../profiles/referenceCalibration';
import { validateNativeInertialCalibration } from '../profiles/nativeInertialCalibration';
import { clearPhysicsEventsForFrame } from './stagePainter';
import {
  sampleClearPhysicsWorldHistory,
  type ClearPhysicsSeed,
  type ClearPhysicsHistoryPose,
  type ClearPhysicsEvent,
} from './clearPhysics';
import { crushFragmentIdentity } from './fragmentIdentity';

type Vector = { readonly x: number; readonly y: number; readonly z: number };
export const NATIVE_CALIBRATED_MAX_BODIES = 8192;
export const NATIVE_CALIBRATED_MAX_HISTORY_BYTES = 96 * 1024 * 1024;
/** Column-major affine and inverse-transpose bases operate on the unit mesh. */
export interface NativeCalibratedFragmentPacket {
  readonly kind: 'native-inertial';
  readonly id: string;
  readonly parentId: string;
  readonly waveId: string;
  readonly fx: 0 | 1;
  readonly fy: 0 | 1;
  readonly depthIndex: 0 | 1;
  readonly centerPixels: Vector;
  readonly quaternion: readonly [number, number, number, number];
  readonly dimensionsPixels: readonly [number, number, number];
  readonly stageVerticalScale: number;
  readonly basis: readonly [Vector, Vector, Vector];
  readonly normalBasis: readonly [Vector, Vector, Vector];
  readonly opacity: number;
  readonly frontBlend: number;
  readonly cornerRadius: number;
  readonly color: string;
  readonly cutFaceAmbient: number;
  readonly topFaceAmbient: number;
  readonly cutFaceTint: number;
  readonly materialIdentity: 'solid-calibrated';
  readonly lifetimeBoundary: 'exclusive-cue-deadline';
}
const smooth = (t: number) => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};
function rotate(p: Vector, [x, y, z, w]: readonly number[]): Vector {
  const tx = 2 * (y! * p.z - z! * p.y),
    ty = 2 * (z! * p.x - x! * p.z),
    tz = 2 * (x! * p.y - y! * p.x);
  return {
    x: p.x + w! * tx + y! * tz - z! * ty,
    y: p.y + w! * ty + z! * tx - x! * tz,
    z: p.z + w! * tz + x! * ty - y! * tx,
  };
}

/** Pure native-cell → stage projection. Rise already belongs to the seed/solver. */
export function projectNativeFragmentPose(
  seed: Readonly<ClearPhysicsSeed>,
  pose: Readonly<ClearPhysicsHistoryPose>,
  projection: {
    board: Pick<DropReferenceCalibration['board'], 'x' | 'y' | 'cell' | 'verticalScale'>;
    rows: number;
  },
  appearance: Readonly<BlockCrushDropFragmentAppearanceProfile>,
  remainingCanonicalFrames: number,
  style: { waveId: string; color: string; cornerRadius: number; durationCanonicalFrames?: number },
): NativeCalibratedFragmentPacket {
  const { board: b, rows } = projection,
    v = b.verticalScale ?? 1,
    edge = appearance.baseScale + appearance.releaseGrowthScale * pose.releaseAge;
  const identity = crushFragmentIdentity(seed.id),
    q = pose.quaternion;
  if (
    !identity.volume ||
    ![0, 1].includes(seed.layer!) ||
    ![b.x, b.y, b.cell, v, edge, ...q, pose.x, pose.y, pose.z, remainingCanonicalFrames].every(
      Number.isFinite,
    ) ||
    b.cell <= 0 ||
    v <= 0 ||
    edge <= 0
  )
    throw new Error('DROP_NATIVE_INERTIAL_PROJECTION_INVALID');
  const dimensions = [b.cell * edge, b.cell * edge, b.cell * edge * 0.9] as const;
  // Reflect world Y into screen Y without turning quaternion into legacy Euler.
  const screenQ = [-q[0], q[1], -q[2], q[3]] as const,
    axes = [
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    ];
  const basis = axes.map((axis, i) => {
    const r = rotate(axis, screenQ),
      d = dimensions[i]!;
    return { x: r.x * d, y: r.y * d * v, z: r.z * d };
  }) as unknown as NativeCalibratedFragmentPacket['basis'];
  const normalBasis = axes.map((axis, i) => {
    const r = rotate(axis, screenQ),
      d = dimensions[i]!;
    return { x: r.x / d, y: r.y / d / v, z: r.z / d };
  }) as unknown as NativeCalibratedFragmentPacket['normalBasis'];
  return {
    kind: 'native-inertial',
    id: seed.id,
    parentId: identity.parentId,
    waveId: style.waveId,
    fx: (identity.quadrant % 2) as 0 | 1,
    fy: Math.floor(identity.quadrant / 2) as 0 | 1,
    depthIndex: seed.layer as 0 | 1,
    centerPixels: {
      x: b.x + (pose.x + 0.5) * b.cell,
      y: b.y + (rows - 0.5 - pose.y) * b.cell * v,
      z: pose.z * b.cell,
    },
    quaternion: [...q],
    dimensionsPixels: dimensions,
    stageVerticalScale: v,
    basis,
    normalBasis,
    opacity:
      appearance.exitFadeFrames !== undefined
        ? smooth(remainingCanonicalFrames / appearance.exitFadeFrames)
        : smooth(remainingCanonicalFrames / ((style.durationCanonicalFrames ?? 60) * 0.03)),
    frontBlend:
      seed.layer === 1
        ? 0
        : 1 - (1 - (appearance.frontTextureEndBlend ?? 0.1)) * smooth(pose.releaseAge / 0.6),
    cornerRadius: style.cornerRadius,
    color: style.color,
    cutFaceAmbient: appearance.cutFaceAmbient ?? 0.42,
    topFaceAmbient: appearance.topFaceAmbient ?? 0.85,
    cutFaceTint: appearance.cutFaceTint ?? 0xffffff,
    materialIdentity: 'solid-calibrated',
    lifetimeBoundary: 'exclusive-cue-deadline',
  };
}
export function nativeCalibratedWorldVertex(
  local: Vector,
  packet: NativeCalibratedFragmentPacket,
): Vector {
  const [a, b, c] = packet.basis,
    p = packet.centerPixels;
  return {
    x: p.x + a.x * local.x + b.x * local.y + c.x * local.z,
    y: p.y + a.y * local.x + b.y * local.y + c.y * local.z,
    z: p.z + a.z * local.x + b.z * local.y + c.z * local.z,
  };
}

type Schedule = NonNullable<BlockCrushDropPresentationFrame['physicsCueSchedule']>;
const schedules = new WeakMap<Schedule, ClearPhysicsEvent[]>();
export function validateNativeCalibratedWorldBudget(events: readonly ClearPhysicsEvent[]): void {
  let bytes = 0,
    bodies = 0;
  const ids = new Set<string>();
  for (const event of events) {
    bodies += event.input.seeds.length;
    bytes +=
      event.input.seeds.length *
      16 *
      8 *
      (Math.ceil((event.endSeconds - event.startSeconds) * 120) + 1);
    for (const seed of event.input.seeds) {
      if (ids.has(seed.id)) throw new Error('DROP_NATIVE_INERTIAL_DUPLICATE_BODY');
      ids.add(seed.id);
    }
  }
  if (bodies > NATIVE_CALIBRATED_MAX_BODIES || bytes > NATIVE_CALIBRATED_MAX_HISTORY_BYTES)
    throw new Error('DROP_NATIVE_INERTIAL_WORLD_BUDGET');
}
/** Whole immutable schedule is sampled once, before iterating active wave owners. */
export function calibratedNativeFragmentPackets(
  frame: BlockCrushDropPresentationFrame,
  calibration: DropReferenceCalibration,
  color: (parentId: string, kind: string, fragmentId: string) => string,
): NativeCalibratedFragmentPacket[] {
  if (!calibration.clear?.nativeInertial) return [];
  validateNativeInertialCalibration(calibration);
  const motion = frame.before.config.rules.fieldMotion;
  if (motion.pauses?.length || motion.rateChanges?.length)
    throw new Error('DROP_NATIVE_INERTIAL_VARIABLE_RISE_UNSUPPORTED');
  const cues = frame.lingeringClears ?? (frame.lingeringClear ? [frame.lingeringClear] : []),
    schedule = frame.physicsCueSchedule;
  if (frame.sequenceCueSchedule?.length || cues.some((c) => c.sequence))
    throw new Error('DROP_NATIVE_INERTIAL_SEQUENCE_CONFLICT');
  if (cues.some((c) => c.observedFragmentMotion || c.observedFragmentMotionV2))
    throw new Error('DROP_NATIVE_INERTIAL_OBSERVED_MOTION_CONFLICT');
  if (
    cues.some(
      (c) =>
        !c.fragmentAppearance?.inertialPhysics?.sharedContact ||
        c.fragmentAppearance.inertialPhysics.depthLayers !== 2,
    ) ||
    !schedule
  )
    throw new Error('DROP_NATIVE_INERTIAL_REQUIRES_SHARED_TWO_DEPTH_SCHEDULE');
  if (
    schedule.some(
      (e) =>
        e.sequence ||
        e.observedFragmentMotion ||
        !e.fragmentAppearance.inertialPhysics?.sharedContact ||
        e.fragmentAppearance.inertialPhysics.depthLayers !== 2,
    )
  )
    throw new Error('DROP_NATIVE_INERTIAL_UNSUPPORTED_SCHEDULE');
  let events = schedules.get(schedule);
  if (!events) {
    events = clearPhysicsEventsForFrame(frame);
    validateNativeCalibratedWorldBudget(events);
    schedules.set(schedule, events);
  }
  const seconds = frame.frameIndex / frame.fps,
    poses = sampleClearPhysicsWorldHistory(events, seconds, seconds),
    packets: NativeCalibratedFragmentPacket[] = [];
  for (const cue of cues) {
    const start = (frame.frameIndex - cue.elapsedFrames) / frame.fps,
      ids = new Set(cue.eliminatedCells.map((c) => c.id));
    const index = schedule.findIndex(
      (e) =>
        Math.abs(e.startSeconds - start) < 1e-8 &&
        e.eliminatedCells.length === ids.size &&
        e.eliminatedCells.every((c) => ids.has(c.id)),
    );
    if (index < 0) throw new Error('DROP_NATIVE_INERTIAL_NATIVE_BINDING_INVALID');
    const event = events[index]!,
      owner = schedule[index]!,
      remaining = (event.endSeconds - seconds) * 30;
    for (const seed of event.input.seeds) {
      const pose = poses.get(seed.id);
      if (!pose) continue;
      const parent = owner.eliminatedCells.find(
        (c) => c.id === crushFragmentIdentity(seed.id).parentId,
      )!;
      packets.push(
        projectNativeFragmentPose(
          seed,
          pose,
          { board: calibration.board, rows: frame.before.config.rows },
          owner.fragmentAppearance,
          remaining,
          {
            waveId: `${cue.actionIndex}:${cue.cycleIndex}`,
            color: color(parent.id, parent.kind, seed.id),
            cornerRadius: calibration.clear.fragmentCubeCornerRadius ?? 0.065,
            durationCanonicalFrames: (event.endSeconds - event.startSeconds) * 30,
          },
        ),
      );
    }
  }
  return packets;
}
