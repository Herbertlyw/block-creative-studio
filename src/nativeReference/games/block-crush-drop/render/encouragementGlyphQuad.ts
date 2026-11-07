/**
 * Independent, presentation-only glyph prototype. No game packets, clocks,
 * asset loading, DOM constructors or camera recovery live in this module.
 * Canvas triangles are affine: a projective quad needs bounded subdivision.
 */
export interface EncouragementGlyphPoint {
  readonly x: number;
  readonly y: number;
}
/** UV order is (0,0), (1,0), (1,1), (0,1). Negative winding mirrors the texel. */
export type EncouragementGlyphQuad = readonly [
  EncouragementGlyphPoint,
  EncouragementGlyphPoint,
  EncouragementGlyphPoint,
  EncouragementGlyphPoint,
];
export type EncouragementGlyphHomography = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface EncouragementGlyphVertex extends EncouragementGlyphPoint {
  readonly u: number;
  readonly v: number;
}
export type EncouragementGlyphTriangle = readonly [
  EncouragementGlyphVertex,
  EncouragementGlyphVertex,
  EncouragementGlyphVertex,
];
export interface EncouragementGlyphMeshOptions {
  readonly maxErrorPixels?: number;
  readonly maxTriangles?: number;
}
export interface EncouragementGlyphMesh {
  readonly homography: EncouragementGlyphHomography;
  readonly triangles: readonly EncouragementGlyphTriangle[];
  readonly winding: 1 | -1;
  readonly exactAffine: boolean;
  /** Certified geometric interpolation error in quad-coordinate pixels, not a raster/alpha error. */
  readonly errorBoundPixels: number;
  readonly subdivisions: number;
}
export interface EncouragementGlyphTexture {
  readonly image: CanvasImageSource;
  readonly width: number;
  readonly height: number;
  readonly sourceRect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}
/** A caller must establish a complete isolated glyph mask; a whole-word cut is not that proof. */
export interface EncouragementGlyphAsset {
  readonly glyphId: string;
  readonly front: EncouragementGlyphTexture;
  readonly mask: EncouragementGlyphTexture;
  /** Transparent RGBA fronts preserve their alpha by default; masking again would square antialias alpha. */
  readonly frontMaskMode?: 'source-alpha' | 'multiply-mask';
}
export interface EncouragementGlyphScratch {
  readonly image: CanvasImageSource;
  readonly context: CanvasRenderingContext2D;
  readonly dispose?: () => void;
}
export type EncouragementGlyphScratchFactory = (
  width: number,
  height: number,
) => EncouragementGlyphScratch;
export interface EncouragementGlyphDrawOptions extends EncouragementGlyphMeshOptions {
  readonly face: 'front' | 'back';
  readonly backColor: string;
  readonly sideColor: string;
  /** Explicit finite 2D silhouette sweep, not recovered 3D extrusion. */
  readonly extrusion?: { readonly x: number; readonly y: number; readonly steps?: number };
  readonly opacity?: number;
}
export const ENCOURAGEMENT_GLYPH_QUAD_LIMITS = Object.freeze({
  maxCoordinate: 16384,
  maxAreaPixels: 1048576,
  maxDecodedPixels: 4194304,
  maxScratchPixels: 2097152,
  maxTriangles: 8192,
  maxDrawTriangles: 32768,
  maxExtrusionPixels: 32,
  maxExtrusionSteps: 16,
});
const EPS = 1e-10;
const fail = (reason: string): never => {
  throw new Error(`ENCOURAGEMENT_GLYPH_${reason}`);
};
const finite = (v: number) => typeof v === 'number' && Number.isFinite(v);
const cross = (
  a: EncouragementGlyphPoint,
  b: EncouragementGlyphPoint,
  c: EncouragementGlyphPoint,
) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

