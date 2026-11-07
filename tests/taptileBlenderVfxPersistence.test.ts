import { describe, expect, it } from 'vitest';
import { BrowserAssetStore, MemoryAssetBlobRepository } from '../src/assets/browserAssetStore';
import {
  createTapTileBlenderVfxAsset,
  forgetTapTileBlenderVfxAsset,
  persistTapTileBlenderVfxAsset,
  restoreTapTileBlenderVfxAsset,
} from '../src/taptile/blender';
import { createMinimalGlb } from './glbFixture';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { size(): number } {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    size: () => values.size,
  };
}

function vfxGlb(): ArrayBuffer {
  return createMinimalGlb({
    triangleCount: 2,
    nodeInstances: 3,
    semanticExtras: true,
    semanticRoles: ['tile', 'match-core', 'match-fragment'],
    vfxStyle: 'shatter',
    vfxFragmentCount: 96,
    fixedCamera: true,
    timeline: { frameStart: 1, frameEnd: 60, frameCount: 60, fps: 30 },
  });
}

describe('TapTile Blender VFX browser persistence', () => {
  it('round-trips a validated GLB by SHA-256 and restores it for the same project', async () => {
    const store = new BrowserAssetStore(new MemoryAssetBlobRepository());
    const storage = memoryStorage();
    const asset = await createTapTileBlenderVfxAsset(vfxGlb(), 'fixture.glb');
    await persistTapTileBlenderVfxAsset('project-a', asset, { store, storage });
    expect(storage.size()).toBe(1);
    const restored = await restoreTapTileBlenderVfxAsset('project-a', { store, storage });
    expect(restored).toMatchObject({
      fileName: 'fixture.glb',
      byteLength: asset.byteLength,
      sha256: asset.sha256,
    });
    expect(restored?.validation.effectFragmentCount).toBe(96);
    expect(await restoreTapTileBlenderVfxAsset('project-b', { store, storage })).toBeNull();
  });

  it('forgets only the project pointer without deleting the content-addressed model', async () => {
    const store = new BrowserAssetStore(new MemoryAssetBlobRepository());
    const storage = memoryStorage();
    const asset = await createTapTileBlenderVfxAsset(vfxGlb(), 'fixture.glb');
    await persistTapTileBlenderVfxAsset('project-a', asset, { store, storage });
    forgetTapTileBlenderVfxAsset('project-a', { storage });
    expect(await restoreTapTileBlenderVfxAsset('project-a', { store, storage })).toBeNull();
    expect(await store.has(`sha256:${asset.sha256}`)).toBe(true);
  });

  it('self-heals a malformed project pointer instead of retrying it on every reload', async () => {
    const store = new BrowserAssetStore(new MemoryAssetBlobRepository());
    const storage = memoryStorage();
    storage.setItem('taptile-blender-vfx/v1/project-a', '{"version":1,"contentHash":"not-a-hash"}');
    expect(await restoreTapTileBlenderVfxAsset('project-a', { store, storage })).toBeNull();
    expect(storage.size()).toBe(0);
  });
});
