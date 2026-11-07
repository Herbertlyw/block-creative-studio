import type { CompiledTapTileLevel, TapTileRuleProfileId } from '../project';

export type TapTileGameplayStatus = 'playing' | 'won' | 'lost';

export interface TapTileGameState {
  status: TapTileGameplayStatus;
  turn: number;
  boardIds: string[];
  trayIds: string[];
  clearedIds: string[];
  activeBlockerCount: Record<string, number>;
}

export interface TapTileAction {
  id: string;
  type: 'tap';
  actor: 'human' | 'agent' | 'script';
  tileId: string;
}

export type TapTileRejectReason = 'not-playing' | 'not-on-board' | 'blocked';

export type TapTileSemanticEvent =
  | { type: 'tap.accepted'; tileId: string; turn: number }
  | { type: 'tap.rejected'; tileId: string; reason: TapTileRejectReason; blockerIds?: string[] }
  | { type: 'tile.fly-to-tray'; tileId: string; trayIndex: number }
  | { type: 'tray.reordered'; before: string[]; afterInsert: string[]; afterResolve: string[] }
  | { type: 'match.resolved'; matchKey: string; tileIds: string[] }
  | { type: 'tiles.unlocked'; tileIds: string[] }
  | { type: 'tray.warning'; occupied: number; capacity: 7 }
  | { type: 'game.won' }
  | { type: 'game.lost'; reason: 'tray-full' | 'board-empty-with-unmatched-tray' };

export interface TapTileTransition {
  before: TapTileGameState;
  after: TapTileGameState;
  action: TapTileAction;
  accepted: boolean;
  rejectReason?: TapTileRejectReason;
  blockerIds?: string[];
  trayBefore: string[];
  trayAfterInsert: string[];
  trayAfterResolve: string[];
  insertedIndex?: number;
  matchedTileIds: string[];
  newlyUnlockedTileIds: string[];
  terminal?: 'won' | 'lost';
  terminalReason?: 'tray-full' | 'board-empty-with-unmatched-tray';
  events: TapTileSemanticEvent[];
}

export interface TapTileGameplaySession {
  ruleProfileId: TapTileRuleProfileId;
  level: CompiledTapTileLevel;
  state: TapTileGameState;
}
