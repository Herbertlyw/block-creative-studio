import { calibratedFragmentVelocitySpread } from './fragmentSpreadCurve';

/** Optional presentation physics in the 1080 × 1920 reference screen, independent of FPS and board stretch. */
export interface DropFragmentPhysics {
  gravityPixelsPerSecondSquared: number;
  initialVelocityY: number;
  initialVelocityX: number;
  velocitySpreadX?: number;
  velocitySpreadY?: number;
  /** Opt-in distribution powers for the supported sampled plain-ballistic path. */
  velocitySpreadPowerX?: number;
  velocitySpreadPowerY?: number;
  exitY?: number;
  /** Preserve a constrained fold until this clear-relative second, then detach into free fall. */
  sheetDetachSeconds?: number;
  /** Opt-in genuine seconds of support after each native release; no added launch impulse. */
  sheetDetachAfterReleaseSeconds?: number;
}

/** A cube's projected radius never exceeds its half diagonal, including arbitrary tumbling. */
export function calibratedFragmentRadius(size: number): number {
  return (Math.abs(size) * Math.sqrt(3)) / 2;
}

/** Last positive crossing after the entire fragment has left the screen, not an opacity deadline. */
export function calibratedFragmentFlightSeconds(
  originY: number,
  size: number,
  physics: DropFragmentPhysics,
  velocityY = physics.initialVelocityY,
): number {
  const distance = (physics.exitY ?? 1920) + calibratedFragmentRadius(size) - originY;
  const discriminant = velocityY * velocityY + 2 * physics.gravityPixelsPerSecondSquared * distance;
  if (discriminant < 0) return 0;
  return Math.max(
    0,
    (-velocityY + Math.sqrt(discriminant)) / physics.gravityPixelsPerSecondSquared,
  );
}

export interface DropFragmentPhysicsSample {
  elapsedSeconds: number;
  releaseSeconds: number;
  x: number;
  y: number;
  size: number;
  seedX: number;
  seedY: number;
  physics: DropFragmentPhysics;
}

/** Random-access closed-form motion. Delaying release never fast-forwards a later column's gravity. */
export function calibratedFragmentPhysicsPose(sample: DropFragmentPhysicsSample) {
  const { physics, elapsedSeconds, releaseSeconds, size } = sample;
  const released = elapsedSeconds >= releaseSeconds;
  const age = Math.max(0, elapsedSeconds - releaseSeconds);
  const vx =
    physics.initialVelocityX +
    (physics.velocitySpreadPowerX === undefined || physics.velocitySpreadPowerX === 1
      ? (2 * sample.seedX - 1) * (physics.velocitySpreadX ?? 0)
      : calibratedFragmentVelocitySpread(
          sample.seedX,
          physics.velocitySpreadX ?? 0,
          physics.velocitySpreadPowerX,
        ));
  const initialVy =
    physics.initialVelocityY +
    (physics.velocitySpreadPowerY === undefined || physics.velocitySpreadPowerY === 1
      ? (2 * sample.seedY - 1) * (physics.velocitySpreadY ?? 0)
      : calibratedFragmentVelocitySpread(
          sample.seedY,
          physics.velocitySpreadY ?? 0,
          physics.velocitySpreadPowerY,
        ));
  const x = sample.x + vx * age;
  const y = sample.y + initialVy * age + 0.5 * physics.gravityPixelsPerSecondSquared * age * age;
  const visible = y - calibratedFragmentRadius(size) <= (physics.exitY ?? 1920);
  return {
    x,
    y,
    size,
    age,
    released,
    visible,
    alpha: visible ? 1 : 0,
    velocityX: vx,
    velocityY: initialVy + physics.gravityPixelsPerSecondSquared * age,
  };
}
