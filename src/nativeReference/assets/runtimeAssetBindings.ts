import type { AgentImageTransform } from '../agent-assets/contracts';
import type { AssetManifest, MaterialPackManifest, ResolvedRenderPlan } from '../headless/contracts';
import { assetUriToContentHash } from './browserAssetStore';

export type BrowserAssetBindingRole =
  | 'background-image'
  | 'tile-face-image'
  | 'particle-sprite'
  | 'flipbook'
  | 'audio'
  | 'geometry-3d'
  | 'texture-map';

export type RuntimeImageFit = 'cover' | 'contain' | 'stretch';
export type RuntimeImageBlendMode =
  | 'source-over'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'soft-light';

export interface BrowserAssetManifestMetadata extends Record<string, unknown> {
  browserAsset: {
    role: BrowserAssetBindingRole;
    uri: string;
    fileName: string;
    mimeType: string;
    byteLength: number;
    width?: number;
    height?: number;
    fit?: RuntimeImageFit;
    opacity?: number;
    blendMode?: RuntimeImageBlendMode;
    inset?: number;
  };
}

export interface RuntimeImageAssetBinding {
  transform?: AgentImageTransform;
  slotId: string;
  role: 'background-image' | 'tile-face-image' | 'board-atlas-image' | 'tile-material-image' | 'ui-image' | 'particle-sprite' | 'texture-map';
  contentHash: string;
  sourceUri: string;
  objectUrl: string;
  fileName: string;
  mimeType: string;
  width?: number;
  height?: number;
  fit: RuntimeImageFit;
  opacity: number;
  blendMode: RuntimeImageBlendMode;
  inset: number;
}

export interface RuntimeBinaryAssetBinding {
  slotId: string;
  role: Exclude<BrowserAssetBindingRole, RuntimeImageAssetBinding['role']>;
  contentHash: string;
  sourceUri: string;
  objectUrl: string;
  fileName: string;
  mimeType: string;
}

export interface RuntimeAssetMissing {
  slotId: string;
  uri: string;
  reason:
    | 'invalid-metadata'
    | 'invalid-uri'
    | 'hash-mismatch'
    | 'blob-missing'
    | 'unsupported-binding';
}

export type RuntimeAssetBinding = RuntimeImageAssetBinding | RuntimeBinaryAssetBinding;

export interface RuntimeAssetBindings {
  revision: string;
  bySlot: Record<string, RuntimeAssetBinding[]>;
  missing: RuntimeAssetMissing[];
  readonly background: RuntimeImageAssetBinding | null;
  readonly tileFace: RuntimeImageAssetBinding | null;
  readonly boardAtlas: RuntimeImageAssetBinding | null;
  readonly particleSprites: RuntimeImageAssetBinding[];
  readonly textureMaps: RuntimeImageAssetBinding[];
  readonly binary: RuntimeBinaryAssetBinding[];
}

export interface RuntimeAssetBindingsInput {
  revision?: string;
  bySlot?: Record<string, RuntimeAssetBinding[]>;
  missing?: RuntimeAssetMissing[];
  background?: RuntimeImageAssetBinding | null;
  tileFace?: RuntimeImageAssetBinding | null;
  particleSprites?: RuntimeImageAssetBinding[];
  textureMaps?: RuntimeImageAssetBinding[];
  binary?: RuntimeBinaryAssetBinding[];
}

function isRuntimeImageBinding(binding: RuntimeAssetBinding): binding is RuntimeImageAssetBinding {
  return binding.role === 'background-image'
    || binding.role === 'tile-face-image'
    || binding.role === 'board-atlas-image'
    || binding.role === 'tile-material-image'
    || binding.role === 'ui-image'
    || binding.role === 'particle-sprite'
    || binding.role === 'texture-map';
}

function compareBindings(left: RuntimeAssetBinding, right: RuntimeAssetBinding): number {
  return left.slotId.localeCompare(right.slotId) || left.contentHash.localeCompare(right.contentHash) || left.role.localeCompare(right.role);
}

