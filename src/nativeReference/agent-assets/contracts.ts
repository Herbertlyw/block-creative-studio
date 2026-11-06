import type {
  RuntimeImageBlendMode,
  RuntimeImageFit,
} from '../assets/runtimeAssetBindings';

export const AGENT_ASSET_EXTENSION_VERSION = '1.0.0' as const;

export type AgentImageMimeType = 'image/png' | 'image/jpeg';
export type AgentImageRole = 'background-image' | 'tile-face-image' | 'board-atlas-image' | 'texture-map' | 'particle-sprite' | 'tile-material-image' | 'ui-image' | 'effect-sequence';

export interface AgentAssetProvenance {
  sourcePath?: string;
  assetRef?: string;
  sourceRef?: string;
  originalSha256?: string;
  originalMimeType?: string;
  conversion?: string;
}

export interface AgentImageTransform {
  x?: number; y?: number; width?: number; height?: number;
  anchorX?: number; anchorY?: number; rotationDeg?: number; clipRadius?: number;
  layer?: number; visible?: boolean;
}

export interface AgentImageAsset {
  id: string;
  kind: 'image';
  sourceName: string;
  mimeType: AgentImageMimeType;
  encoding: 'base64';
  data: string;
  sha256: string;
  width: number;
  height: number;
  byteLength: number;
  provenance?: AgentAssetProvenance;
}

/**
 * Deterministic sequence playback. Elapsed frames come from the bound event's own
 * presentation window, so a seek renders the same sprite frame as sequential playback.
 */
export interface AgentSequencePlayback {
  startOffsetFrames: number;
  durationFrames: number | null;
  speed: number;
  loop: boolean;
  holdLastFrame: boolean;
}

export interface AgentSequenceFrame {
  data: string;
  sha256: string;
  byteLength: number;
}

/** Ordered transparent PNG frames stored as one asset, hashed frame by frame. */
export interface AgentSequenceAsset {
  id: string;
  kind: 'sequence';
  sourceName: string;
  mimeType: 'image/png';
  encoding: 'base64';
  fps: number;
  width: number;
  height: number;
  byteLength: number;
  sha256: string;
  frames: AgentSequenceFrame[];
  provenance?: AgentAssetProvenance;
}

/**
 * Where referenced bytes live. Every form carries the asset's `sha256` separately,
 * so a moved or replaced file is caught no matter which form is used.
 *
 * - `./assets/bg.png`            project-relative attachment (default; human-readable, zips as-is)
 * - `cas:sha256-<hex>`           local content-addressed store (optional; dedupes automatically)
 * - `lib://<assetRef>@sha256-<hex>`  element library (read-only until the upload interface lands)
 */
export type AgentAssetRefScheme = 'attachment' | 'cas' | 'library';

/**
 * An asset whose bytes are held outside the project JSON. `data` is deliberately
 * absent rather than optional: that makes every existing `.data` reader a compile
 * error, instead of a value that type-checks and fails at render time.
 */
export interface AgentAssetRefEntry {
  id: string;
  kind: 'image' | 'sequence';
  sourceName: string;
  mimeType: AgentImageMimeType;
  encoding: 'ref';
  /** Absent on sequences: each frame carries its own reference instead. */
  ref?: string;
  sha256: string;
  width: number;
  height: number;
  byteLength: number;
  /** Present only when `kind` is 'sequence'; one reference per frame, in order. */
  frames?: Array<{ ref: string; sha256: string; byteLength: number; encoding?: 'ref' }>;
  fps?: number;
  provenance?: AgentAssetProvenance;
}

export type AgentAssetEntry = AgentImageAsset | AgentSequenceAsset | AgentAssetRefEntry;

/** True when the asset's bytes must be fetched through a resolver. */
export function isAgentAssetRef(entry: AgentAssetEntry): entry is AgentAssetRefEntry {
  return entry.encoding === 'ref';
}

