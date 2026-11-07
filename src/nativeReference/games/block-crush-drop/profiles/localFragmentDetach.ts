import { calibratedFragmentRadius } from './fragmentPhysics';

/** Particle presentation samples only. Output FPS, native actions and audio keep their clocks. */
export function calibratedFragmentDisplaySeconds(
  seconds: number,
  displayFps?: number,
  phaseSeconds?: number,
): number {
  if (displayFps === undefined) {
    if (phaseSeconds !== undefined) throw new Error('DROP_FRAGMENT_DISPLAY_PHASE_REQUIRES_CLOCK');
    return seconds;
  }
  if (
    !Number.isFinite(seconds) ||
    !Number.isInteger(displayFps) ||
    displayFps < 1 ||
    displayFps > 120
  )
    throw new Error('DROP_FRAGMENT_DISPLAY_CLOCK_INVALID');
  if (phaseSeconds !== undefined) {
    if (!Number.isFinite(phaseSeconds) || phaseSeconds < 0 || phaseSeconds >= 1 / displayFps)
      throw new Error('DROP_FRAGMENT_DISPLAY_PHASE_INVALID');
    return (
      Math.round((seconds + phaseSeconds) * displayFps) / displayFps -
      Math.round(phaseSeconds * displayFps) / displayFps
    );
  }
  return Math.round(seconds * displayFps) / displayFps;
}

/** Maximum positive delay of the presented particle clock, never more than one sample. */
export function calibratedFragmentDisplayMaximumLag(
  displayFps?: number,
  phaseSeconds?: number,
): number {
  calibratedFragmentDisplaySeconds(0, displayFps, phaseSeconds);
  if (displayFps === undefined) return 0;
  if (phaseSeconds === undefined) return 0.5 / displayFps;
  return Math.max(
    0,
    Math.min(
      1 / displayFps,
      0.5 / displayFps - phaseSeconds + Math.round(phaseSeconds * displayFps) / displayFps,
    ),
  );
}

/** Screen coordinates, radians and genuine seconds. Not a normalized sheet age. */
export interface LocalFragmentSupportAnchor {
  x: number;
  y: number;
  angle: number;
  velocityX: number;
  velocityY: number;
  angularVelocity: number;
}
export interface LocalFragmentDetachSample {
  elapsedSeconds: number;
  releaseSeconds: number;
  supportSeconds: number;
  gravityPixelsPerSecondSquared: number;
  size: number;
  exitY: number;
  supportAt: (seconds: number) => LocalFragmentSupportAnchor;
}

/** Per-particle support -> free flight. No extra launch impulse, fade or ID change. */
export function localFragmentDetachPose(sample: LocalFragmentDetachSample) {
  const {
    elapsedSeconds: t,
    releaseSeconds,
    supportSeconds,
    size,
    exitY,
    gravityPixelsPerSecondSquared: g,
  } = sample;
  if (
    ![t, releaseSeconds, supportSeconds, size, exitY, g].every(Number.isFinite) ||
    releaseSeconds < 0 ||
    supportSeconds < 0 ||
    supportSeconds > 2 ||
    size <= 0 ||
    g <= 0
  )
    throw new Error('DROP_LOCAL_DETACH_NONFINITE_OR_INVALID_INPUT');
  const detachSeconds = releaseSeconds + supportSeconds,
    released = t >= releaseSeconds,
    detached = t >= detachSeconds;
  const anchor = sample.supportAt(detached ? detachSeconds : t);
  if (!Object.values(anchor).every(Number.isFinite))
    throw new Error('DROP_LOCAL_DETACH_INVALID_ANCHOR');
  const age = Math.max(0, t - releaseSeconds),
    flightAge = detached ? t - detachSeconds : 0;
  const x = anchor.x + (detached ? anchor.velocityX * flightAge : 0);
  const y =
    anchor.y + (detached ? anchor.velocityY * flightAge + 0.5 * g * flightAge * flightAge : 0);
  const angle = anchor.angle + (detached ? anchor.angularVelocity * flightAge : 0);
  const velocityX = anchor.velocityX,
    velocityY = anchor.velocityY + (detached ? g * flightAge : 0);
  const visible = y - calibratedFragmentRadius(size) <= exitY;
  return {
    x,
    y,
    angle,
    velocityX,
    velocityY,
    angularVelocity: anchor.angularVelocity,
    size,
    age,
    flightAge,
    releaseSeconds,
    detachSeconds,
    released,
    detached,
    visible,
    alpha: visible ? 1 : 0,
    ...(detached ? { detachAnchor: anchor } : {}),
  };
}

/** The supported interpolation interval begins at the last pinned native step. */
export function localSheetReleaseSeconds(
  subColumn: number,
  subColumns: number,
  frontSeconds: number,
  motionRate: number,
  origin: 'left' | 'right' | 'center' | 'edges' = 'left',
) {
  if (
    ![subColumn, subColumns, frontSeconds, motionRate].every(Number.isFinite) ||
    subColumn < 0 ||
    subColumns < 1 ||
    subColumn >= subColumns ||
    frontSeconds < 0 ||
    motionRate <= 0
  )
    throw new Error('DROP_LOCAL_DETACH_INVALID_FRONT');
  const u = subColumn / Math.max(1, subColumns - 1),
    distance =
      origin === 'right'
        ? 1 - u
        : origin === 'center'
          ? Math.abs(u - 0.5) * 2
          : origin === 'edges'
            ? 1 - Math.abs(u - 0.5) * 2
            : u;
  const step = 1 + Math.round(Math.round(frontSeconds * 30 * motionRate) * distance);
  return (step - 1) / (30 * motionRate);
}

/** C1 support samples and derivatives from a native discrete position stencil. */
export function localSupportHermite(
  p0: number,
  p1: number,
  m0: number,
  m1: number,
  u: number,
  stepSeconds: number,
) {
  const q = Math.max(0, Math.min(1, u)),
    q2 = q * q,
    q3 = q2 * q;
  const value =
    (2 * q3 - 3 * q2 + 1) * p0 +
    (q3 - 2 * q2 + q) * m0 * stepSeconds +
    (-2 * q3 + 3 * q2) * p1 +
    (q3 - q2) * m1 * stepSeconds;
  const velocity =
    ((6 * q2 - 6 * q) * p0 +
      (3 * q2 - 4 * q + 1) * m0 * stepSeconds +
      (-6 * q2 + 6 * q) * p1 +
      (3 * q2 - 2 * q) * m1 * stepSeconds) /
    stepSeconds;
  return { value, velocity };
}

/** True-second upward support envelope. Zero slope at both endpoints. */
export function localSupportLift(ageSeconds: number, pixels: number, durationSeconds: number) {
  if (ageSeconds <= 0 || ageSeconds >= durationSeconds || pixels === 0)
    return { value: 0, velocity: 0 };
  const u = ageSeconds / durationSeconds;
  return {
    value: pixels * Math.sin(Math.PI * u) ** 2,
    velocity: ((pixels * Math.PI) / durationSeconds) * Math.sin(2 * Math.PI * u),
  };
}
