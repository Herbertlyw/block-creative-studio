import { describe, expect, it } from 'vitest';
import {
  collectRuntimeAssetRequests,
  imageBindingDefaults,
  readBrowserAssetMetadata,
  runtimeBindingRevision,
} from '../src/assets/runtimeAssetBindings';
import {
  createBrowserAssetManifest,
  createBrowserAssetVariant,
} from '../src/assets/browserAssetAuthoring';
import type { BrowserAssetMetadata } from '../src/assets/browserAssetStore';
import { AssetRegistry } from '../src/headless/assetRegistry';
import { compileVariant } from '../src/headless/variantCompiler';
import { makeFixture } from './headlessFixtures';

function createPlan() {
  const fixture = makeFixture();
  const basePlan = compileVariant(
    fixture.master,
    fixture.recipe,
    new AssetRegistry(fixture.assets),
    { renderer: 'fixed-camera-cinematic', requireHashes: true },
  );
  const metadata: BrowserAssetMetadata = {
    contentHash: `sha256:${'8'.repeat(64)}`,
    uri: `bcs-asset://sha256/${'8'.repeat(64)}`,
    fileName: 'background.png',
    mimeType: 'image/png',
    byteLength: 4096,
    createdAt: '2026-09-03T00:00:00.000Z',
    mediaClass: 'image',
    width: 720,
    height: 1280,
  };
  const asset = createBrowserAssetManifest(metadata, {
    role: 'background-image',
    fit: 'contain',
    opacity: 0.75,
    blendMode: 'screen',
  });
  const authored = createBrowserAssetVariant({
    plan: basePlan,
    masterId: fixture.master.id,
    lockMode: 'frame-exact',
    seed: 1,
    asset,
    role: 'background-image',
  });
  const plan = compileVariant(
    fixture.master,
    authored.recipe,
    new AssetRegistry([...fixture.assets, asset, authored.look]),
    { renderer: 'fixed-camera-cinematic', requireHashes: true },
  );
  return { plan, asset };
}

describe('runtime asset bindings', () => {
  it('extracts browser binary requests from a resolved render plan', () => {
    const { plan, asset } = createPlan();
    const metadata = readBrowserAssetMetadata(asset);
    const requests = collectRuntimeAssetRequests(plan);

    expect(metadata?.role).toBe('background-image');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      slotId: 'background.base',
      role: 'background-image',
      contentHash: asset.contentHash,
    });
    expect(runtimeBindingRevision(plan)).toContain(plan.planHash);
  });

  it('creates deterministic image defaults from manifest metadata', () => {
    const { plan } = createPlan();
    const request = collectRuntimeAssetRequests(plan)[0]!;
    const binding = imageBindingDefaults(request, 'blob:runtime-background');

    expect(binding).toMatchObject({
      objectUrl: 'blob:runtime-background',
      fit: 'contain',
      opacity: 0.75,
      blendMode: 'screen',
      inset: 0,
    });
  });
});
