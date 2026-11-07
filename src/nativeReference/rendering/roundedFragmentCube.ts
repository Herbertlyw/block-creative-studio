/**
 * Small, genuinely rounded boxes for Canvas fragment renderers. Coordinates are
 * camera space (x right, y down, +z towards the viewer), with orthographic
 * projection. The caller owns translation, opacity and time; this module has no
 * random source, clock, integration step, browser globals or gameplay dependency.
 */
export interface RoundedCubeVector {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}
export type RoundedCubeFaceId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export interface RoundedCubeGeometryOptions {
  /** Radius / full side length; capped at .22 so a cube cannot become a sphere. */
  readonly cornerRadius?: number;
  /** 2 is sufficient for small particles; 3–4 is useful for close inspection. */
  readonly bevelSegments?: number;
}
export interface RoundedCubeVertex {
  readonly position: RoundedCubeVector;
  readonly normal: RoundedCubeVector;
}
export interface RoundedCubePatch {
  readonly kind: 'face' | 'bevel' | 'corner';
  readonly faceId?: RoundedCubeFaceId;
  readonly indices: readonly number[];
}
export interface RoundedCubeGeometry {
  readonly radius: number;
  readonly segments: number;
  readonly vertices: readonly RoundedCubeVertex[];
  readonly patches: readonly RoundedCubePatch[];
}
export interface RoundedCubeLightOptions {
  readonly lightDirection?: RoundedCubeVector;
  readonly ambient?: number;
  /** Explicitly lower the ambient clamp floor, 0–.55; default remains .55. */
  readonly ambientFloor?: number;
  readonly diffuse?: number;
  readonly highlight?: number;
  /** Blinn lobe gain, 0–2; omitted retains the legacy .32 gain/mix limit. */
  readonly specularStrength?: number;
  /** Blinn exponent, 4–128; higher values concentrate the geometric glint. */
  readonly specularPower?: number;
}
export interface RoundedCubeLighting {
  readonly diffuse: number;
  readonly brightness: number;
  readonly specular: number;
}
export interface RoundedCubeProjectionOptions
  extends RoundedCubeGeometryOptions,
    RoundedCubeLightOptions {
  readonly size: number;
  /** Absolute Euler radians, applied X then Y then Z. Never incremental. */
  readonly rotationX?: number;
  readonly rotationY?: number;
  readonly rotationZ?: number;
  /** Opt-in object-front projection. Omitted keeps the original flat face mapping. */
  readonly frontUvMapping?: 'flat-patch' | 'mother-plane';
}
export interface RoundedCubeProjectedPatch {
  readonly kind: RoundedCubePatch['kind'];
  readonly faceId?: RoundedCubeFaceId;
  readonly points: readonly RoundedCubeVector[];
  readonly normal: RoundedCubeVector;
  readonly depth: number;
  readonly lighting: RoundedCubeLighting;
  readonly vertexLighting: readonly RoundedCubeLighting[];
  readonly vertexNormals: readonly RoundedCubeVector[];
  /** Original object-front plane coordinates, present only for the opt-in cap. */
  readonly frontUvs?: readonly { readonly u: number; readonly v: number }[];
}
export interface RoundedCubeProjection {
  /** Visible patches only, sorted far to near. */
  readonly patches: readonly RoundedCubeProjectedPatch[];
  readonly silhouette: readonly RoundedCubeVector[];
  readonly primaryFaceId?: RoundedCubeFaceId;
}
export interface RoundedCubeFacePaintInfo {
  readonly faceId: RoundedCubeFaceId;
  readonly primary: boolean;
  readonly size: number;
  readonly color: string;
  readonly normal: RoundedCubeVector;
  readonly lighting: RoundedCubeLighting;
}
export interface RoundedCubeCastShadowOptions {
  /** Translation in full side-length units, each clamped to -2–2. */
  readonly offsetX: number;
  readonly offsetY: number;
  /** Blur in full side-length units, clamped to 0–2. */
  readonly blur: number;
  /** Multiplied once by the caller's alpha and shadow strength, clamped to 0–1. */
  readonly opacity: number;
  readonly color?: string;
}
export interface RoundedFragmentCubeOptions extends RoundedCubeProjectionOptions {
  /** Hex RGB albedo, e.g. #edc08a. Light adds neutral cream, never a black edge. */
  readonly color: string;
  /** Object-space face albedo. Cut faces can be ivory while the outer wood stays
   * brown; these colors rotate with the solid, independently of the light. */
  readonly faceColors?: Partial<Readonly<Record<RoundedCubeFaceId, string>>>;
  readonly lightColor?: string;
  /** Optional single shallow cast shadow, 0–1; default off. */
  readonly shadow?: number;
  /** Opt-in single silhouette projection; omitted preserves the legacy shadow. */
  readonly castShadow?: RoundedCubeCastShadowOptions;
  /**
   * Runs in the actual visible face's local square [0,size]², clipped and
   * transformed into its 3D orientation. Paint only the face/texture, not an
   * additional procedural extrusion. Existing tile painters can be adapted as:
   *   facePainter: (ctx, face) => tile(0, 0, face.size, face.color, 'face')
   * The texture is lit after painting, preserving the recessed star/wood motif.
   */
  readonly facePainter?: (
    context: CanvasRenderingContext2D,
    face: RoundedCubeFacePaintInfo,
  ) => void;
  readonly textureFaces?: 'primary' | 'all' | readonly RoundedCubeFaceId[];
  /** Unlit [0,1]² quarter texture prepared by the renderer, not a frame image.
   * Used only by mother-plane; the side/back/cut flats never receive this image. */
  readonly frontTexture?: CanvasImageSource;
}

