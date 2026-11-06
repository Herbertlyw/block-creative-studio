export const BOARD_SIZE = 8;

export type TileColor = 'coral' | 'amber' | 'lime' | 'cyan' | 'blue' | 'violet' | 'rose';
export type ClearAxes = 'rows' | 'columns' | 'both';
export type SeedSupplyVersion = 'reference-worktree-0f237a8f';
export type ClearTrigger = 'line-complete' | 'board-full';
export interface ReferenceClearRule {
  turn: number;
  axes?: ClearAxes;
  trigger?: ClearTrigger;
}
export type Actor = 'human' | 'agent';
export type StudioMode = 'edit' | 'play' | 'replay' | 'render';
export type GameStatus = 'playing' | 'game-over';
export type MaterialPresetId = 'glossy-plastic' | 'candy-resin' | 'crystal-glass';
export type LightingPresetId = 'clean-studio' | 'soft-candy' | 'neon-contrast';
export type CameraPresetId = 'flat-gameplay' | 'premium-perspective' | 'dynamic-clear';
export type FxPresetId = 'clean-pop' | 'crystal-shatter' | 'energy-burst';
export type RhythmPresetId = 'human-natural' | 'tight-fast' | 'suspense-burst' | 'combo-rush';
export type GeometryPresetId = 'soft-cube' | 'premium-beveled' | 'candy-rounded';
export type RenderBackendId = 'reference-2d' | 'three-3d';
export type ReferenceTileMaterialId = 'soft-bevel' | 'flat-matte';
export type ReferenceTileFaceSetId = 'botanical-reference' | 'none';
export type ReferencePreviewFxId = 'full-line-tint' | 'cells-only';
export type ReferenceClearFxId = 'sweep-score-spark' | 'sweep-only';
export type ReferenceFeedbackFxId = 'praise-combo' | 'score-only';
export type ReferenceAmbientFxId = 'garden-petals' | 'none';

export interface GridCell {
  row: number;
  col: number;
}

export interface BoardState {
  rows: number;
  cols: number;
  cells: Array<Array<TileColor | null>>;
}

export interface PieceShape {
  id: string;
  label: string;
  cells: Array<[number, number]>;
}

export interface PieceInstance {
  id: string;
  shapeId: string;
  color: TileColor;
  used: boolean;
  setIndex: number;
  slotIndex: number;
  /** Optional per-cell colors in the same order as PieceShape.cells. */
  cellColors?: TileColor[];
}

export interface GameSnapshot {
  board: BoardState;
  /** Omitted means historical row-and-column clears. */
  clearAxes?: ClearAxes;
  clearTrigger?: ClearTrigger;
  referenceClearRules?: ReferenceClearRule[];
  pieces: PieceInstance[];
  /** Authored rounds, including round zero. Absent means seeded refresh. */
  fixedPieceSupply?: PieceInstance[][];
  /** Absent retains the public V1 seeded generator. */
  seedSupplyVersion?: SeedSupplyVersion;
  supplyExhausted?: boolean;
  seed: number;
  setIndex: number;
  turn: number;
  score: number;
  combo: number;
  status: GameStatus;
}

/** Viewport-normalized pointer coordinates plus a frame offset from drag start. */
export interface PointerSample {
  frameOffset: number;
  x: number;
  y: number;
}

export interface PlacementAction {
  id: string;
  actor: Actor;
  pieceId: string;
  anchor: GridCell;
  durationFrames: number;
  pointerPath: PointerSample[];
  /** Explicit user-authored agent paths are retained instead of regenerated. */
  pointerPathMode?: 'authored';
}

export interface ClearResult {
  rows: number[];
  cols: number[];
  cells: Array<GridCell & { color: TileColor }>;
}

export interface GameTransition {
  before: GameSnapshot;
  placedBoard: BoardState;
  after: GameSnapshot;
  action: PlacementAction;
  clear: ClearResult;
  placementPoints: number;
  clearBonusPoints: number;
  points: number;
}

export interface Take {
  id: string;
  name: string;
  createdAt: string;
  initial: GameSnapshot;
  actions: PlacementAction[];
}

