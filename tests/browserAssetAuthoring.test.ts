import { describe, expect, it } from 'vitest';
import {
  createBrowserAssetManifest,
  createBrowserAssetVariant,
  validateBrowserAssetFile,
} from '../src/assets/browserAssetAuthoring';
import type { BrowserAssetMetadata } from '../src/assets/browserAssetStore';
import { AssetRegistry } from '../src/headless/assetRegistry';
import { runQualityGate } from '../src/headless/qualityGate';
import { validateAssetManifest } from '../src/headless/validation';
import { compileVariant } from '../src/headless/variantCompiler';
import { makeFixture } from './headlessFixtures';
import { createMinimalGlb } from './glbFixture';

const imageMetadata: BrowserAssetMetadata = {
  contentHash: `sha256:${'9'.repeat(64)}`,
  uri: `bcs-asset://sha256/${'9'.repeat(64)}`,
  fileName: 'copper-background.webp',
  mimeType: 'image/webp',
  byteLength: 48_000,
  createdAt: '2026-09-03T00:00:00.000Z',
  mediaClass: 'image',
  width: 1080,
  height: 1920,
};

describe('browser asset authoring', () => {
  it('creates a strict manifest whose URI and hash point to the stored blob', () => {
    const asset = createBrowserAssetManifest(imageMetadata, {
      role: 'background-image',
      fit: 'cover',
      opacity: 0.9,
    });

    expect(asset.kind).toBe('background');
    expect(asset.origin).toBe('uploaded');
    expect(asset.contentHash).toBe(imageMetadata.contentHash);
    expect(asset.uri).toBe(imageMetadata.uri);
    expect(validateAssetManifest(asset).filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(asset.metadata).toMatchObject({
      browserAsset: {
        role: 'background-image',
        width: 1080,
        height: 1920,
        fit: 'cover',
        opacity: 0.9,
      },
    });
  });

  it('derives a new Look Pack and Variant without changing the base gameplay master', () => {
    const fixture = makeFixture();
    const baseRegistry = new AssetRegistry(fixture.assets);
    const basePlan = compileVariant(fixture.master, fixture.recipe, baseRegistry, {
      renderer: 'fixed-camera-cinematic',
      requireHashes: true,
    });
    const asset = createBrowserAssetManifest(imageMetadata, { role: 'background-image' });
    const authored = createBrowserAssetVariant({
      plan: basePlan,
      masterId: fixture.master.id,
      lockMode: 'frame-exact',
      seed: 20260903,
      asset,
      role: 'background-image',
    });
    const registry = new AssetRegistry([...fixture.assets, asset, authored.look]);
    const plan = compileVariant(fixture.master, authored.recipe, registry, {
      renderer: 'fixed-camera-cinematic',
      requireHashes: true,
    });
    const report = runQualityGate(plan, { strict: true, requireHashes: true });

    expect(authored.slotId).toBe('background.base');
    expect(authored.look.slots['background.base']).toMatchObject({
      id: asset.id,
      contentHash: imageMetadata.contentHash,
    });
    expect(plan.replay).toEqual(basePlan.replay);
    expect(plan.slots['background.base']?.manifest.uri).toBe(imageMetadata.uri);
    expect(report.passed).toBe(true);
  });


  it('rejects SVG before it can enter the runtime image store', async () => {
    const svg = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'],
      'unsafe.svg',
      { type: 'image/svg+xml' },
    );
    await expect(validateBrowserAssetFile(svg, 'tile-face-image')).rejects.toThrow('暂不接受 SVG');
  });

  it('accepts a complete self-contained GLB 2.0 and rejects arbitrary binary', async () => {
    await expect(validateBrowserAssetFile(
      new File([createMinimalGlb()], 'tile.glb', { type: 'model/gltf-binary' }),
      'geometry-3d',
    )).resolves.toBeUndefined();

    await expect(validateBrowserAssetFile(
      new File([new Uint8Array(12)], 'tile.glb', { type: 'model/gltf-binary' }),
      'geometry-3d',
    )).rejects.toThrow('magic');
  });

  it('rejects media that does not match the requested runtime role', () => {
    const audioMetadata: BrowserAssetMetadata = {
      ...imageMetadata,
      fileName: 'clear.wav',
      mimeType: 'audio/wav',
      mediaClass: 'audio',
    };
    expect(() => createBrowserAssetManifest(audioMetadata, {
      role: 'tile-face-image',
    })).toThrow('只接受图片');
  });
});
