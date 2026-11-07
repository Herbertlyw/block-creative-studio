import { describe, expect, it } from 'vitest';
import {
  compileTapTileLevel,
  replayTapTileTake,
  solveTapTileLevel,
  solveTapTileLevelAnytime,
  solveTapTileTake,
  solveTapTileTakeAnytime,
  type TapTileScenarioProfileId,
} from '../src/taptile/gameplay';
import type { CompiledTapTileLevel } from '../src/taptile/project';
import { createDefaultTapTileProject } from '../src/taptile/project';
import { seededPathRank } from '../src/taptile/gameplay/solver/seededOrder';

function flatLevelWithCopies(copiesByGroup: readonly number[]): CompiledTapTileLevel {
  const ids: string[] = [];
  const tiles: CompiledTapTileLevel['tiles'] = {};
  for (let group = 0; group < copiesByGroup.length; group += 1) {
    for (let copy = 0; copy < (copiesByGroup[group] ?? 0); copy += 1) {
      const id = `g${group + 1}-${copy + 1}`;
      ids.push(id);
      tiles[id] = {
        id,
        archetypeId: `face-${group + 1}`,
        matchKey: `match-${group + 1}`,
        geometry: {
          centerXPx: 100 + group * 20,
          centerYPx: 100 + copy * 20,
          widthPx: 96,
          heightPx: 120,
          rotationDeg: 0,
          layer: 0,
          order: ids.length,
        },
      };
    }
  }
  return {
    levelHash: `fixture-${copiesByGroup.join('-')}`,
    ruleProfileId: 'taptile-tray-match3-v1',
    tiles,
    initialBoardIds: ids,
    blockersByTile: Object.fromEntries(ids.map((id) => [id, []])),
    dependentsByTile: Object.fromEntries(ids.map((id) => [id, []])),
    initialBlockerCount: Object.fromEntries(ids.map((id) => [id, 0])),
    initialPlayableIds: ids,
    blockerEdges: [],
    validation: {
      valid: true,
      issues: [],
      statistics: { tileCount: ids.length, archetypeCount: copiesByGroup.length, edgeCount: 0, playableCount: ids.length },
    },
  };
}

function flatLevel(groupCount: number, copies = 3): CompiledTapTileLevel {
  return flatLevelWithCopies(Array.from({ length: groupCount }, () => copies));
}

