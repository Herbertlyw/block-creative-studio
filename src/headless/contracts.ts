/**
 * Renderer- and Agent-neutral contracts for Block Creative Studio's headless core.
 *
 * The upstream creator may be a human, an external Agent, a DCC application, or
 * a procedural tool. Once an artifact crosses this boundary it must be versioned,
 * validated and deterministic enough for batch rendering.
 */

export const BCS_CONTRACT_VERSION = '1.0.0' as const;

export type HeadlessRendererId =
  | 'reference-2d'
  | 'fixed-camera-cinematic'
  | 'three-3d';

export type AssetOrigin =
  | 'builtin'
  | 'uploaded'
  | 'generated'
  | 'project'
  | 'external-dcc';

export type AssetKind =
  | 'bitmap'
  | 'vector'
  | 'font'
  | 'audio'
  | 'texture-set'
  | 'geometry-3d'
  | 'animation-asset'
  | 'material-pack'
  | 'effect-pack'
  | 'look-pack'
  | 'plugin-package'
  | 'camera-profile'
  | 'board-skin'
  | 'tile-face'
  | 'background'
  | 'ui-theme';

export interface AssetRef {
  id: string;
  version: string;
  kind: AssetKind;
  contentHash?: string;
}

/** Texture binding on a Material Pack: AssetRef plus optional runtime URI/channel metadata. */
export interface MaterialTextureRef extends AssetRef {
  uri?: string;
  channels?: TextureChannel;
  colorSpace?: ColorSpaceTag;
  normalY?: NormalYConvention;
}

export interface RuntimeBudget {
  textureMemoryMiB?: number;
  triangleCount?: number;
  pluginMemoryMiB?: number;
}

export interface AssetRuntimeContract {
  renderers: HeadlessRendererId[];
  deterministic: boolean;
  budget?: RuntimeBudget;
}

export interface AssetProvenance {
  createdBy?: 'human' | 'external-agent' | 'tool' | 'dcc';
  generator?: string;
  prompt?: string;
  seed?: number;
  sourceUris?: string[];
}


export interface FixedCameraAssetMetadata {
  designResolution: { width: number; height: number };
  boardScreenRect?: { x: number; y: number; width: number; height: number };
  allowOrbit: false;
  allowTransformAnimation?: false;
  maximumScreenZoom?: number;
  maximumScreenTranslationPx?: number;
  maximumScreenRotationDegrees?: number;
}

export interface AssetManifestBase<K extends AssetKind = AssetKind> {
  contract: 'bcs.asset-manifest';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  id: string;
  version: string;
  kind: K;
  origin: AssetOrigin;
  label?: string;
  contentHash?: string;
  uri?: string;
  runtime: AssetRuntimeContract;
  /** Explicit immutable dependencies not represented by a typed sub-contract. */
  dependencies?: AssetRef[];
  provenance?: AssetProvenance;
  metadata?: Record<string, unknown>;
}

export type MaterialClass =
  | 'metal'
  | 'wood'
  | 'glass'
  | 'stone'
  | 'jade'
  | 'plastic'
  | 'jelly'
  | 'ceramic'
  | 'fabric'
  | 'custom';

export interface MaterialAppearanceProfile {
  baseColor: string;
  roughness: number;
  metalness: number;
  specular?: number;
  clearcoat?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
  normalStrength?: number;
  emission?: number;
  textureRefs?: Partial<Record<
    'baseColor' | 'normal' | 'roughness' | 'metallic' | 'height' | 'ao' | 'emission' | 'opacity' | 'orm',
    MaterialTextureRef
  >>;
}

export type FractureMode =
  | 'none'
  | 'chips'
  | 'plates'
  | 'radial-shards'
  | 'chunks'
  | 'splinters'
  | 'soft-tear'
  | 'droplets'
  | 'custom';

export interface MaterialBehaviorProfile {
  materialClass: MaterialClass;
  density: number;
  brittleness: number;
  ductility: number;
  elasticity: number;
  hardness: number;
  fractureMode: FractureMode;
  largeFragmentRatio: number;
  dustAmount: number;
  sparkAmount: number;
  dropletAmount: number;
  gravityScale: number;
  drag: number;
}

export interface MaterialPackManifest extends AssetManifestBase<'material-pack'> {
  appearance: MaterialAppearanceProfile;
  behavior: MaterialBehaviorProfile;
}

export type CinematicEventType =
  | 'placement'
  | 'line-clear'
  | 'cross-clear'
  | 'combo'
  | 'all-clear'
  | 'game-over';

export type EffectLayerRole =
  | 'anticipation'
  | 'energy'
  | 'material-response'
  | 'tile-exit'
  | 'large-fragments'
  | 'small-fragments'
  | 'particles'
  | 'lighting-reaction'
  | 'screen-feedback'
  | 'audio';

