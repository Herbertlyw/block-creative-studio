import { stableHash, type AssetManifestEntry, type TapTileProjectV2 } from '../project';
import { resolveTapTileBuiltinAssetUrl } from '../assetUrl';
import { TAPTILE_POINTER_ASSET_ID } from '../presentation/assets';

export interface TapTileAssetCacheLoaders {
  image?(entry: AssetManifestEntry, uri: string): Promise<CanvasImageSource>;
  video?(entry: AssetManifestEntry, uri: string): Promise<CanvasImageSource>;
  indexedDbBlob?(blobId: string): Promise<Blob>;
}

async function defaultImageLoader(_entry: AssetManifestEntry, uri: string): Promise<CanvasImageSource> {
  if (typeof Image === 'undefined') throw new Error('ASSET_IMAGE_ENVIRONMENT_UNAVAILABLE');
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`ASSET_IMAGE_LOAD_FAILED: ${uri}`));
    image.src = uri;
  });
  return image;
}

async function defaultVideoLoader(_entry: AssetManifestEntry, uri: string): Promise<CanvasImageSource> {
  if (typeof document === 'undefined') throw new Error('ASSET_VIDEO_ENVIRONMENT_UNAVAILABLE');
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.preload = 'auto';
  video.src = uri;
  await new Promise<void>((resolve, reject) => {
    video.oncanplay = () => resolve();
    video.onerror = () => reject(new Error(`ASSET_VIDEO_LOAD_FAILED: ${uri}`));
    video.load();
  });
  return video;
}

export class TapTileAssetCache {
  readonly versionHash: string;
  private readonly project: TapTileProjectV2;
  private readonly loaders: TapTileAssetCacheLoaders;
  private readonly promises = new Map<string, Promise<CanvasImageSource>>();
  private readonly values = new Map<string, CanvasImageSource>();
  private readonly objectUrls = new Set<string>();
  private disposed = false;

  constructor(project: TapTileProjectV2, loaders: TapTileAssetCacheLoaders = {}) {
    this.project = project;
    this.loaders = loaders;
    this.versionHash = stableHash(Object.values(project.assets.entries)
      .map((entry) => ({ id: entry.id, version: entry.version, contentHash: entry.contentHash, source: entry.source }))
      .sort((left, right) => left.id.localeCompare(right.id)), 'assets');
  }

  private async sourceUri(entry: AssetManifestEntry): Promise<string> {
    if (entry.source.type === 'builtin') return resolveTapTileBuiltinAssetUrl(entry.source.uri);
    if (!this.loaders.indexedDbBlob) throw new Error(`ASSET_INDEXEDDB_RESOLVER_MISSING: ${entry.id}`);
    const blob = await this.loaders.indexedDbBlob(entry.source.blobId);
    const uri = URL.createObjectURL(blob);
    this.objectUrls.add(uri);
    return uri;
  }

  load(assetId: string): Promise<CanvasImageSource> {
    if (this.disposed) return Promise.reject(new Error('ASSET_CACHE_DISPOSED'));
    const existing = this.promises.get(assetId);
    if (existing) return existing;
    const entry = this.project.assets.entries[assetId];
    if (!entry) return Promise.reject(new Error(`ASSET_NOT_FOUND: ${assetId}`));
    const promise = (async () => {
      if (entry.kind === 'sequence') throw new Error(`ASSET_SEQUENCE_MANIFEST_REQUIRED: ${assetId}`);
      if (entry.kind === 'audio') throw new Error(`ASSET_AUDIO_NOT_DRAWABLE: ${assetId}`);
      const uri = await this.sourceUri(entry);
      const value = entry.kind === 'video'
        ? await (this.loaders.video ?? defaultVideoLoader)(entry, uri)
        : await (this.loaders.image ?? defaultImageLoader)(entry, uri);
      this.values.set(assetId, value);
      return value;
    })();
    this.promises.set(assetId, promise);
    return promise;
  }

  async preload(assetIds: readonly string[]): Promise<void> {
    await Promise.all([...new Set(assetIds)].sort().map((assetId) => this.load(assetId)));
  }

  get(assetId: string): CanvasImageSource | undefined {
    return this.values.get(assetId);
  }

  has(assetId: string): boolean {
    return this.values.has(assetId);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const value of this.values.values()) {
      if (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) {
        value.pause();
        value.removeAttribute('src');
        value.load();
      }
    }
    for (const uri of this.objectUrls) URL.revokeObjectURL(uri);
    this.objectUrls.clear();
    this.values.clear();
    this.promises.clear();
  }
}

export function collectTapTileDrawableAssetIds(project: TapTileProjectV2): string[] {
  const ids = new Set<string>();
  if (project.assets.entries[TAPTILE_POINTER_ASSET_ID]) ids.add(TAPTILE_POINTER_ASSET_ID);
  const theme = project.visuals.themes[project.visuals.selectedThemeId];
  for (const binding of Object.values(theme?.bindings ?? {})) {
    const body = project.visuals.bodyStyles[binding.bodyStyleId];
    if (body?.bodyAssetId) ids.add(body.bodyAssetId);
    const assembly = project.visuals.faceAssemblies[binding.faceAssemblyId];
    for (const part of assembly?.parts ?? []) if (part.source.kind === 'image') ids.add(part.source.assetId);
  }
  for (const layer of project.visuals.stageAssemblies[project.visuals.selectedStageAssemblyId] ?? []) {
    if (layer.assetId) ids.add(layer.assetId);
  }
  return [...ids].sort();
}
