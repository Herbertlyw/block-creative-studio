import { describe, expect, it } from 'vitest';
import { collectRuntimeAssetRequests } from '../src/assets/runtimeAssetBindings';
import { AssetRegistry } from '../src/headless/assetRegistry';
import type { AssetManifest } from '../src/headless/contracts';
import { runQualityGate } from '../src/headless/qualityGate';
import { compileVariant } from '../src/headless/variantCompiler';
import { makeFixture, ref } from './headlessFixtures';

const textureHash = `sha256:${'9'.repeat(64)}`;

function uploadedTexture(): AssetManifest {
  return {
    contract: 'bcs.asset-manifest',
    contractVersion: '1.0.0',
    id: 'texture.copper.base-color',
    version: '1.0.0',
    kind: 'bitmap',
    origin: 'uploaded',
    contentHash: textureHash,
    uri: `bcs-asset://sha256/${'9'.repeat(64)}`,
    runtime: {
      renderers: ['fixed-camera-cinematic'],
      deterministic: true,
      budget: { textureMemoryMiB: 7 },
    },
    metadata: {
      browserAsset: {
        role: 'texture-map',
        uri: `bcs-asset://sha256/${'9'.repeat(64)}`,
        fileName: 'copper-base.webp',
        mimeType: 'image/webp',
        byteLength: 48000,
        width: 2048,
        height: 2048,
      },
    },
  };
}

describe('asset dependency closure', () => {
  it('resolves nested Material Pack textures into the immutable render plan', () => {
    const fixture = makeFixture();
    const texture = uploadedTexture();
    fixture.material.appearance.textureRefs = {
      baseColor: ref(texture.id, texture.kind, '9'),
    };
    const plan = compileVariant(
      fixture.master,
      fixture.recipe,
      new AssetRegistry([...fixture.assets, texture]),
      { renderer: 'fixed-camera-cinematic', requireHashes: true },
    );
    const report = runQualityGate(plan, { strict: true, requireHashes: true });
    const requests = collectRuntimeAssetRequests(plan);

    expect(plan.assets?.['texture.copper.base-color@1.0.0']?.manifest.uri).toBe(texture.uri);
    expect((plan.dependencyOrder ?? []).at(-1)).toMatchObject({ id: 'look.copper' });
    expect(report.passed).toBe(true);
    expect(report.metrics.textureMemoryMiB).toBe(69);
    expect(requests).toContainEqual(expect.objectContaining({
      slotId: 'asset:texture.copper.base-color@1.0.0',
      role: 'texture-map',
      contentHash: textureHash,
    }));
  });

  it('rejects dependency cycles with a machine-readable compiler error', () => {
    const fixture = makeFixture();
    const background = fixture.assets.find((asset) => asset.id === 'background.dark');
    const board = fixture.assets.find((asset) => asset.id === 'board.dark');
    expect(background).toBeDefined();
    expect(board).toBeDefined();
    background!.dependencies = [ref(board!.id, board!.kind, '1')];
    board!.dependencies = [ref(background!.id, background!.kind, 'f')];

    expect(() => compileVariant(
      fixture.master,
      fixture.recipe,
      new AssetRegistry(fixture.assets),
      { renderer: 'fixed-camera-cinematic', requireHashes: true },
    )).toThrowError(expect.objectContaining({ code: 'ASSET_DEPENDENCY_CYCLE' }));
  });
});
