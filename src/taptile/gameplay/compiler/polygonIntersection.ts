import { polygonArea, polygonSignedArea, type PolygonPoint } from './rotatedRect';

function cross(origin: PolygonPoint, edge: PolygonPoint, point: PolygonPoint): number {
  return (edge.x - origin.x) * (point.y - origin.y) - (edge.y - origin.y) * (point.x - origin.x);
}

function intersectSegmentWithLine(
  start: PolygonPoint,
  end: PolygonPoint,
  lineStart: PolygonPoint,
  lineEnd: PolygonPoint,
): PolygonPoint {
  const startDistance = cross(lineStart, lineEnd, start);
  const endDistance = cross(lineStart, lineEnd, end);
  const denominator = startDistance - endDistance;
  const t = Math.abs(denominator) < Number.EPSILON ? 0 : startDistance / denominator;
  return {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
}

export function intersectConvexPolygons(
  subject: readonly PolygonPoint[],
  clip: readonly PolygonPoint[],
  epsilon = 0.001,
): PolygonPoint[] {
  if (subject.length < 3 || clip.length < 3) return [];
  const orientedClip = polygonSignedArea(clip) < 0 ? [...clip].reverse() : [...clip];
  let output = [...subject];
  for (let edgeIndex = 0; edgeIndex < orientedClip.length; edgeIndex += 1) {
    const lineStart = orientedClip[edgeIndex];
    const lineEnd = orientedClip[(edgeIndex + 1) % orientedClip.length];
    if (!lineStart || !lineEnd || output.length === 0) return [];
    const input = output;
    output = [];
    let start = input.at(-1);
    if (!start) continue;
    let startInside = cross(lineStart, lineEnd, start) >= -epsilon;
    for (const end of input) {
      const endInside = cross(lineStart, lineEnd, end) >= -epsilon;
      if (endInside) {
        if (!startInside) output.push(intersectSegmentWithLine(start, end, lineStart, lineEnd));
        output.push(end);
      } else if (startInside) {
        output.push(intersectSegmentWithLine(start, end, lineStart, lineEnd));
      }
      start = end;
      startInside = endInside;
    }
  }
  return output;
}

export function convexPolygonIntersectionArea(
  left: readonly PolygonPoint[],
  right: readonly PolygonPoint[],
  epsilon = 0.001,
): number {
  const area = polygonArea(intersectConvexPolygons(left, right, epsilon));
  return area <= epsilon ? 0 : area;
}