function quadWinding(quad: EncouragementGlyphQuad): 1 | -1 {
  if (
    !Array.isArray(quad) ||
    quad.length !== 4 ||
    quad.some((p) => !p || !finite(p.x) || !finite(p.y))
  )
    fail('QUAD_NONFINITE');
  if (
    quad.some(
      (p) =>
        Math.abs(p.x) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate ||
        Math.abs(p.y) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate,
    )
  )
    fail('COORDINATE_BUDGET');
  const turns = quad.map((p, i) => cross(p, quad[(i + 1) % 4]!, quad[(i + 2) % 4]!));
  if (
    turns.some((t) => Math.abs(t) < EPS) ||
    !(turns.every((t) => t > 0) || turns.every((t) => t < 0))
  )
    fail('QUAD_NOT_SIMPLE_CONVEX');
  const area =
    Math.abs(
      quad.reduce((s, p, i) => {
        const q = quad[(i + 1) % 4]!;
        return s + p.x * q.y - p.y * q.x;
      }, 0),
    ) / 2;
  if (area < 0.01) fail('QUAD_DEGENERATE');
  if (area > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxAreaPixels) fail('AREA_BUDGET');
  return turns[0]! > 0 ? 1 : -1;
}

/** Unit-square-to-quad projective matrix. It is exact as a mathematical mapping. */
export function encouragementGlyphHomography(
  quad: EncouragementGlyphQuad,
): EncouragementGlyphHomography {
  quadWinding(quad);
  const [p0, p1, p2, p3] = quad;
  const dx1 = p1.x - p2.x,
    dx2 = p3.x - p2.x,
    dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y,
    dy2 = p3.y - p2.y,
    dy3 = p0.y - p1.y + p2.y - p3.y;
  let g = 0,
    h = 0;
  if (Math.abs(dx3) > EPS || Math.abs(dy3) > EPS) {
    const d = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(d) < EPS) fail('HOMOGRAPHY_SINGULAR');
    g = (dx3 * dy2 - dx2 * dy3) / d;
    h = (dx1 * dy3 - dx3 * dy1) / d;
  }
  const matrix: EncouragementGlyphHomography = [
    p1.x - p0.x + g * p1.x,
    p3.x - p0.x + h * p3.x,
    p0.x,
    p1.y - p0.y + g * p1.y,
    p3.y - p0.y + h * p3.y,
    p0.y,
    g,
    h,
    1,
  ];
  if (matrix.some((n) => !finite(n)) || Math.min(1, 1 + g, 1 + h, 1 + g + h) <= EPS)
    fail('HOMOGRAPHY_POLE');
  return matrix;
}

export function projectEncouragementGlyphUv(
  matrix: EncouragementGlyphHomography,
  u: number,
  v: number,
): EncouragementGlyphPoint {
  if (
    !finite(u) ||
    !finite(v) ||
    u < 0 ||
    u > 1 ||
    v < 0 ||
    v > 1 ||
    matrix.length !== 9 ||
    matrix.some((n) => !finite(n))
  )
    fail('UV_INVALID');
  const d = matrix[6] * u + matrix[7] * v + matrix[8];
  if (d <= EPS) fail('HOMOGRAPHY_POLE');
  const x = (matrix[0] * u + matrix[1] * v + matrix[2]) / d,
    y = (matrix[3] * u + matrix[4] * v + matrix[5]) / d;
  if (!finite(x) || !finite(y)) fail('PROJECTION_NONFINITE');
  if (
    Math.abs(x) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate ||
    Math.abs(y) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate
  )
    fail('COORDINATE_BUDGET');
  return { x, y };
}

/**
 * For each scalar N/D, |Hessian| is bounded over the entire unit square.
 * Subtracting the mapped origin removes translation from this conservative
 * bound. Taylor's remainder plus barycentric cancellation bounds each affine
 * triangle error by .5 * ||Hessian-vector|| * diameter(UV)^2.
 */
function unitSquareHessianBound(m: EncouragementGlyphHomography): number {
  const g = m[6],
    h = m[7],
    dmin = Math.min(1, 1 + g, 1 + h, 1 + g + h);
  const component = (a: number, b: number, origin: number) => {
    const aa = a - origin * g,
      bb = b - origin * h,
      nmax = Math.max(0, Math.abs(aa), Math.abs(bb), Math.abs(aa + bb));
    const xx = (2 * Math.abs(aa * g)) / dmin ** 2 + (2 * nmax * g * g) / dmin ** 3;
    const yy = (2 * Math.abs(bb * h)) / dmin ** 2 + (2 * nmax * h * h) / dmin ** 3;
    const xy =
      (Math.abs(aa * h) + Math.abs(bb * g)) / dmin ** 2 + (2 * nmax * Math.abs(g * h)) / dmin ** 3;
    return Math.hypot(xx, yy, Math.SQRT2 * xy);
  };
  return Math.hypot(component(m[0], m[1], m[2]), component(m[3], m[4], m[5]));
}

