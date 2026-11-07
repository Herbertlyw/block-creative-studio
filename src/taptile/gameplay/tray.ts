import type { CompiledTapTileLevel } from '../project';

export function insertIntoGroupedTray(
  trayIds: readonly string[],
  tileId: string,
  level: CompiledTapTileLevel,
): { trayIds: string[]; insertedIndex: number } {
  const matchKey = level.tiles[tileId]?.matchKey;
  let insertedIndex = trayIds.length;
  if (matchKey) {
    for (let index = trayIds.length - 1; index >= 0; index -= 1) {
      const existingId = trayIds[index];
      if (existingId && level.tiles[existingId]?.matchKey === matchKey) {
        insertedIndex = index + 1;
        break;
      }
    }
  }
  const next = [...trayIds];
  next.splice(insertedIndex, 0, tileId);
  return { trayIds: next, insertedIndex };
}

export function resolveGroupedTrayMatch(
  trayIds: readonly string[],
  tileId: string,
  level: CompiledTapTileLevel,
): { trayIds: string[]; matchedTileIds: string[] } {
  const matchKey = level.tiles[tileId]?.matchKey;
  if (!matchKey) return { trayIds: [...trayIds], matchedTileIds: [] };
  const matching = trayIds.filter((candidateId) => level.tiles[candidateId]?.matchKey === matchKey);
  if (matching.length < 3) return { trayIds: [...trayIds], matchedTileIds: [] };
  const matchedTileIds = matching.slice(0, 3);
  const matched = new Set(matchedTileIds);
  return {
    trayIds: trayIds.filter((candidateId) => !matched.has(candidateId)),
    matchedTileIds,
  };
}
