import type { TileGameplayGeometry } from '../../project';

export interface PolygonPoint {
  x: number;
  y: number;
}

export function rotatedRectVertices(geometry: TileGameplayGeometry): PolygonPoint[] {
  const halfWidth = geometry.widthPx / 2;
  const halfHeight = geometry.heightPx / 2;
  const radians = (geometry.rotationDeg * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ].map((point) => ({
    x: geometry.centerXPx + point.x * cosine - point.y * sine,
    y: geometry.centerYPx + point.x * sine + point.y * cosine,
  }));
}

export function polygonSignedArea(vertices: readonly PolygonPoint[]): number {
  let doubled = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    if (!current || !next) continue;
    doubled += current.x * next.y - next.x * current.y;
  }
  return doubled / 2;
}

export function polygonArea(vertices: readonly PolygonPoint[]): number {
  return Math.abs(polygonSignedArea(vertices));
}
