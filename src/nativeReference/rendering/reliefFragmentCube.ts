/**
 * A native, non-convex carved mother tile, intersected with four rectangular
 * fracture volumes. This is a reusable reconstruction hypothesis, not recovered
 * source geometry. In particular the star's depth cannot be inferred from a
 * single reference image. No image, video, clock or random source defines it.
 */
import {
  roundedFragmentCubeLighting,
  type RoundedCubeCastShadowOptions,
  type RoundedCubeFaceId,
  type RoundedCubeLightOptions,
  type RoundedCubeLighting,
  type RoundedCubeVector,
} from './roundedFragmentCube';

export const RELIEF_MOTHER_PROFILE = Object.freeze({
  id: 'carved-star-v1',
  /** Dimensions are fractions of the whole mother tile's width. */
  depth: 0.46,
  starOuterRadius: 0.34,
  starInnerRadius: 0.155,
  recessDepth: 0.105,
  grooveTransition: 0.032,
  outerBevelWidth: 0.055,
  outerBevelDepth: 0.035,
  surfaceSegments: 16,
});
export interface ReliefFragmentGeometryOptions {
  readonly ix: number;
  readonly iy: number;
  /** The initial contract deliberately supports a four-way front split only. */
  readonly subdivisions?: number;
  readonly depthLayers?: number;
  readonly depthIndex?: number;
}
export interface ReliefFragmentVertex {
  /** Piece-local coordinates. A fragment's unrotated width is one. */
  readonly position: RoundedCubeVector;
  /** Coordinates of the original, whole mother's artwork, never piece UVs. */
  readonly motherUv: { readonly x: number; readonly y: number };
}
export interface ReliefFragmentTriangle {
  readonly indices: readonly [number, number, number];
  readonly kind: 'front' | 'back' | 'outer-side' | 'cut-side';
  readonly faceId: RoundedCubeFaceId;
  readonly normal: RoundedCubeVector;
}
export interface ReliefFragmentGeometry {
  readonly profile: typeof RELIEF_MOTHER_PROFILE;
  readonly ix: number;
  readonly iy: number;
  readonly subdivisions: 2;
  readonly depthLayers: 1;
  readonly vertices: readonly ReliefFragmentVertex[];
  readonly triangles: readonly ReliefFragmentTriangle[];
}
export interface ReliefFragmentProjectionOptions
  extends ReliefFragmentGeometryOptions,
    RoundedCubeLightOptions {
  readonly size: number;
  /** Absolute Euler radians, X then Y then Z; random access needs no integration. */
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
}
export interface ReliefFragmentProjectedTriangle extends Omit<ReliefFragmentTriangle, 'indices'> {
  readonly points: readonly [RoundedCubeVector, RoundedCubeVector, RoundedCubeVector];
  readonly motherUvs: readonly [
    ReliefFragmentVertex['motherUv'],
    ReliefFragmentVertex['motherUv'],
    ReliefFragmentVertex['motherUv'],
  ];
  readonly depth: number;
  readonly lighting: RoundedCubeLighting;
}
export interface ReliefFragmentProjection {
  /** Real visible triangles, sorted far to near. No convex hull fills the notch. */
  readonly triangles: readonly ReliefFragmentProjectedTriangle[];
  readonly parentSize: number;
}
export interface ReliefFragmentPaintInfo {
  /** Whole mother's width; the helper owns the quarter selection and projection. */
  readonly size: number;
  readonly color: string;
}
export interface ReliefFragmentCubeOptions extends ReliefFragmentProjectionOptions {
  readonly color: string;
  readonly cutColor?: string;
  readonly faceColors?: Partial<Readonly<Record<RoundedCubeFaceId, string>>>;
  readonly lightColor?: string;
  readonly shadow?: number;
  readonly castShadow?: RoundedCubeCastShadowOptions;
  /** Paint [0,size]² of the whole mother. Only the carved exterior front uses it. */
  readonly facePainter?: (context: CanvasRenderingContext2D, info: ReliefFragmentPaintInfo) => void;
  /** Opt in only when the painter uses its supplied context. Legacy game tile
   * closures capture the output context and must keep the direct path. */
  readonly cacheFacePainter?: boolean;
}

