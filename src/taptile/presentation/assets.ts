import type { AssetManifestEntry } from '../project/types';

export const TAPTILE_POINTER_ASSET_ID = 'reference-hand-pointer-v1';
export const TAPTILE_POINTER_ASSET_URI = '/assets/taptile/reference-hand-pointer-v1.svg';

export function createDefaultTapTilePresentationAssets(): Record<string, AssetManifestEntry> {
  return {
    [TAPTILE_POINTER_ASSET_ID]: {
      id: TAPTILE_POINTER_ASSET_ID,
      kind: 'image',
      source: { type: 'builtin', uri: TAPTILE_POINTER_ASSET_URI },
      width: 280,
      height: 360,
      hasAlpha: true,
      contentHash: 'be4e3bffdd9c61fa86788596cdd20fc12a2018c27b974aadb0c963a032572171',
      version: '1',
    },
  };
}
