import type { GameplayTile } from './types';

export function insertIntoGroupedTray(
  trayIds: readonly string[],
  tileId: string,
  tiles: Readonly<Record<string, GameplayTile>>,
): { trayIds: string[]; insertedIndex: number } {
  const faceId = tiles[tileId]?.faceId;
  if (!faceId) return { trayIds: [...trayIds, tileId], insertedIndex: trayIds.length };
  let insertedIndex = trayIds.length;
  for (let index = trayIds.length - 1; index >= 0; index -= 1) {
    const existing = tiles[trayIds[index] ?? ''];
    if (existing?.faceId === faceId) {
      insertedIndex = index + 1;
      break;
    }
  }
  const next = [...trayIds];
  next.splice(insertedIndex, 0, tileId);
  return { trayIds: next, insertedIndex };
}

export function resolveTrayMatch(
  trayIds: readonly string[],
  faceId: string,
  matchSize: number,
  tiles: Readonly<Record<string, GameplayTile>>,
): { trayIds: string[]; clearedIds: string[] } {
  const matching = trayIds.filter((tileId) => tiles[tileId]?.faceId === faceId);
  if (matching.length < matchSize) return { trayIds: [...trayIds], clearedIds: [] };
  const clearedIds = matching.slice(0, matchSize);
  const cleared = new Set(clearedIds);
  return {
    trayIds: trayIds.filter((tileId) => !cleared.has(tileId)),
    clearedIds,
  };
}

