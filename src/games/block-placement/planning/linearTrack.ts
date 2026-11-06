/** Time is expressed in the caller's clock; values stay in the caller's coordinate space. */
export type LinearTrackPoint<T extends readonly number[]> = { time: number; value: T };

/** Piece and pointer tracks can share interpolation without sharing anchors or coordinates. */
export function sampleLinearTrack(
  points: readonly LinearTrackPoint<readonly [number, number]>[],
  time: number,
  minSpan: number,
): [number, number];
export function sampleLinearTrack(
  points: readonly LinearTrackPoint<readonly [number, number, number]>[],
  time: number,
  minSpan: number,
): [number, number, number];
export function sampleLinearTrack(
  points: readonly LinearTrackPoint<readonly number[]>[],
  time: number,
  minSpan: number,
): number[] {
  const first = points[0],
    last = points.at(-1);
  if (!first || !last || !Number.isFinite(time) || !Number.isFinite(minSpan) || minSpan <= 0)
    throw new Error('BB_LINEAR_TRACK_INVALID');
  let previousTime = -Infinity;
  for (const point of points) {
    if (
      !Number.isFinite(point.time) ||
      point.time < previousTime ||
      point.value.length !== first.value.length ||
      !point.value.every(Number.isFinite)
    )
      throw new Error('BB_LINEAR_TRACK_INVALID');
    previousTime = point.time;
  }
  if (time <= first.time) return [...first.value];
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1],
      next = points[index];
    if (
      !previous ||
      !next ||
      next.time < previous.time ||
      previous.value.length !== next.value.length
    )
      throw new Error('BB_LINEAR_TRACK_INVALID');
    if (time <= next.time) {
      const amount = Math.max(
        0,
        Math.min(1, (time - previous.time) / Math.max(minSpan, next.time - previous.time)),
      );
      return previous.value.map((value, i) => {
        const target = next.value[i];
        if (target === undefined || !Number.isFinite(value) || !Number.isFinite(target))
          throw new Error('BB_LINEAR_TRACK_INVALID');
        return value + (target - value) * amount;
      });
    }
  }
  return [...last.value];
}
