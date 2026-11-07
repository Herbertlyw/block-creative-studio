/**
 * Deterministic signed velocity spread with an optional bias toward the centre.
 * The power changes the distribution, never its maximum amplitude or a clock.
 * Omitting it preserves the legacy expression, including floating-point order.
 */
export function calibratedFragmentVelocitySpread(seed: number, spread: number, power = 1): number {
  if (!Number.isFinite(seed) || seed < 0 || seed > 1) {
    throw new RangeError(
      'FRAGMENT_VELOCITY_SPREAD_INVALID_SEED: expected a finite number in [0, 1]',
    );
  }
  if (!Number.isFinite(spread) || spread < 0) {
    throw new RangeError(
      'FRAGMENT_VELOCITY_SPREAD_INVALID_SPREAD: expected a finite non-negative number',
    );
  }
  if (!Number.isFinite(power) || power < 1 || power > 8) {
    throw new RangeError(
      'FRAGMENT_VELOCITY_SPREAD_INVALID_POWER: expected a finite number in [1, 8]',
    );
  }

  if (power === 1) return (2 * seed - 1) * spread;
  const z = 2 * seed - 1;
  return spread * Math.sign(z) * Math.abs(z) ** power;
}
