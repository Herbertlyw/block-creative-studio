import type { CompiledTapTileLevel } from '../../project';
import type { TapTileGameState } from '../types';
import type { TapTileScenarioProfileId } from './types';

export interface SolverScoreContext {
  state: TapTileGameState;
  depth: number;
  matchCount: number;
  unlockedCount: number;
  consecutiveMatches: number;
  maxConsecutiveMatches: number;
  sawWarning: boolean;
  recoveredAfterWarning: boolean;
}

function trayShape(level: CompiledTapTileLevel, state: TapTileGameState): { distinct: number; pairs: number } {
  const counts = new Map<string, number>();
  for (const tileId of state.trayIds) {
    const key = level.tiles[tileId]?.matchKey ?? tileId;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return {
    distinct: counts.size,
    pairs: [...counts.values()].filter((count) => count === 2).length,
  };
}

export function scoreSolverCandidate(
  level: CompiledTapTileLevel,
  profile: TapTileScenarioProfileId,
  context: SolverScoreContext,
): number {
  const { state } = context;
  const { distinct, pairs } = trayShape(level, state);
  const cleared = state.clearedIds.length;
  const remaining = state.boardIds.length;
  const common = cleared * 26
    + context.matchCount * 150
    + context.unlockedCount * 18
    - state.trayIds.length * 16
    - distinct * 11
    - remaining;

  if (profile === 'max-clear') {
    return cleared * 100_000
      + context.matchCount * 4_000
      + pairs * 240
      + context.unlockedCount * 70
      - state.trayIds.length * 180
      - distinct * 45
      - context.depth;
  }
  if (profile === 'intentional-fail') {
    return (state.status === 'lost' ? 1_000_000 : 0)
      + state.trayIds.length * 260
      + distinct * 70
      - pairs * 60
      - context.matchCount * 90;
  }
  if (profile === 'danger-rescue') {
    if (!context.sawWarning) {
      return state.trayIds.length * 230
        + pairs * 180
        - distinct * 8
        + context.unlockedCount * 8
        - context.matchCount * 60;
    }
    return 4_000
      + (context.recoveredAfterWarning ? 2_500 : 0)
      + common
      + context.matchCount * 80
      - state.trayIds.length * 25;
  }
  if (profile === 'combo-heavy') {
    return common
      + context.consecutiveMatches * 220
      + context.maxConsecutiveMatches * 160
      + context.matchCount * 70;
  }
  if (profile === 'fast-clear') {
    return common + cleared * 18 - context.depth * 7 + (state.status === 'won' ? 1_000_000 - context.depth * 100 : 0);
  }
  return common + pairs * 35 + (state.status === 'won' ? 1_000_000 : 0);
}
