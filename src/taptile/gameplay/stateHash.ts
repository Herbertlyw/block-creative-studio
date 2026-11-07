import { stableHash } from '../project';
import type { TapTileGameState } from './types';

export function tapTileStateHash(state: TapTileGameState): string {
  return stableHash({
    status: state.status,
    turn: state.turn,
    boardIds: state.boardIds,
    trayIds: state.trayIds,
    clearedIds: [...state.clearedIds].sort(),
    activeBlockerCount: state.activeBlockerCount,
  }, 'state');
}
