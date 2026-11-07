import { describe, expect, it } from 'vitest';
import {
  BrowserAssetStore,
  MemoryAssetBlobRepository,
  assetUriToContentHash,
  classifyBrowserAssetMedia,
  contentHashToAssetUri,
} from '../src/assets/browserAssetStore';

describe('BrowserAssetStore', () => {
  it('stores immutable blobs by SHA-256 and deduplicates identical content', async () => {
    const store = new BrowserAssetStore(new MemoryAssetBlobRepository());
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const first = await store.putBlob(blob, {
      fileName: 'hello.bin',
      inspectMedia: false,
    });
    const second = await store.putBlob(blob, {
      fileName: 'renamed.bin',
      inspectMedia: false,
    });

    expect(first.contentHash).toBe(
      'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(first.uri).toBe(
      'bcs-asset://sha256/2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
    expect(second).toEqual(first);
    expect((await store.list())).toHaveLength(1);
    expect((await store.get(first.uri))?.blob.size).toBe(blob.size);
  });

  it('round-trips content-addressed URIs and classifies supported media', () => {
    const hash = `sha256:${'a'.repeat(64)}`;
    expect(assetUriToContentHash(contentHashToAssetUri(hash))).toBe(hash);
    expect(classifyBrowserAssetMedia('', 'tile.glb')).toBe('model');
    expect(classifyBrowserAssetMedia('image/webp', 'tile.webp')).toBe('image');
    expect(classifyBrowserAssetMedia('audio/wav', 'clear.wav')).toBe('audio');
    expect(classifyBrowserAssetMedia('video/webm', 'burst.webm')).toBe('video');
  });

  it('rejects empty and oversized imports before persistence', async () => {
    const store = new BrowserAssetStore(new MemoryAssetBlobRepository());
    await expect(store.putBlob(new Blob([]), { inspectMedia: false })).rejects.toThrow('Empty');
    await expect(store.putBlob(new Blob(['12345']), {
      maximumBytes: 4,
      inspectMedia: false,
    })).rejects.toThrow('limit');
    expect((await store.list())).toHaveLength(0);
  });

  it('deletes blob and metadata together', async () => {
    const store = new BrowserAssetStore(new MemoryAssetBlobRepository());
    const metadata = await store.putBlob(new Blob(['payload']), {
      fileName: 'payload.bin',
      inspectMedia: false,
    });
    expect(await store.has(metadata.contentHash)).toBe(true);
    await store.delete(metadata.uri);
    expect(await store.has(metadata.contentHash)).toBe(false);
    expect((await store.estimate()).assetCount).toBe(0);
  });
});
