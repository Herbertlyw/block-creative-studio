import type { CompiledTapTileLevel, TapTileTake, TapTileTakeAction } from '../../project';
import { tapTileStateHash } from '../stateHash';
import type { TapTileGameState } from '../types';

export function createTapTileTake(
  level: CompiledTapTileLevel,
  actions: readonly TapTileTakeAction[],
  finalState: TapTileGameState,
  options: { id: string; name: string; createdAt?: string },
): TapTileTake {
  return {
    id: options.id,
    name: options.name,
    createdAt: options.createdAt ?? new Date().toISOString(),
    levelHash: level.levelHash,
    ruleProfileId: level.ruleProfileId,
    actions: actions.map((action) => ({
      ...action,
      ...(action.pointerPath ? { pointerPath: action.pointerPath.map((point) => ({ ...point })) } : {}),
    })),
    result: finalState.status === 'won' ? 'won' : finalState.status === 'lost' ? 'lost' : 'unfinished',
    finalStateHash: tapTileStateHash(finalState),
  };
}