export interface RhythmProfile {
  id: RhythmPresetId;
  label: string;
  description: string;
  globalSpeed: number;
  dragFrames: number;
  pickupDelayFrames: number;
  placementSettleFrames: number;
  betweenActionFrames: number;
  clearDelayFrames: number;
  clearDurationFrames: number;
  cameraRecoveryFrames: number;
  easing: 'easeOutCubic' | 'easeInOutCubic' | 'easeOutBack';
}

export interface GeometryStyle {
  id: GeometryPresetId;
  depth: number;
  bevel: number;
  gap: number;
}

export interface Reference2DStyleSpec {
  profile: 'block-garden-reference-v1';
  tileMaterial: ReferenceTileMaterialId;
  tileFaceSet: ReferenceTileFaceSetId;
  previewFx: ReferencePreviewFxId;
  clearFx: ReferenceClearFxId;
  feedbackFx: ReferenceFeedbackFxId;
  ambientFx: ReferenceAmbientFxId;
  /** Omitted preserves the historical 2D background. */
  backgroundColor?: string;
  bestScore: number;
}

export interface StyleSpec {
  renderer: RenderBackendId;
  reference2d: Reference2DStyleSpec;
  material: MaterialPresetId;
  lighting: LightingPresetId;
  camera: CameraPresetId;
  fx: FxPresetId;
  geometry: GeometryStyle;
  background: string;
  showPointer: boolean;
}

export interface RenderSpec {
  width: number;
  height: number;
  fps: number;
  quality: 'preview' | 'standard' | 'cinematic';
}

/** Public-studio generated tones. This is not the workbench ProductionAudio contract. */
export interface StudioTestAudio {
  enabled: boolean;
  sfxGain: number;
  bgmGain?: number;
  /** Seconds into the exported timeline before the bed starts. */
  bgmStartSeconds?: number;
  /** Seconds skipped from the start of the generated bed. */
  bgmSourceOffsetSeconds?: number;
  bgmLoop?: boolean;
  /** Omitted preserves the historical 110 Hz test bed. */
  bgmPattern?: 'melody-v1';
  cueOverrides?: Array<{
    kind: 'place' | 'line-cleared' | 'cross-cleared' | 'praise' | 'game-over';
    eventId?: string;
    gain: number;
    offsetSeconds: number;
  }>;
}

export interface ProjectSpec {
  schemaVersion: '1.0.0';
  id: string;
  name: string;
  ruleProfile: 'block-placement-classic-v1';
  seed: number;
  setupBoard: BoardState;
  setupPieces: PieceInstance[];
  style: StyleSpec;
  rhythm: RhythmProfile;
  render: RenderSpec;
  audio?: StudioTestAudio;
  clearAxes?: ClearAxes;
  clearTrigger?: ClearTrigger;
  referenceClearRules?: ReferenceClearRule[];
  fixedPieceSupply?: PieceInstance[][];
  /** Absent retains the public V1 seeded generator. */
  seedSupplyVersion?: SeedSupplyVersion;
}

export interface LegalMove {
  pieceId: string;
  anchor: GridCell;
  immediateLines: number;
  clearedCells: number;
  heuristic: number;
}

export interface CompiledAction {
  action: PlacementAction;
  transition: GameTransition;
  startFrame: number;
  releaseFrame: number;
  clearStartFrame: number;
  clearEndFrame: number;
  endFrame: number;
}

export interface CompiledTake {
  id: string;
  fps: number;
  totalFrames: number;
  actions: CompiledAction[];
  initial: GameSnapshot;
  final: GameSnapshot;
}

export interface ClearingFrame {
  clear: ClearResult;
  progress: number;
  seed: number;
}

export interface PlacementFeedbackFrame {
  cells: Array<GridCell & { color: TileColor }>;
  progress: number;
  placementPoints: number;
}

export interface PresentationFrame {
  frame: number;
  fps: number;
  totalFrames?: number;
  /** Source action identity for semantic events; stable across all frames of one action. */
  currentActionId?: string;
  snapshot: GameSnapshot;
  board: BoardState;
  hiddenPieceId?: string;
  draggedPiece?: {
    piece: PieceInstance;
    anchor: GridCell;
    progress: number;
    pointerDriven?: boolean;
  };
  pointer?: { x: number; y: number; pressed: boolean };
  placementFeedback?: PlacementFeedbackFrame;
  clearing?: ClearingFrame;
  cameraPunch: number;
}