export function createEncouragementGlyphQuadMesh(
  quad: EncouragementGlyphQuad,
  options: EncouragementGlyphMeshOptions = {},
): EncouragementGlyphMesh {
  const winding = quadWinding(quad),
    homography = encouragementGlyphHomography(quad);
  const tolerance = options.maxErrorPixels ?? 0.25,
    maxTriangles = options.maxTriangles ?? 2048;
  if (!finite(tolerance) || tolerance < 0.0001 || tolerance > 4) fail('ERROR_TOLERANCE_INVALID');
  if (
    !Number.isInteger(maxTriangles) ||
    maxTriangles < 2 ||
    maxTriangles > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxTriangles
  )
    fail('TRIANGLE_BUDGET_INVALID');
  const hessian = unitSquareHessianBound(homography);
  let n = 1;
  while (hessian / n ** 2 > tolerance) {
    n *= 2;
    if (2 * n * n > maxTriangles) fail('PROJECTIVE_ERROR_BUDGET');
  }
  const vertex = (u: number, v: number): EncouragementGlyphVertex => ({
    ...projectEncouragementGlyphUv(homography, u, v),
    u,
    v,
  });
  const triangles: EncouragementGlyphTriangle[] = [];
  for (let iy = 0; iy < n; iy++)
    for (let ix = 0; ix < n; ix++) {
      const a = vertex(ix / n, iy / n),
        b = vertex((ix + 1) / n, iy / n),
        c = vertex((ix + 1) / n, (iy + 1) / n),
        d = vertex(ix / n, (iy + 1) / n);
      triangles.push([a, b, c], [a, c, d]);
    }
  return {
    homography,
    triangles,
    winding,
    exactAffine: homography[6] === 0 && homography[7] === 0,
    errorBoundPixels: hessian / n ** 2,
    subdivisions: n,
  };
}

