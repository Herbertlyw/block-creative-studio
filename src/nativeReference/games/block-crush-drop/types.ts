import type { DropReferenceCalibration } from './profiles/referenceCalibration';
import type { EliminationResolutionTrace } from '../../game-runtime/eliminationResolutionTrace';

export interface BlockCrushDropCoordinate {
  x: number;
  y: number;
}

export interface BlockCrushDropCell extends BlockCrushDropCoordinate {
  id: string;
  kind: string;
  /** Runtime-authored rigid piece identity, retained after cuts. */
  groupId?: string;
}

export interface BlockCrushDropPieceDefinition {
  id: string;
  kind: string;
  cells: BlockCrushDropCoordinate[];
  allowedQuarterTurns: Array<0 | 1 | 2 | 3>;
}

export interface BlockCrushDropTrayPiece {
  pieceId: string;
  /** The source footage presents authored orientations; the player does not rotate them. */
  quarterTurns: 0 | 1 | 2 | 3;
}

/** A measured downward contact that covers, rather than deletes, real cells. */
export interface BlockCrushDropContactStack {
  cellId: string;
  landingInsetRows: 1 | 2;
  /** Exactly the cells occupying the destination; all identities survive. */
  coveredCellIds: string[];
}

export interface BlockCrushDropSettlementOverride {
  maxRowsPerClear?: number;
  /** Bounded completed-row batches per zero-based clear cycle; later cycles inherit the turn/global limit. */
  maxRowsPerClearByCycle?: number[];
  /** Select bounded completed-row batches from the lower or upper frontier. */
  clearRowOrder?: 'bottom-up' | 'top-down';
  cascadeLimit?: number;
  cascadeLimitBoundary?: 'after-gravity' | 'before-gravity';
  frontierReleaseLifetime?: 'persistent' | 'wave';
  /** Real cell identities released after compaction of each zero-based clear cycle. */
  releaseCellIdsByCycle?: string[][];
  /** Temporarily hold active cells during this cycle's gravity only. */
  holdCellIdsByCycle?: string[][];
  /** Detect a new row after each one-cell gravity pass instead of settling fully. */
  gravityStopByCycle?: Array<'settled' | 'first-completed-row'>;
  /** Explicit contacts after each clear's ordinary gravity. No cell is removed. */
  contactStackByCycle?: BlockCrushDropContactStack[][];
  /** Recheck only a full row immediately below this wave's lowest cleared row. */
  adjacentBelowClearCandidate?: boolean;
  /** Absolute canonical field clocks at each clear's gravity endpoint. */
  fieldTickByCycle?: number[];
}

/** Explicit reference reconstruction exception; ordinary collision remains the default. */
export interface BlockCrushDropPlacementOverride {
  /** Lower the collision-safe landing by this many rows, bounded to 0–2. */
  landingInsetRows?: number;
  /** Must equal every existing cell overlapped by the inset footprint exactly. */
  replaceCellIds?: string[];
}

export interface BlockCrushDropConfig {
  columns: number;
  rows: number;
  initialCells: BlockCrushDropCell[];
  pieces: BlockCrushDropPieceDefinition[];
  /** Ordered tray refreshes. Each batch exposes up to three independently selectable slots. */
  trayBatches: BlockCrushDropTrayPiece[][];
  rules: {
    pieceSource: 'three-slot-tray';
    placement: 'tray-drag-release-then-vertical-fall';
    rotation: 'fixed-from-tray';
    clear: 'newly-completed-horizontal-rows';
    gravity: 'vertical-after-release';
    /** Opt-in piece physics; cut-component-cascade releases connected piece fragments after a cut; piece-frontier-cascade releases current piece cells and old piece cells only above the removed rows; retained-piece-cascade keeps pieces rigid until a clear, then releases surviving old piece cells. Terrain retains its cavities. clear-frontier-cascade additionally releases the upper region supported by each removed row. */
    settlement?:
      | 'piece-frontier-cascade'
      | 'contact-clear-cascade'
      | 'split-settle-cascade'
      | 'retained-piece-cascade'
      | 'clear-frontier-cascade'
      | 'cut-component-cascade';
    /** Minimum simultaneous cleared rows that release the static upper terrain; default 1. */
    frontierReleaseMinRows?: number;
    /** Limit released terrain to columns occupied by retained cells from earlier turns. */
    frontierReleaseScope?: 'all-columns' | 'retained-piece-columns';
    /** Optional authored ceiling on cascade waves resolved by one release. */
    cascadeLimit?: number;
    cascadeLimitBoundary?: 'after-gravity' | 'before-gravity';
    frontierReleaseLifetime?: 'persistent' | 'wave';
    settlementByTurn?: BlockCrushDropSettlementOverride[];
    /** Zero-based semantic turns. Empty entries retain ordinary placement. */
    placementByTurn?: BlockCrushDropPlacementOverride[];
    /** Optional lower-to-upper batching of completed rows within a cascade. */
    maxRowsPerClear?: number;
    fieldMotion: {
      kind: 'continuous-rise';
      /** Canonical gameplay ticks required for the field to rise by one cell. */
      ticksPerCell: number;
      /** Optional canonical-tick intervals during which only field scrolling pauses. */
      pauses?: Array<{ startTick: number; endTick: number }>;
      /** Piecewise constant scrolling-rate multipliers; does not retime audio or actions. */
      rateChanges?: Array<{ startTick: number; multiplier: number }>;
      /** Bottom-up rows injected as the scrolling field crosses cell boundaries. */
      incomingRows: string[];
    };
    /**
     * Completed rows leave the logical grid. Every surviving cell above a
     * cleared row is shifted down by one row at the deterministic endpoint.
     * Fragmentation and the flexible falling sheet are presentation effects,
     * not a rigid-body rule solver.
     */
    collapse: 'compact-rows-above-clear';
    scoring: {
      placedCell: number;
      eliminatedCell: number;
      successiveClearMultiplier: number;
      chainMultiplier: number;
    };
  };
  presentation: {
    referenceCalibration?: DropReferenceCalibration;
    layout: 'top-queue-full-height' | 'side-tray-narrow';
    tile: 'embossed-star' | 'ivory-pyramid';
    hud: 'timer-score-queue' | 'score-progress';
  };
}

export interface BlockCrushDropState {
  config: BlockCrushDropConfig;
  cells: BlockCrushDropCell[];
  /** Surviving released pieces, retained across turns by the retained-piece and clear-frontier policies. */
  mobileCellIds?: string[];
  /** Actual same-coordinate contacts, preserved until gravity separates them. */
  contactStackGroups?: string[][];
  batchIndex: number;
  remainingTraySlots: number[];
  tick: number;
  riseOffsetTicks: number;
  incomingRowIndex: number;
  turn: number;
  score: number;
  combo: number;
  clearEventCount: number;
  status: 'playing' | 'won' | 'game-over';
}

export interface BlockCrushDropAction {
  /** Selects one of the currently visible tray slots. Piece and orientation come from the batch. */
  traySlot: number;
  /** Absolute canonical gameplay tick when the falling piece impacts. */
  impactTick: number;
  /** Logical release pose after the tray-to-board drag; gravity determines the final landing. */
  release: {
    x: number;
    y: number;
  };
}

export interface BlockCrushDropResolution {
  before: BlockCrushDropState;
  after: BlockCrushDropState;
  action: BlockCrushDropAction;
  trace: EliminationResolutionTrace;
}
