import {
  roundedFragmentCubeLighting,
  type RoundedCubeLightOptions,
  type RoundedCubeLighting,
  type RoundedCubeCastShadowOptions,
  type RoundedCubeFaceId,
} from './roundedFragmentCube';

export type PolyhedronVector = { readonly x: number; readonly y: number; readonly z: number };
export interface RoundedPolyhedronVertex {
  readonly position: PolyhedronVector;
  readonly normal: PolyhedronVector;
}
export interface RoundedPolyhedronTriangle {
  readonly indices: readonly [number, number, number];
  readonly kind: 'face' | 'edge' | 'corner';
}
export interface RoundedPolyhedronGeometry {
  readonly variant: number;
  readonly radius: number;
  readonly vertices: readonly RoundedPolyhedronVertex[];
  readonly triangles: readonly RoundedPolyhedronTriangle[];
}
export interface RoundedPolyhedronOptions extends RoundedCubeLightOptions {
  readonly seed: number;
  readonly size: number;
  readonly cornerRadius?: number;
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
  readonly color: string;
  readonly faceColors?: Partial<Readonly<Record<RoundedCubeFaceId, string>>>;
  readonly lightColor?: string;
  readonly shadow?: number;
  readonly castShadow?: RoundedCubeCastShadowOptions;
}
export const ROUNDED_POLYHEDRON_VARIANTS = 64;
export const ROUNDED_POLYHEDRON_MAX_CACHED_GEOMETRIES = 128;
const V = (x: number, y: number, z: number): PolyhedronVector => ({ x, y, z });
const add = (a: PolyhedronVector, b: PolyhedronVector) => V(a.x + b.x, a.y + b.y, a.z + b.z);
const sub = (a: PolyhedronVector, b: PolyhedronVector) => V(a.x - b.x, a.y - b.y, a.z - b.z);
const mul = (a: PolyhedronVector, s: number) => V(a.x * s, a.y * s, a.z * s);
const dot = (a: PolyhedronVector, b: PolyhedronVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: PolyhedronVector, b: PolyhedronVector) =>
  V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const unit = (a: PolyhedronVector) => {
  const n = Math.hypot(a.x, a.y, a.z);
  if (n < 1e-12) throw new Error('ROUNDED_POLYHEDRON_DEGENERATE');
  return mul(a, 1 / n);
};
const mean = (p: readonly PolyhedronVector[]) => mul(p.reduce(add, V(0, 0, 0)), 1 / p.length);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const finite = (n: number | undefined, fallback: number) =>
  n !== undefined && Number.isFinite(n) ? n : fallback;
