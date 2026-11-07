import type { CompiledTapTileLevel } from '../project';
import { TAPTILE_MATCH3_PROFILE } from './profile';
import { insertIntoGroupedTray, resolveGroupedTrayMatch } from './tray';
import type {
  TapTileAction,
  TapTileGameState,
  TapTileRejectReason,
  TapTileSemanticEvent,
  TapTileTransition,
} from './types';

function cloneState(state: TapTileGameState): TapTileGameState {
  return {
    status: state.status,
    turn: state.turn,
    boardIds: [...state.boardIds],
    trayIds: [...state.trayIds],
    clearedIds: [...state.clearedIds],
    activeBlockerCount: { ...state.activeBlockerCount },
  };
}

export function createInitialTapTileGameState(level: CompiledTapTileLevel): TapTileGameState {
  return {
    status: 'playing',
    turn: 0,
    boardIds: [...level.initialBoardIds],
    trayIds: [],
    clearedIds: [],
    activeBlockerCount: { ...level.initialBlockerCount },
  };
}

export function activeBlockerIds(
  level: CompiledTapTileLevel,
  state: TapTileGameState,
  tileId: string,
): string[] {
  const board = new Set(state.boardIds);
  return (level.blockersByTile[tileId] ?? []).filter((id) => board.has(id));
}

export function playableTapTileIds(level: CompiledTapTileLevel, state: TapTileGameState): string[] {
  return state.boardIds.filter((id) => (state.activeBlockerCount[id] ?? 0) === 0);
}

function reject(
  level: CompiledTapTileLevel,
  state: TapTileGameState,
  action: TapTileAction,
  reason: TapTileRejectReason,
): TapTileTransition {
  const before = cloneState(state);
  const after = cloneState(state);
  const blockerIds = reason === 'blocked' ? activeBlockerIds(level, state, action.tileId) : undefined;
  const event: TapTileSemanticEvent = {
    type: 'tap.rejected',
    tileId: action.tileId,
    reason,
    ...(blockerIds && blockerIds.length > 0 ? { blockerIds } : {}),
  };
  return {
    before,
    after,
    action: { ...action },
    accepted: false,
    rejectReason: reason,
    ...(blockerIds && blockerIds.length > 0 ? { blockerIds } : {}),
    trayBefore: [...state.trayIds],
    trayAfterInsert: [...state.trayIds],
    trayAfterResolve: [...state.trayIds],
    matchedTileIds: [],
    newlyUnlockedTileIds: [],
    events: [event],
  };
}

export function applyTapAction(
  level: CompiledTapTileLevel,
  state: TapTileGameState,
  action: TapTileAction,
): TapTileTransition {
  if (state.status !== 'playing') return reject(level, state, action, 'not-playing');
  if (!state.boardIds.includes(action.tileId) || !level.tiles[action.tileId]) return reject(level, state, action, 'not-on-board');
  if ((state.activeBlockerCount[action.tileId] ?? 0) > 0) return reject(level, state, action, 'blocked');

  const before = cloneState(state);
  const next = cloneState(state);
  next.turn += 1;
  next.boardIds = next.boardIds.filter((id) => id !== action.tileId);
  const trayBefore = [...next.trayIds];
  const inserted = insertIntoGroupedTray(next.trayIds, action.tileId, level);
  const trayAfterInsert = [...inserted.trayIds];
  const resolved = resolveGroupedTrayMatch(trayAfterInsert, action.tileId, level);
  const trayAfterResolve = [...resolved.trayIds];
  next.trayIds = trayAfterResolve;
  if (resolved.matchedTileIds.length > 0) {
    next.clearedIds = [...next.clearedIds, ...resolved.matchedTileIds.filter((id) => !next.clearedIds.includes(id))];
  }

  const newlyUnlockedTileIds: string[] = [];
  const boardSet = new Set(next.boardIds);
  for (const dependentId of level.dependentsByTile[action.tileId] ?? []) {
    if (!boardSet.has(dependentId)) continue;
    const previous = next.activeBlockerCount[dependentId] ?? 0;
    const current = Math.max(0, previous - 1);
    next.activeBlockerCount[dependentId] = current;
    if (previous > 0 && current === 0) newlyUnlockedTileIds.push(dependentId);
  }

  const events: TapTileSemanticEvent[] = [
    { type: 'tap.accepted', tileId: action.tileId, turn: next.turn },
    { type: 'tile.fly-to-tray', tileId: action.tileId, trayIndex: inserted.insertedIndex },
    { type: 'tray.reordered', before: trayBefore, afterInsert: trayAfterInsert, afterResolve: trayAfterResolve },
  ];
  const matchKey = level.tiles[action.tileId]?.matchKey ?? '';
  if (resolved.matchedTileIds.length > 0) events.push({ type: 'match.resolved', matchKey, tileIds: [...resolved.matchedTileIds] });
  if (newlyUnlockedTileIds.length > 0) events.push({ type: 'tiles.unlocked', tileIds: [...newlyUnlockedTileIds] });

  let terminal: TapTileTransition['terminal'];
  let terminalReason: TapTileTransition['terminalReason'];
  if (next.boardIds.length === 0 && next.trayIds.length === 0) {
    next.status = 'won';
    terminal = 'won';
    events.push({ type: 'game.won' });
  } else if (next.trayIds.length >= TAPTILE_MATCH3_PROFILE.trayCapacity) {
    next.status = 'lost';
    terminal = 'lost';
    terminalReason = 'tray-full';
    events.push({ type: 'game.lost', reason: terminalReason });
  } else if (next.boardIds.length === 0) {
    next.status = 'lost';
    terminal = 'lost';
    terminalReason = 'board-empty-with-unmatched-tray';
    events.push({ type: 'game.lost', reason: terminalReason });
  } else if (next.trayIds.length === TAPTILE_MATCH3_PROFILE.warningAt) {
    events.push({ type: 'tray.warning', occupied: TAPTILE_MATCH3_PROFILE.warningAt, capacity: TAPTILE_MATCH3_PROFILE.trayCapacity });
  }

  return {
    before,
    after: next,
    action: { ...action },
    accepted: true,
    trayBefore,
    trayAfterInsert,
    trayAfterResolve,
    insertedIndex: inserted.insertedIndex,
    matchedTileIds: [...resolved.matchedTileIds],
    newlyUnlockedTileIds,
    ...(terminal ? { terminal } : {}),
    ...(terminalReason ? { terminalReason } : {}),
    events,
  };
}
