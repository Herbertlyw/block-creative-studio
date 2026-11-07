/** Native closed quarters of one raised square-pyramid mother.
 * This is a reusable geometric reconstruction hypothesis, not source-derived
 * pixels or a claim of unique source topology. Default wood relief is separate.
 * Caller owns translation, opacity and time; absolute poses are deterministic.
 */
import {
  roundedFragmentCubeLighting,
  type RoundedCubeCastShadowOptions,
  type RoundedCubeFaceId,
  type RoundedCubeLightOptions,
  type RoundedCubeLighting,
  type RoundedCubeVector,
} from './roundedFragmentCube';

/** Fixed reconstruction hypothesis. These dimensions are not recovered source
 * geometry. An opt-in profile must never alter the carved-star relief defaults. */
export const PYRAMID_QUARTER_MOTHER_PROFILE = Object.freeze({
  id: 'pyramid-quarter-v1',
  /** Fractions of the whole mother width, not of each independent quarter. */
  depth: 0.42,
  raise: 0.22,
  ridgeRound: 0.035,
  outerBevelWidth: 0.055,
  outerBevelDepth: 0.018,
  surfaceSegments: 16,
});
export interface PyramidQuarterFragmentGeometryOptions {
  readonly ix: number;
  readonly iy: number;
  /** The initial contract deliberately supports a four-way front split only. */
  readonly subdivisions?: number;
  readonly depthLayers?: number;
  readonly depthIndex?: number;
}
export interface PyramidQuarterFragmentVertex {
  /** Piece-local coordinates. A fragment's unrotated width is one. */
  readonly position: RoundedCubeVector;
  /** Coordinates of the original, whole mother's artwork, never repeated quarter artwork. */
  readonly motherUv: { readonly x: number; readonly y: number };
}
export interface PyramidQuarterFragmentTriangle {
  readonly indices: readonly [number, number, number];
  readonly kind: 'front' | 'back' | 'outer-side' | 'cut-side';
  readonly faceId: RoundedCubeFaceId;
  readonly normal: RoundedCubeVector;
}
export interface PyramidQuarterFragmentGeometry {
  readonly profile: typeof PYRAMID_QUARTER_MOTHER_PROFILE;
  readonly ix: number;
  readonly iy: number;
  readonly subdivisions: 2;
  readonly depthLayers: 1;
  readonly vertices: readonly PyramidQuarterFragmentVertex[];
  readonly triangles: readonly PyramidQuarterFragmentTriangle[];
}
/** An explicit screen-space camera hypothesis, never inferred from source pixels.
 * Z grows toward the camera; all lengths and the principal point use stage pixels.
 */
