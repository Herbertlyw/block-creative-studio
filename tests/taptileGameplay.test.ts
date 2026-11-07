import { describe, expect, it } from 'vitest';
import {
  applyTapAction,
  compileTapTileLevel,
  createInitialTapTileGameState,
  playableTapTileIds,
  tapTileStateHash,
  type TapTileAction,
  type TapTileGameState,
} from '../src/taptile/gameplay';
import {
  createDefaultTapTileProject,
  type TapTileProjectV2,
} from '../src/taptile/project';

interface TestTile {
  id: string;
  matchKey: string;
  x?: number;
  y?: number;
  layer?: number;
  editorLocked?: boolean;
  rotationDeg?: number;
}

function makeProject(input: TestTile[]): TapTileProjectV2 {
  const project = createDefaultTapTileProject('free');
  const matchKeys = [...new Set(input.map((tile) => tile.matchKey))];
  project.visuals.archetypes = {};
  project.visuals.faceAssemblies = {};
  const bindings: Record<string, { faceAssemblyId: string; bodyStyleId: string }> = {};
  for (const [index, matchKey] of matchKeys.entries()) {
    const archetypeId = `archetype-${matchKey}`;
    const faceAssemblyId = `face-${matchKey}`;
    project.visuals.archetypes[archetypeId] = { id: archetypeId, displayName: matchKey, matchKey };
    project.visuals.faceAssemblies[faceAssemblyId] = {
      id: faceAssemblyId,
      name: matchKey,
      mode: 'overlay-on-body',
      bodyInteraction: 'show-body',
      parts: [{
        id: `${faceAssemblyId}-glyph`,
        source: { kind: 'glyph', value: String.fromCodePoint(0x1f330 + index) },
        transform: { x: 0.5, y: 0.5, scaleX: 1, scaleY: 1, rotationDeg: 0, opacity: 1 },
      }],
    };
    bindings[archetypeId] = { faceAssemblyId, bodyStyleId: 'body-warm' };
  }
  project.visuals.themes = { test: { id: 'test', name: 'Test', bindings } };
  project.visuals.selectedThemeId = 'test';
  project.level.tileInstances = input.map((tile, order) => ({
    id: tile.id,
    archetypeId: `archetype-${tile.matchKey}`,
    geometry: {
      centerXPx: tile.x ?? 100 + order * 190,
      centerYPx: tile.y ?? 800,
      widthPx: 170,
      heightPx: 170,
      rotationDeg: tile.rotationDeg ?? 0,
      layer: tile.layer ?? 0,
      order,
    },
    authoring: { editorLocked: tile.editorLocked ?? false },
  }));
  project.level.blockerPolicy = { minimumOverlapAreaPx: 100, minimumOverlapRatio: 0.01, epsilonPx: 0.001 };
  project.level.blockerOverrides = { forced: [], ignored: [] };
  return project;
}

function action(tileId: string, index = 0): TapTileAction {
  return { id: `action-${index}-${tileId}`, type: 'tap', actor: 'script', tileId };
}

function tap(level: ReturnType<typeof compileTapTileLevel>, state: TapTileGameState, tileId: string, index = 0) {
  return applyTapAction(level, state, action(tileId, index));
}