function parameters(seed: number, radius: number | undefined) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new Error('ROUNDED_POLYHEDRON_SEED_INVALID');
  if (radius !== undefined && (!Number.isFinite(radius) || radius < 0 || radius > 0.22))
    throw new Error('ROUNDED_POLYHEDRON_RADIUS_INVALID');
  return {
    variant: seed % ROUNDED_POLYHEDRON_VARIANTS,
    radius: Math.round((radius ?? 0.1) * 10000) / 10000,
  };
}
function noise(variant: number, index: number) {
  let n = (variant + 1) ^ Math.imul(index + 1, 0x9e3779b1);
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return (((n ^ (n >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}

/** Convex irregular tetrahedron + sphere. Flat triangular cores, cylindrical
 * edges and spherical vertex caps share exact seams: this is a closed volume. */
export function createRoundedPolyhedronFragmentGeometry(
  seed: number,
  cornerRadius?: number,
): RoundedPolyhedronGeometry {
  const { variant, radius: r } = parameters(seed, cornerRadius),
    raw = [V(1, 1, 1), V(-1, -1, 1), V(-1, 1, -1), V(1, -1, -1)].map((p, i) =>
      V(
        p.x + 0.24 * noise(variant, i * 3),
        p.y + 0.24 * noise(variant, i * 3 + 1),
        p.z + 0.24 * noise(variant, i * 3 + 2),
      ),
    );
  const centre = mean(raw),
    centred = raw.map((p) => sub(p, centre)),
    maximum = Math.max(...centred.flatMap((p) => [Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)])),
    base = centred.map((p) => mul(p, (0.5 - r) / maximum));
  const faces: Array<{ indices: [number, number, number]; normal: PolyhedronVector }> = [];
  for (const indices of [
    [0, 1, 2],
    [0, 3, 1],
    [0, 2, 3],
    [1, 3, 2],
  ] as [number, number, number][]) {
    let normal = unit(
      cross(sub(base[indices[1]]!, base[indices[0]]!), sub(base[indices[2]]!, base[indices[0]]!)),
    );
    if (dot(normal, mean(indices.map((i) => base[i]!))) < 0) {
      indices.reverse();
      normal = mul(normal, -1);
    }
    faces.push({ indices, normal });
  }
  const vertices: RoundedPolyhedronVertex[] = [],
    triangles: RoundedPolyhedronTriangle[] = [],
    lookup = new Map<string, number>();
  const vertex = (position: PolyhedronVector, normal: PolyhedronVector) => {
    const key = [position.x, position.y, position.z].map((v) => v.toFixed(11)).join(':');
    const old = lookup.get(key);
    if (old !== undefined) return old;
    const index = vertices.length;
    vertices.push(
      Object.freeze({
        position: Object.freeze(position),
        normal: Object.freeze(r === 0 ? unit(position) : normal),
      }),
    );
    lookup.set(key, index);
    return index;
  };
  const triangle = (ids: [number, number, number], kind: RoundedPolyhedronTriangle['kind']) => {
    const p = ids.map((i) => vertices[i]!),
      w = cross(sub(p[1]!.position, p[0]!.position), sub(p[2]!.position, p[0]!.position));
    if (Math.hypot(w.x, w.y, w.z) < 1e-12) return;
    if (dot(w, mean(p.map((v) => v.normal))) < 0) ids.reverse();
    triangles.push(Object.freeze({ indices: Object.freeze(ids), kind }));
  };
  for (const face of faces)
    triangle(
      face.indices.map((i) => vertex(add(base[i]!, mul(face.normal, r)), face.normal)) as [
        number,
        number,
        number,
      ],
      'face',
    );
  if (r > 0) {
    const edges = new Map<string, { a: number; b: number; normals: PolyhedronVector[] }>();
    for (const face of faces)
      for (let i = 0; i < 3; i++) {
        const a = face.indices[i]!,
          b = face.indices[(i + 1) % 3]!,
          key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        const edge = edges.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), normals: [] };
        edge.normals.push(face.normal);
        edges.set(key, edge);
      }
    // Two angular segments provide a bounded curved surface, not a screen rim.
    for (const {
      a,
      b,
      normals: [first, second],
    } of edges.values())
      for (let i = 0; i < 2; i++) {
        const n0 = unit(add(mul(first!, 1 - i / 2), mul(second!, i / 2))),
          n1 = unit(add(mul(first!, 1 - (i + 1) / 2), mul(second!, (i + 1) / 2)));
        const ids = [
          vertex(add(base[a]!, mul(n0, r)), n0),
          vertex(add(base[b]!, mul(n0, r)), n0),
          vertex(add(base[b]!, mul(n1, r)), n1),
          vertex(add(base[a]!, mul(n1, r)), n1),
        ];
        triangle([ids[0]!, ids[1]!, ids[2]!], 'edge');
        triangle([ids[0]!, ids[2]!, ids[3]!], 'edge');
      }
    for (let i = 0; i < 4; i++) {
      const normals = faces.filter((f) => f.indices.includes(i)).map((f) => f.normal),
        n = 2;
      const at = (a: number, b: number) => {
        const normal = unit(
          add(
            add(mul(normals[0]!, a / n), mul(normals[1]!, b / n)),
            mul(normals[2]!, 1 - (a + b) / n),
          ),
        );
        return vertex(add(base[i]!, mul(normal, r)), normal);
      };
      for (let a = 0; a < n; a++)
        for (let b = 0; b < n - a; b++) {
          triangle([at(a, b), at(a + 1, b), at(a, b + 1)], 'corner');
          if (a + b < n - 1) triangle([at(a + 1, b), at(a + 1, b + 1), at(a, b + 1)], 'corner');
        }
    }
  }
  return Object.freeze({
    variant,
    radius: r,
    vertices: Object.freeze(vertices),
    triangles: Object.freeze(triangles),
  });
}
const cache = new Map<string, RoundedPolyhedronGeometry>();
/** CPU-only prototypes have a fixed upper bound; no texture or GPU ownership. */
export function roundedPolyhedronFragmentCacheSize() {
  return cache.size;
}
function geometry(seed: number, radius: number | undefined) {
  const p = parameters(seed, radius),
    key = `${p.variant}:${p.radius}`,
    old = cache.get(key);
  if (old) return old;
  const mesh = createRoundedPolyhedronFragmentGeometry(seed, p.radius);
  if (cache.size >= ROUNDED_POLYHEDRON_MAX_CACHED_GEOMETRIES)
    cache.delete(cache.keys().next().value!);
  cache.set(key, mesh);
  return mesh;
}
function hull(points: readonly PolyhedronVector[]) {
  const ordered = [...points].sort((a, b) => a.x - b.x || a.y - b.y),
    half = (list: readonly PolyhedronVector[]) => {
      const out: PolyhedronVector[] = [];
      for (const p of list) {
        while (
          out.length > 1 &&
          cross(sub(out.at(-1)!, out.at(-2)!), sub(p, out.at(-1)!)).z <= 1e-10
        )
          out.pop();
        out.push(p);
      }
      return out;
    };
  return [...half(ordered).slice(0, -1), ...half([...ordered].reverse()).slice(0, -1)];
}
export function projectRoundedPolyhedronFragment(options: RoundedPolyhedronOptions) {
  if (!Number.isFinite(options.size) || options.size <= 0)
    return { triangles: [], silhouette: [] } as {
      triangles: ProjectedPolyhedronTriangle[];
      silhouette: PolyhedronVector[];
    };
  const mesh = geometry(options.seed, options.cornerRadius),
    x = finite(options.rotationX, 0) % (2 * Math.PI),
    y = finite(options.rotationY, 0) % (2 * Math.PI),
    z = finite(options.rotationZ, 0) % (2 * Math.PI),
    cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  const rotate = (p: PolyhedronVector) => {
    const yy = p.y * cx - p.z * sx,
      zz = p.y * sx + p.z * cx,
      xx = p.x * cy + zz * sy,
      depth = -p.x * sy + zz * cy;
    return V(xx * cz - yy * sz, xx * sz + yy * cz, depth);
  };
  const rotated = mesh.vertices.map((v) => ({
      position: mul(rotate(v.position), options.size),
      normal: rotate(v.normal),
      objectNormal: v.normal,
    })),
    triangles: ProjectedPolyhedronTriangle[] = [];
  for (const t of mesh.triangles) {
    const p = t.indices.map((i) => rotated[i]!),
      geometric = cross(sub(p[1]!.position, p[0]!.position), sub(p[2]!.position, p[0]!.position));
    if (geometric.z <= 1e-10) continue;
    const normal = mesh.radius === 0 ? unit(geometric) : unit(mean(p.map((v) => v.normal)));
    const objectNormal =
      mesh.radius === 0
        ? unit(
            cross(
              sub(mesh.vertices[t.indices[1]]!.position, mesh.vertices[t.indices[0]]!.position),
              sub(mesh.vertices[t.indices[2]]!.position, mesh.vertices[t.indices[0]]!.position),
            ),
          )
        : undefined;
    triangles.push({
      kind: t.kind,
      points: p.map((v) => v.position),
      normal,
      objectNormals: p.map((v) => objectNormal ?? v.objectNormal),
      vertexLighting: p.map((v) =>
        roundedFragmentCubeLighting(mesh.radius === 0 ? normal : v.normal, options),
      ),
      lighting: roundedFragmentCubeLighting(normal, options),
      depth: mean(p.map((v) => v.position)).z,
    });
  }
  triangles.sort((a, b) => a.depth - b.depth);
  return { triangles, silhouette: hull(rotated.map((v) => v.position)) };
}
export interface ProjectedPolyhedronTriangle {
  readonly kind: RoundedPolyhedronTriangle['kind'];
  readonly points: readonly PolyhedronVector[];
  readonly normal: PolyhedronVector;
  readonly objectNormals: readonly PolyhedronVector[];
  readonly vertexLighting: readonly RoundedCubeLighting[];
  readonly lighting: RoundedCubeLighting;
  readonly depth: number;
}
const rgb = (color: string) => {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('ROUNDED_POLYHEDRON_COLOR_INVALID');
  const n = parseInt(color.slice(1), 16);
  return [n >>> 16, (n >>> 8) & 255, n & 255];
};
function path(c: CanvasRenderingContext2D, p: readonly PolyhedronVector[]) {
  c.beginPath();
  p.forEach((v, i) => (i ? c.lineTo(v.x, v.y) : c.moveTo(v.x, v.y)));
  c.closePath();
}
export type PolyhedronRgb = readonly [number, number, number];
export interface PolyhedronRasterTriangle {
  readonly points: readonly [PolyhedronVector, PolyhedronVector, PolyhedronVector];
  readonly colors: readonly [PolyhedronRgb, PolyhedronRgb, PolyhedronRgb];
}
export const ROUNDED_POLYHEDRON_RASTER_CORE = 128;
export const ROUNDED_POLYHEDRON_RASTER_HALO = 1;
export const ROUNDED_POLYHEDRON_RASTER_SCALE = 2;
const RASTER_SIDE = ROUNDED_POLYHEDRON_RASTER_CORE + 2 * ROUNDED_POLYHEDRON_RASTER_HALO;
const SAMPLE_SIDE = RASTER_SIDE * ROUNDED_POLYHEDRON_RASTER_SCALE;
/** One reusable tile per calling context: sample RGBA + depth + resolved RGBA.
 * The scratch canvas has another RASTER_SIDE² RGBA pixels. No body-sized image
 * or per-fragment decoded cache exists, even for a very large nominal size. */
export const ROUNDED_POLYHEDRON_RASTER_TYPED_BYTES =
  SAMPLE_SIDE * SAMPLE_SIDE * 8 + RASTER_SIDE * RASTER_SIDE * 4;
export const ROUNDED_POLYHEDRON_RASTER_CANVAS_BYTES = RASTER_SIDE * RASTER_SIDE * 4;
export function createRoundedPolyhedronRasterTile(
  rgba = new Uint8ClampedArray(RASTER_SIDE * RASTER_SIDE * 4),
) {
  if (rgba.length !== RASTER_SIDE * RASTER_SIDE * 4)
    throw new Error('ROUNDED_POLYHEDRON_RASTER_BUFFER_INVALID');
  return {
    samples: new Uint8ClampedArray(SAMPLE_SIDE * SAMPLE_SIDE * 4),
    depth: new Float32Array(SAMPLE_SIDE * SAMPLE_SIDE),
    rgba,
  };
}
export type RoundedPolyhedronRasterTile = ReturnType<typeof createRoundedPolyhedronRasterTile>;
/** Gouraud shading of the actual three normal-lit RGB vertices. Four geometry
 * samples per device pixel resolve coverage and premultiplied color together;
 * uncovered samples cannot tint the edge black. Frontmost surface wins once. */
export function rasterizeRoundedPolyhedronTile(
  triangles: readonly PolyhedronRasterTriangle[],
  tile: RoundedPolyhedronRasterTile,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > ROUNDED_POLYHEDRON_RASTER_CORE ||
    height > ROUNDED_POLYHEDRON_RASTER_CORE
  )
    throw new Error('ROUNDED_POLYHEDRON_RASTER_TILE_INVALID');
  const w = width + 2,
    h = height + 2,
    sw = w * 2,
    sh = h * 2,
    originX = x - 1,
    originY = y - 1;
  for (let row = 0; row < sh; row++) {
    tile.samples.fill(0, row * SAMPLE_SIDE * 4, (row * SAMPLE_SIDE + sw) * 4);
    tile.depth.fill(-Infinity, row * SAMPLE_SIDE, row * SAMPLE_SIDE + sw);
  }
  for (let row = 0; row < h; row++)
    tile.rgba.fill(0, row * RASTER_SIDE * 4, (row * RASTER_SIDE + w) * 4);
  let candidateSamples = 0;
  for (const t of triangles) {
    const [a, b, c] = t.points,
      denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-14) continue;
    const left = Math.max(0, Math.ceil((Math.min(a.x, b.x, c.x) - originX) * 2 - 0.5)),
      right = Math.min(sw - 1, Math.floor((Math.max(a.x, b.x, c.x) - originX) * 2 - 0.5));
    const top = Math.max(0, Math.ceil((Math.min(a.y, b.y, c.y) - originY) * 2 - 0.5)),
      bottom = Math.min(sh - 1, Math.floor((Math.max(a.y, b.y, c.y) - originY) * 2 - 0.5));
    if (left > right || top > bottom) continue;
    const inverse = 1 / denominator,
      step0 = (b.y - c.y) * inverse * 0.5,
      step1 = (c.y - a.y) * inverse * 0.5;
    candidateSamples += (right - left + 1) * (bottom - top + 1);
    for (let sy = top; sy <= bottom; sy++) {
      const py = originY + (sy + 0.5) / 2,
        px = originX + (left + 0.5) / 2;
      let l0 = ((b.y - c.y) * (px - c.x) + (c.x - b.x) * (py - c.y)) * inverse,
        l1 = ((c.y - a.y) * (px - c.x) + (a.x - c.x) * (py - c.y)) * inverse;
      for (let sx = left; sx <= right; sx++, l0 += step0, l1 += step1) {
        const l2 = 1 - l0 - l1;
        if (l0 < -1e-9 || l1 < -1e-9 || l2 < -1e-9) continue;
        const index = sy * SAMPLE_SIDE + sx,
          z = l0 * a.z + l1 * b.z + l2 * c.z;
        if (z < tile.depth[index]!) continue;
        tile.depth[index] = z;
        const offset = index * 4;
        for (let channel = 0; channel < 3; channel++)
          tile.samples[offset + channel] = Math.round(
            clamp(
              l0 * t.colors[0][channel]! + l1 * t.colors[1][channel]! + l2 * t.colors[2][channel]!,
              0,
              255,
            ),
          );
        tile.samples[offset + 3] = 255;
      }
    }
  }
  let coveredSamples = 0;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      let coverage = 0,
        r = 0,
        g = 0,
        b = 0;
      for (let sample = 0; sample < 4; sample++) {
        const i = ((py * 2 + (sample >> 1)) * SAMPLE_SIDE + px * 2 + (sample & 1)) * 4;
        if (tile.samples[i + 3]) {
          coverage++;
          r += tile.samples[i]!;
          g += tile.samples[i + 1]!;
          b += tile.samples[i + 2]!;
        }
      }
      if (coverage) {
        const offset = (py * RASTER_SIDE + px) * 4;
        tile.rgba[offset] = Math.round(r / coverage);
        tile.rgba[offset + 1] = Math.round(g / coverage);
        tile.rgba[offset + 2] = Math.round(b / coverage);
        tile.rgba[offset + 3] = Math.round((255 * coverage) / 4);
        coveredSamples += coverage;
      }
    }
  return { candidateSamples, coveredSamples };
}
interface RasterStore {
  readonly tile: RoundedPolyhedronRasterTile;
  readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  readonly context: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  readonly image: ImageData;
  draws: number;
  tiles: number;
  candidateSamples: number;
  coveredSamples: number;
}
const rasterStores = new WeakMap<CanvasRenderingContext2D, RasterStore>();
/** Diagnostics expose counters and bounds, never a retained fragment image. */
export function roundedPolyhedronFragmentRasterStats(c: CanvasRenderingContext2D) {
  const s = rasterStores.get(c);
  return s
    ? {
        draws: s.draws,
        tiles: s.tiles,
        candidateSamples: s.candidateSamples,
        coveredSamples: s.coveredSamples,
        typedBytes: ROUNDED_POLYHEDRON_RASTER_TYPED_BYTES,
        canvasBytes: ROUNDED_POLYHEDRON_RASTER_CANVAS_BYTES,
      }
    : undefined;
}
function rasterStore(c: CanvasRenderingContext2D): RasterStore {
  const old = rasterStores.get(c);
  if (old) return old;
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(RASTER_SIDE, RASTER_SIDE)
      : typeof document !== 'undefined'
        ? Object.assign(document.createElement('canvas'), {
            width: RASTER_SIDE,
            height: RASTER_SIDE,
          })
        : undefined;
  if (!canvas) throw new Error('ROUNDED_POLYHEDRON_RASTER_CANVAS_UNAVAILABLE');
  const context = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!context) throw new Error('ROUNDED_POLYHEDRON_RASTER_CONTEXT_UNAVAILABLE');
  const image = context.createImageData(RASTER_SIDE, RASTER_SIDE);
  const s: RasterStore = {
    tile: createRoundedPolyhedronRasterTile(image.data),
    canvas,
    context,
    image,
    draws: 0,
    tiles: 0,
    candidateSamples: 0,
    coveredSamples: 0,
  };
  rasterStores.set(c, s);
  return s;
}
/** Solid-only draw of the real closed mesh. Raster tiles use device coordinates,
 * so the caller's rotation/scale/clip survives without rotated tile seams or
 * repeated alpha. The existing silhouette casts its shadow exactly once. */
