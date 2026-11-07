import {
  roundedFragmentCubeLighting,
  type RoundedCubeCastShadowOptions,
  type RoundedCubeFaceId,
  type RoundedCubeLightOptions,
  type RoundedCubeLighting,
  type RoundedCubeVector as Vector,
} from './roundedFragmentCube';

/** An authored rest-space partition, not a recovered source mesh or hidden inventory. */
export interface PartitionedSolidProfile {
  readonly version: 1;
  readonly coordinateSpace: 'mother-front-uv';
  readonly vertices: readonly (readonly [number, number])[];
  readonly regions: readonly { readonly slot: number; readonly boundary: readonly number[] }[];
  /** Full depth / full mother width. All four solids share this actual thickness. */
  readonly motherDepth: number;
}
export interface PartitionedSolidGeometryOptions {
  readonly profile: PartitionedSolidProfile;
  readonly ix: number;
  readonly iy: number;
  readonly subdivisions?: number;
  readonly depthLayers?: number;
  readonly depthIndex?: number;
  /** Radius in nominal half-mother units, also used by observed V2 radius keys. */
  readonly cornerRadius?: number;
  readonly bevelSegments?: number;
}
export interface PartitionedSolidFace {
  readonly kind: 'front' | 'back' | 'outer-side' | 'cut-side' | 'bevel';
  readonly faceId?: RoundedCubeFaceId;
  readonly neighborSlot?: number;
  readonly points: readonly Vector[];
  readonly normal: Vector;
  readonly distance: number;
}
export interface PartitionedSolidGeometry {
  readonly slot: number;
  /** Area centroid in mother UV; a modeled pivot, never an observed physical COM. */
  readonly pivot: { readonly x: number; readonly y: number; readonly z: 0 };
  readonly motherDepth: number;
  /** Raw closed faces in mother UV/depth coordinates, for partition proofs. */
  readonly rawFaces: readonly PartitionedSolidFace[];
  /** Closed rounded faces in nominal half-mother units around the area centroid. */
  readonly faces: readonly PartitionedSolidFace[];
  readonly rawVolume: number;
  readonly beveledVolume: number;
  readonly requestedRadius: number;
  readonly effectiveRadius: number;
}
export interface PartitionedSolidProjectionOptions
  extends PartitionedSolidGeometryOptions,
    RoundedCubeLightOptions {
  /** Nominal half-mother width. Never independently normalize a region's bbox. */
  readonly size: number;
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
}
export interface PartitionedSolidProjectedFace extends PartitionedSolidFace {
  readonly depth: number;
  readonly lighting: RoundedCubeLighting;
}
export interface PartitionedSolidProjection {
  readonly faces: readonly PartitionedSolidProjectedFace[];
  readonly silhouette: readonly Vector[];
  readonly frontTransform: readonly [number, number, number, number, number, number];
  readonly parentSize: number;
  readonly requestedRadius: number;
  readonly effectiveRadius: number;
  /** All real mesh vertices, including hidden faces; suitable for exit proofs. */
  readonly bounds: {
    readonly minX: number;
    readonly maxX: number;
    readonly minY: number;
    readonly maxY: number;
    readonly minZ: number;
    readonly maxZ: number;
  } | null;
}
export interface PartitionedSolidOptions extends PartitionedSolidProjectionOptions {
  readonly color: string;
  readonly faceColors?: Partial<Readonly<Record<RoundedCubeFaceId, string>>>;
  readonly lightColor?: string;
  readonly shadow?: number;
  readonly castShadow?: RoundedCubeCastShadowOptions;
  /** Full mother artwork, clipped only to the surviving original front plane. */
  readonly facePainter?: (
    context: CanvasRenderingContext2D,
    info: { size: number; color: string; lighting: RoundedCubeLighting },
  ) => void;
}