export type EffectLayerImplementation =
  | 'recipe'
  | 'shader'
  | 'sprite'
  | 'flipbook'
  | 'geometry'
  | 'transform-track'
  | 'audio-asset'
  | 'plugin';

export interface EffectLayerSpec {
  id: string;
  role: EffectLayerRole;
  implementation: EffectLayerImplementation;
  required: boolean;
  assetRef?: AssetRef;
  parameters?: Record<string, string | number | boolean>;
}

export interface EffectPackManifest extends AssetManifestBase<'effect-pack'> {
  supportedEvents: CinematicEventType[];
  compatibleMaterialClasses: Array<MaterialClass | '*'>;
  layers: EffectLayerSpec[];
}

export type PluginRuntime = 'web-worker' | 'node-worker' | 'wasm';
export type PluginPermission =
  | 'network'
  | 'filesystem-read'
  | 'filesystem-write'
  | 'process-spawn'
  | 'dom';

export interface PluginPackageManifest extends AssetManifestBase<'plugin-package'> {
  apiVersion: '1';
  executionRuntime: PluginRuntime;
  entry: string;
  inputSchemaRef: string;
  outputSchemaRef: string;
  timeoutMs: number;
  permissions: PluginPermission[];
}

export type LookSlotId =
  | 'background.base'
  | 'background.reaction'
  | 'board.skin'
  | 'tile.material'
  | 'tile.face'
  | 'interaction.preview'
  | 'placement.confirmation'
  | 'clear.primary'
  | 'clear.secondary'
  | 'hud.current-score'
  | 'feedback.praise'
  | 'feedback.combo'
  | 'endgame.presentation'
  | 'postprocess.grade'
  | 'audio.pack'
  | (string & {});

export interface LookPackManifest extends AssetManifestBase<'look-pack'> {
  slots: Record<string, AssetRef>;
}

export type GenericAssetKind = Exclude<AssetKind, 'material-pack' | 'effect-pack' | 'look-pack' | 'plugin-package'>;
export type GenericAssetManifest = AssetManifestBase<GenericAssetKind>;

export type AssetManifest =
  | MaterialPackManifest
  | EffectPackManifest
  | LookPackManifest
  | PluginPackageManifest
  | GenericAssetManifest;

export interface OutputSpec {
  width: number;
  height: number;
  fps: number;
  quality: 'preview' | 'standard' | 'cinematic';
}

export interface CreativeMaster {
  contract: 'bcs.creative-master';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  id: string;
  ruleProfile: string;
  board: { rows: number; cols: number };
  replay: {
    takeId: string;
    semanticHash: string;
    frameHash?: string;
    fps: number;
    totalFrames: number;
  };
  layoutProfileRef: AssetRef;
  cameraProfileRef: AssetRef;
  baseOutput: OutputSpec;
}

export type VariantLockMode = 'frame-exact' | 'semantic' | 'rule-only';

export interface VariantRecipe {
  contract: 'bcs.variant-recipe';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  id: string;
  masterId: string;
  lockMode: VariantLockMode;
  lookPackRef: AssetRef;
  slotOverrides?: Record<string, AssetRef>;
  directorOverrides?: Record<string, string | number | boolean>;
  outputOverrides?: Partial<OutputSpec>;
  seed: number;
}

export interface ResolvedAsset {
  ref: AssetRef;
  manifest: AssetManifest;
}

export interface ResolvedRenderPlan {
  contract: 'bcs.resolved-render-plan';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  id: string;
  masterId: string;
  variantId: string;
  lockMode: VariantLockMode;
  renderer: HeadlessRendererId;
  replay: CreativeMaster['replay'];
  layoutProfile: ResolvedAsset;
  cameraProfile: ResolvedAsset;
  lookPack: ResolvedAsset;
  slots: Record<string, ResolvedAsset>;
  /** Complete resolved dependency closure, keyed by id@version. */
  assets?: Record<string, ResolvedAsset>;
  /** Topological dependency order; dependencies appear before consumers. */
  dependencyOrder?: AssetRef[];
  directorOverrides: Record<string, string | number | boolean>;
  output: OutputSpec;
  seed: number;
  planHash: string;
  warnings: string[];
}

export type ContractIssueSeverity = 'warning' | 'error';

export interface ContractIssue {
  code: string;
  severity: ContractIssueSeverity;
  message: string;
  path?: string;
  recoverable: boolean;
}

export interface QualityReport {
  contract: 'bcs.quality-report';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  planId: string;
  passed: boolean;
  issues: ContractIssue[];
  metrics: {
    assetCount: number;
    textureMemoryMiB: number;
    triangleCount: number;
    pluginMemoryMiB: number;
  };
}

