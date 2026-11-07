/** Numeric, native-particle measurements. No raster/video frame input is accepted. */
type DropObservedFragmentTransformKey = [
  frameOffset: number,
  x: number,
  y: number,
  z: number,
  scale: number,
  rotationX: number,
  rotationY: number,
  rotationZ: number,
];
/** Corner radius is opt-in and requires an explicit opacity in the ninth slot. */
export type DropObservedFragmentKey =
  | [...DropObservedFragmentTransformKey, opacity?: number]
  | [...DropObservedFragmentTransformKey, opacity: number, cornerRadius: number];
export interface DropObservedFragmentDefinition {
  /** Stable within the wave, independent of array order or screen position. */
  id: number;
  cellId: string;
  ix: number;
  iy: number;
  depthIndex: number;
  /** Unscaled full cube edge in 1080×1920 stage pixels. */
  sizePixels: number;
  /** A parent face patch or a plain, lit solid; never a source-frame layer. */
  material: 'parent-uv' | 'solid';
  color?: string;
  /** Linear samples relative to the native visual cue's origin; up to 30 canonical frames of pre-roll. Euler radians are intentionally unwrapped. */
  keys: DropObservedFragmentKey[];
}
export interface DropObservedFragmentMotionV2 {
  version: 2;
  coordinateSpace: 'source-stage-pixels';
  canonicalFps: number;
  /** Defines parent UV patches; independent of older procedural subdivisions. */
  subdivisions: number;
  /** Explicitly hold defined mother tiles until their first particle sample. Default false. */
  holdParentUntilRelease?: boolean;
  particles: DropObservedFragmentDefinition[];
}
export interface DropObservedFragmentPose extends Omit<DropObservedFragmentDefinition, 'keys'> {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  opacity: number;
  /** Present only when an interpolated key explicitly controls rounded-cube shape. */
  cornerRadius?: number;
  /** Bracket indexes make interpolation evidence inspectable. */
  startKey: number;
  endKey: number;
  fraction: number;
}
export const DROP_OBSERVED_FRAGMENT_MAX_KEYS_PER_WAVE = 32768;
export const DROP_OBSERVED_FRAGMENT_MAX_KEYS_PER_CALIBRATION = 131072;
export const DROP_OBSERVED_FRAGMENT_MIN_FRAME_OFFSET = -30;

