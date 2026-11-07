import { describe, expect, it } from 'vitest';
import {
  applyTapAction,
  compileTapTileLevel,
  createInitialTapTileGameState,
  playableTapTileIds,
  tapTileStateHash,
  type TapTileGameState,
} from '../src/taptile/gameplay';
import { createDefaultTapTileProject } from '../src/taptile/project';

interface Candidate {
  state: TapTileGameState;
  actions: string[];
  matches: number;
  unlocked: number;
}

export function findGateASequence(): string[] {
  const level = compileTapTileLevel(createDefaultTapTileProject('hourglass'));
  let frontier: Candidate[] = [{ state: createInitialTapTileGameState(level), actions: [], matches: 0, unlocked: 0 }];
  const seen = new Set<string>();
  for (let depth = 0; depth < 28; depth += 1) {
    const expanded: Candidate[] = [];
    for (const candidate of frontier) {
      for (const tileId of playableTapTileIds(level, candidate.state)) {
        const transition = applyTapAction(level, candidate.state, {
          id: `gate-${depth}-${tileId}`, type: 'tap', actor: 'script', tileId,
        });
        if (!transition.accepted) continue;
        const next: Candidate = {
          state: transition.after,
          actions: [...candidate.actions, tileId],
          matches: candidate.matches + (transition.matchedTileIds.length > 0 ? 1 : 0),
          unlocked: candidate.unlocked + transition.newlyUnlockedTileIds.length,
        };
        if (next.matches >= 2 && next.unlocked > 0) return next.actions;
        if (next.state.status !== 'playing') continue;
        const key = `${tapTileStateHash(next.state)}:${next.matches}:${Math.min(1, next.unlocked)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        expanded.push(next);
      }
    }
    expanded.sort((left, right) => {
      const score = (candidate: Candidate) => candidate.matches * 300 + Math.min(8, candidate.unlocked) * 15 - candidate.state.trayIds.length * 12;
      return score(right) - score(left) || left.actions.join('|').localeCompare(right.actions.join('|'));
    });
    frontier = expanded.slice(0, 500);
  }
  return [];
}

describe('TapTile Gate A browser fixture', () => {
  it('has a deterministic path with two matches and an unlock', () => {
    const actions = findGateASequence();
    expect(actions).toEqual([
      'hourglass-30',
      'hourglass-34',
      'hourglass-41',
      'hourglass-43',
      'hourglass-44',
      'hourglass-45',
    ]);
  });
});
