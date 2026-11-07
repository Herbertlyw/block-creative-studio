import type { AssetManifest, AssetManifestEntry } from '../project';
import { resolveTapTileBuiltinAssetUrl } from '../assetUrl';
import type { ResolvedAsset } from './types';

export class TapTileAssetRegistry {
  readonly manifest: AssetManifest;

  constructor(manifest: AssetManifest) {
    this.manifest = manifest;
  }

  has(assetId: string): boolean {
    return Boolean(this.manifest.entries[assetId]);
  }

  entry(assetId: string): AssetManifestEntry {
    const entry = this.manifest.entries[assetId];
    if (!entry) throw new Error(`ASSET_NOT_FOUND: ${assetId}`);
    return entry;
  }

  resolve(assetId: string): ResolvedAsset {
    const entry = this.entry(assetId);
    if (entry.source.type === 'builtin') {
      return { entry, uri: resolveTapTileBuiltinAssetUrl(entry.source.uri), persistence: 'builtin' };
    }
    return { entry, persistence: 'indexeddb' };
  }
}
