import type { PixelRect } from '../pixelGeometry';
import type { SceneThemeId, StackTemplateId, TileMaterialId } from '../stackModel';

export const TAPTILE_PROJECT_FORMAT = 'taptile-director-project' as const;
export const TAPTILE_SCHEMA_VERSION = '2.0.0' as const;
export const TAPTILE_RULE_PROFILE_ID = 'taptile-tray-match3-v1' as const;

export type TapTileRuleProfileId = typeof TAPTILE_RULE_PROFILE_ID;
export type FaceAssemblyMode = 'overlay-on-body' | 'full-front' | 'composed';
export type TapTileAssetKind = 'image' | 'sequence' | 'audio' | 'video';
export type TapTilePresentationRole = 'board' | 'flight' | 'tray' | 'match-ghost' | 'hud-preview';

export interface TapTileStageSpec {
  authoringWidth: 432;
  authoringHeight: 768;
  exportWidth: 1080;
  exportHeight: 1920;
  scale: 2.5;
  fps: 30;
  safeAreas: Record<string, PixelRect>;
}

export interface AssetManifestEntry {
  id: string;
  kind: TapTileAssetKind;
  source:
    | { type: 'builtin'; uri: string }
    | { type: 'indexeddb'; blobId: string };
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  contentHash?: string;
  version: string;
}

export interface AssetManifest {
  entries: Record<string, AssetManifestEntry>;
}

export interface TileArchetype {
  id: string;
  displayName: string;
  matchKey: string;
}

export interface FacePartTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  opacity: number;
}

export interface FacePart {
  id: string;
  source:
    | { kind: 'image'; assetId: string }
    | { kind: 'glyph'; value: string };
  transform: FacePartTransform;
  repeat?: {
    count: number;
    layout: 'row' | 'column' | 'grid' | 'custom';
    offsets?: Array<{ x: number; y: number }>;
  };
}

export interface FaceAssembly {
  id: string;
  name: string;
  mode: FaceAssemblyMode;
  bodyInteraction: 'show-body' | 'partially-cover-body' | 'replace-front-surface';
  parts: FacePart[];
}

export interface BodyStyle {
  id: string;
  name: string;
  bodyAssetId?: string;
  materialPresetId: string;
  cornerRadiusPx: number;
  borderWidthPx: number;
  shadowPresetId: string;
  fill?: string;
}

export interface ThemeVariantBinding {
  faceAssemblyId: string;
  bodyStyleId: string;
}

export interface ThemeVariant {
  id: string;
  name: string;
  bindings: Record<string, ThemeVariantBinding>;
}

export interface StageAssemblyLayer {
  id: string;
  role: 'base' | 'ambient' | 'foreground' | 'overlay' | 'hud' | 'tray';
  assetId?: string;
  color?: string;
  opacity: number;
}

export interface TileVisualLibrary {
  archetypes: Record<string, TileArchetype>;
  faceAssemblies: Record<string, FaceAssembly>;
  bodyStyles: Record<string, BodyStyle>;
  themes: Record<string, ThemeVariant>;
  selectedThemeId: string;
  stageAssemblies: Record<string, StageAssemblyLayer[]>;
  selectedStageAssemblyId: string;
}

export interface TileGameplayGeometry {
  centerXPx: number;
  centerYPx: number;
  widthPx: number;
  heightPx: number;
  rotationDeg: number;
  layer: number;
  order: number;
}

export interface TapTileInstanceSpec {
  id: string;
  archetypeId: string;
  geometry: TileGameplayGeometry;
  authoring: {
    editorLocked: boolean;
  };
}

export interface BlockerPolicy {
  minimumOverlapAreaPx: number;
  minimumOverlapRatio: number;
  epsilonPx: number;
}

export interface BlockerEdgeSpec {
  blockerId: string;
  blockedId: string;
}

export interface BlockerOverrides {
  forced: BlockerEdgeSpec[];
  ignored: BlockerEdgeSpec[];
}

export interface TapTileLevelSpec {
  id: string;
  name: string;
  tileInstances: TapTileInstanceSpec[];
  blockerPolicy: BlockerPolicy;
  blockerOverrides: BlockerOverrides;
}

export interface TapTileTakeAction {
  id: string;
  type: 'tap';
  actor: 'human' | 'agent' | 'script';
  tileId: string;
  startedAtFrame: number;
  durationFrames: number;
  pointerPath?: Array<{
    frameOffset: number;
    x: number;
    y: number;
  }>;
}

export interface TapTileTake {
  id: string;
  name: string;
  createdAt: string;
  levelHash: string;
  ruleProfileId: TapTileRuleProfileId;
  actions: TapTileTakeAction[];
  result: 'won' | 'lost' | 'unfinished';
  finalStateHash: string;
}

