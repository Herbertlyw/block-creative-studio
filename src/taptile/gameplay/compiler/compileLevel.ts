import {
  TAPTILE_RULE_PROFILE_ID,
  stableHash,
  type CompiledBlockerEdge,
  type CompiledTapTileLevel,
  type TapTileProjectV2,
} from '../../project';
import { convexPolygonIntersectionArea } from './polygonIntersection';
import { rotatedRectVertices } from './rotatedRect';
import { validateTapTileLevel } from './validateLevel';

function edgeKey(blockerId: string, blockedId: string): string {
  return `${blockerId}\u0000${blockedId}`;
}

function sortIds(ids: string[], project: TapTileProjectV2, descendingLayer = false): string[] {
  const byId = Object.fromEntries(project.level.tileInstances.map((tile) => [tile.id, tile]));
  return ids.sort((leftId, rightId) => {
    const left = byId[leftId];
    const right = byId[rightId];
    if (!left || !right) return leftId.localeCompare(rightId);
    const layerDelta = left.geometry.layer - right.geometry.layer;
    if (layerDelta !== 0) return descendingLayer ? -layerDelta : layerDelta;
    return left.geometry.order - right.geometry.order || left.id.localeCompare(right.id);
  });
}

function freezeCompiled(level: CompiledTapTileLevel): CompiledTapTileLevel {
  for (const tile of Object.values(level.tiles)) {
    Object.freeze(tile.geometry);
    Object.freeze(tile);
  }
  for (const value of Object.values(level.blockersByTile)) Object.freeze(value);
  for (const value of Object.values(level.dependentsByTile)) Object.freeze(value);
  Object.freeze(level.tiles);
  Object.freeze(level.initialBoardIds);
  Object.freeze(level.blockersByTile);
  Object.freeze(level.dependentsByTile);
  Object.freeze(level.initialBlockerCount);
  Object.freeze(level.initialPlayableIds);
  Object.freeze(level.blockerEdges);
  Object.freeze(level.validation.issues);
  Object.freeze(level.validation.statistics);
  Object.freeze(level.validation);
  return Object.freeze(level);
}

export function compileTapTileLevel(project: TapTileProjectV2): CompiledTapTileLevel {
  const instances = [...project.level.tileInstances];
  const uniqueInstances = instances.filter((tile, index) => instances.findIndex((candidate) => candidate.id === tile.id) === index);
  const ignored = new Set(project.level.blockerOverrides.ignored.map((edge) => edgeKey(edge.blockerId, edge.blockedId)));
  const edges = new Map<string, CompiledBlockerEdge>();
  for (const blocked of uniqueInstances) {
    const blockedPolygon = rotatedRectVertices(blocked.geometry);
    const blockedArea = blocked.geometry.widthPx * blocked.geometry.heightPx;
    const threshold = Math.max(
      project.level.blockerPolicy.minimumOverlapAreaPx,
      blockedArea * project.level.blockerPolicy.minimumOverlapRatio,
    );
    for (const blocker of uniqueInstances) {
      if (blocker.geometry.layer <= blocked.geometry.layer) continue;
      const key = edgeKey(blocker.id, blocked.id);
      if (ignored.has(key)) continue;
      const overlapAreaPx = convexPolygonIntersectionArea(
        blockedPolygon,
        rotatedRectVertices(blocker.geometry),
        project.level.blockerPolicy.epsilonPx,
      );
      if (overlapAreaPx + project.level.blockerPolicy.epsilonPx < threshold) continue;
      edges.set(key, {
        blockerId: blocker.id,
        blockedId: blocked.id,
        source: 'automatic',
        overlapAreaPx,
        overlapRatio: blockedArea > 0 ? overlapAreaPx / blockedArea : 0,
      });
    }
  }

  const byId = Object.fromEntries(uniqueInstances.map((tile) => [tile.id, tile]));
  for (const forced of project.level.blockerOverrides.forced) {
    const blocker = byId[forced.blockerId];
    const blocked = byId[forced.blockedId];
    if (!blocker || !blocked || blocker.id === blocked.id || blocker.geometry.layer <= blocked.geometry.layer) continue;
    const overlapAreaPx = convexPolygonIntersectionArea(
      rotatedRectVertices(blocker.geometry),
      rotatedRectVertices(blocked.geometry),
      project.level.blockerPolicy.epsilonPx,
    );
    edges.set(edgeKey(blocker.id, blocked.id), {
      blockerId: blocker.id,
      blockedId: blocked.id,
      source: 'forced',
      overlapAreaPx,
      overlapRatio: overlapAreaPx / Math.max(1, blocked.geometry.widthPx * blocked.geometry.heightPx),
    });
  }

  const blockerEdges = [...edges.values()].sort((left, right) => left.blockedId.localeCompare(right.blockedId) || left.blockerId.localeCompare(right.blockerId));
  const blockersByTile = Object.fromEntries(uniqueInstances.map((tile) => [tile.id, [] as string[]]));
  const dependentsByTile = Object.fromEntries(uniqueInstances.map((tile) => [tile.id, [] as string[]]));
  for (const edge of blockerEdges) {
    blockersByTile[edge.blockedId]?.push(edge.blockerId);
    dependentsByTile[edge.blockerId]?.push(edge.blockedId);
  }
  for (const ids of Object.values(blockersByTile)) sortIds(ids, project, true);
  for (const ids of Object.values(dependentsByTile)) sortIds(ids, project);
  const initialBlockerCount = Object.fromEntries(Object.entries(blockersByTile).map(([id, ids]) => [id, ids.length]));
  const initialPlayableIds = sortIds(uniqueInstances.filter((tile) => initialBlockerCount[tile.id] === 0).map((tile) => tile.id), project, true);
  const validation = validateTapTileLevel(project, blockerEdges, initialPlayableIds);
  const tiles = Object.fromEntries(uniqueInstances.map((tile) => {
    const archetype = project.visuals.archetypes[tile.archetypeId];
    return [tile.id, {
      id: tile.id,
      archetypeId: tile.archetypeId,
      matchKey: archetype?.matchKey ?? '',
      geometry: { ...tile.geometry },
    }];
  }));
  const initialBoardIds = sortIds(uniqueInstances.map((tile) => tile.id), project);
  const levelHash = stableHash({
    ruleProfileId: TAPTILE_RULE_PROFILE_ID,
    tiles: initialBoardIds.map((id) => {
      const tile = tiles[id];
      return tile ? { id, archetypeId: tile.archetypeId, matchKey: tile.matchKey, geometry: tile.geometry } : { id };
    }),
    blockerPolicy: project.level.blockerPolicy,
    blockerOverrides: {
      forced: [...project.level.blockerOverrides.forced].sort((left, right) => edgeKey(left.blockerId, left.blockedId).localeCompare(edgeKey(right.blockerId, right.blockedId))),
      ignored: [...project.level.blockerOverrides.ignored].sort((left, right) => edgeKey(left.blockerId, left.blockedId).localeCompare(edgeKey(right.blockerId, right.blockedId))),
    },
  }, 'level');
  return freezeCompiled({
    levelHash,
    ruleProfileId: TAPTILE_RULE_PROFILE_ID,
    tiles,
    initialBoardIds,
    blockersByTile,
    dependentsByTile,
    initialBlockerCount,
    initialPlayableIds,
    blockerEdges,
    validation,
  });
}
