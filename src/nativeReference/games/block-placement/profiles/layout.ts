import { BLOCK_PLACEMENT_GAME_ID } from '../manifest';
import { BLOCK_PLACEMENT_COMPOSITION_PROFILE_ID, blockPlacementCompositionProfile } from './composition';

export const BLOCK_PLACEMENT_LAYOUT_PROFILE_ID = 'block-placement.layout.v1';

const playfield = blockPlacementCompositionProfile.playfield;

export const blockPlacementLayoutProfile = {
  id: BLOCK_PLACEMENT_LAYOUT_PROFILE_ID,
  version: '1.0.0',
  gameId: BLOCK_PLACEMENT_GAME_ID,
  compositionProfileId: BLOCK_PLACEMENT_COMPOSITION_PROFILE_ID,
  canvas: blockPlacementCompositionProfile.designResolution,
  hud: {
    best: { x: 72, y: 48, width: 320, height: 86 },
    scoreCenter: { x: 532, y: 213 },
    controls: { x: 778, y: 48, width: 210, height: 88 },
    blastCrown: { x: 47, y: 56 },
    blastGear: { x: 911, y: 55 },
  },
  board: {
    outer: { x: playfield.x, y: playfield.y, size: playfield.width, radius: 18 },
    grid: { x: 91, y: 321, cell: 110, gap: 2, pitch: 112 },
  },
  rack: {
    centersX: [238, 532, 826],
    centerY: 1470,
    cell: 50,
    pickupLift: 145,
  },
} as const;

export function boardPieceCenterPx(
  anchor: { row: number; col: number },
  bounds: { rows: number; cols: number },
): { x: number; y: number } {
  const grid = blockPlacementLayoutProfile.board.grid;
  return {
    x: grid.x + (anchor.col + bounds.cols / 2) * grid.pitch - grid.gap / 2,
    y: grid.y + (anchor.row + bounds.rows / 2) * grid.pitch - grid.gap / 2,
  };
}

export function boardPieceCenterNormalized(
  anchor: { row: number; col: number },
  bounds: { rows: number; cols: number },
): { x: number; y: number } {
  const canvas = blockPlacementLayoutProfile.canvas;
  const px = boardPieceCenterPx(anchor, bounds);
  return {
    x: px.x / canvas.width,
    y: px.y / canvas.height,
  };
}

export function boardAnchorFromCenterPx(
  center: { x: number; y: number },
  bounds: { rows: number; cols: number },
): { row: number; col: number } | null {
  const grid = blockPlacementLayoutProfile.board.grid;
  const col = Math.round((center.x - (bounds.cols * grid.pitch) / 2 - grid.x) / grid.pitch);
  const row = Math.round((center.y - (bounds.rows * grid.pitch) / 2 - grid.y) / grid.pitch);
  if (row < 0 || col < 0 || row + bounds.rows > 8 || col + bounds.cols > 8) return null;
  return { row, col };
}

export function boardAnchorFromNormalizedPointer(
  pointer: { x: number; y: number },
  bounds: { rows: number; cols: number },
): { row: number; col: number } | null {
  const canvas = blockPlacementLayoutProfile.canvas;
  return boardAnchorFromCenterPx(
    { x: pointer.x * canvas.width, y: pointer.y * canvas.height },
    bounds,
  );
}