describe('TapTile deterministic Beam Search', () => {
  it('keeps path-derived seeded ordering stable while using incremental states internally', () => {
    expect(seededPathRank(1, [])).toBe(814657751);
    expect(seededPathRank(935, ['a'])).toBe(2359091889);
    expect(seededPathRank(935, ['a', 'b'])).toBe(3205851692);
    expect(seededPathRank(240811, ['hourglass-43', 'hourglass-44', 'hourglass-45'])).toBe(3845342074);
  });
  it('solves every seeded production template through the same engine API', () => {
    for (const template of ['hourglass', 't-shape', 'terraces', 'free'] as const) {
      const level = compileTapTileLevel(createDefaultTapTileProject(template));
      const solved = solveTapTileTake(level, { profile: 'safe-win', seed: 20260902, beamWidth: 40 });
      expect(solved.status, `${template}: ${solved.diagnostic}`).toBe('solved');
      expect(solved.take?.result).toBe('won');
      expect(solved.validation?.valid).toBe(true);
    }
  });

  it('solves a small level and produces a formally replayable Take', () => {
    const level = flatLevel(3);
    const solved = solveTapTileTake(level, { profile: 'safe-win', seed: 27, beamWidth: 160 });
    expect(solved.status).toBe('solved');
    expect(solved.take?.result).toBe('won');
    expect(solved.validation?.valid).toBe(true);
    expect(solved.actions).toHaveLength(9);
    expect(solved.actions?.every((action) => action.actor === 'agent' && action.type === 'tap')).toBe(true);
  });

  it('returns exactly the same actions and Take for the same seed', () => {
    const level = flatLevel(4);
    const options = { profile: 'combo-heavy' as const, seed: 935, beamWidth: 240 };
    const first = solveTapTileTake(level, options);
    const second = solveTapTileTake(level, options);
    expect(second.actions).toEqual(first.actions);
    expect(second.take).toEqual(first.take);
    expect(second.finalStateHash).toBe(first.finalStateHash);
  });

  it('creates a danger-rescue Take that warns at 6/7 and later recovers', () => {
    const level = flatLevel(6);
    const solved = solveTapTileTake(level, {
      profile: 'danger-rescue',
      seed: 81,
      beamWidth: 800,
      maxDepth: 18,
    });
    expect(solved.status, solved.diagnostic).toBe('solved');
    expect(solved.take).toBeDefined();
    const replay = replayTapTileTake(level, solved.take!);
    const warningIndex = replay.transitions.findIndex((transition) => transition.events.some((event) => event.type === 'tray.warning'));
    expect(warningIndex).toBeGreaterThanOrEqual(0);
    expect(replay.transitions.slice(warningIndex + 1).some((transition) => transition.matchedTileIds.length === 3 && transition.after.trayIds.length < 6)).toBe(true);
    expect(replay.states.at(-1)?.status).toBe('won');
  });

  it('supports an intentional seventh-slot failure profile', () => {
    const level = flatLevel(7);
    const solved = solveTapTileTake(level, { profile: 'intentional-fail', seed: 5, beamWidth: 260 });
    expect(solved.status, solved.diagnostic).toBe('solved');
    expect(solved.take?.result).toBe('lost');
    expect(solved.actions).toHaveLength(7);
  });

  it('returns a deterministic maximum-clear partial Take when the board cannot be fully cleared', () => {
    const level = flatLevelWithCopies([4, 4, 5, 4, 4, 2]);
    const options = {
      profile: 'max-clear' as const,
      seed: 240811,
      beamWidth: 80,
      maxExpandedStates: 30_000,
    };
    const first = solveTapTileTake(level, options);
    const repeated = solveTapTileTake(level, options);
    expect(first.status, first.diagnostic).toBe('partial');
    expect(first.metrics).toMatchObject({
      clearedTileCount: 15,
      theoreticalClearableTileCount: 15,
      provedMaximum: true,
    });
    expect(first.take?.result).toBe('unfinished');
    expect(first.validation?.valid).toBe(true);
    expect(first.actions).toEqual(repeated.actions);
    expect(first.take).toEqual(repeated.take);
    const replay = replayTapTileTake(level, first.take!);
    expect(replay.states.at(-1)?.status).toBe('playing');
    expect(replay.states.at(-1)?.clearedIds).toHaveLength(15);
    expect(replay.states.at(-1)?.trayIds.length).toBeLessThan(7);
  });

  it('uses maximum-clear mode to fully solve a board when every tile is safely clearable', () => {
    const level = compileTapTileLevel(createDefaultTapTileProject('free'));
    const result = solveTapTileTake(level, {
      profile: 'max-clear',
      seed: 240811,
      beamWidth: 120,
      maxExpandedStates: 60_000,
    });
    expect(result.status, result.diagnostic).toBe('solved');
    expect(result.take?.result).toBe('won');
    expect(result.metrics).toMatchObject({
      clearedTileCount: level.initialBoardIds.length,
      theoreticalClearableTileCount: level.initialBoardIds.length,
      provedMaximum: true,
    });
  });

  it('does not create a maximum-clear Take when no match group contains a triple', () => {
    const result = solveTapTileTake(flatLevelWithCopies([2, 2, 1]), {
      profile: 'max-clear',
      maxExpandedStates: 1_000,
    });
    expect(result.status).toBe('not-found');
    expect(result.take).toBeUndefined();
    expect(result.diagnostic).toContain('无法组成任何三消');
  });

  it('keeps the invalid/not-found evidence boundary explicit', () => {
    const invalid = flatLevel(1);
    invalid.validation.valid = false;
    invalid.validation.issues.push({ code: 'FIXTURE_INVALID', severity: 'error', message: 'invalid', objectIds: [] });
    expect(solveTapTileLevel(invalid).status).toBe('invalid-level');

    const profiles: TapTileScenarioProfileId[] = ['max-clear', 'safe-win', 'danger-rescue', 'combo-heavy', 'fast-clear', 'intentional-fail'];
    for (const profile of profiles) {
      const result = solveTapTileLevel(flatLevel(3), { profile, maxDepth: 0 });
      expect(result.status).toBe('not-found');
      expect(result.diagnostic).toContain('不等于数学上无解');
    }
  });

  it('keeps cooperative anytime search bit-for-bit aligned with the synchronous solver', async () => {
    const level = flatLevelWithCopies([4, 4, 5, 4, 4, 2]);
    const options = {
      profile: 'max-clear' as const,
      seed: 9304,
      beamWidth: 80,
      maxExpandedStates: 30_000,
    };
    const synchronous = solveTapTileTake(level, options);
    const progress: number[] = [];
    const anytime = await solveTapTileTakeAnytime(level, {
      ...options,
      yieldEvery: 256,
      onProgress: (snapshot) => { progress.push(snapshot.expandedStates); },
    });
    expect(anytime.actions).toEqual(synchronous.actions);
    expect(anytime.finalStateHash).toBe(synchronous.finalStateHash);
    expect(anytime.metrics).toEqual(synchronous.metrics);
    expect(progress.length).toBeGreaterThan(1);
    expect(progress[0]).toBe(0);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);
  });

  it('cancels between bounded slices and returns the best replayable maximum-clear path', async () => {
    const level = flatLevelWithCopies([4, 4, 5, 4, 4, 2]);
    const controller = new AbortController();
    const result = await solveTapTileTakeAnytime(level, {
      profile: 'max-clear',
      seed: 9304,
      beamWidth: 120,
      maxExpandedStates: 100_000,
      yieldEvery: 128,
      onProgress: (progress) => {
        if (progress.bestClearedTileCount >= 3) controller.abort();
      },
      signal: controller.signal,
    });
    expect(result.status).toBe('partial');
    expect(result.terminationReason).toBe('canceled');
    expect(result.metrics?.clearedTileCount).toBeGreaterThanOrEqual(3);
    expect(result.take).toBeDefined();
    expect(result.validation?.valid).toBe(true);
  });

  it('honors a zero millisecond time budget before expanding a state', async () => {
    const result = await solveTapTileLevelAnytime(flatLevel(8), {
      profile: 'max-clear',
      timeBudgetMs: 0,
      yieldEvery: 1,
    });
    expect(result.status).toBe('not-found');
    expect(result.expandedStates).toBe(0);
    expect(result.terminationReason).toBe('time-budget');
  });
});