export interface PyramidQuarterPerspectiveCamera {
  readonly focalLengthPixels: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly referencePlaneDepthPixels: number;
}
export interface PyramidQuarterFragmentProjectionOptions
  extends PyramidQuarterFragmentGeometryOptions,
    RoundedCubeLightOptions {
  readonly size: number;
  /** Absolute Euler radians, X then Y then Z; random access needs no integration. */
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
  /** Omission retains the original, exactly orthographic projection. */
  readonly perspectiveCamera?: PyramidQuarterPerspectiveCamera;
  /** Absolute V2 particle pivot. Required only with perspectiveCamera. */
  readonly worldOrigin?: RoundedCubeVector;
}
export interface PyramidQuarterFragmentProjectedTriangle
  extends Omit<PyramidQuarterFragmentTriangle, 'indices'> {
  readonly points: readonly [RoundedCubeVector, RoundedCubeVector, RoundedCubeVector];
  readonly motherUvs: readonly [
    PyramidQuarterFragmentVertex['motherUv'],
    PyramidQuarterFragmentVertex['motherUv'],
    PyramidQuarterFragmentVertex['motherUv'],
  ];
  readonly depth: number;
  readonly lighting: RoundedCubeLighting;
}
export interface PyramidQuarterFragmentProjection {
  /** Real visible triangles, sorted far to near; no front-facing cube proxy. */
  readonly triangles: readonly PyramidQuarterFragmentProjectedTriangle[];
  readonly parentSize: number;
}
export interface PyramidQuarterFragmentPaintInfo {
  /** Whole mother's width; the helper owns the quarter selection and projection. */
  readonly size: number;
  readonly color: string;
}
export interface PyramidQuarterFragmentOptions extends PyramidQuarterFragmentProjectionOptions {
  readonly color: string;
  readonly cutColor?: string;
  readonly faceColors?: Partial<Readonly<Record<RoundedCubeFaceId, string>>>;
  readonly lightColor?: string;
  readonly shadow?: number;
  readonly castShadow?: RoundedCubeCastShadowOptions;
  /** Paint [0,size]² of the whole mother. Only the sloping mother exterior front uses it. */
  readonly facePainter?: (
    context: CanvasRenderingContext2D,
    info: PyramidQuarterFragmentPaintInfo,
  ) => void;
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
/** One continuous raised mother square-pyramid. Broad sectors remain planar;
 * only the narrow diagonal shoulder and outer rim receive gentle rounding. */
export function pyramidQuarterMotherFrontHeight(x: number, y: number): number {
  if (!Number.isFinite(x + y) || x < 0 || x > 1 || y < 0 || y > 1)
    throw new Error('PYRAMID_QUARTER_FRAGMENT_UV_OUT_OF_RANGE');
  const p = PYRAMID_QUARTER_MOTHER_PROFILE,
    ax = Math.abs(x - 0.5),
    ay = Math.abs(y - 0.5);
  const delta = Math.abs(ax - ay),
    shoulder = Math.max(0, 1 - delta / p.ridgeRound);
  const radius = Math.max(ax, ay) + (p.ridgeRound * shoulder * shoulder) / 4;
  const ridge = Math.max(0, 1 - 2 * radius);
  const edge = Math.min(x, y, 1 - x, 1 - y);
  const bevel = p.outerBevelDepth * (1 - smooth(edge / p.outerBevelWidth));
  return p.depth / 2 + p.raise * ridge - bevel;
}
function validate(options: PyramidQuarterFragmentGeometryOptions): void {
  if (
    (options.subdivisions ?? 2) !== 2 ||
    (options.depthLayers ?? 1) !== 1 ||
    (options.depthIndex ?? 0) !== 0
  )
    throw new Error(
      'PYRAMID_QUARTER_FRAGMENT_UNSUPPORTED_PARTITION: requires subdivisions 2 and depthLayers 1',
    );
  if (
    !Number.isInteger(options.ix) ||
    !Number.isInteger(options.iy) ||
    options.ix < 0 ||
    options.ix > 1 ||
    options.iy < 0 ||
    options.iy > 1
  )
    throw new Error('PYRAMID_QUARTER_FRAGMENT_INDEX_OUT_OF_RANGE');
}
// Exactly four immutable meshes, never an unbounded frame/angle cache.
const meshes: Array<PyramidQuarterFragmentGeometry | undefined> = new Array(4);
export function createPyramidQuarterFragmentGeometry(
  options: PyramidQuarterFragmentGeometryOptions,
): PyramidQuarterFragmentGeometry {
  validate(options);
  const { ix, iy } = options,
    known = meshes[iy * 2 + ix];
  if (known) return known;
  const vertices: PyramidQuarterFragmentVertex[] = [],
    triangles: PyramidQuarterFragmentTriangle[] = [],
    lookup = new Map<string, number>();
  const steps = PYRAMID_QUARTER_MOTHER_PROFILE.surfaceSegments / 2,
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
    kind: PyramidQuarterFragmentTriangle['kind'],
    faceId: RoundedCubeFaceId,
  ) => {
    const [a, b, c] = indices.map((i) => vertices[i]!.position) as [
      RoundedCubeVector,
      RoundedCubeVector,
      RoundedCubeVector,
    ];
    const raw = cross(sub(b, a), sub(c, a));
    if (Math.hypot(raw.x, raw.y, raw.z) <= 1e-12)
      throw new Error('PYRAMID_QUARTER_FRAGMENT_DEGENERATE_TRIANGLE');
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
      const x = ix / 2 + i / PYRAMID_QUARTER_MOTHER_PROFILE.surfaceSegments,
        y = iy / 2 + j / PYRAMID_QUARTER_MOTHER_PROFILE.surfaceSegments;
      row.push(vertex(x, y, pyramidQuarterMotherFrontHeight(x, y)));
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
  // so each wedge retains the shared rising mother slope along its cut wall.
  const perimeter: number[] = [];
  for (let i = 0; i < steps; i++) perimeter.push(front[0]![i]!);
  for (let j = 0; j < steps; j++) perimeter.push(front[j]![steps]!);
  for (let i = steps; i > 0; i--) perimeter.push(front[steps]![i]!);
  for (let j = steps; j > 0; j--) perimeter.push(front[j]![0]!);
  const backZ = -PYRAMID_QUARTER_MOTHER_PROFILE.depth / 2;
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
  const mesh: PyramidQuarterFragmentGeometry = Object.freeze({
    profile: PYRAMID_QUARTER_MOTHER_PROFILE,
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
function rotation(options: PyramidQuarterFragmentProjectionOptions) {
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
export function projectPyramidQuarterFragment(
  options: PyramidQuarterFragmentProjectionOptions,
): PyramidQuarterFragmentProjection {
  validate(options);
  if (!Number.isFinite(options.size) || options.size <= 0) return { triangles: [], parentSize: 0 };
  const mesh = createPyramidQuarterFragmentGeometry(options),
    rotate = rotation(options),
    size = options.size;
  const camera = options.perspectiveCamera,
    origin = options.worldOrigin;
  if (
    camera &&
    (!Number.isFinite(camera.focalLengthPixels) ||
      camera.focalLengthPixels <= 0 ||
      !Number.isFinite(camera.centerX) ||
      !Number.isFinite(camera.centerY) ||
      !Number.isFinite(camera.referencePlaneDepthPixels) ||
      !origin ||
      ![origin.x, origin.y, origin.z].every(Number.isFinite))
  )
    throw new Error('PYRAMID_QUARTER_PERSPECTIVE_INVALID_CAMERA_OR_ORIGIN');
  // Keep the old arithmetic path untouched when perspective is not requested.
  // Project absolute stage positions, then remove the caller-owned translation.
  // Never clamp a vertex through the camera plane into a plausible-looking mesh.
  const points = camera
    ? mesh.vertices.map((p) => {
        const q = rotate(p.position),
          x = origin!.x + q.x * size,
          y = origin!.y + q.y * size,
          z = origin!.z + q.z * size;
        const denominator = camera.focalLengthPixels - (z - camera.referencePlaneDepthPixels);
        if (denominator <= 1e-6)
          throw new Error('PYRAMID_QUARTER_PERSPECTIVE_CAMERA_PLANE_INTERSECTION');
        const scale = camera.focalLengthPixels / denominator;
        const projected = v(
          camera.centerX + (x - camera.centerX) * scale - origin!.x,
          camera.centerY + (y - camera.centerY) * scale - origin!.y,
          z,
        );
        if (![projected.x, projected.y, projected.z].every(Number.isFinite))
          throw new Error('PYRAMID_QUARTER_PERSPECTIVE_NONFINITE_PROJECTION');
        return projected;
      })
    : mesh.vertices.map((p) => {
        const q = rotate(p.position);
        return v(q.x * size, q.y * size, q.z * size);
      });
  const triangles: PyramidQuarterFragmentProjectedTriangle[] = [];
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
  triangles: readonly PyramidQuarterFragmentProjectedTriangle[],
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
  const text = /^#[\da-f]{6}$/i.test(color) ? color.slice(1) : 'efaac1',
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
export function pyramidQuarterFragmentUvTransform(
  triangle: PyramidQuarterFragmentProjectedTriangle,
  parentSize: number,
): readonly [number, number, number, number, number, number] {
  const [a, b, c] = triangle.motherUvs.map((p) => ({ x: p.x * parentSize, y: p.y * parentSize }));
  const [p, q, r] = triangle.points;
  const ux = b!.x - a!.x,
    uy = b!.y - a!.y,
    vx = c!.x - a!.x,
    vy = c!.y - a!.y,
    determinant = ux * vy - uy * vx;
  if (Math.abs(determinant) <= 1e-12)
    throw new Error('PYRAMID_QUARTER_FRAGMENT_FRONT_UV_DEGENERATE');
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
  options: PyramidQuarterFragmentOptions,
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
/** Closed quarter-wedge silhouette and plain cut faces, with real sloping normals. */
export function drawPyramidQuarterFragment(
  context: CanvasRenderingContext2D,
  options: PyramidQuarterFragmentOptions,
): void {
  const projection = projectPyramidQuarterFragment(options);
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
        context.fillStyle = cast?.color ?? '#704653';
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
    // All visible triangles union into the exact projected silhouette. This
    // preserves the real quarter outline as it rotates, without a cube proxy.
    trace(context, projection.triangles);
    context.fillStyle = options.color;
    context.fill();
    for (const triangle of projection.triangles) {
      const color =
        options.faceColors?.[triangle.faceId] ??
        (triangle.kind === 'cut-side' ? (options.cutColor ?? options.color) : options.color);
      trace(context, [triangle]);
      context.fillStyle = litColor(color, light, triangle.lighting, limit);
      context.fill();
      if (triangle.kind !== 'front' || !options.facePainter) continue;
      context.save();
      try {
        trace(context, [triangle]);
        context.clip();
        context.transform(...pyramidQuarterFragmentUvTransform(triangle, projection.parentSize));
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