export type ResourceReadiness = 'pending' | 'ready' | 'failed' | 'released';

export type ReferencePassId =
  | 'background'
  | 'board'
  | 'tile'
  | 'tray'
  | 'interaction'
  | 'placement'
  | 'clear'
  | 'feedback'
  | 'endgame';

export const REFERENCE_PASS_ORDER: readonly ReferencePassId[] = [
  'background',
  'board',
  'tile',
  'tray',
  'interaction',
  'placement',
  'clear',
  'feedback',
  'endgame',
] as const;

export type DiagnosticViewId =
  | 'beauty'
  | 'albedo'
  | 'world-normal'
  | 'roughness'
  | 'metalness'
  | 'emission'
  | 'bloom-contribution'
  | 'highlight-clip';

export type FrameTimeBase = 'presentation-frame' | 'source-pts' | 'wall-clock-forbidden';

export interface FrameRenderRequest {
  contract: 'bcs.frame-render-request';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  planId: string;
  planHash: string;
  takeId: string;
  takeHash: string;
  frameIndex: number;
  fps: number;
  renderer: HeadlessRendererId;
  targetPixels: { width: number; height: number };
  coordinateSpace: 'design' | 'video';
  timeBase: FrameTimeBase;
  diagnosticView: DiagnosticViewId;
  enabledPasses: ReferencePassId[];
  requireResources: boolean;
}

export interface PreparedResourceSlot {
  slotId: string;
  uri: string;
  contentHash: string;
  readiness: ResourceReadiness;
  byteLength?: number;
}

export interface PreparedResources {
  contract: 'bcs.prepared-resources';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  planHash: string;
  readiness: ResourceReadiness;
  slots: PreparedResourceSlot[];
  missing: Array<{ slotId: string; uri: string; reason: string }>;
}

export interface FrameRenderResult {
  contract: 'bcs.frame-render-result';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  request: FrameRenderRequest;
  status: 'rendered' | 'failed' | 'blocked';
  width: number;
  height: number;
  warnings: string[];
  error?: ContractIssue;
}

export type CalibrationCorrespondence =
  | 'exact-replay'
  | 'state-matched'
  | 'isolated-presentation';

export type CalibrationReviewStatus =
  | 'PASS'
  | 'FAIL'
  | 'BLOCKED'
  | 'NOT_COMPARABLE'
  | 'NOT_RUN';

export interface CalibrationRoi {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CalibrationCase {
  contract: 'bcs.calibration-case';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  id: string;
  referenceMediaHash?: string;
  sourceFrameIndex?: number;
  sourcePtsSeconds?: number;
  sourceTimeBase?: string;
  targetTakeHash?: string;
  isolatedFixtureHash?: string;
  targetFrame: number;
  targetFps: number;
  eventId: string;
  eventType: string;
  correspondence: CalibrationCorrespondence;
  roi: CalibrationRoi[];
  excludedRegions: CalibrationRoi[];
  reviewStatus: CalibrationReviewStatus;
  unresolvedReasons: string[];
}

export type ColorSpaceTag = 'srgb' | 'linear';
export type NormalYConvention = 'opengl' | 'directx' | 'unspecified';
export type TextureChannel = 'r' | 'g' | 'b' | 'a' | 'rgb' | 'rgba';
export type MaterialCapabilityState = 'supported' | 'pending' | 'unsupported';

export interface MaterialMapBinding {
  slot: 'baseColor' | 'normal' | 'roughness' | 'metallic' | 'ao' | 'emission' | 'orm';
  uri: string;
  contentHash: string;
  colorSpace: ColorSpaceTag;
  channels: TextureChannel;
  normalY?: NormalYConvention;
}

export interface MaterialUvTransform {
  repeat: [number, number];
  offset: [number, number];
  rotationRadians: number;
}

export interface MaterialRuntimeDescriptor {
  contract: 'bcs.material-runtime';
  contractVersion: typeof BCS_CONTRACT_VERSION;
  id: string;
  version: string;
  contentHash: string;
  materialClass: MaterialClass;
  baseColor: string;
  roughness: number;
  metalness: number;
  specular?: number;
  clearcoat?: number;
  transmission?: number;
  ior?: number;
  thickness?: number;
  normalStrength?: number;
  emission?: number;
  maps: MaterialMapBinding[];
  uv: MaterialUvTransform;
  combine: 'multiply-factor' | 'replace';
  capabilities: {
    heightDisplacement: MaterialCapabilityState;
    anisotropy: MaterialCapabilityState;
    subsurface: MaterialCapabilityState;
    complexTransmission: MaterialCapabilityState;
    materialAwareFracture: MaterialCapabilityState;
  };
  unsupportedFields: string[];
  behaviorPending: true;
}
