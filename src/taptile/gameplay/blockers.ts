import { centeredPixelRect, pixelRectIntersectionArea } from '../pixelGeometry';
import type { GameplayTile, TapTileGameplayState } from './types';

function tileRect(tile: GameplayTile) {
  return centeredPixelRect(
    { x: tile.centerXPx, y: tile.centerYPx },
    tile.widthPx,
    tile.heightPx,
  );
}

export function blockerIdsForTile(state: TapTileGameplayState, tileId: string): string[] {
  const tile = state.tiles[tileId];
  if (!tile || !state.boardIds.includes(tileId)) return [];
  const active = new Set(state.boardIds);
  const rect = tileRect(tile);
  return Object.values(state.tiles)
    .filter((candidate) => active.has(candidate.id) && candidate.layer > tile.layer)
    .filter((candidate) => pixelRectIntersectionArea(rect, tileRect(candidate)) >= state.rules.minimumOcclusionAreaPx)
    .sort((left, right) => right.layer - left.layer || right.order - left.order)
    .map((candidate) => candidate.id);
}

export function playableTileIds(state: TapTileGameplayState): string[] {
  return state.boardIds.filter((tileId) => {
    const tile = state.tiles[tileId];
    return Boolean(tile && !tile.locked && blockerIdsForTile(state, tileId).length === 0);
  });
}

export function buildBlockerGraph(state: TapTileGameplayState): Record<string, string[]> {
  return Object.fromEntries(state.boardIds.map((tileId) => [tileId, blockerIdsForTile(state, tileId)]));
}

