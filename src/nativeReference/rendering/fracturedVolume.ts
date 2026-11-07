import {
  roundedFragmentCubeLighting,
  type RoundedCubeCastShadowOptions,
  type RoundedCubeLightOptions,
  type RoundedCubeLighting,
  type RoundedCubeVector,
} from './roundedFragmentCube';

type Vector = RoundedCubeVector;
type OuterFace = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export interface FracturedVolumeGeometryOptions {
  /** All pieces of one parent must use this same stable seed. */
  seed?: number;
  /** Explicit alternative partition; center-three requires subdivisions=2 and
   * depthLayers=2. Its irregular sites are an authored reconstruction hypothesis. */
  seedPattern?: 'grid' | 'center-three';
  ix: number;
  iy: number;
  subdivisions?: number;
  /** Opt-in real depth partition; each half has its own complementary cells. */
  depthLayers?: 1 | 2;
  /** Zero is the front half, one the rear half when depthLayers is two. */
  depthIndex?: number;
  /** Rounded edge radius, in nominal fragment-size units. Zero disables bevels. */
  cornerRadius?: number;
  bevelSegments?: number;
}
export interface FracturedVolumeFace {
  kind: 'outer' | 'fracture' | 'bevel';
  /** Only original parent surfaces have an outer-face identity. */
  outerFace?: OuterFace;
  /** Reciprocal Voronoi cell index, for an exact raw cut interface. */
  neighborIndex?: number;
  points: Vector[];
  normal: Vector;
  distance: number;
}
export interface FracturedVolumeGeometry {
  subdivisions: number;
  ix: number;
  iy: number;
  cellIndex: number;
  depthLayers: 1 | 2;
  depthIndex: number;
  /** Mother-cube depth in mother-width units; not a measured source parameter. */
  motherDepth: number;
  /** Shared 3D seeds and exact closed partition, both in centered mother units. */
  seeds: Vector[];
  rawFaces: FracturedVolumeFace[];
  /** Beveled closed render mesh, in fragment-size units about its grid center. */
  faces: FracturedVolumeFace[];
  rawVolume: number;
  beveledVolume: number;
  effectiveRadius: number;
}
export interface FracturedVolumeProjectionOptions
  extends FracturedVolumeGeometryOptions,
    RoundedCubeLightOptions {
  /** A complete mother block is size × subdivisions wide. */
  size: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
}
export interface FracturedVolumeProjectedFace extends FracturedVolumeFace {
  depth: number;
  lighting: RoundedCubeLighting;
}
export interface FracturedVolumeProjection {
  faces: FracturedVolumeProjectedFace[];
  silhouette: Vector[];
  frontTransform: [number, number, number, number, number, number];
  backTransform: [number, number, number, number, number, number];
  depthLayers: 1 | 2;
  parentSize: number;
}
export interface FracturedVolumeOptions extends FracturedVolumeProjectionOptions {
  color: string;
  lightColor?: string;
  shadow?: number;
  castShadow?: RoundedCubeCastShadowOptions;
  /** The full original parent face is clipped to its surviving outer surface. */
  facePainter?: (
    context: CanvasRenderingContext2D,
    info: { size: number; color: string; lighting: RoundedCubeLighting },
  ) => void;
}