export function drawRoundedPolyhedronFragment(
  c: CanvasRenderingContext2D,
  options: RoundedPolyhedronOptions,
): void {
  const projection = projectRoundedPolyhedronFragment(options);
  if (!projection.triangles.length) return;
  const transform = c.getTransform(),
    canvasWidth = c.canvas.width,
    canvasHeight = c.canvas.height;
  const components = [
    transform.a,
    transform.b,
    transform.c,
    transform.d,
    transform.e,
    transform.f,
    canvasWidth,
    canvasHeight,
  ];
  if (!components.every(Number.isFinite) || canvasWidth <= 0 || canvasHeight <= 0) return;
  const base = rgb(options.color),
    light = rgb(options.lightColor ?? '#fff8e8'),
    colors = options.faceColors,
    limit =
      options.specularStrength === undefined
        ? 0.4
        : clamp(finite(options.specularStrength, 0.32), 0.4, 0.95);
  const albedo = (n: PolyhedronVector) => {
    const weights: [RoundedCubeFaceId, number][] = [
      [n.x < 0 ? 'left' : 'right', n.x * n.x],
      [n.y < 0 ? 'top' : 'bottom', n.y * n.y],
      [n.z < 0 ? 'back' : 'front', n.z * n.z],
    ];
    return [0, 1, 2].map((k) =>
      weights.reduce((sum, [id, w]) => sum + (colors?.[id] ? rgb(colors[id]!) : base)[k]! * w, 0),
    );
  };
  const lit = (base: readonly number[], l: RoundedCubeLighting): PolyhedronRgb => {
    const mix = clamp(l.specular + Math.max(0, l.brightness - 1) * 0.35, 0, limit);
    return base.map((v, i) =>
      Math.round(clamp(v * Math.min(1, l.brightness) * (1 - mix) + light[i]! * mix, 0, 255)),
    ) as [number, number, number];
  };
  const device = (p: PolyhedronVector) =>
    V(
      transform.a * p.x + transform.c * p.y + transform.e,
      transform.b * p.x + transform.d * p.y + transform.f,
      p.z,
    );
  const triangles: PolyhedronRasterTriangle[] = projection.triangles.map((t) => ({
    points: t.points.map(device) as [PolyhedronVector, PolyhedronVector, PolyhedronVector],
    colors: t.objectNormals.map((n, i) => lit(albedo(n), t.vertexLighting[i]!)) as [
      PolyhedronRgb,
      PolyhedronRgb,
      PolyhedronRgb,
    ],
  }));
  const silhouette = projection.silhouette.map(device),
    left = Math.max(0, Math.floor(Math.min(...silhouette.map((p) => p.x)))),
    right = Math.min(canvasWidth, Math.ceil(Math.max(...silhouette.map((p) => p.x)))),
    top = Math.max(0, Math.floor(Math.min(...silhouette.map((p) => p.y)))),
    bottom = Math.min(canvasHeight, Math.ceil(Math.max(...silhouette.map((p) => p.y))));
  c.save();
  try {
    const strength = clamp(finite(options.shadow, 0), 0, 1),
      cast = options.castShadow;
    if (strength > 0 && (cast?.opacity ?? 0.2) > 0) {
      c.save();
      try {
        c.translate(
          options.size * clamp(cast?.offsetX ?? 0.09, -2, 2),
          options.size * clamp(cast?.offsetY ?? 0.14, -2, 2),
        );
        c.globalAlpha *= strength * clamp(cast?.opacity ?? 0.2, 0, 1);
        c.fillStyle = cast?.color ?? '#795735';
        c.shadowColor = c.fillStyle;
        c.shadowBlur = options.size * clamp(cast?.blur ?? 0.12, 0, 2);
        c.shadowOffsetX = c.shadowOffsetY = 0;
        path(c, projection.silhouette);
        c.fill();
      } finally {
        c.restore();
      }
    }
    if (left >= right || top >= bottom) return;
    const s = rasterStore(c);
    s.draws++;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.shadowColor = 'rgba(0,0,0,0)';
    c.shadowBlur = 0;
    c.shadowOffsetX = c.shadowOffsetY = 0;
    c.imageSmoothingEnabled = false;
    for (let y = top; y < bottom; y += ROUNDED_POLYHEDRON_RASTER_CORE)
      for (let x = left; x < right; x += ROUNDED_POLYHEDRON_RASTER_CORE) {
        const width = Math.min(ROUNDED_POLYHEDRON_RASTER_CORE, right - x),
          height = Math.min(ROUNDED_POLYHEDRON_RASTER_CORE, bottom - y),
          stats = rasterizeRoundedPolyhedronTile(triangles, s.tile, x, y, width, height);
        s.tiles++;
        s.candidateSamples += stats.candidateSamples;
        s.coveredSamples += stats.coveredSamples;
        s.context.putImageData(s.image, 0, 0, 0, 0, width + 2, height + 2);
        c.drawImage(s.canvas, 1, 1, width, height, x, y, width, height);
      }
  } finally {
    c.restore();
  }
}