const EPS = 1e-9;
type Point = readonly [number, number];
const fail = (path: string): never => {
  throw new Error(`PARTITIONED_SOLID_PROFILE_INVALID: ${path}`);
};
const number = (v: unknown, lo: number, hi: number, path: string) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : fail(path);
const object = (v: unknown, keys: string[], path: string): Record<string, unknown> => {
  if (
    !v ||
    typeof v !== 'object' ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    fail(path);
  return v as Record<string, unknown>;
};
const cross2 = (a: Point, b: Point, c: Point) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
const area2 = (p: readonly Point[]) =>
  p.reduce((sum, a, i) => {
    const b = p[(i + 1) % p.length]!;
    return sum + a[0] * b[1] - b[0] * a[1];
  }, 0);
function intersection(a: readonly Point[], b: readonly Point[]): Point[] {
  let polygon = [...a];
  for (let i = 0; i < b.length; i++) {
    const first = b[i]!,
      second = b[(i + 1) % b.length]!,
      result: Point[] = [];
    for (let j = 0; j < polygon.length; j++) {
      const p = polygon[j]!,
        q = polygon[(j + 1) % polygon.length]!,
        dp = cross2(first, second, p),
        dq = cross2(first, second, q);
      if (dp >= -EPS) result.push(p);
      if (dp >= -EPS !== dq >= -EPS) {
        const t = dp / (dp - dq);
        result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
    polygon = result;
  }
  return polygon;
}
/** Strict positive/closed public shape, followed by geometric partition checks. */
export function parsePartitionedSolidProfile(
  value: unknown,
  path = 'fragmentPartitionProfile',
): PartitionedSolidProfile {
  const q = object(
    value,
    ['version', 'coordinateSpace', 'vertices', 'regions', 'motherDepth'],
    path,
  );
  if (q.version !== 1 || q.coordinateSpace !== 'mother-front-uv') fail(path);
  if (!Array.isArray(q.vertices) || q.vertices.length < 8 || q.vertices.length > 24)
    fail(path + '.vertices');
  const vertices = (q.vertices as unknown[]).map((v, i): Point => {
    if (!Array.isArray(v) || v.length !== 2) fail(`${path}.vertices.${i}`);
    const p = v as unknown[];
    return [
      number(p[0], 0, 1, `${path}.vertices.${i}.u`),
      number(p[1], 0, 1, `${path}.vertices.${i}.v`),
    ];
  });
  for (let i = 0; i < vertices.length; i++)
    for (let j = 0; j < i; j++)
      if (Math.hypot(vertices[i]![0] - vertices[j]![0], vertices[i]![1] - vertices[j]![1]) < EPS)
        fail(path + '.vertices duplicate');
  if (!Array.isArray(q.regions) || q.regions.length !== 4) fail(path + '.regions');
  const slots = new Set<number>(),
    used = new Set<number>(),
    edges = new Map<string, Array<[number, number]>>();
  const regions = (q.regions as unknown[]).map((v, i) => {
    const r = object(v, ['slot', 'boundary'], `${path}.regions.${i}`),
      slot = number(r.slot, 0, 3, `${path}.regions.${i}.slot`);
    if (!Number.isInteger(slot) || slots.has(slot))
      fail(path + '.regions.slot duplicate or noninteger');
    slots.add(slot);
    if (!Array.isArray(r.boundary) || r.boundary.length < 3 || r.boundary.length > 12)
      fail(`${path}.regions.${i}.boundary`);
    const boundary = (r.boundary as unknown[]).map((v, j) => {
      const k = number(v, 0, vertices.length - 1, `${path}.regions.${i}.boundary.${j}`);
      if (!Number.isInteger(k)) fail(path + '.boundary index');
      used.add(k);
      return k;
    });
    if (new Set(boundary).size !== boundary.length) fail(path + '.boundary duplicate');
    const polygon = boundary.map((k) => vertices[k]!);
    if (area2(polygon) <= EPS) fail(path + '.boundary must be counterclockwise');
    // Every edge is a supporting half-plane; this also rejects stars/self crossings.
    for (let j = 0; j < polygon.length; j++) {
      const a = polygon[j]!,
        b = polygon[(j + 1) % polygon.length]!;
      if (polygon.some((p) => cross2(a, b, p) < -EPS)) fail(path + '.boundary must be convex');
      const first = boundary[j]!,
        second = boundary[(j + 1) % boundary.length]!,
        key = [first, second].sort((a, b) => a - b).join(':');
      edges.set(key, [...(edges.get(key) ?? []), [first, second]]);
    }
    return { slot, boundary };
  });
  if (used.size !== vertices.length) fail(path + '.vertices unused');
  for (const owners of edges.values()) {
    if (owners.length === 2) {
      if (owners[0]![0] !== owners[1]![1] || owners[0]![1] !== owners[1]![0])
        fail(path + '.shared edge orientation');
    } else if (owners.length === 1) {
      const [a, b] = owners[0]!.map((i) => vertices[i]!) as [Point, Point];
      if (
        !(
          [0, 1].some((k) => a[0] === k && b[0] === k) ||
          [0, 1].some((k) => a[1] === k && b[1] === k)
        )
      )
        fail(path + '.unpaired internal edge');
    } else fail(path + '.edge ownership');
  }
  const polygons = regions.map((r) => r.boundary.map((i) => vertices[i]!));
  if (Math.abs(polygons.reduce((sum, p) => sum + area2(p) / 2, 0) - 1) > EPS * 16)
    fail(path + '.regions must cover the mother');
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < i; j++)
      if (Math.abs(area2(intersection(polygons[i]!, polygons[j]!))) > EPS * 16)
        fail(path + '.regions overlap');
  return {
    version: 1,
    coordinateSpace: 'mother-front-uv',
    vertices,
    regions,
    motherDepth: number(q.motherDepth, 0.08, 1, path + '.motherDepth'),
  };
}
export const PARTITIONED_SOLID_PROFILE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'coordinateSpace', 'vertices', 'regions', 'motherDepth'],
  properties: {
    version: { const: 1 },
    coordinateSpace: { const: 'mother-front-uv' },
    motherDepth: { type: 'number', minimum: 0.08, maximum: 1 },
    vertices: {
      type: 'array',
      minItems: 8,
      maxItems: 24,
      items: {
        type: 'array',
        minItems: 2,
        maxItems: 2,
        items: { type: 'number', minimum: 0, maximum: 1 },
      },
    },
    regions: {
      type: 'array',
      minItems: 4,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slot', 'boundary'],
        properties: {
          slot: { type: 'integer', minimum: 0, maximum: 3 },
          boundary: {
            type: 'array',
            minItems: 3,
            maxItems: 12,
            uniqueItems: true,
            items: { type: 'integer', minimum: 0, maximum: 23 },
          },
        },
      },
    },
  },
};