const fail = (path: string): never => {
  throw new Error(`DROP_REFERENCE_CALIBRATION_INVALID: ${path}`);
};
const number = (value: unknown, path: string, lo: number, hi: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi
    ? value
    : fail(path);
const integer = (value: unknown, path: string, lo: number, hi: number) => {
  const result = number(value, path, lo, hi);
  return Number.isInteger(result) ? result : fail(path);
};
const object = (value: unknown, path: string, allowed: string[]): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    fail(path);
  return value as Record<string, unknown>;
};
export function isDropObservedFragmentMotionV2(
  value: unknown,
): value is DropObservedFragmentMotionV2 {
  return !!value && typeof value === 'object' && 'version' in value && value.version === 2;
}
/** Closed parser shared by public calibration and internal presentation consumers. */
export function parseDropObservedFragmentMotionV2(
  value: unknown,
  path = 'observedFragmentMotionV2',
): DropObservedFragmentMotionV2 {
  const motion = object(value, path, [
    'version',
    'coordinateSpace',
    'canonicalFps',
    'subdivisions',
    'holdParentUntilRelease',
    'particles',
  ]);
  if (motion.version !== 2 || motion.coordinateSpace !== 'source-stage-pixels') fail(path);
  const subdivisions = integer(motion.subdivisions, `${path}.subdivisions`, 1, 8);
  if (
    motion.holdParentUntilRelease !== undefined &&
    typeof motion.holdParentUntilRelease !== 'boolean'
  )
    fail(`${path}.holdParentUntilRelease`);
  if (
    !Array.isArray(motion.particles) ||
    motion.particles.length < 1 ||
    motion.particles.length > 8192
  )
    fail(`${path}.particles`);
  const ids = new Set<number>(),
    bindings = new Set<string>();
  let totalKeys = 0;
  const particles = (motion.particles as unknown[]).map(
    (value, index): DropObservedFragmentDefinition => {
      const p = `${path}.particles.${index}`,
        particle = object(value, p, [
          'id',
          'cellId',
          'ix',
          'iy',
          'depthIndex',
          'sizePixels',
          'material',
          'color',
          'keys',
        ]);
      const id = integer(particle.id, `${p}.id`, 0, 1048575);
      if (ids.has(id)) fail(`${p}.id duplicate`);
      ids.add(id);
      if (
        typeof particle.cellId !== 'string' ||
        !particle.cellId.length ||
        particle.cellId.length > 160
      )
        fail(`${p}.cellId`);
      const cellId = particle.cellId as string,
        ix = integer(particle.ix, `${p}.ix`, 0, subdivisions - 1),
        iy = integer(particle.iy, `${p}.iy`, 0, subdivisions - 1);
      const depthIndex = integer(particle.depthIndex, `${p}.depthIndex`, 0, 7),
        binding = `${cellId}:${ix}:${iy}:${depthIndex}`;
      if (bindings.has(binding)) fail(`${p}.native binding duplicate`);
      bindings.add(binding);
      if (particle.material !== 'parent-uv' && particle.material !== 'solid') fail(`${p}.material`);
      if (
        particle.color !== undefined &&
        (typeof particle.color !== 'string' || !/^#[\da-f]{6}$/i.test(particle.color))
      )
        fail(`${p}.color`);
      if (!Array.isArray(particle.keys) || !particle.keys.length || particle.keys.length > 256)
        fail(`${p}.keys`);
      totalKeys += (particle.keys as unknown[]).length;
      if (totalKeys > DROP_OBSERVED_FRAGMENT_MAX_KEYS_PER_WAVE) fail(`${path}.totalKeys`);
      const keys = (particle.keys as unknown[]).map((value, index): DropObservedFragmentKey => {
        const k = `${p}.keys.${index}`;
        if (
          !Array.isArray(value) ||
          (value.length !== 8 && value.length !== 9 && value.length !== 10)
        )
          fail(k);
        const a = value as unknown[];
        const key: DropObservedFragmentKey = [
          integer(a[0], `${k}.frameOffset`, DROP_OBSERVED_FRAGMENT_MIN_FRAME_OFFSET, 864000),
          number(a[1], `${k}.x`, -1080, 2160),
          number(a[2], `${k}.y`, -1920, 7680),
          number(a[3], `${k}.z`, -7680, 7680),
          number(a[4], `${k}.scale`, 0.01, 16),
          number(a[5], `${k}.rotationX`, -32 * Math.PI, 32 * Math.PI),
          number(a[6], `${k}.rotationY`, -32 * Math.PI, 32 * Math.PI),
          number(a[7], `${k}.rotationZ`, -32 * Math.PI, 32 * Math.PI),
        ];
        if (a.length >= 9) key.push(number(a[8], `${k}.opacity`, 0, 1));
        if (a.length === 10) key.push(number(a[9], `${k}.cornerRadius`, 0, 0.22));
        return key;
      });
      if (keys.some((key, index) => index > 0 && key[0] <= keys[index - 1]![0]))
        fail(`${p}.keys.frameOffset must strictly increase`);
      return {
        id,
        cellId,
        ix,
        iy,
        depthIndex,
        sizePixels: number(particle.sizePixels, `${p}.sizePixels`, 0.25, 540),
        material: particle.material as DropObservedFragmentDefinition['material'],
        ...(particle.color === undefined ? {} : { color: particle.color as string }),
        keys,
      };
    },
  );
  return {
    version: 2,
    coordinateSpace: 'source-stage-pixels',
    canonicalFps: integer(motion.canonicalFps, `${path}.canonicalFps`, 1, 240),
    subdivisions,
    ...(motion.holdParentUntilRelease === undefined
      ? {}
      : { holdParentUntilRelease: motion.holdParentUntilRelease as boolean }),
    particles,
  };
}

/** Exact endpoints, no IDW, extrapolation, procedural motion fallback or mutable state.
 * Missing radius endpoints inherit the clear's radius; legacy keys retain their old pose shape.
 */
export function sampleDropObservedFragmentMotionV2(
  motion: DropObservedFragmentMotionV2,
  elapsedSeconds: number,
  fallbackCornerRadius = 0.065,
): DropObservedFragmentPose[] {
  if (!Number.isFinite(elapsedSeconds)) return [];
  const offset = elapsedSeconds * motion.canonicalFps,
    poses: DropObservedFragmentPose[] = [];
  for (const { keys, ...definition } of motion.particles) {
    // Tolerate floating-point conversion of an exact canonical endpoint only.
    const first = keys[0]!,
      last = keys.at(-1)!;
    if (offset < first[0] - 1e-8 || offset > last[0] + 1e-8) continue;
    const at = Math.max(first[0], Math.min(last[0], offset));
    let lo = 0,
      hi = keys.length - 1;
    while (lo < hi) {
      const middle = Math.floor((lo + hi) / 2);
      if (keys[middle]![0] < at) lo = middle + 1;
      else hi = middle;
    }
    const endKey = lo,
      startKey = keys[endKey]![0] === at ? endKey : Math.max(0, endKey - 1),
      a = keys[startKey]!,
      b = keys[endKey]!;
    const fraction = a[0] === b[0] ? 0 : (at - a[0]) / (b[0] - a[0]);
    const lerp = (index: number) => a[index]! + (b[index]! - a[index]!) * fraction;
    const opacity = (a[8] ?? 1) + ((b[8] ?? 1) - (a[8] ?? 1)) * fraction;
    if (opacity <= 0) continue;
    const hasRadius = a[9] !== undefined || b[9] !== undefined;
    const fallback = hasRadius
      ? number(fallbackCornerRadius, 'observedFragmentMotionV2.fallbackCornerRadius', 0, 0.22)
      : 0;
    const radiusA = a[9] ?? fallback,
      radiusB = b[9] ?? fallback;
    poses.push({
      ...definition,
      x: lerp(1),
      y: lerp(2),
      z: lerp(3),
      scale: lerp(4),
      rotationX: lerp(5),
      rotationY: lerp(6),
      rotationZ: lerp(7),
      opacity,
      ...(hasRadius ? { cornerRadius: radiusA + (radiusB - radiusA) * fraction } : {}),
      startKey,
      endKey,
      fraction,
    });
  }
  // +Z points towards the viewer. Ties never depend on definition/key order.
  return poses.sort((a, b) => a.z - b.z || a.id - b.id);
}
export function dropObservedFragmentLastFrame(motion: DropObservedFragmentMotionV2): number {
  return Math.max(...motion.particles.map((particle) => particle.keys.at(-1)![0]));
}
/** Earliest authored visibility; cue pre-roll never changes the observation origin. */
export function dropObservedFragmentFirstFrame(motion: DropObservedFragmentMotionV2): number {
  return Math.min(...motion.particles.map((particle) => particle.keys[0]![0]));
}
/** Only explicitly defined mothers can be held; missing particles are never invented. */
export function dropObservedFragmentHeldParentIds(
  motion: DropObservedFragmentMotionV2,
  elapsedSeconds: number,
): string[] {
  if (!motion.holdParentUntilRelease || !Number.isFinite(elapsedSeconds)) return [];
  const firstByCell = new Map<string, number>(),
    offset = elapsedSeconds * motion.canonicalFps;
  for (const particle of motion.particles)
    firstByCell.set(
      particle.cellId,
      Math.min(firstByCell.get(particle.cellId) ?? Infinity, particle.keys[0]![0]),
    );
  return [...firstByCell]
    .filter(([, first]) => offset < first - 1e-8)
    .map(([id]) => id)
    .sort();
}

const num = (minimum: number, maximum: number) => ({ type: 'number', minimum, maximum });
const int = (minimum: number, maximum: number) => ({ type: 'integer', minimum, maximum });
export const DROP_OBSERVED_FRAGMENT_MOTION_V2_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'coordinateSpace', 'canonicalFps', 'subdivisions', 'particles'],
  properties: {
    version: { const: 2 },
    coordinateSpace: { const: 'source-stage-pixels' },
    canonicalFps: int(1, 240),
    subdivisions: int(1, 8),
    holdParentUntilRelease: { type: 'boolean' },
    particles: {
      type: 'array',
      minItems: 1,
      maxItems: 8192,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'cellId', 'ix', 'iy', 'depthIndex', 'sizePixels', 'material', 'keys'],
        properties: {
          id: int(0, 1048575),
          cellId: { type: 'string', minLength: 1, maxLength: 160 },
          ix: int(0, 7),
          iy: int(0, 7),
          depthIndex: int(0, 7),
          sizePixels: num(0.25, 540),
          material: { enum: ['parent-uv', 'solid'] },
          color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          keys: {
            type: 'array',
            minItems: 1,
            maxItems: 256,
            items: {
              type: 'array',
              minItems: 8,
              maxItems: 10,
              prefixItems: [
                int(DROP_OBSERVED_FRAGMENT_MIN_FRAME_OFFSET, 864000),
                num(-1080, 2160),
                num(-1920, 7680),
                num(-7680, 7680),
                num(0.01, 16),
                num(-32 * Math.PI, 32 * Math.PI),
                num(-32 * Math.PI, 32 * Math.PI),
                num(-32 * Math.PI, 32 * Math.PI),
                num(0, 1),
                num(0, 0.22),
              ],
            },
          },
        },
      },
    },
  },
};
