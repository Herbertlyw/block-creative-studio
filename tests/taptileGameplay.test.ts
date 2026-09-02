import { describe, expect, it } from 'vitest';
import {
  blockerIdsForTile,
  clickGameplayTile,
  createGameplayState,
  playableTileIds,
  type GameplayTile,
  type TapTileGameplayState,
} from '../src/taptile/gameplay';

function tile(
  id: string,
  faceId: string,
  centerXPx: number,
  centerYPx: number,
  layer = 0,
): Omit<GameplayTile, 'order' | 'locked'> {
  return { id, faceId, centerXPx, centerYPx, widthPx: 170, heightPx: 170, layer };
}

function click(state: TapTileGameplayState, tileId: string) {
  return clickGameplayTile(state, tileId);
}

describe('TapTile gameplay engine', () => {
  it('uses the same pixel overlap graph for playability and post-click unlocking', () => {
    const initial = createGameplayState([
      tile('lower', 'frog', 500, 700, 0),
      tile('upper', 'bear', 530, 700, 1),
    ]);
    expect(blockerIdsForTile(initial, 'lower')).toEqual(['upper']);
    expect(playableTileIds(initial)).toEqual(['upper']);
    expect(click(initial, 'lower').events[0]).toMatchObject({ type: 'click-rejected', reason: 'blocked' });

    const moved = click(initial, 'upper');
    expect(moved.state.boardIds).toEqual(['lower']);
    expect(moved.events).toContainEqual({ type: 'tiles-unlocked', tileIds: ['lower'] });
  });

  it('groups equal faces in the tray and resolves the third copy before capacity checks', () => {
    let state = createGameplayState([
      tile('frog-1', 'frog', 100, 300),
      tile('bear-1', 'bear', 300, 300),
      tile('frog-2', 'frog', 500, 300),
      tile('frog-3', 'frog', 700, 300),
    ]);
    state = click(state, 'frog-1').state;
    state = click(state, 'bear-1').state;
    state = click(state, 'frog-2').state;
    expect(state.trayIds).toEqual(['frog-1', 'frog-2', 'bear-1']);
    const third = click(state, 'frog-3');
    expect(third.state.trayIds).toEqual(['bear-1']);
    expect(third.state.clearedIds).toEqual(expect.arrayContaining(['frog-1', 'frog-2', 'frog-3']));
    expect(third.events).toContainEqual({
      type: 'match-resolved',
      faceId: 'frog',
      tileIds: ['frog-1', 'frog-2', 'frog-3'],
      source: 'tray-match-3',
    });
  });

  it('warns at six of seven tray slots and loses only after an unresolved seventh tile', () => {
    const tiles = Array.from({ length: 7 }, (_, index) => tile(`tile-${index}`, `face-${index}`, 80 + index * 140, 400));
    let state = createGameplayState(tiles);
    let transition = click(state, 'tile-0');
    for (let index = 1; index < 6; index += 1) transition = click(transition.state, `tile-${index}`);
    expect(transition.state.status).toBe('playing');
    expect(transition.events).toContainEqual({ type: 'tray-warning', occupied: 6, capacity: 7 });
    transition = click(transition.state, 'tile-6');
    expect(transition.state.status).toBe('lost');
    expect(transition.events).toContainEqual({ type: 'game-lost', reason: 'tray-full' });
  });

  it('tracks collection goals on selection independently from triple elimination', () => {
    let state = createGameplayState([
      tile('heart-1', 'heart', 120, 500),
      tile('heart-2', 'heart', 360, 500),
      tile('heart-3', 'heart', 600, 500),
    ], {
      goals: [{ id: 'heart-goal', kind: 'collect-face', faceId: 'heart', target: 3, progressOn: 'selected' }],
    });
    state = click(state, 'heart-1').state;
    state = click(state, 'heart-2').state;
    const completed = click(state, 'heart-3');
    expect(completed.state.goals[0]?.current).toBe(3);
    expect(completed.state.status).toBe('won');
    expect(completed.events.some((event) => event.type === 'goal-progress')).toBe(true);
    expect(completed.events.some((event) => event.type === 'match-resolved')).toBe(true);
  });

  it('can use an observed collection goal as the terminal condition without requiring a board clear', () => {
    const state = createGameplayState([
      tile('heart-1', 'heart', 120, 500),
      tile('heart-2', 'heart', 360, 500),
      tile('coin-1', 'coin', 600, 500),
    ], {
      matchSize: 2,
      winCondition: 'complete-goals',
      goals: [{ id: 'heart-goal', kind: 'collect-face', faceId: 'heart', target: 1, progressOn: 'selected' }],
    });
    const completed = click(state, 'heart-1');
    expect(completed.state.status).toBe('won');
    expect(completed.state.boardIds).toEqual(['heart-2', 'coin-1']);
    expect(completed.events).toContainEqual({ type: 'game-won' });
  });

  it('keeps full-tray failure switchable because the audited videos do not show a complete loss sample', () => {
    const tiles = Array.from({ length: 8 }, (_, index) => tile(`safe-${index}`, `face-${index}`, 50 + index * 130, 400));
    let state = createGameplayState(tiles, { loseOnTrayFull: false });
    for (let index = 0; index < 7; index += 1) state = click(state, `safe-${index}`).state;
    expect(state.status).toBe('playing');
    expect(state.trayIds).toHaveLength(7);
    expect(state.boardIds).toEqual(['safe-7']);
  });

  it('supports the observed tap-one auto-clear-set variant without a tray', () => {
    const state = createGameplayState([
      tile('shoe-1', 'shoe', 120, 400),
      tile('shoe-2', 'shoe', 420, 400),
      tile('shoe-3', 'shoe', 720, 400),
    ], { mode: 'direct-set-clear' });
    const transition = click(state, 'shoe-2');
    expect(transition.state.boardIds).toEqual([]);
    expect(transition.state.trayIds).toEqual([]);
    expect(transition.state.status).toBe('won');
    expect(transition.events).toContainEqual({
      type: 'match-resolved',
      faceId: 'shoe',
      tileIds: ['shoe-2', 'shoe-1', 'shoe-3'],
      source: 'direct-set-clear',
    });
  });

  it('supports manual in-place triple selection and resets a mixed-face attempt', () => {
    let state = createGameplayState([
      tile('kiwi-1', 'kiwi', 120, 400),
      tile('kiwi-2', 'kiwi', 360, 400),
      tile('kiwi-3', 'kiwi', 600, 400),
      tile('pear-1', 'pear', 840, 400),
    ], { mode: 'manual-in-place-match' });
    state = click(state, 'kiwi-1').state;
    const reset = click(state, 'pear-1');
    expect(reset.state.selectedInPlaceIds).toEqual(['pear-1']);
    expect(reset.events.some((event) => event.type === 'in-place-selection-reset')).toBe(true);
    state = click(reset.state, 'kiwi-1').state;
    state = click(state, 'kiwi-2').state;
    const matched = click(state, 'kiwi-3');
    expect(matched.state.boardIds).toEqual(['pear-1']);
    expect(matched.state.selectedInPlaceIds).toEqual([]);
  });

  it('rejects fractional export geometry instead of hiding subpixel drift', () => {
    expect(() => createGameplayState([
      { ...tile('fractional', 'frog', 100, 300), centerXPx: 100.5 },
    ])).toThrow(/integer export-pixel geometry/);
  });
});
