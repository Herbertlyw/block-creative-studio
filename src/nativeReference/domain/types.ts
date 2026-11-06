export type { DiagnosticViewId, MaterialBehaviorProfile, MaterialRuntimeDescriptor, ReferencePassId } from '../headless/contracts';
import type {
  DiagnosticViewId,
  MaterialBehaviorProfile,
  MaterialRuntimeDescriptor,
  ReferencePassId,
} from '../headless/contracts';

export const BOARD_SIZE = 8;

export type TileColor = 'coral' | 'amber' | 'lime' | 'cyan' | 'blue' | 'violet' | 'rose';
export type Actor = 'human' | 'agent';
export type StudioMode = 'edit' | 'play' | 'replay' | 'render';
export type GameStatus = 'playing' | 'game-over';
export type MaterialPresetId = 'glossy-plastic' | 'candy-resin' | 'crystal-glass';
export type LightingPresetId = 'neutral-lookdev' | 'clean-studio' | 'soft-candy' | 'neon-contrast';
export type CameraPresetId = 'flat-gameplay' | 'premium-perspective' | 'dynamic-clear';
export type LookDevPresetId = 'neutral-lookdev' | 'balanced-cinematic' | 'high-energy';
export type FxPresetId = 'clean-pop' | 'crystal-shatter' | 'energy-burst';
export type RhythmPresetId = 'human-natural' | 'tight-fast' | 'suspense-burst' | 'combo-rush';
export type GeometryPresetId = 'soft-cube' | 'premium-beveled' | 'candy-rounded';
export type RenderBackendId =
  | 'reference-2d'
  | 'three-3d'
  | 'fixed-camera-cinematic'
  | 'moving-camera-cinematic';
export type ReferenceTileMaterialId = 'soft-bevel' | 'flat-matte' | 'candy-blast';
export type ReferenceTileFaceSetId = 'botanical-reference' | 'none';
export type ReferencePreviewFxId = 'full-line-tint' | 'cells-only';
export type ReferenceClearFxId =
  | 'sweep-score-spark'
  | 'sweep-only'
  | 'neon-shatter'
  | 'pixel-burst'
  | 'laser-slice'
  | 'fire-wave'
  | 'lightning-chain';
export type ReferenceFeedbackFxId = 'praise-combo' | 'score-only';
export type ReferenceAmbientFxId = 'garden-petals' | 'none';
/** 全屏光效档位(可叉乘): none=无, edge-glow=棋盘侧边霓虹, clear-bloom=全屏光爆, edge-glow+clear-bloom=两者叠加。 */
export type ReferenceScreenFxId = 'none' | 'edge-glow' | 'clear-bloom' | 'edge-glow+clear-bloom';
export type PraiseTierId = 'nice' | 'great' | 'amazing' | 'incredible' | 'fantastic' | 'unbelievable';
export type BlastPraiseTierId = 'good' | 'great' | 'amazing' | 'fantastic' | 'unbelievable';

/** candy-blast 皮肤评价档位: 场景视觉文字与 `block-placement.praise-<tier>` 音效事件共用同一判定。 */
export function blastPraiseTier(combo: number, lineCount: number): BlastPraiseTierId {
  if (combo >= 8 || lineCount >= 4) return 'unbelievable';
  if (combo >= 6 || lineCount >= 3) return 'fantastic';
  if (combo >= 4) return 'amazing';
  if (combo >= 3) return 'great';
  return 'good';
}

export interface GridCell { row: number; col: number }

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
  /** Explicit authored line rule; omitted preserves historical row-and-column clears. */
  clearAxes?: 'rows' | 'columns' | 'both';
  clearTrigger?: 'line-complete' | 'board-full';
  referenceClearRules?: Array<{turn:number;axes?:'rows'|'columns'|'both';trigger?:'line-complete'|'board-full'}>;
  pieces: PieceInstance[];
  /** Optional authored sequence of complete three-piece rounds, including round zero. */
  fixedPieceSupply?: PieceInstance[][];
  /** True only when the final authored round was consumed. */
  supplyExhausted?: boolean;
  seed: number;
  setIndex: number;
  turn: number;
  score: number;
  combo: number;
  status: GameStatus;
}

/** Viewport-normalized pointer coordinates plus a frame offset from drag start. */
export interface PointerSample { frameOffset: number; x: number; y: number }

