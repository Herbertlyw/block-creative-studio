export const TAPTILE_AUTHORING_STAGE = {
  width: 432,
  height: 768,
} as const;

export const TAPTILE_EXPORT_STAGE = {
  width: 1080,
  height: 1920,
} as const;

export interface PixelPoint {
  x: number;
  y: number;
}

export interface PixelRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface PixelLattice {
  originX: number;
  originY: number;
  pitchX: number;
  pitchY: number;
  subdivisions?: number;
}

const EXPORT_SCALE_X = TAPTILE_EXPORT_STAGE.width / TAPTILE_AUTHORING_STAGE.width;
const EXPORT_SCALE_Y = TAPTILE_EXPORT_STAGE.height / TAPTILE_AUTHORING_STAGE.height;

if (EXPORT_SCALE_X !== EXPORT_SCALE_Y) {
  throw new Error('TapTile authoring and export stages must use the same aspect ratio.');
}

export const TAPTILE_EXPORT_SCALE = EXPORT_SCALE_X;

export function snapAuthoringCoordinateToExportPixel(value: number): number {
  return Math.round(value * TAPTILE_EXPORT_SCALE) / TAPTILE_EXPORT_SCALE;
}

export function snapAuthoringPointToExportPixels(point: PixelPoint): PixelPoint {
  return {
    x: snapAuthoringCoordinateToExportPixel(point.x),
    y: snapAuthoringCoordinateToExportPixel(point.y),
  };
}

export function authoringToExportPoint(point: PixelPoint): PixelPoint {
  return {
    x: Math.round(point.x * TAPTILE_EXPORT_SCALE),
    y: Math.round(point.y * TAPTILE_EXPORT_SCALE),
  };
}

export function exportToAuthoringPoint(point: PixelPoint): PixelPoint {
  return snapAuthoringPointToExportPixels({
    x: point.x / TAPTILE_EXPORT_SCALE,
    y: point.y / TAPTILE_EXPORT_SCALE,
  });
}

export function centeredPixelRect(center: PixelPoint, width: number, height: number): PixelRect {
  const left = center.x - width / 2;
  const top = center.y - height / 2;
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

export function pixelRectIntersectionArea(left: PixelRect, right: PixelRect): number {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

export function latticePoint(columnUnits: number, rowUnits: number, lattice: PixelLattice): PixelPoint {
  const subdivisions = Math.max(1, Math.round(lattice.subdivisions ?? 1));
  return {
    x: Math.round(lattice.originX + (columnUnits * lattice.pitchX) / subdivisions),
    y: Math.round(lattice.originY + (rowUnits * lattice.pitchY) / subdivisions),
  };
}

export function isIntegerPixelPoint(point: PixelPoint): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y);
}

