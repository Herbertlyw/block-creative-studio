import type { StackTile } from './stackModel';

export interface StackPoint {
  x: number;
  y: number;
}

export interface StackSelectionRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export function makeSelectionRect(start: StackPoint, end: StackPoint): StackSelectionRect {
  const left = Math.min(start.x, end.x);
  const top = Math.min(start.y, end.y);
  const right = Math.max(start.x, end.x);
  const bottom = Math.max(start.y, end.y);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function tileIdsInsideSelection(
  tiles: readonly StackTile[],
  rect: StackSelectionRect,
  layerFocus: number | 'all' = 'all',
): string[] {
  return tiles
    .filter((tile) => layerFocus === 'all' || tile.layer === layerFocus)
    .filter((tile) => tile.x >= rect.left && tile.x <= rect.right && tile.y >= rect.top && tile.y <= rect.bottom)
    .map((tile) => tile.id);
}