describe('TapTile tray-match3-v1 engine', () => {
  it('allows levels whose match groups are not multiples of three', () => {
    const project = makeProject([
      { id: 'a-1', matchKey: 'a' },
      { id: 'a-2', matchKey: 'a' },
      { id: 'b-1', matchKey: 'b' },
      { id: 'b-2', matchKey: 'b' },
    ]);
    const level = compileTapTileLevel(project);
    expect(level.validation.valid).toBe(true);
    expect(level.validation.issues.some((issue) => issue.code === 'MATCH_KEY_COUNT_INVALID')).toBe(false);
  });

  it('uses the frozen blocker graph and incrementally unlocks dependents', () => {
    const project = makeProject([
      { id: 'lower', matchKey: 'frog', x: 500, y: 700, layer: 0 },
      { id: 'upper', matchKey: 'bear', x: 530, y: 700, layer: 1 },
    ]);
    const level = compileTapTileLevel(project);
    const initial = createInitialTapTileGameState(level);
    expect(level.blockersByTile.lower).toEqual(['upper']);
    expect(playableTapTileIds(level, initial)).toEqual(['upper']);
    const rejected = tap(level, initial, 'lower');
    expect(rejected).toMatchObject({ accepted: false, rejectReason: 'blocked', blockerIds: ['upper'] });
    expect(rejected.after).toEqual(initial);

    const moved = tap(level, initial, 'upper');
    expect(moved.after.boardIds).toEqual(['lower']);
    expect(moved.newlyUnlockedTileIds).toEqual(['lower']);
    expect(moved.events).toContainEqual({ type: 'tiles.unlocked', tileIds: ['lower'] });
  });

  it('groups by matchKey and exposes insert and resolve tray states', () => {
    const project = makeProject([
      { id: 'frog-1', matchKey: 'frog' },
      { id: 'bear-1', matchKey: 'bear' },
      { id: 'frog-2', matchKey: 'frog' },
      { id: 'frog-3', matchKey: 'frog' },
      { id: 'bear-2', matchKey: 'bear' },
      { id: 'bear-3', matchKey: 'bear' },
    ]);
    const level = compileTapTileLevel(project);
    let state = createInitialTapTileGameState(level);
    state = tap(level, state, 'frog-1', 1).after;
    state = tap(level, state, 'bear-1', 2).after;
    const second = tap(level, state, 'frog-2', 3);
    expect(second.trayAfterInsert).toEqual(['frog-1', 'frog-2', 'bear-1']);
    const third = tap(level, second.after, 'frog-3', 4);
    expect(third.trayBefore).toEqual(['frog-1', 'frog-2', 'bear-1']);
    expect(third.trayAfterInsert).toEqual(['frog-1', 'frog-2', 'frog-3', 'bear-1']);
    expect(third.trayAfterResolve).toEqual(['bear-1']);
    expect(third.matchedTileIds).toEqual(['frog-1', 'frog-2', 'frog-3']);
  });

  it('warns at six and loses only after an unresolved seventh tile', () => {
    const project = makeProject(Array.from({ length: 8 }, (_, index) => ({ id: `tile-${index}`, matchKey: `face-${index}` })));
    const level = compileTapTileLevel(project);
    let state = createInitialTapTileGameState(level);
    let transition = tap(level, state, 'tile-0', 0);
    for (let index = 1; index < 6; index += 1) transition = tap(level, transition.after, `tile-${index}`, index);
    expect(transition.after.status).toBe('playing');
    expect(transition.events).toContainEqual({ type: 'tray.warning', occupied: 6, capacity: 7 });
    const lost = tap(level, transition.after, 'tile-6', 6);
    expect(lost.after.status).toBe('lost');
    expect(lost.terminalReason).toBe('tray-full');
  });

  it('resolves a triple before checking the seventh tray slot', () => {
    const keys = ['a', 'b', 'c', 'd', 'e', 'a', 'a', 'z'];
    const project = makeProject(keys.map((matchKey, index) => ({ id: `tile-${index}`, matchKey })));
    const level = compileTapTileLevel(project);
    let state = createInitialTapTileGameState(level);
    for (let index = 0; index < 6; index += 1) state = tap(level, state, `tile-${index}`, index).after;
    expect(state.trayIds).toHaveLength(6);
    const rescue = tap(level, state, 'tile-6', 6);
    expect(rescue.trayAfterInsert).toHaveLength(7);
    expect(rescue.trayAfterResolve).toHaveLength(4);
    expect(rescue.after.status).toBe('playing');
  });

  it('does not treat editorLocked as a gameplay blocker', () => {
    const project = makeProject([
      { id: 'locked-1', matchKey: 'a', editorLocked: true },
      { id: 'locked-2', matchKey: 'a', editorLocked: true },
      { id: 'locked-3', matchKey: 'a', editorLocked: true },
    ]);
    const level = compileTapTileLevel(project);
    const state = createInitialTapTileGameState(level);
    expect(playableTapTileIds(level, state)).toContain('locked-1');
    expect(tap(level, state, 'locked-1').accepted).toBe(true);
  });

  it('replays the same input 100 times to the same state hash', () => {
    const project = makeProject(Array.from({ length: 9 }, (_, index) => ({ id: `tile-${index}`, matchKey: `key-${Math.floor(index / 3)}` })));
    const level = compileTapTileLevel(project);
    const run = (): string => {
      let state = createInitialTapTileGameState(level);
      for (let index = 0; index < 9; index += 1) state = tap(level, state, `tile-${index}`, index).after;
      expect(state.status).toBe('won');
      return tapTileStateHash(state);
    };
    const expected = run();
    for (let index = 0; index < 100; index += 1) expect(run()).toBe(expected);
  });
});