export function isAgentSequenceAsset(entry: AgentAssetEntry): entry is AgentSequenceAsset {
  return entry.kind === 'sequence' && entry.encoding !== 'ref';
}
export function isAgentImageAsset(entry: AgentAssetEntry): entry is AgentImageAsset {
  return entry.kind === 'image' && entry.encoding !== 'ref';
}
/** Kind test that ignores how the bytes are stored, for callers that go through a resolver. */
export function isAgentSequenceKind(entry: AgentAssetEntry): boolean {
  return entry.kind === 'sequence';
}
/**
 * Bytes are materialized in one Node-side step before a render, so anything that
 * reads `data` requires an already-inlined asset. Failing loudly here beats
 * silently rendering a hole, and keeps the browser path free of async resolution.
 */
export function requireInlineAgentAsset<T extends AgentAssetEntry>(
  entry: T,
  id = entry.id,
): Exclude<T, AgentAssetRefEntry> {
  if (entry.encoding === 'ref') throw new Error(`AGENT_ASSET_UNRESOLVED_REF: ${id}`);
  return entry as Exclude<T, AgentAssetRefEntry>;
}

/** Callers that only handle single stills state that explicitly instead of reading missing fields. */
export function requireAgentImageAsset(entry: AgentAssetEntry, id = entry.id): AgentImageAsset {
  if (entry.kind !== 'image') throw new Error(`AGENT_ASSET_IMAGE_REQUIRED: ${id}`);
  return requireInlineAgentAsset(entry, id) as AgentImageAsset;
}

export interface AgentImageBinding {
  slotId: string;
  assetId: string;
  role: AgentImageRole;
  fit: RuntimeImageFit;
  opacity: number;
  blendMode: RuntimeImageBlendMode;
  inset: number;
  transform?: AgentImageTransform;
  /** Present only for sequence slots; image slots reject it. */
  playback?: AgentSequencePlayback;
}

export interface AgentAssetExtensionV1 {
  version: typeof AGENT_ASSET_EXTENSION_VERSION;
  entries: Record<string, AgentAssetEntry>;
  bindings: Record<string, AgentImageBinding>;
}

export interface AgentAssetSlotDeclaration {
  slotId: string;
  title: string;
  role: AgentImageRole;
  /** A sequence slot consumes ordered frames on a real event; omitted means one still image. */
  assetKind?: 'image' | 'sequence';
  acceptedMimeTypes: readonly AgentImageMimeType[];
  defaultFit: RuntimeImageFit;
  allowedFits: readonly RuntimeImageFit[];
  allowedBlendModes: readonly RuntimeImageBlendMode[];
  allowInset: boolean;
  transform?: {
    units: 'canvas-normalized' | 'target-normalized' | 'pointer-normalized' | 'event-normalized';
    allowed: readonly (keyof AgentImageTransform)[];
    defaults: AgentImageTransform;
    notes: string;
  };
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  sequence?: {
    maxFrames: number;
    minFps: number;
    maxFps: number;
    anchor: string;
    playbackDefaults: AgentSequencePlayback;
  };
  consumer: {
    renderer: string;
    target: string;
    behavior: string;
    actualPixels: true;
  };
}

export interface AgentAssetGameDeclaration {
  gameId: string;
  version: '1.0.0';
  slots: readonly AgentAssetSlotDeclaration[];
}

export const AGENT_IMAGE_DEFAULT_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxWidth: 8192,
  maxHeight: 8192,
  maxPixels: 16_777_216,
} as const;

export const AGENT_ASSET_MAX_TOTAL_BYTES = 32 * 1024 * 1024;

/** Full-stage DCC sequences need a larger bounded package than still artwork. */
export function agentAssetTotalByteBudget(gameId: string): number {
  return gameId === 'block-crush-drop' ? 384 * 1024 * 1024 : AGENT_ASSET_MAX_TOTAL_BYTES;
}

export const AGENT_SEQUENCE_DEFAULT_LIMITS = {
  maxFrames: 120,
  minFps: 4,
  maxFps: 60,
  maxBytes: 12 * 1024 * 1024,
  maxWidth: 2048,
  maxHeight: 2048,
  maxPixels: 4_194_304,
} as const;

export const AGENT_SEQUENCE_DEFAULT_PLAYBACK: AgentSequencePlayback = {
  startOffsetFrames: 0, durationFrames: null, speed: 1, loop: false, holdLastFrame: false,
};

export function emptyAgentAssetExtension(): AgentAssetExtensionV1 {
  return { version: AGENT_ASSET_EXTENSION_VERSION, entries: {}, bindings: {} };
}
