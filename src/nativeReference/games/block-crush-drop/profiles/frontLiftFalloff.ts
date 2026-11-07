export type FrontLiftFalloffOrigin = 'left' | 'right' | 'center' | 'edges';

/**
 * Opt-in amplitude only: every child of a mother column receives the same lift.
 * This presentation control is not a recovered source force field. The caller
 * must pass the result into its existing lift value/derivative calculation.
 * Single-column u=0 follows the existing release-front rule: positive power
 * preserves left/edges lift and suppresses right/center lift.
 */
export function frontLiftFalloffPixels(
  pixels: number,
  cellX: number,
  columns: number,
  origin: FrontLiftFalloffOrigin = 'left',
  power?: number,
): number {
  if (
    !Number.isFinite(pixels) ||
    pixels < 0 ||
    pixels > 800 ||
    !Number.isSafeInteger(columns) ||
    columns < 1 ||
    !Number.isSafeInteger(cellX) ||
    cellX < 0 ||
    cellX >= columns ||
    !['left', 'right', 'center', 'edges'].includes(origin) ||
    (power !== undefined && (!Number.isFinite(power) || power < 0 || power > 4))
  ) {
    throw new Error('DROP_FRONT_LIFT_FALLOFF_INVALID_INPUT');
  }
  // Return the actual input, including signed zero, for exact legacy equality.
  if (power === undefined || power === 0 || pixels === 0) return pixels;
  const u = cellX / Math.max(1, columns - 1);
  const distance =
    origin === 'right'
      ? 1 - u
      : origin === 'center'
        ? Math.abs(u - 0.5) * 2
        : origin === 'edges'
          ? 1 - Math.abs(u - 0.5) * 2
          : u;
  return pixels * (1 - distance) ** power;
}