const add = (a: Vector, b: Vector): Vector => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vector, b: Vector): Vector => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const mul = (a: Vector, s: number): Vector => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const dot = (a: Vector, b: Vector) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vector, b: Vector): Vector => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const length = (p: Vector) => Math.hypot(p.x, p.y, p.z);
const unit = (p: Vector) => mul(p, 1 / Math.max(1e-20, length(p)));
const close = (a: Vector, b: Vector) => length(sub(a, b)) < EPS * 8;
const clamp = (v: number | undefined, fallback: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v !== undefined && Number.isFinite(v) ? v : fallback));
function unique(points: readonly Vector[]) {
  const result: Vector[] = [];
  for (const p of points) if (!result.some((q) => close(p, q))) result.push(p);
  return result;
}
function volume(faces: readonly PartitionedSolidFace[]) {
  let v = 0;
  for (const f of faces)
    for (let i = 1; i + 1 < f.points.length; i++)
      v += dot(f.points[0]!, cross(f.points[i]!, f.points[i + 1]!)) / 6;
  return Math.abs(v);
}
/** Modeled planar centroid. It does not imply physical/source mass recovery. */
export function partitionedSolidRegionPivot(
  profile: PartitionedSolidProfile,
  slot: number,
): { x: number; y: number; z: 0 } {
  const r = profile.regions.find((r) => r.slot === slot);
  if (!r) return fail('slot');
  const p = r.boundary.map((i) => profile.vertices[i]!),
    twice = area2(p);
  let x = 0,
    y = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!,
      b = p[(i + 1) % p.length]!,
      c = a[0] * b[1] - b[0] * a[1];
    x += (a[0] + b[0]) * c;
    y += (a[1] + b[1]) * c;
  }
  return { x: x / (3 * twice), y: y / (3 * twice), z: 0 };
}
function cap(points: Vector[], normal: Vector): Vector[] {
  const ps = unique(points);
  if (ps.length < 3) return [];
  const center = mul(ps.reduce(add), 1 / ps.length),
    axis = Math.abs(normal.z) < 0.8 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 },
    u = unit(cross(axis, normal)),
    v = cross(normal, u);
  return ps.sort(
    (a, b) =>
      Math.atan2(dot(sub(a, center), v), dot(sub(a, center), u)) -
      Math.atan2(dot(sub(b, center), v), dot(sub(b, center), u)),
  );
}
function clip(
  faces: readonly PartitionedSolidFace[],
  normal: Vector,
  distance: number,
): PartitionedSolidFace[] {
  const result: PartitionedSolidFace[] = [],
    cuts: Vector[] = [];
  for (const f of faces) {
    const ps: Vector[] = [];
    for (let i = 0; i < f.points.length; i++) {
      const a = f.points[i]!,
        b = f.points[(i + 1) % f.points.length]!,
        da = dot(normal, a) - distance,
        db = dot(normal, b) - distance;
      if (da <= EPS) ps.push(a);
      if (da <= EPS !== db <= EPS) {
        const p = add(a, mul(sub(b, a), da / (da - db)));
        ps.push(p);
        cuts.push(p);
      } else if (Math.abs(da) <= EPS) cuts.push(a);
    }
    const points = ps.filter((p, i) => !close(p, ps[(i + ps.length - 1) % ps.length]!));
    if (
      points.length >= 3 &&
      length(
        points.reduce((sum, p, i) => add(sum, cross(p, points[(i + 1) % points.length]!)), {
          x: 0,
          y: 0,
          z: 0,
        }),
      ) >
        EPS ** 2
    )
      result.push({ ...f, points });
  }
  const points = cap(cuts, normal);
  if (
    points.length >= 3 &&
    faces.some((f) => f.points.some((p) => dot(normal, p) - distance > EPS))
  )
    result.push({ kind: 'bevel', points, normal, distance });
  return result;
}
function bevel(
  raw: readonly PartitionedSolidFace[],
  radius: number,
  steps: number,
): readonly PartitionedSolidFace[] {
  if (radius === 0) return raw;
  let core = raw;
  for (const f of raw) core = clip(core, f.normal, f.distance - radius);
  const corePoints = unique(core.flatMap((f) => f.points)),
    normals: Vector[] = [];
  const append = (n: Vector) => {
    const q = unit(n);
    if (length(q) > 0.9 && !normals.some((p) => dot(p, q) > 1 - EPS)) normals.push(q);
  };
  for (let i = 0; i < raw.length; i++)
    for (let j = i + 1; j < raw.length; j++) {
      const a = raw[i]!,
        b = raw[j]!;
      if (a.points.filter((p) => b.points.some((q) => close(p, q))).length < 2) continue;
      for (let k = 1; k <= steps; k++)
        append(add(mul(a.normal, 1 - k / (steps + 1)), mul(b.normal, k / (steps + 1))));
    }
  for (const p of unique(raw.flatMap((f) => f.points)))
    append(
      raw
        .filter((f) => Math.abs(dot(f.normal, p) - f.distance) < EPS * 16)
        .map((f) => f.normal)
        .reduce(add),
    );
  let result = raw;
  for (const n of normals)
    result = clip(result, n, Math.max(...corePoints.map((p) => dot(n, p))) + radius);
  return result;
}
function frozenFaces(faces: readonly PartitionedSolidFace[]) {
  return Object.freeze(
    faces.map((f) =>
      Object.freeze({
        ...f,
        normal: Object.freeze({ ...f.normal }),
        points: Object.freeze(f.points.map((p) => Object.freeze({ ...p }))),
      }),
    ),
  );
}
export const PARTITIONED_SOLID_GEOMETRY_CACHE_LIMIT = 128;
const cache = new Map<string, PartitionedSolidGeometry>();
export function partitionedSolidGeometryCacheSize(): number {
  return cache.size;
}
export function createPartitionedSolidGeometry(
  options: PartitionedSolidGeometryOptions,
): PartitionedSolidGeometry {
  if (
    (options.subdivisions ?? 2) !== 2 ||
    (options.depthLayers ?? 1) !== 1 ||
    (options.depthIndex ?? 0) !== 0 ||
    !Number.isInteger(options.ix) ||
    !Number.isInteger(options.iy) ||
    options.ix < 0 ||
    options.ix > 1 ||
    options.iy < 0 ||
    options.iy > 1
  )
    throw new Error('PARTITIONED_SOLID_UNSUPPORTED_PARTITION: requires n2 and one depth');
  const radius = clamp(options.cornerRadius, 0.065, 0, 0.22),
    steps = Math.round(clamp(options.bevelSegments, 2, 1, 4)),
    slot = options.ix + options.iy * 2;
  const key = `${JSON.stringify(options.profile)}:${slot}:${radius}:${steps}`,
    known = cache.get(key);
  if (known) return known;
  const profile = parsePartitionedSolidProfile(options.profile),
    region = profile.regions.find((r) => r.slot === slot)!,
    pivot = partitionedSolidRegionPivot(profile, slot),
    z = profile.motherDepth / 2;
  const front = region.boundary.map((i) => ({
    x: profile.vertices[i]![0],
    y: profile.vertices[i]![1],
    z,
  }));
  const raw: PartitionedSolidFace[] = [
    { kind: 'front', faceId: 'front', points: front, normal: { x: 0, y: 0, z: 1 }, distance: z },
    {
      kind: 'back',
      faceId: 'back',
      points: [...front].reverse().map((p) => ({ ...p, z: -z })),
      normal: { x: 0, y: 0, z: -1 },
      distance: z,
    },
  ];
  for (let i = 0; i < front.length; i++) {
    const a = front[i]!,
      b = front[(i + 1) % front.length]!,
      normal = unit({ x: b.y - a.y, y: a.x - b.x, z: 0 }),
      first = region.boundary[i]!,
      second = region.boundary[(i + 1) % front.length]!;
    const neighbor = profile.regions.find(
      (r) =>
        r.slot !== slot &&
        r.boundary.some(
          (k, j) => k === second && r.boundary[(j + 1) % r.boundary.length] === first,
        ),
    );
    const faceId: RoundedCubeFaceId | undefined = neighbor
      ? undefined
      : a.x === 0 && b.x === 0
        ? 'left'
        : a.x === 1 && b.x === 1
          ? 'right'
          : a.y === 0 && b.y === 0
            ? 'top'
            : 'bottom';
    raw.push({
      kind: neighbor ? 'cut-side' : 'outer-side',
      ...(faceId ? { faceId } : {}),
      ...(neighbor ? { neighborSlot: neighbor.slot } : {}),
      points: [a, { ...a, z: -z }, { ...b, z: -z }, b],
      normal,
      distance: dot(normal, a),
    });
  }
  // A continuous conservative cap keeps the modeled centroid strictly in the
  // inset core; unlike retry-halving it never introduces radius discontinuities.
  const effective = Math.min(
      radius / 2,
      0.9 * Math.min(...raw.map((f) => f.distance - dot(f.normal, pivot))),
    ),
    rounded = bevel(raw, effective, steps);
  const faces = rounded.map((f) => ({
    ...f,
    points: f.points.map((p) => mul(sub(p, pivot), 2)),
    distance: (f.distance - dot(f.normal, pivot)) * 2,
  }));
  const geometry: PartitionedSolidGeometry = Object.freeze({
    slot,
    pivot: Object.freeze(pivot),
    motherDepth: profile.motherDepth,
    rawFaces: frozenFaces(raw),
    faces: frozenFaces(faces),
    rawVolume: volume(raw),
    beveledVolume: volume(rounded),
    requestedRadius: radius,
    effectiveRadius: effective * 2,
  });
  if (cache.size >= PARTITIONED_SOLID_GEOMETRY_CACHE_LIMIT)
    cache.delete(cache.keys().next().value!);
  cache.set(key, geometry);
  return geometry;
}
function rotateFor(o: PartitionedSolidProjectionOptions) {
  const rx = clamp(o.rotationX, 0, -1e12, 1e12) % (2 * Math.PI),
    ry = clamp(o.rotationY, 0, -1e12, 1e12) % (2 * Math.PI),
    rz = clamp(o.rotationZ, 0, -1e12, 1e12) % (2 * Math.PI),
    cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  return (p: Vector): Vector => {
    const y = p.y * cx - p.z * sx,
      z = p.y * sx + p.z * cx,
      x = p.x * cy + z * sy,
      depth = -p.x * sy + z * cy;
    return { x: x * cz - y * sz, y: x * sz + y * cz, z: depth };
  };
}
function hull(points: readonly Vector[]): Vector[] {
  const ps = [...points].sort((a, b) => a.x - b.x || a.y - b.y),
    half = (p: Vector[]) => {
      const out: Vector[] = [];
      for (const q of p) {
        while (out.length >= 2 && cross(sub(out.at(-1)!, out.at(-2)!), sub(q, out.at(-1)!)).z <= 0)
          out.pop();
        out.push(q);
      }
      out.pop();
      return out;
    };
  return [...half(ps), ...half([...ps].reverse())];
}
export function projectPartitionedSolid(
  o: PartitionedSolidProjectionOptions,
): PartitionedSolidProjection {
  if (!Number.isFinite(o.size) || o.size <= 0)
    return {
      faces: [],
      silhouette: [],
      frontTransform: [1, 0, 0, 1, 0, 0],
      parentSize: 0,
      requestedRadius: 0,
      effectiveRadius: 0,
      bounds: null,
    };
  const g = createPartitionedSolidGeometry(o),
    rotate = rotateFor(o),
    points = g.faces.flatMap((f) => f.points.map((p) => mul(rotate(p), o.size)));
  const faces = g.faces
    .map((f) => {
      const normal = rotate(f.normal),
        points = f.points.map((p) => mul(rotate(p), o.size));
      return {
        ...f,
        points,
        normal,
        depth: points.reduce((s, p) => s + p.z, 0) / points.length,
        lighting: roundedFragmentCubeLighting(normal, o),
      };
    })
    .filter((f) => f.normal.z > 1e-10)
    .sort((a, b) => a.depth - b.depth);
  const ex = rotate({ x: 1, y: 0, z: 0 }),
    ey = rotate({ x: 0, y: 1, z: 0 }),
    origin = rotate({
      x: -g.pivot.x * o.size * 2,
      y: -g.pivot.y * o.size * 2,
      z: g.motherDepth * o.size,
    });
  return {
    faces,
    silhouette: hull(points),
    frontTransform: [ex.x, ex.y, ey.x, ey.y, origin.x, origin.y],
    parentSize: o.size * 2,
    requestedRadius: g.requestedRadius,
    effectiveRadius: g.effectiveRadius,
    bounds: {
      minX: Math.min(...points.map((p) => p.x)),
      maxX: Math.max(...points.map((p) => p.x)),
      minY: Math.min(...points.map((p) => p.y)),
      maxY: Math.max(...points.map((p) => p.y)),
      minZ: Math.min(...points.map((p) => p.z)),
      maxZ: Math.max(...points.map((p) => p.z)),
    },
  };
}
function path(c: CanvasRenderingContext2D, ps: readonly Vector[]) {
  c.beginPath();
  ps.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
}
function rgb(color: string) {
  const n = Number.parseInt(/^#[\da-f]{6}$/i.test(color) ? color.slice(1) : 'c0c0c0', 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
/** Four real complementary bodies. No video layers, repeated stickers or proxy boxes. */
export function drawPartitionedSolid(
  c: CanvasRenderingContext2D,
  o: PartitionedSolidOptions,
): void {
  const p = projectPartitionedSolid(o);
  if (!p.faces.length) return;
  const light = rgb(o.lightColor ?? '#ffffff'),
    limit = o.specularStrength === undefined ? 0.4 : clamp(o.specularStrength, 0.4, 0.4, 0.95);
  c.save();
  try {
    const strength = clamp(o.shadow, 0, 0, 1),
      cast = o.castShadow;
    if (strength > 0) {
      c.save();
      try {
        c.translate(
          o.size * clamp(cast?.offsetX, 0.12, -2, 2),
          o.size * clamp(cast?.offsetY, 0.18, -2, 2),
        );
        c.globalAlpha *= strength * clamp(cast?.opacity, 0.2, 0, 1);
        c.fillStyle = cast?.color ?? '#202020';
        c.shadowColor = c.fillStyle;
        c.shadowBlur = o.size * clamp(cast?.blur, 0.15, 0, 2);
        c.shadowOffsetX = 0;
        c.shadowOffsetY = 0;
        path(c, p.silhouette);
        c.fill();
      } finally {
        c.restore();
      }
    }
    path(c, p.silhouette);
    c.fillStyle = o.color;
    c.fill();
    for (const f of p.faces) {
      const color = f.faceId ? (o.faceColors?.[f.faceId] ?? o.color) : o.color,
        base = rgb(color),
        mix = clamp(
          f.lighting.specular + Math.max(0, f.lighting.brightness - 1) * 0.35,
          0,
          0,
          limit,
        );
      path(c, f.points);
      c.fillStyle = `rgb(${base.map((v, i) => Math.round(v * Math.min(1, f.lighting.brightness) * (1 - mix) + light[i]! * mix)).join(',')})`;
      c.fill();
      if (f.kind !== 'front' || !o.facePainter) continue;
      c.save();
      try {
        path(c, f.points);
        c.clip();
        c.transform(...p.frontTransform);
        o.facePainter(c, { size: p.parentSize, color, lighting: f.lighting });
        if (f.lighting.brightness < 1) {
          c.save();
          try {
            c.globalAlpha *= 1 - f.lighting.brightness;
            c.fillStyle = '#000000';
            c.fillRect(0, 0, p.parentSize, p.parentSize);
          } finally {
            c.restore();
          }
        }
        if (mix > 0) {
          c.save();
          try {
            c.globalAlpha *= mix;
            c.fillStyle = o.lightColor ?? '#ffffff';
            c.fillRect(0, 0, p.parentSize, p.parentSize);
          } finally {
            c.restore();
          }
        }
      } finally {
        c.restore();
      }
    }
  } finally {
    c.restore();
  }
}