const vector = (x: number, y: number, z: number): RoundedCubeVector => ({ x, y, z });
const dot = (a: RoundedCubeVector, b: RoundedCubeVector) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a: RoundedCubeVector, b: RoundedCubeVector) => vector(a.x - b.x, a.y - b.y, a.z - b.z);
const cross = (a: RoundedCubeVector, b: RoundedCubeVector) =>
  vector(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const unit = (v: RoundedCubeVector): RoundedCubeVector => {
  const length = Math.hypot(v.x, v.y, v.z);
  return length > 1e-12 ? vector(v.x / length, v.y / length, v.z / length) : vector(0, 0, 1);
};
const finite = (value: number | undefined, fallback: number) =>
  value !== undefined && Number.isFinite(value) ? value : fallback;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const average = (values: readonly RoundedCubeVector[]) =>
  vector(
    values.reduce((n, v) => n + v.x, 0) / values.length,
    values.reduce((n, v) => n + v.y, 0) / values.length,
    values.reduce((n, v) => n + v.z, 0) / values.length,
  );
const parameters = (options: RoundedCubeGeometryOptions) => ({
  radius: Math.round(clamp(finite(options.cornerRadius, 0.1), 0, 0.22) * 10000) / 10000,
  segments: Math.round(clamp(finite(options.bevelSegments, 2), 1, 4)),
});

/** Minkowski sum of an inset cube and a sphere: six flats, twelve round edges,
 * eight spherical octants. Every join shares exact positions and normals. */
export function createRoundedFragmentCubeGeometry(
  options: RoundedCubeGeometryOptions = {},
): RoundedCubeGeometry {
  const { radius: r, segments: n } = parameters(options),
    a = 0.5 - r;
  const vertices: RoundedCubeVertex[] = [],
    patches: RoundedCubePatch[] = [],
    lookup = new Map<string, number>();
  const vertex = (position: RoundedCubeVector, normal: RoundedCubeVector) => {
    const key = [position.x, position.y, position.z, normal.x, normal.y, normal.z]
      .map((v) => v.toFixed(9))
      .join(',');
    const known = lookup.get(key);
    if (known !== undefined) return known;
    const index = vertices.length;
    vertices.push(
      Object.freeze({ position: Object.freeze(position), normal: Object.freeze(normal) }),
    );
    lookup.set(key, index);
    return index;
  };
  const patch = (indices: number[], kind: RoundedCubePatch['kind'], faceId?: RoundedCubeFaceId) => {
    const p = indices.map((i) => vertices[i]!),
      normal = unit(average(p.map((v) => v.normal)));
    const winding = cross(sub(p[1]!.position, p[0]!.position), sub(p[2]!.position, p[0]!.position));
    if (Math.hypot(winding.x, winding.y, winding.z) < 1e-12) return;
    if (dot(winding, normal) < 0) indices.reverse();
    patches.push(
      Object.freeze({ kind, ...(faceId ? { faceId } : {}), indices: Object.freeze(indices) }),
    );
  };
  const faceIds: readonly (readonly [
    RoundedCubeFaceId,
    RoundedCubeVector,
    RoundedCubeVector,
    RoundedCubeVector,
  ])[] = [
    ['front', vector(0, 0, 1), vector(1, 0, 0), vector(0, 1, 0)],
    ['back', vector(0, 0, -1), vector(-1, 0, 0), vector(0, 1, 0)],
    ['right', vector(1, 0, 0), vector(0, 0, -1), vector(0, 1, 0)],
    ['left', vector(-1, 0, 0), vector(0, 0, 1), vector(0, 1, 0)],
    ['top', vector(0, -1, 0), vector(1, 0, 0), vector(0, 0, 1)],
    ['bottom', vector(0, 1, 0), vector(1, 0, 0), vector(0, 0, -1)],
  ];
  for (const [id, normal, u, v] of faceIds) {
    patch(
      [
        [-a, -a],
        [a, -a],
        [a, a],
        [-a, a],
      ].map(([x, y]) =>
        vertex(
          vector(
            normal.x * 0.5 + u.x * x! + v.x * y!,
            normal.y * 0.5 + u.y * x! + v.y * y!,
            normal.z * 0.5 + u.z * x! + v.z * y!,
          ),
          normal,
        ),
      ),
      'face',
      id,
    );
  }
  if (r > 0) {
    for (let along = 0; along < 3; along++) {
      const axes = [0, 1, 2].filter((i) => i !== along),
        first = axes[0]!,
        second = axes[1]!;
      for (const s of [-1, 1])
        for (const t of [-1, 1])
          for (let step = 0; step < n; step++) {
            const points = [
              [step, -a],
              [step, a],
              [step + 1, a],
              [step + 1, -a],
            ].map(([i, end]) => {
              const u = i! / n,
                length = Math.hypot(1 - u, u),
                normal = [0, 0, 0],
                position = [0, 0, 0];
              normal[first] = (s * (1 - u)) / length;
              normal[second] = (t * u) / length;
              position[along] = end!;
              position[first] = s * a + r * normal[first]!;
              position[second] = t * a + r * normal[second]!;
              return vertex(
                vector(position[0]!, position[1]!, position[2]!),
                vector(normal[0]!, normal[1]!, normal[2]!),
              );
            });
            patch(points, 'bevel');
          }
    }
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1]) {
          const at = (i: number, j: number) => {
            const normal = unit(vector(sx * i, sy * j, sz * (n - i - j)));
            return vertex(
              vector(sx * a + r * normal.x, sy * a + r * normal.y, sz * a + r * normal.z),
              normal,
            );
          };
          for (let i = 0; i < n; i++)
            for (let j = 0; j < n - i; j++) {
              patch([at(i, j), at(i + 1, j), at(i, j + 1)], 'corner');
              if (i + j < n - 1) patch([at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)], 'corner');
            }
        }
  }
  return Object.freeze({
    radius: r,
    segments: n,
    vertices: Object.freeze(vertices),
    patches: Object.freeze(patches),
  });
}

