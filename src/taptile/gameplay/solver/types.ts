import type { TapTileTake } from '../../project';
import type { TapTileAction } from '../types';
import type { TapTileTakeValidationResult } from '../take';

export type TapTileScenarioProfileId =
  | 'max-clear'
  | 'safe-win'
  | 'danger-rescue'
  | 'combo-heavy'
  | 'fast-clear'
  | 'intentional-fail';

export interface TapTileScenarioProfile {
  id: TapTileScenarioProfileId;
  name: string;
  description: string;
}

export interface SolveTapTileOptions {
  profile?: TapTileScenarioProfileId;
  seed?: number;
  beamWidth?: number;
  maxDepth?: number;
  maxExpandedStates?: number;
}

export type TapTileSolveTerminationReason =
  | 'goal'
  | 'theoretical-maximum'
  | 'state-budget'
  | 'depth-limit'
  | 'frontier-exhausted'
  | 'canceled'
  | 'time-budget'
  | 'invalid-level'
  | 'no-triples';

export interface TapTileSolveProgress {
  profile: TapTileScenarioProfileId;
  depth: number;
  maxDepth: number;
  frontierSize: number;
  expandedStates: number;
  stateBudget: number;
  bestClearedTileCount: number;
  theoreticalClearableTileCount: number;
  bestActionCount: number;
  peakTrayOccupancy: number;
  elapsedMs: number;
}

/**
 * Cooperative browser search options. `yieldEvery` bounds how much work may run
 * before control is returned to the event loop, so cancellation is real rather
 * than a cosmetic wrapper around the synchronous solver.
 */
export interface SolveTapTileAnytimeOptions extends SolveTapTileOptions {
  signal?: AbortSignal;
  timeBudgetMs?: number;
  yieldEvery?: number;
  onProgress?: (progress: TapTileSolveProgress) => void | Promise<void>;
}

export interface TapTileSolveMetrics {
  clearedTileCount: number;
  theoreticalClearableTileCount: number;
  remainingBoardCount: number;
  trayOccupancy: number;
  peakTrayOccupancy: number;
  matchCount: number;
  unlockedCount: number;
  provedMaximum: boolean;
}

export interface SolveResult {
  status: 'solved' | 'partial' | 'not-found' | 'invalid-level';
  actions?: TapTileAction[];
  expandedStates: number;
  terminationReason?: TapTileSolveTerminationReason;
  finalStateHash?: string;
  metrics?: TapTileSolveMetrics;
  diagnostic?: string;
}

export interface SolveTakeResult extends SolveResult {
  take?: TapTileTake;
  validation?: TapTileTakeValidationResult;
}
