export interface PerspectiveFrameFitOptions {
  verticalFovDegrees: number;
  aspect: number;
  contentWidth: number;
  contentHeight: number;
  widthFill?: number;
  heightFill?: number;
  minimumDistance?: number;
}

function requirePositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
  return value;
}

function clampFill(value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) return fallback;
  return Math.max(0.05, Math.min(1, resolved));
}

/**
 * Returns the camera-to-frame distance needed to keep a rectangular content
 * envelope inside a perspective camera's viewport.
 *
 * Three.js PerspectiveCamera.fov is vertical. Portrait canvases therefore need
 * extra distance to fit wide content such as the 8×8 board horizontally.
 */
export function perspectiveDistanceToFitFrame({
  verticalFovDegrees,
  aspect,
  contentWidth,
  contentHeight,
  widthFill = 1,
  heightFill = 1,
  minimumDistance = 0,
}: PerspectiveFrameFitOptions): number {
  const fov = Math.max(1, Math.min(179, requirePositiveFinite(verticalFovDegrees, 'verticalFovDegrees')));
  const safeAspect = requirePositiveFinite(aspect, 'aspect');
  const width = requirePositiveFinite(contentWidth, 'contentWidth');
  const height = requirePositiveFinite(contentHeight, 'contentHeight');
  const safeWidthFill = clampFill(widthFill, 1);
  const safeHeightFill = clampFill(heightFill, 1);
  const safeMinimumDistance = Number.isFinite(minimumDistance)
    ? Math.max(0, minimumDistance)
    : 0;

  const tangent = Math.tan((fov * Math.PI) / 360);
  const horizontalDistance = width / (2 * tangent * safeAspect * safeWidthFill);
  const verticalDistance = height / (2 * tangent * safeHeightFill);

  return Math.max(safeMinimumDistance, horizontalDistance, verticalDistance);
}
