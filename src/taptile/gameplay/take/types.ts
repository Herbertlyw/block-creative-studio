import type { TapTileGameState, TapTileTransition } from '../types';

export interface TapTileTakeReplayResult {
  valid: boolean;
  states: TapTileGameState[];
  transitions: TapTileTransition[];
  error?: {
    actionIndex: number;
    code: string;
    message: string;
    tileId?: string;
    blockerIds?: string[];
  };
}

export interface TapTileTakeValidationIssue {
  code: string;
  message: string;
  actionIndex?: number;
  tileId?: string;
  blockerIds?: string[];
}

export interface TapTileTakeValidationResult {
  valid: boolean;
  issues: TapTileTakeValidationIssue[];
  replay: TapTileTakeReplayResult;
}