function pushBinding(bySlot: Record<string, RuntimeAssetBinding[]>, binding: RuntimeAssetBinding | null | undefined): void {
  if (!binding) return;
  const list = bySlot[binding.slotId] ?? [];
  list.push(binding);
  bySlot[binding.slotId] = list;
}

function imagesByRole(bindings: RuntimeAssetBindings, role: RuntimeImageAssetBinding['role']): RuntimeImageAssetBinding[] {
  return Object.values(bindings.bySlot)
    .flat()
    .filter((item): item is RuntimeImageAssetBinding => isRuntimeImageBinding(item) && item.role === role)
    .sort(compareBindings);
}

export function firstImageBinding(
  bindings: RuntimeAssetBindings,
  slotId: string,
): RuntimeImageAssetBinding | null {
  const list = bindings.bySlot[slotId] ?? [];
  for (const item of list) {
    if (isRuntimeImageBinding(item)) return item;
  }
  return null;
}

export function createRuntimeAssetBindings(input: RuntimeAssetBindingsInput = {}): RuntimeAssetBindings {
  const bySlot: Record<string, RuntimeAssetBinding[]> = {};
  if (input.bySlot) {
    for (const [slotId, list] of Object.entries(input.bySlot)) {
      bySlot[slotId] = [...list].sort(compareBindings);
    }
  }
  pushBinding(bySlot, input.background ?? null);
  pushBinding(bySlot, input.tileFace ?? null);
  for (const item of input.particleSprites ?? []) pushBinding(bySlot, item);
  for (const item of input.textureMaps ?? []) pushBinding(bySlot, item);
  for (const item of input.binary ?? []) pushBinding(bySlot, item);
  for (const slotId of Object.keys(bySlot)) {
    bySlot[slotId] = [...(bySlot[slotId] ?? [])].sort(compareBindings);
  }
  const missing = [...(input.missing ?? [])].sort((left, right) => (
    left.slotId.localeCompare(right.slotId) || left.uri.localeCompare(right.uri) || left.reason.localeCompare(right.reason)
  ));
  const bindings: RuntimeAssetBindings = {
    revision: input.revision ?? 'none',
    bySlot,
    missing,
    get background() {
      return firstImageBinding(bindings, 'background.base')
        ?? imagesByRole(bindings, 'background-image')[0]
        ?? null;
    },
    get tileFace() {
      return firstImageBinding(bindings, 'tile.face')
        ?? imagesByRole(bindings, 'tile-face-image')[0]
        ?? null;
    },
    get boardAtlas() {
      return firstImageBinding(bindings, 'board.atlas')
        ?? imagesByRole(bindings, 'board-atlas-image')[0]
        ?? null;
    },
    get particleSprites() {
      return imagesByRole(bindings, 'particle-sprite');
    },
    get textureMaps() {
      return imagesByRole(bindings, 'texture-map');
    },
    get binary() {
      return Object.values(bindings.bySlot)
        .flat()
        .filter((item): item is RuntimeBinaryAssetBinding => !isRuntimeImageBinding(item))
        .sort(compareBindings);
    },
  };
  return bindings;
}

export const EMPTY_RUNTIME_ASSET_BINDINGS: RuntimeAssetBindings = createRuntimeAssetBindings({ revision: 'none' });