// Radius/quality reuse is bounded. Do not cache arbitrary frame/angle/particle
// keys: a long export must not grow memory once for every rendered fragment.
const geometryCache = new Map<string, RoundedCubeGeometry>();
function geometryFor(options: RoundedCubeGeometryOptions): RoundedCubeGeometry {
  const p = parameters(options),
    key = `${p.radius}:${p.segments}`,
    cached = geometryCache.get(key);
  if (cached) return cached;
  const geometry = createRoundedFragmentCubeGeometry({
    cornerRadius: p.radius,
    bevelSegments: p.segments,
  });
  if (geometryCache.size >= 16) geometryCache.delete(geometryCache.keys().next().value!);
  geometryCache.set(key, geometry);
  return geometry;
}

/** Neutral fill protects saturated side faces. The default broad Blinn lobe is
 * unchanged; an explicit gain/exponent can concentrate a brighter normal-based
 * glint on the rounded bevel without painting a white rim or black outline. */
export function roundedFragmentCubeLighting(
  normal: RoundedCubeVector,
  options: RoundedCubeLightOptions = {},
): RoundedCubeLighting {
  const n = unit(normal),
    light = unit(options.lightDirection ?? vector(-0.38, -0.58, 0.72));
  const diffuse = Math.max(0, dot(n, light)),
    half = unit(vector(light.x, light.y, light.z + 1));
  return {
    diffuse,
    brightness:
      clamp(finite(options.ambient, 0.72), clamp(finite(options.ambientFloor, 0.55), 0, 0.55), 1) +
      clamp(finite(options.diffuse, 0.38), 0, 0.8) * diffuse,
    specular:
      clamp(finite(options.highlight, 0.45), 0, 1) *
      clamp(finite(options.specularStrength, 0.32), 0, 2) *
      Math.max(0, dot(n, half)) ** clamp(finite(options.specularPower, 10), 4, 128),
  };
}
function hull(points: readonly RoundedCubeVector[]): RoundedCubeVector[] {
  const ordered = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: readonly RoundedCubeVector[]) => {
    const out: RoundedCubeVector[] = [];
    for (const p of list) {
      while (
        out.length >= 2 &&
        cross(sub(out.at(-1)!, out.at(-2)!), sub(p, out.at(-1)!)).z <= 1e-10
      )
        out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(ordered), ...half(ordered.reverse())];
}
/** Pure, random-access geometric/lighting plan, also usable by offline checks. */
export function projectRoundedFragmentCube(
  options: RoundedCubeProjectionOptions,
): RoundedCubeProjection {
  const size = finite(options.size, 0);
  if (size <= 0) return { patches: [], silhouette: [] };
  const mesh = geometryFor(options),
    x = finite(options.rotationX, 0) % (2 * Math.PI),
    y = finite(options.rotationY, 0) % (2 * Math.PI),
    z = finite(options.rotationZ, 0) % (2 * Math.PI);
  const cx = Math.cos(x),
    sx = Math.sin(x),
    cy = Math.cos(y),
    sy = Math.sin(y),
    cz = Math.cos(z),
    sz = Math.sin(z);
  const rotate = (v: RoundedCubeVector) => {
    const yy = v.y * cx - v.z * sx,
      zz = v.y * sx + v.z * cx,
      xx = v.x * cy + zz * sy,
      depth = -v.x * sy + zz * cy;
    return vector(xx * cz - yy * sz, xx * sz + yy * cz, depth);
  };
  const rotated = mesh.vertices.map((v) => {
    const normal = rotate(v.normal);
    return {
      position: rotate(v.position),
      normal,
      lighting: roundedFragmentCubeLighting(normal, options),
    };
  });
  const patches: RoundedCubeProjectedPatch[] = [];
  for (const face of mesh.patches) {
    const points = face.indices.map((i) => rotated[i]!),
      normal = unit(average(points.map((p) => p.normal)));
    // Curved-patch normals are averaged for lighting only. The actual polygon
    // normal decides visibility, so a tiny edge-on patch cannot leak backwards.
    const geometric = cross(
      sub(points[1]!.position, points[0]!.position),
      sub(points[2]!.position, points[0]!.position),
    );
    if (geometric.z <= 1e-10) continue;
    patches.push({
      kind: face.kind,
      ...(face.faceId ? { faceId: face.faceId } : {}),
      normal,
      points: points.map((p) =>
        vector(p.position.x * size, p.position.y * size, p.position.z * size),
      ),
      depth: average(points.map((p) => p.position)).z * size,
      lighting: roundedFragmentCubeLighting(normal, options),
      vertexLighting: points.map((p) => p.lighting),
      vertexNormals: points.map((p) => p.normal),
      ...(options.frontUvMapping === 'mother-plane' &&
      face.indices.some((i) => mesh.vertices[i]!.normal.z > 1e-10) &&
      face.indices.every((i) => mesh.vertices[i]!.normal.z >= -1e-10)
        ? {
            frontUvs: face.indices.map((i) => ({
              u: mesh.vertices[i]!.position.x + 0.5,
              v: mesh.vertices[i]!.position.y + 0.5,
            })),
          }
        : {}),
    });
  }
  patches.sort((a, b) => a.depth - b.depth);
  const primary = patches
    .filter((p) => p.kind === 'face')
    .sort((a, b) => b.normal.z - a.normal.z)[0]?.faceId;
  return {
    patches,
    silhouette: hull(
      rotated.map((v) => vector(v.position.x * size, v.position.y * size, v.position.z * size)),
    ),
    ...(primary ? { primaryFaceId: primary } : {}),
  };
}

