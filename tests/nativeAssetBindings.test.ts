import { describe, expect, it } from 'vitest';
import {
  BrowserAssetStore,
  MemoryAssetBlobRepository,
} from '../src/nativeReference/assets/browserAssetStore';
import {
  collectRuntimeAssetReferenceIssues,
  collectRuntimeAssetRequests,
} from '../src/nativeReference/assets/runtimeAssetBindings';
import type { ResolvedRenderPlan, AssetManifest } from '../src/nativeReference/headless/contracts';

describe('isolated reference asset contracts', () => {
  it('distinguishes a present synthetic asset, absent asset and inconsistent manifest hash', async () => {
    const store = new BrowserAssetStore(new MemoryAssetBlobRepository());
    const asset = await store.putBlob(new Blob(['synthetic image data'], { type: 'image/png' }), {
      fileName: 'test.png',
      inspectMedia: false,
    });
    expect(await store.has(asset.contentHash)).toBe(true);
    expect(await store.has(`sha256:${'0'.repeat(64)}`)).toBe(false);
    const manifest: AssetManifest = {
      contract: 'bcs.asset-manifest',
      contractVersion: '1.0.0',
      id: 'synthetic-image',
      version: '1',
      kind: 'bitmap',
      origin: 'generated',
      runtime: { renderers: ['reference-2d'], deterministic: true },
      contentHash: asset.contentHash,
      uri: asset.uri,
      metadata: {
        browserAsset: {
          role: 'background-image',
          uri: asset.uri,
          fileName: 'test.png',
          mimeType: 'image/png',
          byteLength: asset.byteLength,
        },
      },
    };
    const plan = {
      slots: { 'background.base': { manifest } },
      assets: {},
      planHash: 'test-plan',
    } as unknown as ResolvedRenderPlan;
    expect(collectRuntimeAssetReferenceIssues(plan)).toEqual([]);
    expect(collectRuntimeAssetRequests(plan)[0]?.contentHash).toBe(asset.contentHash);
    const broken = structuredClone(plan);
    broken.slots['background.base']!.manifest.contentHash = `sha256:${'1'.repeat(64)}`;
    expect(collectRuntimeAssetReferenceIssues(broken)).toMatchObject([
      { slotId: 'background.base', reason: 'hash-mismatch' },
    ]);
    expect(collectRuntimeAssetRequests(broken)).toEqual([]);
    store.close();
  });
});
