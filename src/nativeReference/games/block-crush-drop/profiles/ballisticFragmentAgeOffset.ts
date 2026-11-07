/** Existing age-offset semantics: waiting/release clocks never move. */
function checkedOffset(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < -0.25 || value > 0.25)
    throw new Error('DROP_BALLISTIC_FRAGMENT_AGE_OFFSET_INVALID');
  return value;
}
/** Input is already display-sampled once; this helper never quantizes again. */
export function calibratedBallisticFragmentElapsedSeconds(
  sampledSeconds: number,
  releaseSeconds: number,
  offsetSeconds?: number,
): number {
  const offset = checkedOffset(offsetSeconds);
  if (offset === 0 || sampledSeconds < releaseSeconds) return sampledSeconds;
  return releaseSeconds + Math.max(0, sampledSeconds - releaseSeconds + offset);
}
/** Visible crossing on the original display clock, clamped to native release. */
export function calibratedBallisticFragmentExitSeconds(
  releaseSeconds: number,
  flightSeconds: number,
  offsetSeconds?: number,
): number {
  const offset = checkedOffset(offsetSeconds);
  return offset === 0
    ? releaseSeconds + flightSeconds
    : releaseSeconds + Math.max(0, flightSeconds - offset);
}
/** A negative movement-age offset delays real exit; positive never needs a longer cue. */
export function calibratedBallisticFragmentAgeMaximumDelay(offsetSeconds?: number): number {
  return Math.max(0, -checkedOffset(offsetSeconds));
}