export interface TapTileDirectorTiming {
  pointerTravelFrames: number;
  pressFrames: number;
  flightFrames: number;
  trayReorderFrames: number;
  matchDelayFrames: number;
  matchVfxFrames: number;
  inputOverlapFrames: number;
}

export interface TapTileDirectorProfile {
  id: string;
  name: string;
  globalSpeed: number;
  betweenActionFrames: number;
  pointerStyle: 'natural' | 'direct' | 'urgent';
  tileFlightStyle: 'arc' | 'direct' | 'snap';
  trayMotionStyle: 'smooth' | 'tight' | 'elastic';
  matchStyle: 'burst' | 'shatter' | 'pulse';
  cameraStyle: 'steady' | 'impact' | 'rush';
  timing: TapTileDirectorTiming;
}

export interface TapTileDirectorProjectSpec {
  selectedProfileId: string;
  profiles: Record<string, TapTileDirectorProfile>;
  actionOverrides: Record<string, Partial<TapTileDirectorTiming>>;
  seed: number;
}

export interface TapTileRenderSpec {
  width: 1080;
  height: 1920;
  fps: 30;
  quality: 'preview' | 'standard' | 'cinematic';
}

export interface TapTileAuthoringSettings {
  templateId: StackTemplateId;
  material: TileMaterialId;
  sceneTheme: SceneThemeId;
  snap: boolean;
  snapGapPx: number;
  showLayerBadges: boolean;
  debugView: 'normal' | 'playability' | 'blockers' | 'single-layer';
}

export interface AudioCueRef {
  assetIds: string[];
  volume: number;
  startOffsetMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  delayFrames: number;
  peakLimit?: number;
}

export interface AudioPack {
  id: string;
  name: string;
  peakLimit?: number;
  tap: AudioCueRef;
  pickup?: AudioCueRef;
  traySettle: AudioCueRef;
  match: AudioCueRef;
  shatter?: AudioCueRef;
  warning?: AudioCueRef;
  win?: AudioCueRef;
  outro?: AudioCueRef;
}

export interface OutroPack {
  id: string;
  name: string;
  transitionId?: string;
  backgroundAssetId?: string;
  logoAssetId?: string;
  headline?: string;
  ctaLabel?: string;
  durationFrames: number;
}

export interface CutSpec {
  id: string;
  name: string;
  takeRange: {
    startActionIndex: number;
    endActionIndex: number;
  };
  timeWarpSegments?: Array<{
    sourceStartFrame: number;
    sourceEndFrame: number;
    speed: number;
  }>;
  introFrames?: number;
  outroPackId?: string;
  targetDurationFrames?: number;
}

export interface TapTileProductionSpec {
  audioPacks: Record<string, AudioPack>;
  selectedAudioPackId?: string;
  cuts: Record<string, CutSpec>;
  selectedCutId?: string;
  outros: Record<string, OutroPack>;
}

export interface TapTileProjectV2 {
  format: typeof TAPTILE_PROJECT_FORMAT;
  schemaVersion: typeof TAPTILE_SCHEMA_VERSION;
  id: string;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  ruleProfileId: TapTileRuleProfileId;
  stage: TapTileStageSpec;
  assets: AssetManifest;
  visuals: TileVisualLibrary;
  level: TapTileLevelSpec;
  takes: TapTileTake[];
  selectedTakeId?: string;
  director: TapTileDirectorProjectSpec;
  render: TapTileRenderSpec;
  authoring: TapTileAuthoringSettings;
  production: TapTileProductionSpec;
}

export type LevelValidationSeverity = 'error' | 'warning' | 'info';

export interface LevelValidationIssue {
  code: string;
  severity: LevelValidationSeverity;
  message: string;
  objectIds: string[];
  suggestion?: string;
}

export interface LevelValidationReport {
  valid: boolean;
  issues: LevelValidationIssue[];
  statistics: {
    tileCount: number;
    archetypeCount: number;
    edgeCount: number;
    playableCount: number;
  };
}

export interface CompiledTapTile {
  id: string;
  archetypeId: string;
  matchKey: string;
  geometry: TileGameplayGeometry;
}

export interface CompiledBlockerEdge {
  blockerId: string;
  blockedId: string;
  source: 'automatic' | 'forced';
  overlapAreaPx: number;
  overlapRatio: number;
}

export interface CompiledTapTileLevel {
  levelHash: string;
  ruleProfileId: TapTileRuleProfileId;
  tiles: Record<string, CompiledTapTile>;
  initialBoardIds: string[];
  blockersByTile: Record<string, string[]>;
  dependentsByTile: Record<string, string[]>;
  initialBlockerCount: Record<string, number>;
  initialPlayableIds: string[];
  blockerEdges: CompiledBlockerEdge[];
  validation: LevelValidationReport;
}