const v = (x: number, y: number, z: number): RoundedCubeVector => ({ x, y, z });
const sub = (a: RoundedCubeVector, b: RoundedCubeVector) => v(a.x - b.x, a.y - b.y, a.z - b.z);
const cross = (a: RoundedCubeVector, b: RoundedCubeVector) =>
  v(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const unit = (p: RoundedCubeVector) => {
  const n = Math.hypot(p.x, p.y, p.z);
  return v(p.x / n, p.y / n, p.z / n);
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const finite = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) ? value : fallback;
const smooth = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const star = Object.freeze(
  Array.from({ length: 10 }, (_, i) => {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5,
      radius =
        i % 2 ? RELIEF_MOTHER_PROFILE.starInnerRadius : RELIEF_MOTHER_PROFILE.starOuterRadius;
    return Object.freeze({ x: 0.5 + Math.cos(angle) * radius, y: 0.5 + Math.sin(angle) * radius });
  }),
);

/** Signed distance to the non-convex five-point engraving, in mother units. */
export function reliefMotherStarDistance(x: number, y: number): number {
  let inside = false,
    distance = Infinity;
  for (let i = 0, j = star.length - 1; i < star.length; j = i++) {
    const a = star[j]!,
      b = star[i]!,
      dx = b.x - a.x,
      dy = b.y - a.y;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy), 0, 1);
    distance = Math.min(distance, Math.hypot(x - a.x - t * dx, y - a.y - t * dy));
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? -distance : distance;
}
/** One shared mother height function; neither quarter independently reshapes it. */
export function reliefMotherFrontHeight(x: number, y: number): number {
  if (!Number.isFinite(x + y) || x < 0 || x > 1 || y < 0 || y > 1)
    throw new Error('RELIEF_FRAGMENT_UV_OUT_OF_RANGE');
  const p = RELIEF_MOTHER_PROFILE,
    edge = Math.min(x, y, 1 - x, 1 - y);
  const bevel = p.outerBevelDepth * (1 - smooth(edge / p.outerBevelWidth));
  const groove = p.recessDepth * smooth(0.5 - reliefMotherStarDistance(x, y) / p.grooveTransition);
  return p.depth / 2 - bevel - groove;
}
function validate(options: ReliefFragmentGeometryOptions): void {
  if (
    (options.subdivisions ?? 2) !== 2 ||
    (options.depthLayers ?? 1) !== 1 ||
    (options.depthIndex ?? 0) !== 0
  )
    throw new Error(
      'RELIEF_FRAGMENT_UNSUPPORTED_PARTITION: requires subdivisions 2 and depthLayers 1',
    );
  if (
    !Number.isInteger(options.ix) ||
    !Number.isInteger(options.iy) ||
    options.ix < 0 ||
    options.ix > 1 ||
    options.iy < 0 ||
    options.iy > 1
  )
    throw new Error('RELIEF_FRAGMENT_INDEX_OUT_OF_RANGE');
}
// Four immutable meshes, rather than an unbounded cache keyed by frame or angle.
const meshes: Array<ReliefFragmentGeometry | undefined> = new Array(4);
export function createReliefFragmentCubeGeometry(
  options: ReliefFragmentGeometryOptions,
): ReliefFragmentGeometry {
  validate(options);
  const { ix, iy } = options,
    known = meshes[iy * 2 + ix];
  if (known) return known;
  const vertices: ReliefFragmentVertex[] = [],
    triangles: ReliefFragmentTriangle[] = [],
    lookup = new Map<string, number>();
  const steps = RELIEF_MOTHER_PROFILE.surfaceSegments / 2,
    centerX = (ix + 0.5) / 2,
    centerY = (iy + 0.5) / 2;
  const vertex = (x: number, y: number, z: number) => {
    const key = `${x}:${y}:${z}`,
      existing = lookup.get(key);
    if (existing !== undefined) return existing;
    const index = vertices.length;
    vertices.push(
      Object.freeze({
        position: Object.freeze(v((x - centerX) * 2, (y - centerY) * 2, z * 2)),
        motherUv: Object.freeze({ x, y }),
      }),
    );
    lookup.set(key, index);
    return index;
  };
  const triangle = (
    indices: [number, number, number],
    kind: ReliefFragmentTriangle['kind'],
    faceId: RoundedCubeFaceId,
  ) => {
    const [a, b, c] = indices.map((i) => vertices[i]!.position) as [
      RoundedCubeVector,
      RoundedCubeVector,
      RoundedCubeVector,
    ];
    const raw = cross(sub(b, a), sub(c, a));
    if (Math.hypot(raw.x, raw.y, raw.z) <= 1e-12)
      throw new Error('RELIEF_FRAGMENT_DEGENERATE_TRIANGLE');
    triangles.push(
      Object.freeze({
        indices: Object.freeze(indices),
        kind,
        faceId,
        normal: Object.freeze(unit(raw)),
      }),
    );
  };
  const front: number[][] = [];
  for (let j = 0; j <= steps; j++) {
    const row: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = ix / 2 + i / RELIEF_MOTHER_PROFILE.surfaceSegments,
        y = iy / 2 + j / RELIEF_MOTHER_PROFILE.surfaceSegments;
      row.push(vertex(x, y, reliefMotherFrontHeight(x, y)));
    }
    front.push(row);
  }
  for (let j = 0; j < steps; j++)
    for (let i = 0; i < steps; i++) {
      const a = front[j]![i]!,
        b = front[j]![i + 1]!,
        c = front[j + 1]![i + 1]!,
        d = front[j + 1]![i]!;
      triangle([a, b, c], 'front', 'front');
      triangle([a, c, d], 'front', 'front');
    }
  // CCW front perimeter. Every cut wall uses these same sampled front vertices,
  // so its outline includes the engraving's recessed V/chevron intersections.
  const perimeter: number[] = [];
  for (let i = 0; i < steps; i++) perimeter.push(front[0]![i]!);
  for (let j = 0; j < steps; j++) perimeter.push(front[j]![steps]!);
  for (let i = steps; i > 0; i--) perimeter.push(front[steps]![i]!);
  for (let j = steps; j > 0; j--) perimeter.push(front[j]![0]!);
  const backZ = -RELIEF_MOTHER_PROFILE.depth / 2;
  const back = perimeter.map((i) => {
    const p = vertices[i]!.motherUv;
    return vertex(p.x, p.y, backZ);
  });
  const backCenter = vertex(centerX, centerY, backZ);
  for (let i = 0; i < perimeter.length; i++) {
    const next = (i + 1) % perimeter.length,
      a = perimeter[i]!,
      b = perimeter[next]!,
      ba = back[i]!,
      bb = back[next]!;
    triangle([backCenter, bb, ba], 'back', 'back');
    const pa = vertices[a]!.motherUv,
      pb = vertices[b]!.motherUv;
    const outer =
      (pa.x === 0 && pb.x === 0) ||
      (pa.x === 1 && pb.x === 1) ||
      (pa.y === 0 && pb.y === 0) ||
      (pa.y === 1 && pb.y === 1);
    const faceId: RoundedCubeFaceId =
      i < steps ? 'top' : i < steps * 2 ? 'right' : i < steps * 3 ? 'bottom' : 'left';
    triangle([a, ba, bb], outer ? 'outer-side' : 'cut-side', faceId);
    triangle([a, bb, b], outer ? 'outer-side' : 'cut-side', faceId);
  }
  const mesh: ReliefFragmentGeometry = Object.freeze({
    profile: RELIEF_MOTHER_PROFILE,
    ix,
    iy,
    subdivisions: 2,
    depthLayers: 1,
    vertices: Object.freeze(vertices),
    triangles: Object.freeze(triangles),
  });
  meshes[iy * 2 + ix] = mesh;
  return mesh;
}
function rotation(options: ReliefFragmentProjectionOptions) {
  const rx = finite(options.rotationX, 0) % (2 * Math.PI),
    ry = finite(options.rotationY, 0) % (2 * Math.PI),
    rz = finite(options.rotationZ, 0) % (2 * Math.PI);
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  return (p: RoundedCubeVector) => {
    const y = p.y * cx - p.z * sx,
      z = p.y * sx + p.z * cx,
      x = p.x * cy + z * sy,
      depth = -p.x * sy + z * cy;
    return v(x * cz - y * sz, x * sz + y * cz, depth);
  };
}
export function projectReliefFragmentCube(
  options: ReliefFragmentProjectionOptions,
): ReliefFragmentProjection {
  validate(options);
  if (!Number.isFinite(options.size) || options.size <= 0) return { triangles: [], parentSize: 0 };
  const mesh = createReliefFragmentCubeGeometry(options),
    rotate = rotation(options),
    size = options.size;
  const points = mesh.vertices.map((p) => {
    const q = rotate(p.position);
    return v(q.x * size, q.y * size, q.z * size);
  });
  const triangles: ReliefFragmentProjectedTriangle[] = [];
  for (const triangle of mesh.triangles) {
    const ps = triangle.indices.map((i) => points[i]!) as [
      RoundedCubeVector,
      RoundedCubeVector,
      RoundedCubeVector,
    ];
    if (cross(sub(ps[1], ps[0]), sub(ps[2], ps[0])).z <= 1e-10) continue;
    const normal = rotate(triangle.normal);
    triangles.push({
      kind: triangle.kind,
      faceId: triangle.faceId,
      points: ps,
      normal,
      motherUvs: [
        mesh.vertices[triangle.indices[0]]!.motherUv,
        mesh.vertices[triangle.indices[1]]!.motherUv,
        mesh.vertices[triangle.indices[2]]!.motherUv,
      ],
      depth: ps.reduce((sum, p) => sum + p.z, 0) / 3,
      lighting: roundedFragmentCubeLighting(normal, options),
    });
  }
  triangles.sort((a, b) => a.depth - b.depth);
  return { triangles, parentSize: size * 2 };
}
function trace(
  context: CanvasRenderingContext2D,
  triangles: readonly ReliefFragmentProjectedTriangle[],
): void {
  context.beginPath();
  for (const { points } of triangles) {
    context.moveTo(points[0].x, points[0].y);
    context.lineTo(points[1].x, points[1].y);
    context.lineTo(points[2].x, points[2].y);
    context.closePath();
  }
}
function rgb(color: string): readonly number[] {
  const text = /^#[\da-f]{6}$/i.test(color) ? color.slice(1) : 'edb479',
    n = parseInt(text, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function litColor(
  color: string,
  light: readonly number[],
  value: RoundedCubeLighting,
  limit: number,
): string {
  const mix = clamp(value.specular + Math.max(0, value.brightness - 1) * 0.35, 0, limit);
  return `rgb(${rgb(color)
    .map((n, i) =>
      Math.round(clamp(n * Math.min(1, value.brightness) * (1 - mix) + light[i]! * mix, 0, 255)),
    )
    .join(',')})`;
}
/** Affine map from one true mother-UV triangle onto its projected 3D triangle. */
export function reliefFragmentUvTransform(
  triangle: ReliefFragmentProjectedTriangle,
  parentSize: number,
): readonly [number, number, number, number, number, number] {
  const [a, b, c] = triangle.motherUvs.map((p) => ({ x: p.x * parentSize, y: p.y * parentSize }));
  const [p, q, r] = triangle.points;
  const ux = b!.x - a!.x,
    uy = b!.y - a!.y,
    vx = c!.x - a!.x,
    vy = c!.y - a!.y,
    determinant = ux * vy - uy * vx;
  if (Math.abs(determinant) <= 1e-12) throw new Error('RELIEF_FRAGMENT_FRONT_UV_DEGENERATE');
  const xx = ((q.x - p.x) * vy - (r.x - p.x) * uy) / determinant,
    xy = ((r.x - p.x) * ux - (q.x - p.x) * vx) / determinant;
  const yx = ((q.y - p.y) * vy - (r.y - p.y) * uy) / determinant,
    yy = ((r.y - p.y) * ux - (q.y - p.y) * vx) / determinant;
  return [xx, yx, xy, yy, p.x - xx * a!.x - xy * a!.y, p.y - yx * a!.x - yy * a!.y];
}
type Scratch = {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  pixels: number;
};
// One scratch image per output context, not per particle/frame. Weak ownership
// also lets a disposed export release it. Texture contents are repainted each
// draw, so height-dependent palette changes cannot accidentally use stale UVs.
const scratchByContext = new WeakMap<CanvasRenderingContext2D, Scratch>();
function textureFor(
  context: CanvasRenderingContext2D,
  options: ReliefFragmentCubeOptions,
  parentSize: number,
): Scratch | undefined {
  if (!options.facePainter || !options.cacheFacePainter || typeof context.drawImage !== 'function')
    return undefined;
  const pixels = Math.round(clamp(Math.ceil(parentSize), 32, 256));
  let scratch = scratchByContext.get(context);
  if (!scratch) {
    const owner = (context.canvas as HTMLCanvasElement | undefined)?.ownerDocument;
    const canvas = owner
      ? owner.createElement('canvas')
      : typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(pixels, pixels)
        : undefined;
    const ctx = canvas?.getContext('2d') as Scratch['context'] | null | undefined;
    if (!canvas || !ctx) return undefined;
    scratch = { canvas, context: ctx, pixels };
    scratchByContext.set(context, scratch);
  }
  if (
    scratch.pixels !== pixels ||
    scratch.canvas.width !== pixels ||
    scratch.canvas.height !== pixels
  ) {
    scratch.canvas.width = pixels;
    scratch.canvas.height = pixels;
    scratch.pixels = pixels;
  }
  const c = scratch.context;
  c.save();
  try {
    c.setTransform(pixels / parentSize, 0, 0, pixels / parentSize, 0, 0);
    c.clearRect(0, 0, parentSize, parentSize);
    c.globalAlpha = 1;
    options.facePainter(c as CanvasRenderingContext2D, { size: parentSize, color: options.color });
  } finally {
    c.restore();
  }
  return scratch;
}
/** Real relief silhouette and cut faces. No hull underlay erases a chevron. */
export function drawReliefFragmentCube(
  context: CanvasRenderingContext2D,
  options: ReliefFragmentCubeOptions,
): void {
  const projection = projectReliefFragmentCube(options);
  if (!projection.triangles.length) return;
  const light = rgb(options.lightColor ?? '#fff8e8'),
    limit =
      options.specularStrength === undefined
        ? 0.4
        : clamp(finite(options.specularStrength, 0.32), 0.4, 0.95);
  const texture = textureFor(context, options, projection.parentSize);
  context.save();
  try {
    const strength = clamp(finite(options.shadow, 0), 0, 1),
      cast = options.castShadow;
    if (strength > 0 && (cast?.opacity ?? 0.2) > 0) {
      context.save();
      try {
        context.translate(
          options.size * clamp(finite(cast?.offsetX, 0.12), -2, 2),
          options.size * clamp(finite(cast?.offsetY, 0.18), -2, 2),
        );
        context.globalAlpha *= strength * clamp(finite(cast?.opacity, 0.2), 0, 1);
        context.fillStyle = cast?.color ?? '#67441f';
        context.shadowColor = context.fillStyle;
        context.shadowBlur = options.size * clamp(finite(cast?.blur, 0.15), 0, 2);
        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
        trace(context, projection.triangles);
        context.fill();
      } finally {
        context.restore();
      }
    }
    // All visible triangles union into the exact projected silhouette. A convex
    // hull would incorrectly refill the physical notch we are reconstructing.
    trace(context, projection.triangles);
    context.fillStyle = options.color;
    context.fill();
    for (const triangle of projection.triangles) {
      const color =
        options.faceColors?.[triangle.faceId] ??
        (triangle.kind === 'cut-side' ? (options.cutColor ?? '#f2cd94') : options.color);
      trace(context, [triangle]);
      context.fillStyle = litColor(color, light, triangle.lighting, limit);
      context.fill();
      if (triangle.kind !== 'front' || !options.facePainter) continue;
      context.save();
      try {
        trace(context, [triangle]);
        context.clip();
        context.transform(...reliefFragmentUvTransform(triangle, projection.parentSize));
        if (texture)
          context.drawImage(texture.canvas, 0, 0, projection.parentSize, projection.parentSize);
        else options.facePainter(context, { size: projection.parentSize, color: options.color });
        if (triangle.lighting.brightness < 1) {
          context.save();
          try {
            context.globalAlpha *= 1 - triangle.lighting.brightness;
            context.fillStyle = '#000000';
            context.fillRect(0, 0, projection.parentSize, projection.parentSize);
          } finally {
            context.restore();
          }
        }
        const mix = clamp(
          triangle.lighting.specular + Math.max(0, triangle.lighting.brightness - 1) * 0.35,
          0,
          limit,
        );
        if (mix > 0) {
          context.save();
          try {
            context.globalAlpha *= mix;
            context.fillStyle = options.lightColor ?? '#fff8e8';
            context.fillRect(0, 0, projection.parentSize, projection.parentSize);
          } finally {
            context.restore();
          }
        }
      } finally {
        context.restore();
      }
    }
  } finally {
    context.restore();
  }
}