export interface PlacementAction {
  id: string;
  actor: Actor;
  pieceId: string;
  anchor: GridCell;
  durationFrames: number;
  pointerPath: PointerSample[];
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

export interface ThreeLookDevStyle {
  id: LookDevPresetId;
  /** Multiplier over the lighting preset exposure. */
  exposure: number;
  /** Multiplier applied to material environment reflections. */
  environmentIntensity: number;
  /** Baseline bloom contribution outside clear events. */
  bloomStrength: number;
  bloomThreshold: number;
  bloomRadius: number;
  /** Additional bloom added only during a clear event. */
  clearBloomBoost: number;
}


export interface Reference2DStyleSpec {
  profile: 'block-garden-reference-v1';
  tileMaterial: ReferenceTileMaterialId;
  tileFaceSet: ReferenceTileFaceSetId;
  previewFx: ReferencePreviewFxId;
  clearFx: ReferenceClearFxId;
  feedbackFx: ReferenceFeedbackFxId;
  ambientFx: ReferenceAmbientFxId;
  /** 全屏光效(可选, 默认 none): clear-bloom = 消除时全屏径向光爆+光束。 */
  screenFx?: ReferenceScreenFxId;
  /** Optional vocabulary shared by rendered praise and voice events; legacy words remain the default. */
  praiseWords?: import('./praiseWords').PraiseWordMap;
  bestScore: number;
  /** Optional coordinated material-study theme. Legacy projects retain their palette. */
  materialTheme?: 'watermelon' | 'orange' | 'kiwi' | 'dragonfruit' | 'cheese' | 'chocolate' | 'ice' | 'gold' | 'celadon' | 'amethyst' | 'pearl' | 'midnight';
  /** Visual seam in reference design pixels; grid centers and game geometry do not change. */
  cellGapPx?: number;
}

export interface ShotExecution {
  cameraProfileId: string;
  layoutProfileId: string;
  designResolution: { width: number; height: number };
  layoutDesignResolution?: { width: number; height: number };
  compositionAspect: number;
  boardScreenRect: { x: number; y: number; width: number; height: number };
  maximumScreenZoom: number;
  verticalFovDegrees: number;
  contentWidth: number;
  contentHeight: number;
  widthFill: number;
  heightFill: number;
  baseDistance: number;
  lookAt: readonly [number, number, number];
  cameraOffset: { x: number; y: number };
  cameraMotionMode: 'fixed' | 'keyframed' | 'event-driven';
  cameraTimeBase: 'presentation-frame';
  poseSource: 'plan' | 'fallback-fixed-shot';
  fovSource: 'plan' | 'fallback-fixed-shot';
  cameraFieldsFromPlan: {
    designResolution: boolean;
    boardScreenRect: boolean;
    maximumScreenZoom: boolean;
  };
  layoutFieldsFromPlan: {
    designResolution: boolean;
  };
}

export interface StyleSpec {
  renderer: RenderBackendId;
  reference2d: Reference2DStyleSpec;
  material: MaterialPresetId;
  lighting: LightingPresetId;
  camera: CameraPresetId;
  fx: FxPresetId;
  geometry: GeometryStyle;
  lookDev: ThreeLookDevStyle;
  background: string;
  showPointer: boolean;
  diagnosticView?: DiagnosticViewId;
  enabledPasses?: ReferencePassId[];
  materialRuntime?: MaterialRuntimeDescriptor;
  materialBehavior?: MaterialBehaviorProfile;
  shotExecution?: ShotExecution;
}

export interface RenderSpec {
  width: number;
  height: number;
  fps: number;
  quality: 'preview' | 'standard' | 'cinematic';
}

export interface ProjectSpec {
  audio?: import('../agent-director/contracts').ProductionAudio;
  schemaVersion: '1.0.0';
  id: string;
  name: string;
  ruleProfile: 'block-placement-classic-v1';
  seed: number;
  setupBoard: BoardState;
  setupPieces: PieceInstance[];
  fixedPieceSupply?: PieceInstance[][];
  clearAxes?: 'rows' | 'columns' | 'both';
  clearTrigger?: 'line-complete' | 'board-full';
  referenceClearRules?: Array<{turn:number;axes?:'rows'|'columns'|'both';trigger?:'line-complete'|'board-full'}>;
  style: StyleSpec;
  rhythm: RhythmProfile;
  render: RenderSpec;
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

export interface ClearingFrame { clear: ClearResult; progress: number; seed: number }

export interface PlacementFeedbackFrame {
  cells: Array<GridCell & { color: TileColor }>;
  progress: number;
  placementPoints: number;
}

export interface PresentationFrame {
  praiseWord?: import('./praiseWords').PraiseWord;
  frame: number;
  fps: number;
  totalFrames?: number;
  /** Stable semantic action identity for event de-duplication across presentation frames. */
  currentActionId?: string;
  snapshot: GameSnapshot;
  board: BoardState;
  hiddenPieceId?: string;
  draggedPiece?: { piece: PieceInstance; anchor: GridCell; progress: number; pointerDriven?: boolean };
  pointer?: { x: number; y: number; pressed: boolean };
  placementFeedback?: PlacementFeedbackFrame;
  clearing?: ClearingFrame;
  cameraPunch: number;
}
