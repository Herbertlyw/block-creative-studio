export type TapTileGameplayMode = 'tray-match-3' | 'direct-set-clear' | 'manual-in-place-match';
export type TapTileGameplayStatus = 'playing' | 'won' | 'lost';
export type TapTileWinCondition = 'clear-board' | 'complete-goals' | 'clear-board-or-goals' | 'clear-board-and-goals';

export interface GameplayTile {
  id: string;
  faceId: string;
  centerXPx: number;
  centerYPx: number;
  widthPx: number;
  heightPx: number;
  layer: number;
  order: number;
  locked: boolean;
}

export interface GameplayGoal {
  id: string;
  kind: 'collect-face';
  faceId: string;
  target: number;
  current: number;
  progressOn: 'selected' | 'cleared';
}

export interface TapTileGameplayRules {
  mode: TapTileGameplayMode;
  matchSize: number;
  trayCapacity: number;
  minimumOcclusionAreaPx: number;
  directClearAllCopies: boolean;
  loseOnTrayFull: boolean;
  winCondition: TapTileWinCondition;
}

export interface TapTileGameplayState {
  rules: TapTileGameplayRules;
  status: TapTileGameplayStatus;
  turn: number;
  tiles: Record<string, GameplayTile>;
  boardIds: string[];
  trayIds: string[];
  selectedInPlaceIds: string[];
  clearedIds: string[];
  goals: GameplayGoal[];
}

export type GameplayEvent =
  | { type: 'click-rejected'; tileId: string; reason: 'not-playing' | 'not-on-board' | 'locked' | 'blocked' | 'already-selected' | 'no-complete-set'; blockerIds?: string[] }
  | { type: 'click-accepted'; tileId: string; turn: number }
  | { type: 'tile-moved-to-tray'; tileId: string; trayIndex: number }
  | { type: 'in-place-selection-changed'; tileIds: string[] }
  | { type: 'in-place-selection-reset'; previousTileIds: string[]; nextFaceId: string }
  | { type: 'match-resolved'; faceId: string; tileIds: string[]; source: TapTileGameplayMode }
  | { type: 'goal-progress'; goalId: string; previous: number; current: number; target: number }
  | { type: 'tiles-unlocked'; tileIds: string[] }
  | { type: 'tray-warning'; occupied: number; capacity: number }
  | { type: 'game-won' }
  | { type: 'game-lost'; reason: 'tray-full' | 'board-empty-with-unmatched-tray' };

export interface GameplayTransition {
  state: TapTileGameplayState;
  events: GameplayEvent[];
}
