/** Bounded parametric adapter of the existing native rounded cube. These are
 * the real native patches/normals, not replacement box geometry or source pixels. */
import {
  createRoundedFragmentCubeGeometry,
  type RoundedCubeFaceId,
  type RoundedCubeVector,
} from './roundedFragmentCube';

export interface RoundedCubeDepthVertex {
  readonly coreSigns: RoundedCubeVector;
  readonly normal: RoundedCubeVector;
}
export interface RoundedCubeDepthTriangle {
  /** Native winding; the y-down GPU adapter reverses it once. */
  readonly indices: readonly [number, number, number];
  readonly frontUvEligible: boolean;
  readonly faceId?: RoundedCubeFaceId;
}
export interface RoundedCubeDepthPrototype {
  readonly zeroRadius: boolean;
  readonly vertices: readonly RoundedCubeDepthVertex[];
  readonly triangles: readonly RoundedCubeDepthTriangle[];
}
const prototypes: Array<RoundedCubeDepthPrototype | undefined> = new Array(2);
export function quantizeRoundedCubeDepthRadius(radius: number): number {
  if (!Number.isFinite(radius) || radius < 0 || radius > 0.22)
    throw new Error('OBSERVED_FRAGMENT_DEPTH_ROUNDED_RADIUS');
  return Math.round(radius * 10000) / 10000;
}
/** Exactly two immutable prototypes; no cache indexed by radius/frame/angle. */
export function createRoundedCubeDepthPrototype(zeroRadius: boolean): RoundedCubeDepthPrototype {
  const index = zeroRadius ? 0 : 1,
    known = prototypes[index];
  if (known) return known;
  const canonicalRadius = zeroRadius ? 0 : 0.1,
    native = createRoundedFragmentCubeGeometry({ cornerRadius: canonicalRadius, bevelSegments: 2 });
  const vertices = native.vertices.map((v) => {
    const core = (position: number, normal: number) => {
      const value = (position - canonicalRadius * normal) / (0.5 - canonicalRadius),
        sign = Math.round(value);
      if (Math.abs(value - sign) > 1e-12 || Math.abs(sign) !== 1)
        throw new Error('OBSERVED_FRAGMENT_DEPTH_ROUNDED_NATIVE_TOPOLOGY');
      return sign;
    };
    return Object.freeze({
      coreSigns: Object.freeze({
        x: core(v.position.x, v.normal.x),
        y: core(v.position.y, v.normal.y),
        z: core(v.position.z, v.normal.z),
      }),
      normal: v.normal,
    });
  });
  const triangles: RoundedCubeDepthTriangle[] = [];
  for (const patch of native.patches) {
    const frontUvEligible =
      patch.indices.some((i) => native.vertices[i]!.normal.z > 1e-10) &&
      patch.indices.every((i) => native.vertices[i]!.normal.z >= -1e-10);
    for (let i = 1; i < patch.indices.length - 1; i++)
      triangles.push(
        Object.freeze({
          indices: Object.freeze([
            patch.indices[0]!,
            patch.indices[i]!,
            patch.indices[i + 1]!,
          ]) as readonly [number, number, number],
          frontUvEligible,
          ...(patch.faceId ? { faceId: patch.faceId } : {}),
        }),
      );
  }
  const prototype = Object.freeze({
    zeroRadius,
    vertices: Object.freeze(vertices),
    triangles: Object.freeze(triangles),
  });
  prototypes[index] = prototype;
  return prototype;
}
/** Native parameter formula applies to all axes, including full unit Z depth. */
export function roundedCubeDepthPosition(
  vertex: RoundedCubeDepthVertex,
  radius: number,
): RoundedCubeVector {
  const r = quantizeRoundedCubeDepthRadius(radius),
    a = 0.5 - r;
  return {
    x: a * vertex.coreSigns.x + r * vertex.normal.x,
    y: a * vertex.coreSigns.y + r * vertex.normal.y,
    z: a * vertex.coreSigns.z + r * vertex.normal.z,
  };
}
/** One quarter donor is already cropped by the tile painter; these local UVs
 * must not be cropped a second time by ix/iy or by mother subdivisions. */
export function roundedCubeDepthFrontUv(
  vertex: RoundedCubeDepthVertex,
  radius: number,
): readonly [number, number] {
  const p = roundedCubeDepthPosition(vertex, radius);
  return [p.x + 0.5, p.y + 0.5];
}
/** Object-space face-color identity stays attached while Euler rotates lighting. */
export function roundedCubeDepthFaceWeights(
  normal: RoundedCubeVector,
): Readonly<Partial<Record<RoundedCubeFaceId, number>>> {
  const sum = normal.x ** 2 + normal.y ** 2 + normal.z ** 2;
  if (!(sum > 1e-12)) throw new Error('OBSERVED_FRAGMENT_DEPTH_ROUNDED_NORMAL');
  return {
    [normal.x < 0 ? 'left' : 'right']: normal.x ** 2 / sum,
    [normal.y < 0 ? 'top' : 'bottom']: normal.y ** 2 / sum,
    [normal.z < 0 ? 'back' : 'front']: normal.z ** 2 / sum,
  };
}
/** Convex projected silhouette of actual morphed vertices. The caller supplies
 * its existing world pose and pinhole; no orthographic proxy is substituted. */
export function roundedCubeDepthProjectedHull(
  radius: number,
  project: (local: RoundedCubeVector) => { x: number; y: number },
): readonly { x: number; y: number }[] {
  const r = quantizeRoundedCubeDepthRadius(radius),
    prototype = createRoundedCubeDepthPrototype(r === 0);
  const points = prototype.vertices.map((vertex) => project(roundedCubeDepthPosition(vertex, r)));
  if (points.some((p) => !Number.isFinite(p.x + p.y)))
    throw new Error('OBSERVED_FRAGMENT_DEPTH_ROUNDED_HULL');
  const sorted = points.sort((a, b) => a.x - b.x || a.y - b.y),
    cross = (
      a: { x: number; y: number },
      b: { x: number; y: number },
      c: { x: number; y: number },
    ) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (input: typeof points) => {
    const out: typeof points = [];
    for (const p of input) {
      while (out.length >= 2 && cross(out.at(-2)!, out.at(-1)!, p) <= 1e-10) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(sorted), ...half([...sorted].reverse())];
}
