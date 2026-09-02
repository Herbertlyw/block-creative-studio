import { blockerIdsForTile, playableTileIds } from './blockers';
import { insertIntoGroupedTray, resolveTrayMatch } from './tray';
import type {
  GameplayEvent,
  GameplayGoal,
  GameplayTile,
  GameplayTransition,
  TapTileGameplayMode,
  TapTileGameplayRules,
  TapTileGameplayState,
} from './types';

export interface CreateGameplayOptions {
  mode?: TapTileGameplayMode;
  matchSize?: number;
  trayCapacity?: number;
  minimumOcclusionAreaPx?: number;
  directClearAllCopies?: boolean;
  loseOnTrayFull?: boolean;
  winCondition?: TapTileGameplayRules['winCondition'];
  goals?: Array<Partial<Pick<GameplayGoal, 'current' | 'progressOn'>> & Pick<GameplayGoal, 'id' | 'kind' | 'faceId' | 'target'>>;
}

const DEFAULT_RULES: TapTileGameplayRules = {
  mode: 'tray-match-3',
  matchSize: 3,
  trayCapacity: 7,
  minimumOcclusionAreaPx: 16,
  directClearAllCopies: true,
  loseOnTrayFull: true,
  winCondition: 'clear-board',
};

function normalizeGameplayTile(tile: Omit<GameplayTile, 'order' | 'locked'> & Partial<Pick<GameplayTile, 'order' | 'locked'>>, order: number): GameplayTile {
  const pixelValues = [tile.centerXPx, tile.centerYPx, tile.widthPx, tile.heightPx];
  if (!pixelValues.every(Number.isInteger)) throw new Error(`Tile ${tile.id} must use integer export-pixel geometry.`);
  if (tile.widthPx <= 0 || tile.heightPx <= 0) throw new Error(`Tile ${tile.id} must have positive dimensions.`);
  if (!Number.isInteger(tile.layer) || tile.layer < 0) throw new Error(`Tile ${tile.id} must use a non-negative integer layer.`);
  return {
    ...tile,
    order: tile.order ?? order,
    locked: tile.locked ?? false,
  };
}

export function createGameplayState(
  inputTiles: Array<Omit<GameplayTile, 'order' | 'locked'> & Partial<Pick<GameplayTile, 'order' | 'locked'>>>,
  options: CreateGameplayOptions = {},
): TapTileGameplayState {
  const { goals: goalOptions = [], ...ruleOptions } = options;
  const rules: TapTileGameplayRules = { ...DEFAULT_RULES, ...ruleOptions };
  rules.matchSize = Math.max(2, Math.round(rules.matchSize));
  rules.trayCapacity = Math.max(rules.matchSize, Math.round(rules.trayCapacity));
  rules.minimumOcclusionAreaPx = Math.max(1, Math.round(rules.minimumOcclusionAreaPx));
  const tiles = inputTiles.map(normalizeGameplayTile);
  if (new Set(tiles.map((tile) => tile.id)).size !== tiles.length) throw new Error('Gameplay tile ids must be unique.');
  const goals = goalOptions.map((goal) => ({
    ...goal,
    current: Math.max(0, Math.min(goal.target, Math.round(goal.current ?? 0))),
    progressOn: goal.progressOn ?? 'selected',
  }));
  return {
    rules,
    status: 'playing',
    turn: 0,
    tiles: Object.fromEntries(tiles.map((tile) => [tile.id, tile])),
    boardIds: tiles.map((tile) => tile.id),
    trayIds: [],
    selectedInPlaceIds: [],
    clearedIds: [],
    goals,
  };
}

function cloneState(state: TapTileGameplayState): TapTileGameplayState {
  return {
    ...state,
    rules: { ...state.rules },
    boardIds: [...state.boardIds],
    trayIds: [...state.trayIds],
    selectedInPlaceIds: [...state.selectedInPlaceIds],
    clearedIds: [...state.clearedIds],
    goals: state.goals.map((goal) => ({ ...goal })),
  };
}

function advanceGoals(
  state: TapTileGameplayState,
  trigger: 'selected' | 'cleared',
  faceIds: readonly string[],
  events: GameplayEvent[],
): void {
  for (const goal of state.goals) {
    if (goal.progressOn !== trigger) continue;
    const amount = faceIds.filter((faceId) => faceId === goal.faceId).length;
    if (amount === 0 || goal.current >= goal.target) continue;
    const previous = goal.current;
    goal.current = Math.min(goal.target, goal.current + amount);
    events.push({ type: 'goal-progress', goalId: goal.id, previous, current: goal.current, target: goal.target });
  }
}

function removeBoardTiles(state: TapTileGameplayState, tileIds: readonly string[]): void {
  const removed = new Set(tileIds);
  state.boardIds = state.boardIds.filter((tileId) => !removed.has(tileId));
  state.clearedIds = [...new Set([...state.clearedIds, ...tileIds])];
}

function appendUnlockEvent(before: Set<string>, state: TapTileGameplayState, events: GameplayEvent[]): void {
  const unlocked = playableTileIds(state).filter((tileId) => !before.has(tileId));
  if (unlocked.length > 0) events.push({ type: 'tiles-unlocked', tileIds: unlocked });
}