function path(context: CanvasRenderingContext2D, points: readonly RoundedCubeVector[]) {
  context.beginPath();
  points.forEach((p, i) => (i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
  context.closePath();
}
function rgb(color: string): readonly number[] {
  const s = /^#[\da-f]{3}$/i.test(color)
    ? color
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('')
    : color.slice(1);
  const n = /^[\da-f]{6}$/i.test(s) ? parseInt(s, 16) : 0xedc08a;
  return [n >> 16, (n >> 8) & 255, n & 255];
}
function litRgb(
  base: readonly number[],
  light: readonly number[],
  value: RoundedCubeLighting,
  mixLimit: number,
) {
  const highlight = clamp(value.specular + Math.max(0, value.brightness - 1) * 0.35, 0, mixLimit);
  return base.map((v, i) =>
    Math.round(
      clamp(v * Math.min(1, value.brightness) * (1 - highlight) + light[i]! * highlight, 0, 255),
    ),
  );
}
function litColor(
  base: readonly number[],
  light: readonly number[],
  value: RoundedCubeLighting,
  mixLimit: number,
) {
  return `rgb(${litRgb(base, light, value, mixLimit).join(',')})`;
}

/** Orthographic triangle UV transform; undefined for edge-on/degenerate input. */
export function roundedCubeFrontUvTransform(
  points: readonly RoundedCubeVector[],
  uvs: readonly { readonly u: number; readonly v: number }[],
  size: number,
): readonly [number, number, number, number, number, number] | undefined {
  if (points.length !== 3 || uvs.length !== 3 || !Number.isFinite(size) || size <= 0)
    return undefined;
  const [p, q, r] = points as readonly [RoundedCubeVector, RoundedCubeVector, RoundedCubeVector];
  const [u, v, w] = uvs as readonly [
    { u: number; v: number },
    { u: number; v: number },
    { u: number; v: number },
  ];
  const ax = (v.u - u.u) * size,
    ay = (v.v - u.v) * size,
    bx = (w.u - u.u) * size,
    by = (w.v - u.v) * size;
  const determinant = ax * by - ay * bx,
    screenArea = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (Math.abs(determinant) < 1e-10 || Math.abs(screenArea) < 1e-10) return undefined;
  const a = ((q.x - p.x) * by - (r.x - p.x) * ay) / determinant;
  const b = ((q.y - p.y) * by - (r.y - p.y) * ay) / determinant;
  const c = ((r.x - p.x) * ax - (q.x - p.x) * bx) / determinant;
  const d = ((r.y - p.y) * ax - (q.y - p.y) * bx) / determinant;
  const result = [
    a,
    b,
    c,
    d,
    p.x - a * u.u * size - c * u.v * size,
    p.y - b * u.u * size - d * u.v * size,
  ] as const;
  return result.every(Number.isFinite) ? result : undefined;
}

function paintMotherPlane(
  context: CanvasRenderingContext2D,
  patch: RoundedCubeProjectedPatch,
  options: RoundedFragmentCubeOptions,
  mixLimit: number,
): void {
  if (!patch.frontUvs || !options.frontTexture) return;
  for (let i = 1; i < patch.points.length - 1; i++) {
    const indices = [0, i, i + 1],
      points = indices.map((j) => patch.points[j]!),
      uvs = indices.map((j) => patch.frontUvs![j]!);
    const transform = roundedCubeFrontUvTransform(points, uvs, options.size);
    if (!transform) continue;
    context.save();
    try {
      path(context, points);
      context.clip();
      context.transform(...transform);
      context.drawImage(options.frontTexture, 0, 0, options.size, options.size);
    } finally {
      context.restore();
    }
  }
  // The texture is unlit. Apply the same geometric response after projection,
  // including the normal variation across the curved front cap, once per patch.
  const overlay = (alpha: readonly number[], color: readonly number[]) => {
    const low = alpha.indexOf(Math.min(...alpha)),
      high = alpha.indexOf(Math.max(...alpha));
    if (alpha[high]! <= 0) return;
    const rgba = (a: number) => `rgba(${color.join(',')},${a})`,
      start = patch.points[low]!,
      end = patch.points[high]!;
    context.save();
    try {
      path(context, patch.points);
      context.clip();
      if (high !== low && Math.hypot(end.x - start.x, end.y - start.y) > 1e-6) {
        const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
        gradient.addColorStop(0, rgba(alpha[low]!));
        gradient.addColorStop(1, rgba(alpha[high]!));
        context.fillStyle = gradient;
      } else context.fillStyle = rgba(alpha[high]!);
      context.fill();
    } finally {
      context.restore();
    }
  };
  overlay(
    patch.vertexLighting.map((v) => clamp(1 - v.brightness, 0, 1)),
    [0, 0, 0],
  );
  overlay(
    patch.vertexLighting.map((v) =>
      clamp(v.specular + Math.max(0, v.brightness - 1) * 0.35, 0, mixLimit),
    ),
    rgb(options.lightColor ?? '#fff8e8'),
  );
}
/** Draw centered on the current Canvas origin; preserves all caller state. */
export function drawRoundedFragmentCube(
  context: CanvasRenderingContext2D,
  options: RoundedFragmentCubeOptions,
): void {
  const projection = projectRoundedFragmentCube(options);
  if (!projection.patches.length) return;
  const base = rgb(options.color),
    light = rgb(options.lightColor ?? '#fff8e8'),
    shadow = clamp(finite(options.shadow, 0), 0, 1);
  const faceColors = options.faceColors;
  // Recover the mesh's object-space normal from its camera-space normal. This
  // keeps a cut-face material attached to the face through arbitrary Euler
  // rotations; choosing albedo from the screen-facing normal would flicker.
  const rx = finite(options.rotationX, 0),
    ry = finite(options.rotationY, 0),
    rz = finite(options.rotationZ, 0);
  const cx = Math.cos(rx),
    sx = Math.sin(rx),
    cy = Math.cos(ry),
    sy = Math.sin(ry),
    cz = Math.cos(rz),
    sz = Math.sin(rz);
  const materials =
    faceColors &&
    (Object.fromEntries(
      Object.entries(faceColors)
        .filter(([, color]) => typeof color === 'string')
        .map(([id, color]) => [id, rgb(color!)]),
    ) as Partial<Record<RoundedCubeFaceId, readonly number[]>> | undefined);
  const albedo = (normal: RoundedCubeVector): readonly number[] => {
    if (!materials) return base;
    const x = normal.x * cz + normal.y * sz,
      y = -normal.x * sz + normal.y * cz;
    const xx = x * cy - normal.z * sy,
      z = x * sy + normal.z * cy;
    const yy = y * cx + z * sx,
      zz = -y * sx + z * cx;
    const weights: readonly (readonly [RoundedCubeFaceId, number])[] = [
      [xx < 0 ? 'left' : 'right', xx * xx],
      [yy < 0 ? 'top' : 'bottom', yy * yy],
      [zz < 0 ? 'back' : 'front', zz * zz],
    ];
    const sum = weights.reduce((n, [, weight]) => n + weight, 0);
    return [0, 1, 2].map(
      (channel) =>
        weights.reduce((n, [id, weight]) => n + (materials[id] ?? base)[channel]! * weight, 0) /
        sum,
    );
  };
  // Only opting into a stronger lobe relaxes the legacy .4 light-color mix cap.
  // Off-lobe normals retain their albedo; no independent edge overlay is added.
  const mixLimit =
    options.specularStrength === undefined
      ? 0.4
      : clamp(finite(options.specularStrength, 0.32), 0.4, 0.95);
  context.save();
  try {
    if (shadow > 0) {
      if (options.castShadow === undefined) {
        context.save();
        context.translate(options.size * 0.09, options.size * 0.14);
        context.globalAlpha *= shadow * 0.2;
        context.shadowColor = 'rgba(72,43,18,.2)';
        context.shadowBlur = options.size * 0.12;
        path(context, projection.silhouette);
        context.fillStyle = '#795735';
        context.fill();
        context.restore();
      } else {
        const cast = options.castShadow,
          opacity = clamp(finite(cast.opacity, 0.2), 0, 1);
        if (opacity > 0) {
          context.save();
          try {
            context.translate(
              options.size * clamp(finite(cast.offsetX, 0.09), -2, 2),
              options.size * clamp(finite(cast.offsetY, 0.14), -2, 2),
            );
            context.globalAlpha *= shadow * opacity;
            // The opaque color is shared by the silhouette and its blur. Alpha
            // is applied only by globalAlpha, never squared in shadowColor.
            context.shadowColor = cast.color ?? '#795735';
            context.shadowBlur = options.size * clamp(finite(cast.blur, 0.12), 0, 2);
            context.shadowOffsetX = 0;
            context.shadowOffsetY = 0;
            path(context, projection.silhouette);
            context.fillStyle = cast.color ?? '#795735';
            context.fill();
          } finally {
            context.restore();
          }
        }
      }
    }
    // A single albedo underlay prevents dark cracks from Canvas polygon AA. No
    // per-face strokes or repeated shadows can turn a dense stream into black.
    path(context, projection.silhouette);
    context.fillStyle = options.color;
    context.fill();
    for (const patch of projection.patches) {
      path(context, patch.points);
      const shades = patch.vertexLighting.map((v) => v.brightness + v.specular);
      let low = shades.indexOf(Math.min(...shades)),
        high = shades.indexOf(Math.max(...shades));
      // Rounded transitions interpolate neighboring face materials as well as
      // lighting. With no overrides the old drawing commands remain identical.
      const vertexAlbedo = materials ? patch.vertexNormals.map(albedo) : undefined;
      if (vertexAlbedo) {
        const colors = vertexAlbedo.map((color, i) =>
          litRgb(color, light, patch.vertexLighting[i]!, mixLimit),
        );
        let widest = -1;
        for (let i = 0; i < vertexAlbedo.length; i++)
          for (let j = i + 1; j < vertexAlbedo.length; j++) {
            const distance = colors[i]!.reduce(
              (sum, value, channel) => sum + (value - colors[j]![channel]!) ** 2,
              0,
            );
            if (distance > widest) {
              widest = distance;
              low = i;
              high = j;
            }
          }
        if (widest === 0) high = low;
      }
      const start = patch.points[low]!,
        end = patch.points[high]!;
      if (high !== low && Math.hypot(end.x - start.x, end.y - start.y) > 1e-6) {
        const gradient = context.createLinearGradient(start.x, start.y, end.x, end.y);
        gradient.addColorStop(
          0,
          litColor(vertexAlbedo?.[low] ?? base, light, patch.vertexLighting[low]!, mixLimit),
        );
        gradient.addColorStop(
          1,
          litColor(vertexAlbedo?.[high] ?? base, light, patch.vertexLighting[high]!, mixLimit),
        );
        context.fillStyle = gradient;
      } else context.fillStyle = litColor(albedo(patch.normal), light, patch.lighting, mixLimit);
      context.fill();
      if (options.frontUvMapping === 'mother-plane') {
        paintMotherPlane(context, patch, options, mixLimit);
        continue;
      }
      const primary = patch.faceId === projection.primaryFaceId,
        selection = options.textureFaces ?? 'primary';
      if (
        !options.facePainter ||
        !patch.faceId ||
        !(
          selection === 'all' ||
          (selection === 'primary' && primary) ||
          (Array.isArray(selection) && selection.includes(patch.faceId))
        )
      )
        continue;
      const origin = patch.points[0]!,
        u = sub(patch.points[1]!, origin),
        v = sub(patch.points[3]!, origin),
        size = options.size;
      context.save();
      try {
        path(context, patch.points);
        context.clip();
        context.transform(u.x / size, u.y / size, v.x / size, v.y / size, origin.x, origin.y);
        options.facePainter(context, {
          faceId: patch.faceId,
          primary,
          size,
          color: faceColors?.[patch.faceId] ?? options.color,
          normal: patch.normal,
          lighting: patch.lighting,
        });
        if (patch.lighting.brightness < 1) {
          context.fillStyle = `rgba(0,0,0,${1 - patch.lighting.brightness})`;
          context.fillRect(0, 0, size, size);
        }
        const opacity = clamp(
          patch.lighting.specular + Math.max(0, patch.lighting.brightness - 1) * 0.35,
          0,
          mixLimit,
        );
        if (opacity > 0) {
          context.globalAlpha *= opacity;
          context.fillStyle = options.lightColor ?? '#fff8e8';
          context.fillRect(0, 0, size, size);
        }
      } finally {
        context.restore();
      }
    }
  } finally {
    context.restore();
  }
}