/** Map image-pixel coordinates through an affine triangle; caller clips the destination triangle. */
export function encouragementGlyphTriangleTransform(
  triangle: EncouragementGlyphTriangle,
  width: number,
  height: number,
  offset: EncouragementGlyphPoint = { x: 0, y: 0 },
): readonly [number, number, number, number, number, number] {
  if (
    !finite(width) ||
    !finite(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxDecodedPixels ||
    !finite(offset.x) ||
    !finite(offset.y) ||
    triangle.length !== 3 ||
    triangle.some(
      (p) => ![p.x, p.y, p.u, p.v].every(finite) || p.u < 0 || p.u > 1 || p.v < 0 || p.v > 1,
    )
  )
    fail('TRIANGLE_INVALID');
  if (
    triangle.some(
      (p) =>
        Math.abs(p.x + offset.x) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate ||
        Math.abs(p.y + offset.y) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate,
    )
  )
    fail('COORDINATE_BUDGET');
  const [p, q, r] = triangle,
    sx = p.u * width,
    sy = p.v * height,
    ux = (q.u - p.u) * width,
    uy = (q.v - p.v) * height,
    vx = (r.u - p.u) * width,
    vy = (r.v - p.v) * height;
  const det = ux * vy - vx * uy;
  if (Math.abs(det) < EPS) fail('TRIANGLE_DEGENERATE');
  const a = ((q.x - p.x) * vy - (r.x - p.x) * uy) / det,
    c = (-(q.x - p.x) * vx + (r.x - p.x) * ux) / det;
  const b = ((q.y - p.y) * vy - (r.y - p.y) * uy) / det,
    d = (-(q.y - p.y) * vx + (r.y - p.y) * ux) / det;
  const result: readonly [number, number, number, number, number, number] = [
    a,
    b,
    c,
    d,
    p.x + offset.x - a * sx - c * sy,
    p.y + offset.y - b * sx - d * sy,
  ];
  if (result.some((n) => !finite(n))) fail('TRANSFORM_NONFINITE');
  return result;
}

function validateTexture(t: EncouragementGlyphTexture): void {
  const r = t?.sourceRect;
  if (
    !t?.image ||
    !r ||
    ![t.width, t.height, r.x, r.y, r.width, r.height].every(Number.isInteger) ||
    t.width <= 0 ||
    t.height <= 0 ||
    r.x < 0 ||
    r.y < 0 ||
    r.width <= 0 ||
    r.height <= 0 ||
    r.x + r.width > t.width ||
    r.y + r.height > t.height
  )
    fail('TEXTURE_RECT_INVALID');
  if (t.width * t.height > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxDecodedPixels)
    fail('TEXTURE_DECODE_BUDGET');
}
function color(value: string): void {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) fail('COLOR_INVALID');
}
function preparedTexture(
  asset: EncouragementGlyphAsset,
  tint: string | undefined,
  factory: EncouragementGlyphScratchFactory,
): EncouragementGlyphScratch {
  const r = asset.front.sourceRect,
    m = asset.mask.sourceRect,
    layer = factory(r.width, r.height),
    c = layer.context;
  if (!layer.image || !c || c.canvas.width !== r.width || c.canvas.height !== r.height) {
    layer.dispose?.();
    fail('SCRATCH_DIMENSIONS_INVALID');
  }
  c.save();
  try {
    c.globalAlpha = 1;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, r.width, r.height);
    if (tint) {
      c.drawImage(asset.mask.image, m.x, m.y, m.width, m.height, 0, 0, r.width, r.height);
      c.globalCompositeOperation = 'source-in';
      c.fillStyle = tint;
      c.fillRect(0, 0, r.width, r.height);
    } else {
      c.drawImage(asset.front.image, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height);
      if (asset.frontMaskMode === 'multiply-mask') {
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(asset.mask.image, m.x, m.y, m.width, m.height, 0, 0, r.width, r.height);
      }
    }
  } catch (error) {
    layer.dispose?.();
    throw error;
  } finally {
    c.restore();
  }
  return layer;
}
function paintMesh(
  c: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  mesh: EncouragementGlyphMesh,
  offset: EncouragementGlyphPoint,
): void {
  for (const tri of mesh.triangles) {
    c.save();
    try {
      c.beginPath();
      c.moveTo(tri[0].x + offset.x, tri[0].y + offset.y);
      c.lineTo(tri[1].x + offset.x, tri[1].y + offset.y);
      c.lineTo(tri[2].x + offset.x, tri[2].y + offset.y);
      c.closePath();
      c.clip();
      c.transform(...encouragementGlyphTriangleTransform(tri, width, height, offset));
      c.drawImage(image, 0, 0, width, height);
    } finally {
      c.restore();
    }
  }
}

/**
 * A finite mask sweep paints explicit sides, followed by an independent front
 * texture or solid back mask. The caller supplies scratch allocation/cleanup;
 * this helper has no persistent texture cache and never changes a game frame.
 */