function settleTerminalState(state: TapTileGameplayState, events: GameplayEvent[]): void {
  const boardCleared = state.boardIds.length === 0 && (state.rules.mode !== 'tray-match-3' || state.trayIds.length === 0);
  const goalsComplete = state.goals.length > 0 && state.goals.every((goal) => goal.current >= goal.target);
  const won = state.rules.winCondition === 'clear-board'
    ? boardCleared
    : state.rules.winCondition === 'complete-goals'
      ? goalsComplete
      : state.rules.winCondition === 'clear-board-or-goals'
        ? boardCleared || goalsComplete
        : boardCleared && goalsComplete;

  if (won) {
    state.status = 'won';
    events.push({ type: 'game-won' });
    return;
  }

  if (state.rules.mode === 'tray-match-3') {
    if (state.rules.loseOnTrayFull && state.trayIds.length >= state.rules.trayCapacity) {
      state.status = 'lost';
      events.push({ type: 'game-lost', reason: 'tray-full' });
      return;
    }
    if (state.boardIds.length === 0) {
      if (state.trayIds.length > 0) {
        state.status = 'lost';
        events.push({ type: 'game-lost', reason: 'board-empty-with-unmatched-tray' });
      }
      return;
    }
    if (state.trayIds.length === state.rules.trayCapacity - 1) {
      events.push({ type: 'tray-warning', occupied: state.trayIds.length, capacity: state.rules.trayCapacity });
    }
    return;
  }
}

function rejected(state: TapTileGameplayState, tileId: string, reason: Extract<GameplayEvent, { type: 'click-rejected' }>['reason'], blockerIds?: string[]): GameplayTransition {
  return { state, events: [{ type: 'click-rejected', tileId, reason, ...(blockerIds ? { blockerIds } : {}) }] };
}

export function clickGameplayTile(state: TapTileGameplayState, tileId: string): GameplayTransition {
  if (state.status !== 'playing') return rejected(state, tileId, 'not-playing');
  if (!state.boardIds.includes(tileId)) return rejected(state, tileId, 'not-on-board');
  const tile = state.tiles[tileId];
  if (!tile) return rejected(state, tileId, 'not-on-board');
  if (tile.locked) return rejected(state, tileId, 'locked');
  const blockers = blockerIdsForTile(state, tileId);
  if (blockers.length > 0) return rejected(state, tileId, 'blocked', blockers);
  if (state.rules.mode === 'manual-in-place-match' && state.selectedInPlaceIds.includes(tileId)) {
    return rejected(state, tileId, 'already-selected');
  }

  const beforePlayable = new Set(playableTileIds(state));
  const next = cloneState(state);
  next.turn += 1;
  const events: GameplayEvent[] = [{ type: 'click-accepted', tileId, turn: next.turn }];

  if (next.rules.mode === 'tray-match-3') {
    next.boardIds = next.boardIds.filter((id) => id !== tileId);
    const inserted = insertIntoGroupedTray(next.trayIds, tileId, next.tiles);
    next.trayIds = inserted.trayIds;
    events.push({ type: 'tile-moved-to-tray', tileId, trayIndex: inserted.insertedIndex });
    advanceGoals(next, 'selected', [tile.faceId], events);
    const resolved = resolveTrayMatch(next.trayIds, tile.faceId, next.rules.matchSize, next.tiles);
    next.trayIds = resolved.trayIds;
    if (resolved.clearedIds.length > 0) {
      next.clearedIds = [...new Set([...next.clearedIds, ...resolved.clearedIds])];
      events.push({ type: 'match-resolved', faceId: tile.faceId, tileIds: resolved.clearedIds, source: next.rules.mode });
      advanceGoals(next, 'cleared', resolved.clearedIds.map((id) => next.tiles[id]?.faceId ?? ''), events);
    }
  } else if (next.rules.mode === 'direct-set-clear') {
    const matching = next.boardIds.filter((id) => next.tiles[id]?.faceId === tile.faceId);
    if (matching.length < next.rules.matchSize) return rejected(state, tileId, 'no-complete-set');
    const clickedFirst = [tileId, ...matching.filter((id) => id !== tileId)];
    const clearedIds = next.rules.directClearAllCopies ? clickedFirst : clickedFirst.slice(0, next.rules.matchSize);
    removeBoardTiles(next, clearedIds);
    events.push({ type: 'match-resolved', faceId: tile.faceId, tileIds: clearedIds, source: next.rules.mode });
    advanceGoals(next, 'selected', [tile.faceId], events);
    advanceGoals(next, 'cleared', clearedIds.map((id) => next.tiles[id]?.faceId ?? ''), events);
  } else {
    const currentFace = next.selectedInPlaceIds.length > 0
      ? next.tiles[next.selectedInPlaceIds[0] ?? '']?.faceId
      : null;
    if (currentFace && currentFace !== tile.faceId) {
      events.push({ type: 'in-place-selection-reset', previousTileIds: [...next.selectedInPlaceIds], nextFaceId: tile.faceId });
      next.selectedInPlaceIds = [];
    }
    next.selectedInPlaceIds.push(tileId);
    events.push({ type: 'in-place-selection-changed', tileIds: [...next.selectedInPlaceIds] });
    advanceGoals(next, 'selected', [tile.faceId], events);
    if (next.selectedInPlaceIds.length >= next.rules.matchSize) {
      const clearedIds = next.selectedInPlaceIds.slice(0, next.rules.matchSize);
      next.selectedInPlaceIds = [];
      removeBoardTiles(next, clearedIds);
      events.push({ type: 'match-resolved', faceId: tile.faceId, tileIds: clearedIds, source: next.rules.mode });
      advanceGoals(next, 'cleared', clearedIds.map((id) => next.tiles[id]?.faceId ?? ''), events);
    }
  }

  appendUnlockEvent(beforePlayable, next, events);
  settleTerminalState(next, events);
  return { state: next, events };
}