export interface RuntimeAssetRequest {
  slotId: string;
  role: BrowserAssetBindingRole;
  contentHash: string;
  uri: string;
  manifest: AssetManifest;
  metadata: BrowserAssetManifestMetadata['browserAsset'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBindingRole(value: unknown): value is BrowserAssetBindingRole {
  return [
    'background-image',
    'tile-face-image',
    'particle-sprite',
    'flipbook',
    'audio',
    'geometry-3d',
    'texture-map',
  ].includes(String(value));
}

export function readBrowserAssetMetadata(
  manifest: AssetManifest,
): BrowserAssetManifestMetadata['browserAsset'] | null {
  if (!isRecord(manifest.metadata) || !isRecord(manifest.metadata.browserAsset)) return null;
  const source = manifest.metadata.browserAsset;
  if (
    !isBindingRole(source.role)
    || typeof source.uri !== 'string'
    || typeof source.fileName !== 'string'
    || typeof source.mimeType !== 'string'
    || typeof source.byteLength !== 'number'
  ) {
    return null;
  }
  const metadata: BrowserAssetManifestMetadata['browserAsset'] = {
    role: source.role,
    uri: source.uri,
    fileName: source.fileName,
    mimeType: source.mimeType,
    byteLength: source.byteLength,
  };
  if (typeof source.width === 'number') metadata.width = source.width;
  if (typeof source.height === 'number') metadata.height = source.height;
  if (source.fit === 'cover' || source.fit === 'contain' || source.fit === 'stretch') metadata.fit = source.fit;
  if (typeof source.opacity === 'number') metadata.opacity = source.opacity;
  if (
    source.blendMode === 'source-over'
    || source.blendMode === 'multiply'
    || source.blendMode === 'screen'
    || source.blendMode === 'overlay'
    || source.blendMode === 'soft-light'
  ) metadata.blendMode = source.blendMode;
  if (typeof source.inset === 'number') metadata.inset = source.inset;
  return metadata;
}

interface RuntimeAssetCandidate {
  slotId: string;
  manifest: AssetManifest;
}

function runtimeAssetCandidates(plan: ResolvedRenderPlan): RuntimeAssetCandidate[] {
  const candidates: RuntimeAssetCandidate[] = [];
  const directlySlotted = new Set<string>();
  for (const [slotId, resolved] of Object.entries(plan.slots)) {
    candidates.push({ slotId, manifest: resolved.manifest });
    directlySlotted.add(`${resolved.manifest.id}@${resolved.manifest.version}`);
  }
  for (const [key, resolved] of Object.entries(plan.assets ?? {})) {
    if (directlySlotted.has(key)) continue;
    candidates.push({ slotId: `asset:${key}`, manifest: resolved.manifest });
  }
  return candidates.sort((left, right) => left.slotId.localeCompare(right.slotId));
}

export function listRuntimeAssetSlotIds(plan: ResolvedRenderPlan | null): string[] {
  if (!plan) return [];
  return [...new Set(runtimeAssetCandidates(plan).map((item) => item.slotId))].sort();
}

export function collectRuntimeAssetReferenceIssues(
  plan: ResolvedRenderPlan | null,
): RuntimeAssetMissing[] {
  if (!plan) return [];
  const issues: RuntimeAssetMissing[] = [];
  for (const { slotId, manifest } of runtimeAssetCandidates(plan)) {
    const raw = isRecord(manifest.metadata)
      ? manifest.metadata.browserAsset
      : undefined;
    if (raw === undefined) continue;
    const metadata = readBrowserAssetMetadata(manifest);
    if (!metadata) {
      issues.push({
        slotId,
        uri: manifest.uri ?? '',
        reason: 'invalid-metadata',
      });
      continue;
    }
    const uri = manifest.uri ?? metadata.uri;
    const contentHash = assetUriToContentHash(uri);
    if (!contentHash) {
      issues.push({ slotId, uri, reason: 'invalid-uri' });
      continue;
    }
    if (manifest.contentHash && manifest.contentHash !== contentHash) {
      issues.push({ slotId, uri, reason: 'hash-mismatch' });
    }
  }
  return issues.sort((left, right) => left.slotId.localeCompare(right.slotId));
}

export function collectRuntimeAssetRequests(plan: ResolvedRenderPlan | null): RuntimeAssetRequest[] {
  if (!plan) return [];
  const requests: RuntimeAssetRequest[] = [];
  const seen = new Set<string>();
  const push = (request: RuntimeAssetRequest): void => {
    const key = request.role === 'texture-map'
      ? `${request.role}:${request.contentHash}`
      : `${request.role}:${request.contentHash}:${request.slotId}`;
    if (seen.has(key)) return;
    seen.add(key);
    requests.push(request);
  };
  for (const { slotId, manifest } of runtimeAssetCandidates(plan)) {
    const metadata = readBrowserAssetMetadata(manifest);
    if (metadata) {
      const uri = manifest.uri ?? metadata.uri;
      const contentHash = assetUriToContentHash(uri);
      if (!contentHash) continue;
      if (manifest.contentHash && manifest.contentHash !== contentHash) continue;
      push({
        slotId,
        role: metadata.role,
        contentHash,
        uri,
        manifest,
        metadata,
      });
      continue;
    }
    const uri = manifest.uri ?? '';
    const contentHash = assetUriToContentHash(uri);
    if (!contentHash) continue;
    if (manifest.kind !== 'bitmap' && manifest.kind !== 'texture-set') continue;
    push({
      slotId,
      role: 'texture-map',
      contentHash,
      uri,
      manifest,
      metadata: {
        role: 'texture-map',
        uri,
        fileName: `${manifest.id}.bin`,
        mimeType: 'application/octet-stream',
        byteLength: 0,
      },
    });
  }
  for (const { slotId, manifest } of runtimeAssetCandidates(plan)) {
    if (manifest.kind !== 'material-pack') continue;
    const pack = manifest as MaterialPackManifest;
    for (const [slot, ref] of Object.entries(pack.appearance.textureRefs ?? {})) {
      if (!ref) continue;
      const uri = ref.uri ?? '';
      const contentHash = assetUriToContentHash(uri);
      if (!contentHash) continue;
      if (ref.contentHash && ref.contentHash !== contentHash) continue;
      push({
        slotId: `${slotId}.${slot}`,
        role: 'texture-map',
        contentHash,
        uri,
        manifest: pack,
        metadata: {
          role: 'texture-map',
          uri,
          fileName: `${ref.id}.png`,
          mimeType: 'image/png',
          byteLength: 0,
        },
      });
    }
  }
  return requests.sort((left, right) => left.slotId.localeCompare(right.slotId));
}

export function runtimeBindingRevision(plan: ResolvedRenderPlan | null): string {
  if (!plan) return 'none';
  const identities = collectRuntimeAssetRequests(plan).map((request) => ({
    slotId: request.slotId,
    role: request.role,
    contentHash: request.contentHash,
    opacity: request.metadata.opacity,
    blendMode: request.metadata.blendMode,
    fit: request.metadata.fit,
    inset: request.metadata.inset,
  }));
  return `${plan.planHash}:${JSON.stringify(identities)}`;
}

export function imageBindingDefaults(
  request: RuntimeAssetRequest,
  objectUrl: string,
): RuntimeImageAssetBinding {
  const metadata = request.metadata;
  const role = request.role as RuntimeImageAssetBinding['role'];
  return {
    slotId: request.slotId,
    role,
    contentHash: request.contentHash,
    sourceUri: request.uri,
    objectUrl,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType,
    ...(metadata.width !== undefined ? { width: metadata.width } : {}),
    ...(metadata.height !== undefined ? { height: metadata.height } : {}),
    fit: metadata.fit ?? (role === 'background-image' ? 'cover' : 'contain'),
    opacity: Math.max(0, Math.min(1, metadata.opacity ?? (role === 'tile-face-image' ? 0.55 : 1))),
    blendMode: metadata.blendMode ?? (role === 'tile-face-image' ? 'multiply' : 'source-over'),
    inset: Math.max(0, Math.min(0.45, metadata.inset ?? (role === 'tile-face-image' ? 0.18 : 0))),
  };
}
