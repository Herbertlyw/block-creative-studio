import { REFERENCE_CANVAS, REFERENCE_LAYOUT } from '../reference2d/referenceProfile';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/** Piece-center in the public 1064×1788 reference canvas, normalized to 0–1. */
export function boardPieceCenterNormalized(
  anchor: { row: number; col: number },
  bounds: { rows: number; cols: number },
): { x: number; y: number } {
  const grid = REFERENCE_LAYOUT.board.grid;
  return {
    x:
      (grid.x + (anchor.col + bounds.cols / 2) * grid.pitch - grid.gap / 2) /
      REFERENCE_CANVAS.width,
    y:
      (grid.y + (anchor.row + bounds.rows / 2) * grid.pitch - grid.gap / 2) /
      REFERENCE_CANVAS.height,
  };
}

/**
 * Pointer sample that lands the drawn tile on the cell.
 * The reference-2D renderer draws the tile `pickupLift` pixels above the pointer,
 * so the stored pointer is the finger, not the tile center.
 */
export function pointerLandingForPlacement(
  anchor: { row: number; col: number },
  bounds: { rows: number; cols: number },
): { x: number; y: number } {
  const center = boardPieceCenterNormalized(anchor, bounds);
  return {
    x: clamp01(center.x),
    y: clamp01(center.y + REFERENCE_LAYOUT.rack.pickupLift / REFERENCE_CANVAS.height),
  };
}

export function boardAnchorFromNormalizedPointer(
  pointer: { x: number; y: number },
  bounds: { rows: number; cols: number },
): { row: number; col: number } | null {
  const grid = REFERENCE_LAYOUT.board.grid;
  const centerX = pointer.x * REFERENCE_CANVAS.width;
  const centerY = pointer.y * REFERENCE_CANVAS.height - REFERENCE_LAYOUT.rack.pickupLift;
  const col = Math.round((centerX - (bounds.cols * grid.pitch) / 2 - grid.x) / grid.pitch);
  const row = Math.round((centerY - (bounds.rows * grid.pitch) / 2 - grid.y) / grid.pitch);
  if (row < 0 || col < 0 || row + bounds.rows > 8 || col + bounds.cols > 8) return null;
  return { row, col };
}
