// Derived production module; supplied reference files remain unchanged.
/** Absolute evaluation keeps seeks and different frame rates free of accumulated drift. */
export function referenceCameraOffset(
  track: readonly (readonly [number, number, number])[] | undefined,
  time: number,
): [number, number] {
  if (!track?.length || time < track[0]![0] || time >= track.at(-1)![0]) return [0, 0];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1]!,
      b = track[i]!;
    if (time <= b[0]) {
      const f = (time - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    }
  }
  return [0, 0];
}