export function drawEncouragementGlyphQuad(
  c: CanvasRenderingContext2D,
  asset: EncouragementGlyphAsset,
  quad: EncouragementGlyphQuad,
  options: EncouragementGlyphDrawOptions,
  factory: EncouragementGlyphScratchFactory,
): { glyphId: string; mesh: EncouragementGlyphMesh; sidePasses: number; scratchPixels: number } {
  if (
    !asset ||
    typeof asset.glyphId !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(asset.glyphId)
  )
    fail('GLYPH_ID_INVALID');
  if (
    asset.frontMaskMode !== undefined &&
    !['source-alpha', 'multiply-mask'].includes(asset.frontMaskMode)
  )
    fail('FRONT_MASK_MODE_INVALID');
  validateTexture(asset.front);
  validateTexture(asset.mask);
  if (
    asset.front.sourceRect.width !== asset.mask.sourceRect.width ||
    asset.front.sourceRect.height !== asset.mask.sourceRect.height
  )
    fail('MASK_DIMENSIONS_MISMATCH');
  if (!options || !['front', 'back'].includes(options.face) || typeof factory !== 'function')
    fail('DRAW_OPTIONS_INVALID');
  color(options.backColor);
  color(options.sideColor);
  const opacity = options.opacity ?? 1;
  if (!finite(opacity) || opacity < 0 || opacity > 1) fail('OPACITY_INVALID');
  const extrusion = options.extrusion ?? { x: 0, y: 0 },
    length = Math.hypot(extrusion.x, extrusion.y),
    steps =
      extrusion.steps ??
      Math.min(ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxExtrusionSteps, Math.max(1, Math.ceil(length)));
  if (
    !finite(length) ||
    length > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxExtrusionPixels ||
    !Number.isInteger(steps) ||
    steps < 1 ||
    steps > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxExtrusionSteps
  )
    fail('EXTRUSION_BUDGET');
  const mesh = createEncouragementGlyphQuadMesh(quad, options),
    sidePasses = length === 0 ? 0 : steps;
  if (
    quad.some(
      (p) =>
        Math.abs(p.x + extrusion.x) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate ||
        Math.abs(p.y + extrusion.y) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate,
    )
  )
    fail('COORDINATE_BUDGET');
  if (mesh.triangles.length * (sidePasses + 1) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxDrawTriangles)
    fail('DRAW_TRIANGLE_BUDGET');
  const r = asset.front.sourceRect,
    scratchPixels = r.width * r.height * (sidePasses ? 2 : 1);
  if (scratchPixels > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxScratchPixels)
    fail('SCRATCH_PIXEL_BUDGET');
  // All numeric/asset budgets are checked before any allocation or drawing.
  const layers: EncouragementGlyphScratch[] = [];
  c.save();
  try {
    c.globalAlpha *= opacity;
    if (sidePasses) {
      const side = preparedTexture(asset, options.sideColor, factory);
      layers.push(side);
      for (let i = steps; i >= 1; i--)
        paintMesh(c, side.image, r.width, r.height, mesh, {
          x: (extrusion.x * i) / steps,
          y: (extrusion.y * i) / steps,
        });
    }
    const face = preparedTexture(
      asset,
      options.face === 'back' ? options.backColor : undefined,
      factory,
    );
    layers.push(face);
    paintMesh(c, face.image, r.width, r.height, mesh, { x: 0, y: 0 });
  } finally {
    c.restore();
    for (const layer of layers) layer.dispose?.();
  }
  return { glyphId: asset.glyphId, mesh, sidePasses, scratchPixels };
}

/** Optional bounded performance glow, separate from glyph textures and quad geometry. */
export function drawEncouragementGlyphGlow(
  c: CanvasRenderingContext2D,
  glow: {
    center: EncouragementGlyphPoint;
    radiusX: number;
    radiusY: number;
    color: 'white' | 'blue';
    blurPixels: number;
    opacity: number;
  },
): void {
  if (
    !glow ||
    ![
      glow.center?.x,
      glow.center?.y,
      glow.radiusX,
      glow.radiusY,
      glow.blurPixels,
      glow.opacity,
    ].every(finite) ||
    glow.radiusX <= 0 ||
    glow.radiusY <= 0 ||
    glow.radiusX > 128 ||
    glow.radiusY > 128 ||
    glow.blurPixels < 0 ||
    glow.blurPixels > 24 ||
    glow.opacity < 0 ||
    glow.opacity > 0.2 ||
    !['white', 'blue'].includes(glow.color) ||
    Math.abs(glow.center.x) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate ||
    Math.abs(glow.center.y) > ENCOURAGEMENT_GLYPH_QUAD_LIMITS.maxCoordinate
  )
    fail('GLOW_BUDGET');
  c.save();
  try {
    c.globalAlpha *= glow.opacity;
    c.fillStyle = glow.color === 'white' ? '#ffffff' : '#b0e7ff';
    c.shadowColor = c.fillStyle;
    c.shadowBlur = glow.blurPixels;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 0;
    c.beginPath();
    c.ellipse(glow.center.x, glow.center.y, glow.radiusX, glow.radiusY, 0, 0, Math.PI * 2);
    c.fill();
  } finally {
    c.restore();
  }
}
