// Derived production module; supplied reference files remain unchanged.
import type { ReferenceAppearance } from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';
type Praise = NonNullable<ReferenceAppearance['praiseEvents']>[number];
/** Source-measured typography geometry; no bitmap frames or gameplay state changes. */
export function praisePose(event: Praise, time: number) {
  const keys = event.keyframes;
  if (!keys?.length) return undefined;
  let a = keys[0],
    b = a;
  for (let i = 1; i < keys.length; i++) {
    b = keys[i];
    if (time <= b[0]) break;
    a = b;
  }
  const p = Math.max(0, Math.min(1, (time - a[0]) / Math.max(0.00001, b[0] - a[0])));
  return {
    x: a[1] + (b[1] - a[1]) * p,
    y: a[2] + (b[2] - a[2]) * p,
    width: a[3] + (b[3] - a[3]) * p,
    height: a[4] + (b[4] - a[4]) * p,
  };
}