const EPS = 1e-9;
const MOTHER_DEPTH = 0.72;
const cache = new Map<string, FracturedVolumeGeometry>();
const clamp = (v: number | undefined, fallback: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(v) ? v! : fallback));
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
const unit = (p: Vector): Vector => mul(p, 1 / Math.max(1e-20, length(p)));
const close = (a: Vector, b: Vector) => length(sub(a, b)) < EPS * 8;
function unique(points: Vector[]): Vector[] {
  const result: Vector[] = [];
  for (const p of points) if (!result.some((q) => close(p, q))) result.push(p);
  return result;
}
function random(seed: number, index: number) {
  let h = (Math.floor(seed * 0x100000000) ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}
function makeBox(): FracturedVolumeFace[] {
  const z = MOTHER_DEPTH / 2;
  const face = (outerFace: OuterFace, normal: Vector, points: number[][]): FracturedVolumeFace => {
    const ps = points.map(([x, y, zz]) => ({ x: x!, y: y!, z: zz! }));
    return { kind: 'outer', outerFace, points: ps, normal, distance: dot(normal, ps[0]!) };
  };
  return [
    face('front', { x: 0, y: 0, z: 1 }, [
      [-0.5, -0.5, z],
      [0.5, -0.5, z],
      [0.5, 0.5, z],
      [-0.5, 0.5, z],
    ]),
    face('back', { x: 0, y: 0, z: -1 }, [
      [-0.5, 0.5, -z],
      [0.5, 0.5, -z],
      [0.5, -0.5, -z],
      [-0.5, -0.5, -z],
    ]),
    face('left', { x: -1, y: 0, z: 0 }, [
      [-0.5, -0.5, -z],
      [-0.5, -0.5, z],
      [-0.5, 0.5, z],
      [-0.5, 0.5, -z],
    ]),
    face('right', { x: 1, y: 0, z: 0 }, [
      [0.5, -0.5, z],
      [0.5, -0.5, -z],
      [0.5, 0.5, -z],
      [0.5, 0.5, z],
    ]),
    face('top', { x: 0, y: -1, z: 0 }, [
      [-0.5, -0.5, -z],
      [0.5, -0.5, -z],
      [0.5, -0.5, z],
      [-0.5, -0.5, z],
    ]),
    face('bottom', { x: 0, y: 1, z: 0 }, [
      [-0.5, 0.5, z],
      [0.5, 0.5, z],
      [0.5, 0.5, -z],
      [-0.5, 0.5, -z],
    ]),
  ];
}
function polygonNormal(points: Vector[]): Vector {
  // Newell's form remains stable when a clipped polygon starts with collinear points.
  return unit(
    points.reduce((n, p, i) => add(n, cross(p, points[(i + 1) % points.length]!)), {
      x: 0,
      y: 0,
      z: 0,
    }),
  );
}
function orderedCap(points: Vector[], normal: Vector): Vector[] {
  const ps = unique(points);
  if (ps.length < 3) return [];
  const center = mul(ps.reduce(add), 1 / ps.length);
  const axis = Math.abs(normal.z) < 0.8 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
  const u = unit(cross(axis, normal)),
    v = cross(normal, u);
  ps.sort(
    (a, b) =>
      Math.atan2(dot(sub(a, center), v), dot(sub(a, center), u)) -
      Math.atan2(dot(sub(b, center), v), dot(sub(b, center), u)),
  );
  return dot(polygonNormal(ps), normal) > 0 ? ps : ps.reverse();
}
/** Clip a closed convex polyhedron by one outward, normalized half-space. */
function clip(
  faces: FracturedVolumeFace[],
  plane: Omit<FracturedVolumeFace, 'points'>,
): FracturedVolumeFace[] {
  const result: FracturedVolumeFace[] = [],
    intersections: Vector[] = [];
  for (const face of faces) {
    const points: Vector[] = [];
    for (let i = 0; i < face.points.length; i++) {
      const a = face.points[i]!,
        b = face.points[(i + 1) % face.points.length]!;
      const da = dot(plane.normal, a) - plane.distance,
        db = dot(plane.normal, b) - plane.distance;
      const insideA = da <= EPS,
        insideB = db <= EPS;
      if (insideA) points.push(a);
      if (insideA !== insideB) {
        const p = add(a, mul(sub(b, a), Math.max(0, Math.min(1, da / (da - db)))));
        points.push(p);
        intersections.push(p);
      } else if (Math.abs(da) <= EPS) intersections.push(a);
    }
    const ps = points.filter((p, i) => !close(p, points[(i + points.length - 1) % points.length]!));
    if (
      ps.length >= 3 &&
      length(
        ps.reduce((n, p, i) => add(n, cross(p, ps[(i + 1) % ps.length]!)), { x: 0, y: 0, z: 0 }),
      ) >
        EPS ** 2
    )
      result.push({ ...face, points: ps });
  }
  const cap = orderedCap(intersections, plane.normal);
  // A tangent plane must not duplicate an existing coplanar face.
  const cutsInterior = faces.some((f) =>
    f.points.some((p) => dot(plane.normal, p) - plane.distance > EPS),
  );
  if (cutsInterior && cap.length >= 3) result.push({ ...plane, points: cap });
  return result;
}
function volume(faces: FracturedVolumeFace[]): number {
  let result = 0;
  for (const f of faces)
    for (let i = 1; i + 1 < f.points.length; i++)
      result += dot(f.points[0]!, cross(f.points[i]!, f.points[i + 1]!)) / 6;
  return Math.abs(result);
}
function seedsFor(n: number, seed: number, depthLayers: 1 | 2): Vector[] {
  if (depthLayers === 2)
    return Array.from({ length: n * n * 2 }, (_, i) => {
      const xy = i % (n * n),
        layer = Math.floor(i / (n * n));
      return {
        x: ((xy % n) + 0.5 + (random(seed, xy * 3) - 0.5) * 0.36) / n - 0.5,
        y: (Math.floor(xy / n) + 0.5 + (random(seed, xy * 3 + 1) - 0.5) * 0.36) / n - 0.5,
        // Mirrored pairs guarantee that the layers exactly divide the mother at
        // z=0. The varying quarter heights still make same-layer cuts oblique.
        z: (layer === 0 ? 1 : -1) * MOTHER_DEPTH * (0.24 + (random(seed, xy * 3 + 2) - 0.5) * 0.14),
      };
    });
  return Array.from({ length: n * n }, (_, i) => ({
    x: ((i % n) + 0.5 + (random(seed, i * 3) - 0.5) * 0.36) / n - 0.5,
    y: (Math.floor(i / n) + 0.5 + (random(seed, i * 3 + 1) - 0.5) * 0.36) / n - 0.5,
    // Alternating front/back sites make the fracture genuinely oblique through
    // the mother volume. These are native authoring seeds, not recovered scans.
    z:
      n === 1
        ? 0
        : MOTHER_DEPTH *
          (((i + Math.floor(i / n)) % 2 ? 1 : -1) * 0.18 + (random(seed, i * 3 + 2) - 0.5) * 0.24),
  }));
}
/** Four non-grid sites per half: one central and three peripheral. Mirroring
 * the complete sites through z=0 preserves exact complementary half volumes;
 * varying their heights makes the within-half interfaces genuinely oblique. */
function centerThreeSeeds(seed: number): Vector[] {
  const center = { x: (random(seed, 101) - 0.5) * 0.06, y: (random(seed, 102) - 0.5) * 0.06 };
  const angle = random(seed, 103) * Math.PI * 2;
  const sites = Array.from({ length: 4 }, (_, i) => {
    const theta = angle + ((i - 1) * Math.PI * 2) / 3 + (random(seed, 104 + i * 3) - 0.5) * 0.12;
    const radius = 0.36 + random(seed, 105 + i * 3) * 0.04;
    return {
      x: i === 0 ? center.x : center.x + Math.cos(theta) * radius,
      y: i === 0 ? center.y : center.y + Math.sin(theta) * radius,
      z: MOTHER_DEPTH * (0.24 + (random(seed, 106 + i * 3) - 0.5) * 0.1),
    };
  });
  return [...sites, ...sites.map((p) => ({ ...p, z: -p.z }))];
}
function partition(seeds: Vector[], ownIndex: number): FracturedVolumeFace[] {
  let faces = makeBox();
  const own = seeds[ownIndex]!;
  for (let i = 0; i < seeds.length; i++) {
    if (i === ownIndex) continue;
    const other = seeds[i]!,
      delta = sub(other, own),
      divisor = length(delta);
    faces = clip(faces, {
      kind: 'fracture',
      neighborIndex: i,
      normal: mul(delta, 1 / divisor),
      distance: (dot(other, other) - dot(own, own)) / (2 * divisor),
    });
  }
  return faces;
}
function bevel(
  raw: FracturedVolumeFace[],
  requestedRadius: number,
  steps: number,
): { faces: FracturedVolumeFace[]; radius: number } {
  if (requestedRadius <= 0) return { faces: raw, radius: 0 };
  let radius = requestedRadius,
    core: FracturedVolumeFace[] = [];
  // Thin Voronoi corners cannot admit the full requested radius. Retain a
  // positive core instead of generating inverted or open bevel rings.
  for (let attempt = 0; attempt < 9; attempt++) {
    core = raw;
    for (const f of raw) core = clip(core, { ...f, distance: f.distance - radius });
    if (core.length >= 4 && volume(core) > 1e-12) break;
    radius *= 0.5;
  }
  if (core.length < 4 || volume(core) <= 1e-12) return { faces: raw, radius: 0 };
  const corePoints = unique(core.flatMap((f) => f.points));
  const bevelNormals: Vector[] = [];
  const append = (n: Vector) => {
    const normal = unit(n);
    if (length(normal) > 0.9 && !bevelNormals.some((q) => dot(q, normal) > 1 - 1e-9))
      bevelNormals.push(normal);
  };
  for (let i = 0; i < raw.length; i++)
    for (let j = i + 1; j < raw.length; j++) {
      const a = raw[i]!,
        b = raw[j]!;
      if (a.points.filter((p) => b.points.some((q) => close(p, q))).length < 2) continue;
      for (let k = 1; k <= steps; k++)
        append(add(mul(a.normal, 1 - k / (steps + 1)), mul(b.normal, k / (steps + 1))));
    }
  for (const vertex of unique(raw.flatMap((f) => f.points))) {
    const adjacent = raw.filter((f) => Math.abs(dot(f.normal, vertex) - f.distance) < EPS * 16);
    if (adjacent.length >= 3) append(adjacent.map((f) => f.normal).reduce(add));
  }
  let faces = raw;
  for (const normal of bevelNormals)
    faces = clip(faces, {
      kind: 'bevel',
      normal,
      distance: Math.max(...corePoints.map((p) => dot(normal, p))) + radius,
    });
  return { faces, radius };
}

/** A deterministic, closed 3D Voronoi partition. Unlike a front polygon extruded
 * straight back, its inclined cut planes create different front/back sections. */
export function createFracturedVolumeGeometry(
  options: FracturedVolumeGeometryOptions,
): FracturedVolumeGeometry {
  const n = Math.round(clamp(options.subdivisions, 2, 1, 8));
  const ix = Math.round(clamp(options.ix, 0, 0, n - 1)),
    iy = Math.round(clamp(options.iy, 0, 0, n - 1));
  const depthLayers = options.depthLayers === 2 ? 2 : 1,
    depthIndex = depthLayers === 2 ? Math.round(clamp(options.depthIndex, 0, 0, 1)) : 0;
  const seed = clamp(options.seed, 0, 0, 1),
    radius = clamp(options.cornerRadius, 0.065, 0, 0.16);
  const steps = Math.round(clamp(options.bevelSegments, 2, 1, 4));
  const centerThree = options.seedPattern === 'center-three';
  if (centerThree && (n !== 2 || depthLayers !== 2))
    throw new RangeError('center-three fractures require subdivisions=2 and depthLayers=2.');
  const key = `${n}:${ix}:${iy}:${seed}:${radius}:${steps}:${depthLayers}:${depthIndex}${centerThree ? ':center-three' : ''}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const seeds = centerThree ? centerThreeSeeds(seed) : seedsFor(n, seed, depthLayers),
    cellIndex = depthIndex * n * n + iy * n + ix,
    rawFaces = partition(seeds, cellIndex);
  const rounded = bevel(rawFaces, radius / n, steps),
    gridCenter = { x: (ix + 0.5) / n - 0.5, y: (iy + 0.5) / n - 0.5, z: 0 };
  const faces = rounded.faces.map((f) => ({
    ...f,
    points: f.points.map((p) => mul(sub(p, gridCenter), n)),
    distance: (f.distance - dot(f.normal, gridCenter)) * n,
  }));
  const geometry: FracturedVolumeGeometry = {
    subdivisions: n,
    ix,
    iy,
    cellIndex,
    depthLayers,
    depthIndex,
    motherDepth: MOTHER_DEPTH,
    seeds,
    rawFaces,
    faces,
    rawVolume: volume(rawFaces),
    beveledVolume: volume(rounded.faces),
    effectiveRadius: rounded.radius * n,
  };
  if (cache.size >= 1024) cache.delete(cache.keys().next().value!);
  cache.set(key, geometry);
  return geometry;
}
function rotation(options: FracturedVolumeProjectionOptions) {
  const ax = clamp(options.rotationX, 0, -1e12, 1e12) % (Math.PI * 2),
    ay = clamp(options.rotationY, 0, -1e12, 1e12) % (Math.PI * 2),
    az = clamp(options.rotationZ, 0, -1e12, 1e12) % (Math.PI * 2);
  const cx = Math.cos(ax),
    sx = Math.sin(ax),
    cy = Math.cos(ay),
    sy = Math.sin(ay),
    cz = Math.cos(az),
    sz = Math.sin(az);
  return (p: Vector): Vector => {
    const y = p.y * cx - p.z * sx,
      z = p.y * sx + p.z * cx,
      x = p.x * cy + z * sy,
      zz = -p.x * sy + z * cy;
    return { x: x * cz - y * sz, y: x * sz + y * cz, z: zz };
  };
}
function hull(points: Vector[]): Vector[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (ps: Vector[]) => {
    const result: Vector[] = [];
    for (const p of ps) {
      while (
        result.length >= 2 &&
        cross(sub(result.at(-1)!, result.at(-2)!), sub(p, result.at(-1)!)).z <= 0
      )
        result.pop();
      result.push(p);
    }
    result.pop();
    return result;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
export function projectFracturedVolume(
  options: FracturedVolumeProjectionOptions,
): FracturedVolumeProjection {
  if (!Number.isFinite(options.size) || options.size <= 0)
    return {
      faces: [],
      silhouette: [],
      frontTransform: [1, 0, 0, 1, 0, 0],
      backTransform: [1, 0, 0, 1, 0, 0],
      depthLayers: options.depthLayers === 2 ? 2 : 1,
      parentSize: 0,
    };
  const geometry = createFracturedVolumeGeometry(options),
    rotate = rotation(options),
    size = options.size;
  const faces = geometry.faces
    .map((f) => {
      const normal = rotate(f.normal),
        points = f.points.map((p) => mul(rotate(p), size));
      return {
        ...f,
        points,
        normal,
        depth: points.reduce((sum, p) => sum + p.z, 0) / points.length,
        lighting: roundedFragmentCubeLighting(normal, options),
      };
    })
    .filter((f) => f.normal.z > 1e-10)
    .sort((a, b) => a.depth - b.depth);
  const ex = rotate({ x: 1, y: 0, z: 0 }),
    ey = rotate({ x: 0, y: 1, z: 0 });
  const origin = rotate({
    x: -(geometry.ix + 0.5) * size,
    y: -(geometry.iy + 0.5) * size,
    z: (geometry.motherDepth * geometry.subdivisions * size) / 2,
  });
  const backOrigin = rotate({
    x: -(geometry.ix + 0.5) * size,
    y: -(geometry.iy + 0.5) * size,
    z: (-geometry.motherDepth * geometry.subdivisions * size) / 2,
  });
  return {
    faces,
    silhouette: hull(faces.flatMap((f) => f.points)),
    frontTransform: [ex.x, ex.y, ey.x, ey.y, origin.x, origin.y],
    backTransform: [ex.x, ex.y, ey.x, ey.y, backOrigin.x, backOrigin.y],
    depthLayers: geometry.depthLayers,
    parentSize: size * geometry.subdivisions,
  };
}
function path(context: CanvasRenderingContext2D, points: Vector[]) {
  context.beginPath();
  points.forEach((p, i) => (i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
  context.closePath();
}
function rgb(color: string): number[] {
  const value = Number.parseInt(/^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : 'c0c0c0', 16);
  return [value >> 16, (value >> 8) & 255, value & 255];
}
function lightMix(lighting: RoundedCubeLighting, limit: number) {
  return clamp(lighting.specular + Math.max(0, lighting.brightness - 1) * 0.35, 0, 0, limit);
}
/** Native inclined fracture faces, closed bevels, parent-UV clipping, one shadow. */
export function drawFracturedVolume(
  context: CanvasRenderingContext2D,
  options: FracturedVolumeOptions,
): void {
  const projection = projectFracturedVolume(options);
  if (!projection.faces.length) return;
  const base = rgb(options.color),
    light = rgb(options.lightColor ?? '#ffffff');
  const mixLimit =
    options.specularStrength === undefined ? 0.4 : clamp(options.specularStrength, 0.4, 0.4, 0.95);
  context.save();
  try {
    const strength = clamp(options.shadow, 0, 0, 1),
      cast = options.castShadow;
    if (strength > 0) {
      context.save();
      try {
        context.translate(
          options.size * clamp(cast?.offsetX, 0.12, -2, 2),
          options.size * clamp(cast?.offsetY, 0.18, -2, 2),
        );
        context.globalAlpha *= strength * clamp(cast?.opacity, 0.2, 0, 1);
        context.fillStyle = cast?.color ?? '#202020';
        context.shadowColor = context.fillStyle;
        context.shadowBlur = options.size * clamp(cast?.blur, 0.15, 0, 2);
        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
        path(context, projection.silhouette);
        context.fill();
      } finally {
        context.restore();
      }
    }
    path(context, projection.silhouette);
    context.fillStyle = options.color;
    context.fill();
    for (const face of projection.faces) {
      const mix = lightMix(face.lighting, mixLimit);
      path(context, face.points);
      context.fillStyle = `rgb(${base.map((v, i) => Math.round(v * Math.min(1, face.lighting.brightness) * (1 - mix) + light[i]! * mix)).join(',')})`;
      context.fill();
      // Fresh interior cut faces remain native material, never full-face stickers.
      const parentSkin =
        face.outerFace === 'front' || (projection.depthLayers === 2 && face.outerFace === 'back');
      if (!parentSkin || !options.facePainter) continue;
      context.save();
      try {
        path(context, face.points);
        context.clip();
        context.transform(
          ...(face.outerFace === 'back' ? projection.backTransform : projection.frontTransform),
        );
        options.facePainter(context, {
          size: projection.parentSize,
          color: options.color,
          lighting: face.lighting,
        });
        if (face.lighting.brightness < 1) {
          context.save();
          context.globalAlpha *= 1 - face.lighting.brightness;
          context.fillStyle = '#000000';
          context.fillRect(0, 0, projection.parentSize, projection.parentSize);
          context.restore();
        }
        if (mix > 0) {
          context.save();
          context.globalAlpha *= mix;
          context.fillStyle = options.lightColor ?? '#ffffff';
          context.fillRect(0, 0, projection.parentSize, projection.parentSize);
          context.restore();
        }
      } finally {
        context.restore();
      }
    }
  } finally {
    context.restore();
  }
}
