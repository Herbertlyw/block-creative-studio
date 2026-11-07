import {
  roundedFragmentCubeLighting,
  type RoundedCubeCastShadowOptions,
  type RoundedCubeLightOptions,
  type RoundedCubeLighting,
  type RoundedCubeVector,
} from './roundedFragmentCube';

type Point = { x: number; y: number };
export interface FracturedBlockGeometryOptions {
  /** The same seed must be supplied to every quarter of one mother block. */
  seed?: number;
  ix: number;
  iy: number;
  subdivisions?: number;
  /** Radius in fragment-size units, shared with the rounded-cube control. */
  cornerRadius?: number;
  bevelSegments?: number;
}
export interface FracturedBlockPatch {
  kind: 'front' | 'back' | 'side' | 'bevel';
  points: RoundedCubeVector[];
  normal: RoundedCubeVector;
}
export interface FracturedBlockGeometry {
  /** Convex Voronoi region in mother-block units [0,1]², before edge rounding. */
  region: Point[];
  patches: FracturedBlockPatch[];
  subdivisions: number;
  ix: number;
  iy: number;
  depth: number;
}
export interface FracturedBlockProjectionOptions
  extends FracturedBlockGeometryOptions,
    RoundedCubeLightOptions {
  /** Nominal quarter width; a mother block is size × subdivisions. */
  size: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
}
export interface FracturedBlockProjectedPatch extends FracturedBlockPatch {
  depth: number;
  lighting: RoundedCubeLighting;
}
export interface FracturedBlockProjection {
  patches: FracturedBlockProjectedPatch[];
  silhouette: RoundedCubeVector[];
  /** Affine mother-UV pixels → projected front plane, not a repeated sticker. */
  frontTransform: [number, number, number, number, number, number];
  parentSize: number;
}
export interface FracturedBlockOptions extends FracturedBlockProjectionOptions {
  color: string;
  lightColor?: string;
  shadow?: number;
  castShadow?: RoundedCubeCastShadowOptions;
  /** Paint the original full mother face at (0,0), with the supplied size. */
  facePainter?: (
    context: CanvasRenderingContext2D,
    info: { size: number; color: string; lighting: RoundedCubeLighting },
  ) => void;
}

const clamp = (v: number | undefined, fallback: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Number.isFinite(v) ? v! : fallback));
// A mother identity/edge profile is static while its pose changes every frame.
// Bound the cache so long rising-field videos do not retain every old mother.
const geometryCache = new Map<string, FracturedBlockGeometry>();
const unit = (p: RoundedCubeVector): RoundedCubeVector => {
  const length = Math.hypot(p.x, p.y, p.z);
  return length > 1e-12
    ? { x: p.x / length, y: p.y / length, z: p.z / length }
    : { x: 0, y: 0, z: 1 };
};
const cross = (a: RoundedCubeVector, b: RoundedCubeVector, c: RoundedCubeVector) => ({
  x: (b.y - a.y) * (c.z - a.z) - (b.z - a.z) * (c.y - a.y),
  y: (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z),
  z: (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x),
});
function random(seed: number, index: number) {
  let h = (Math.floor(seed * 0x100000000) ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
}
function clip(poly: Point[], nx: number, ny: number, distance: number) {
  const result: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!,
      b = poly[(i + 1) % poly.length]!;
    const da = a.x * nx + a.y * ny - distance,
      db = b.x * nx + b.y * ny - distance;
    if (da <= 1e-12) result.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const u = da / (da - db);
      result.push({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
    }
  }
  return result.filter(
    (p, i) =>
      Math.hypot(
        p.x - result[(i + result.length - 1) % result.length]!.x,
        p.y - result[(i + result.length - 1) % result.length]!.y,
      ) > 1e-10,
  );
}
function inset(poly: Point[], amount: number) {
  if (!amount) return poly;
  const lines = poly.map((p, i) => {
    const q = poly[(i + 1) % poly.length]!,
      length = Math.hypot(q.x - p.x, q.y - p.y);
    const nx = -(q.y - p.y) / length,
      ny = (q.x - p.x) / length;
    return { nx, ny, d: p.x * nx + p.y * ny + amount };
  });
  return lines.map((line, i) => {
    const before = lines[(i + lines.length - 1) % lines.length]!,
      det = before.nx * line.ny - before.ny * line.nx;
    return {
      x: (before.d * line.ny - before.ny * line.d) / det,
      y: (before.nx * line.d - before.d * line.nx) / det,
    };
  });
}
/** Two-segment quadratic corner fillets keep an angular fracture, not a pebble. */
function roundOutline(poly: Point[], radius: number): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!,
      before = poly[(i + poly.length - 1) % poly.length]!,
      after = poly[(i + 1) % poly.length]!;
    const l0 = Math.hypot(before.x - p.x, before.y - p.y),
      l1 = Math.hypot(after.x - p.x, after.y - p.y);
    const trim = Math.min(radius, l0 * 0.2, l1 * 0.2);
    const a = { x: p.x + ((before.x - p.x) * trim) / l0, y: p.y + ((before.y - p.y) * trim) / l0 };
    const b = { x: p.x + ((after.x - p.x) * trim) / l1, y: p.y + ((after.y - p.y) * trim) / l1 };
    result.push(a, { x: (a.x + 2 * p.x + b.x) / 4, y: (a.y + 2 * p.y + b.y) / 4 }, b);
  }
  return result;
}

