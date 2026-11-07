import { describe, expect, it } from 'vitest';
import {
  applyTapAction,
  compileTapTileLevel,
  createInitialTapTileGameState,
  createTapTileTake,
  validateTapTileTake,
} from '../src/taptile/gameplay';
import { createDefaultTapTileProject } from '../src/taptile/project';

function makeFixture() {
  const project = createDefaultTapTileProject('free');
  project.level.tileInstances = project.level.tileInstances.slice(0, 6).map((tile, order) => ({
    ...tile,
    archetypeId: order < 3 ? 'archetype-bear' : 'archetype-gift',
    geometry: {
      ...tile.geometry,
      centerXPx: 100 + (order % 3) * 300,
      centerYPx: 500 + Math.floor(order / 3) * 300,
      layer: 0,
      order,
    },
  }));
  return { project, level: compileTapTileLevel(project) };
}

describe('TapTile Take recording and replay', () => {
  it('records, validates, and seeks an identical deterministic state sequence', () => {
    const { level } = makeFixture();
    let state = createInitialTapTileGameState(level);
    const actions = level.initialBoardIds.map((tileId, index) => ({
      id: `tap-${index}`,
      type: 'tap' as const,
      actor: 'human' as const,
      tileId,
      startedAtFrame: index * 18,
      durationFrames: 6,
    }));
    for (const source of actions) {
      state = applyTapAction(level, state, source).after;
    }
    expect(state.status).toBe('won');
    const take = createTapTileTake(level, actions, state, { id: 'take-test', name: 'Test Take', createdAt: new Date(0).toISOString() });
    const validation = validateTapTileTake(level, take);
    expect(validation.valid).toBe(true);
    expect(validation.replay.states).toHaveLength(actions.length + 1);
    expect(validation.replay.states.at(-1)).toEqual(state);
  });

  it('locates the exact invalid action and active blocker', () => {
    const { project } = makeFixture();
    const [lower, upper] = project.level.tileInstances;
    if (!lower || !upper) throw new Error('fixture missing tiles');
    lower.geometry = { ...lower.geometry, centerXPx: 500, centerYPx: 700, layer: 0 };
    upper.geometry = { ...upper.geometry, centerXPx: 500, centerYPx: 700, layer: 1 };
    const level = compileTapTileLevel(project);
    const initial = createInitialTapTileGameState(level);
    const take = createTapTileTake(level, [{
      id: 'tap-blocked', type: 'tap', actor: 'script', tileId: lower.id, startedAtFrame: 0, durationFrames: 1,
    }], initial, { id: 'invalid-take', name: 'Invalid', createdAt: new Date(0).toISOString() });
    const validation = validateTapTileTake(level, take);
    expect(validation.valid).toBe(false);
    expect(validation.issues[0]).toMatchObject({ actionIndex: 0, tileId: lower.id, blockerIds: [upper.id] });
  });
});