/** Pure, closed native mesh. Four shared irregular regions replace a square grid. */
export function createFracturedBlockGeometry(
  options: FracturedBlockGeometryOptions,
): FracturedBlockGeometry {
  const n = Math.round(clamp(options.subdivisions, 2, 1, 8));
  const ix = Math.round(clamp(options.ix, 0, 0, n - 1)),
    iy = Math.round(clamp(options.iy, 0, 0, n - 1));
  const seed = clamp(options.seed, 0, 0, 1),
    radius = clamp(options.cornerRadius, 0.065, 0.015, 0.16);
  const steps = Math.round(clamp(options.bevelSegments, 3, 1, 4));
  const cacheKey = `${n}:${ix}:${iy}:${seed}:${radius}:${steps}`;
  const cached = geometryCache.get(cacheKey);
  if (cached) return cached;
  const sites = Array.from({ length: n * n }, (_, i) => ({
    x: ((i % n) + 0.5 + (random(seed, i * 2) - 0.5) * 0.32) / n,
    y: (Math.floor(i / n) + 0.5 + (random(seed, i * 2 + 1) - 0.5) * 0.32) / n,
  }));
  const own = sites[iy * n + ix]!;
  let region: Point[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  for (let i = 0; i < sites.length; i++) {
    if (i === iy * n + ix) continue;
    const other = sites[i]!;
    region = clip(
      region,
      other.x - own.x,
      other.y - own.y,
      (other.x ** 2 + other.y ** 2 - own.x ** 2 - own.y ** 2) / 2,
    );
  }
  const local = region.map((p) => ({ x: p.x * n - (ix + 0.5), y: p.y * n - (iy + 0.5) }));
  const depth = 0.64 + (random(seed, iy * n + ix + 251) - 0.5) * 0.08;
  const bevel = Math.min(radius, depth * 0.2),
    rings: RoundedCubeVector[][] = [];
  const ring = (offset: number, z: number) =>
    roundOutline(inset(local, offset), radius).map((p) => ({ ...p, z }));
  // Back flat → back bevel → thick wall → front bevel → front flat.
  for (let i = steps; i >= 0; i--) {
    const angle = ((i / steps) * Math.PI) / 2;
    rings.push(ring(bevel * (1 - Math.cos(angle)), -depth / 2 + bevel - bevel * Math.sin(angle)));
  }
  for (let i = 0; i <= steps; i++) {
    const angle = ((i / steps) * Math.PI) / 2;
    rings.push(ring(bevel * (1 - Math.cos(angle)), depth / 2 - bevel + bevel * Math.sin(angle)));
  }
  const patches: FracturedBlockPatch[] = [];
  const add = (kind: FracturedBlockPatch['kind'], points: RoundedCubeVector[]) => {
    const normal = unit(cross(points[0]!, points[1]!, points[2]!));
    if (Math.hypot(...Object.values(cross(points[0]!, points[1]!, points[2]!))) > 1e-12)
      patches.push({ kind, points, normal });
  };
  add('back', [...rings[0]!].reverse());
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < rings[j]!.length; i++) {
      const next = (i + 1) % rings[j]!.length;
      add(j === steps ? 'side' : 'bevel', [
        rings[j]![i]!,
        rings[j]![next]!,
        rings[j + 1]![next]!,
        rings[j + 1]![i]!,
      ]);
    }
  add('front', rings.at(-1)!);
  const geometry = { region, patches, subdivisions: n, ix, iy, depth };
  if (geometryCache.size >= 1024) geometryCache.delete(geometryCache.keys().next().value!);
  geometryCache.set(cacheKey, geometry);
  return geometry;
}
function rotation(options: FracturedBlockProjectionOptions) {
  const ax = clamp(options.rotationX, 0, -1e12, 1e12) % (2 * Math.PI),
    ay = clamp(options.rotationY, 0, -1e12, 1e12) % (2 * Math.PI),
    az = clamp(options.rotationZ, 0, -1e12, 1e12) % (2 * Math.PI);
  const cx = Math.cos(ax),
    sx = Math.sin(ax),
    cy = Math.cos(ay),
    sy = Math.sin(ay),
    cz = Math.cos(az),
    sz = Math.sin(az);
  return (p: RoundedCubeVector): RoundedCubeVector => {
    const y = p.y * cx - p.z * sx,
      z = p.y * sx + p.z * cx,
      x = p.x * cy + z * sy,
      zz = -p.x * sy + z * cy;
    return { x: x * cz - y * sz, y: x * sz + y * cz, z: zz };
  };
}
function hull(points: RoundedCubeVector[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (ps: RoundedCubeVector[]) => {
    const result: RoundedCubeVector[] = [];
    for (const p of ps) {
      while (result.length >= 2 && cross(result.at(-2)!, result.at(-1)!, p).z <= 0) result.pop();
      result.push(p);
    }
    result.pop();
    return result;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
export function projectFracturedBlock(
  options: FracturedBlockProjectionOptions,
): FracturedBlockProjection {
  const empty: FracturedBlockProjection = {
    patches: [],
    silhouette: [],
    frontTransform: [1, 0, 0, 1, 0, 0],
    parentSize: 0,
  };
  if (!Number.isFinite(options.size) || options.size <= 0) return empty;
  const geometry = createFracturedBlockGeometry(options),
    rotate = rotation(options),
    size = options.size;
  const patches = geometry.patches
    .map((patch) => {
      const normal = rotate(patch.normal),
        points = patch.points.map((p) => {
          const q = rotate(p);
          return { x: q.x * size, y: q.y * size, z: q.z * size };
        });
      return {
        ...patch,
        points,
        normal,
        depth: points.reduce((sum, p) => sum + p.z, 0) / points.length,
        lighting: roundedFragmentCubeLighting(normal, options),
      };
    })
    .filter((p) => cross(p.points[0]!, p.points[1]!, p.points[2]!).z > 1e-10)
    .sort((a, b) => a.depth - b.depth);
  const ex = rotate({ x: 1, y: 0, z: 0 }),
    ey = rotate({ x: 0, y: 1, z: 0 });
  const o = rotate({
    x: -(geometry.ix + 0.5) * size,
    y: -(geometry.iy + 0.5) * size,
    z: (geometry.depth * size) / 2,
  });
  return {
    patches,
    silhouette: hull(patches.flatMap((p) => p.points)),
    frontTransform: [ex.x, ex.y, ey.x, ey.y, o.x, o.y],
    parentSize: size * geometry.subdivisions,
  };
}
function path(context: CanvasRenderingContext2D, points: RoundedCubeVector[]) {
  context.beginPath();
  points.forEach((p, i) => (i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
  context.closePath();
}
function rgb(color: string): number[] {
  const hex = /^#[0-9a-f]{6}$/i.test(color) ? color.slice(1) : 'c0c0c0';
  const v = Number.parseInt(hex, 16);
  return [v >> 16, (v >> 8) & 255, v & 255];
}
function litColor(
  base: number[],
  light: number[],
  lighting: RoundedCubeLighting,
  mixLimit: number,
) {
  const mix = clamp(
    lighting.specular + Math.max(0, lighting.brightness - 1) * 0.35,
    0,
    0,
    mixLimit,
  );
  return `rgb(${base.map((v, i) => Math.round(v * Math.min(1, lighting.brightness) * (1 - mix) + light[i]! * mix)).join(',')})`;
}
/** Native thick irregular pieces, with one projected shadow and a clipped parent UV. */
export function drawFracturedBlock(
  context: CanvasRenderingContext2D,
  options: FracturedBlockOptions,
): void {
  const projection = projectFracturedBlock(options);
  if (!projection.patches.length) return;
  const base = rgb(options.color),
    light = rgb(options.lightColor ?? '#ffffff');
  const mixLimit =
    options.specularStrength === undefined ? 0.4 : clamp(options.specularStrength, 0.4, 0.4, 0.95);
  context.save();
  try {
    const shadow = clamp(options.shadow, 0, 0, 1),
      cast = options.castShadow;
    if (shadow > 0) {
      context.save();
      try {
        context.translate(
          options.size * clamp(cast?.offsetX, 0.12, -2, 2),
          options.size * clamp(cast?.offsetY, 0.18, -2, 2),
        );
        context.globalAlpha *= shadow * clamp(cast?.opacity, 0.2, 0, 1);
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
    // One albedo underlay closes Canvas antialias cracks without a black rim.
    path(context, projection.silhouette);
    context.fillStyle = options.color;
    context.fill();
    for (const patch of projection.patches) {
      path(context, patch.points);
      context.fillStyle = litColor(base, light, patch.lighting, mixLimit);
      context.fill();
      if (patch.kind !== 'front' || !options.facePainter) continue;
      context.save();
      try {
        path(context, patch.points);
        context.clip();
        context.transform(...projection.frontTransform);
        options.facePainter(context, {
          size: projection.parentSize,
          color: options.color,
          lighting: patch.lighting,
        });
        if (patch.lighting.brightness < 1) {
          context.save();
          context.globalAlpha *= 1 - patch.lighting.brightness;
          context.fillStyle = '#000000';
          context.fillRect(0, 0, projection.parentSize, projection.parentSize);
          context.restore();
        }
        const mix = clamp(
          patch.lighting.specular + Math.max(0, patch.lighting.brightness - 1) * 0.35,
          0,
          0,
          mixLimit,
        );
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
