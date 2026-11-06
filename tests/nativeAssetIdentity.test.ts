import { syntheticPortableFixture } from './fixtures/syntheticPortable';
import { ordinaryProject } from './fixtures/ordinaryProject';
import { describe, expect, it } from 'vitest';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { blockPlacementAuthoring } from '../src/nativeReference/games/block-placement/authoring';
import { GameAuthoringRegistry } from '../src/nativeReference/game-runtime/authoringRegistry';
import { canonicalBlockPlacementDocumentForHash } from '../src/nativeReference/games/block-placement/canonical';
import { stableStringify } from '../src/nativeReference/headless/stableHash';
import { sha256Hex } from '../src/nativeReference/agent-assets/image';
import { parseReferenceCalibration } from '../src/nativeReference/games/block-placement/presentation/referenceCalibration';
import { isValidPlacementContract } from '../src/contracts/validateContract';
const portable = await syntheticPortableFixture(ordinaryProject());
const fixture = () => JSON.parse(JSON.stringify(portable.project));
const sources = () =>
  Object.fromEntries(
    Object.entries(portable.files).map(([kind, files]) => [
      kind,
      files.map((original) => {
        const file = new File([original], original.name);
        Object.defineProperty(file, 'webkitRelativePath', { value: original.webkitRelativePath });
        return file;
      }),
    ]),
  );
const legacy = () => {
  const doc = fixture();
  doc.direction.style.referenceCalibration = {
    version: 1,
    theme: 'pink',
    duration: 5.016667,
    sourceOffset: 0,
    board: [70, 350, 100],
    rackY: 1500,
    rackCell: 70,
    bestScore: 0,
    scoreTrack: [[0, 0]],
    actions: [
      { actionId: 'synthetic-first', start: 1, release: 1.65, clear: 1.766667, slot: 0 },
      { actionId: 'synthetic-second', start: 3.3, release: 4, clear: 4.1, slot: 1 },
    ],
    sprites: { background: 'asset:synthetic-background' },
    legacySpriteAssetIds: { background: 'synthetic-background' },
  };
  return doc;
};
const canon = (doc: unknown) =>
  stableStringify(
    canonicalBlockPlacementDocumentForHash(
      doc as Parameters<typeof canonicalBlockPlacementDocumentForHash>[0],
    ),
  );

describe('actual BB authoring, legacy assets and content identity', () => {
  it('registers only the real block-placement authoring and rejects missing or duplicate games', () => {
    const registry = new GameAuthoringRegistry();
    registry.register(blockPlacementAuthoring);
    expect(registry.list()).toEqual(['block-placement']);
    expect(registry.require('block-placement').gameId).toBe('block-placement');
    expect(() => registry.require('other')).toThrow(/unavailable/);
    expect(() => registry.register(blockPlacementAuthoring)).toThrow(/already registered/);
  });
  it('hydrates declared asset aliases after checking actual bytes and preserves canonical identity', async () => {
    const doc = legacy(),
      before = JSON.stringify(doc);
    expect(isValidPlacementContract(doc)).toBe(true);
    expect(() =>
      parseReferenceCalibration(doc.direction.style.referenceCalibration, doc),
    ).not.toThrow();
    const result = await inlineBrowserStudioReferences(doc, sources());
    const style = result.document.direction!.style as any;
    expect(style.referenceCalibration.sprites.background).toMatch(/^data:image\/png;base64,/);
    expect(result.report.legacySpritesHydrated).toBe(1);
    expect(result.report.verifiedPayloads).toBe(5);
    expect(result.report.canonicalSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(canon(doc)).toBe(canon(result.document));
    expect(JSON.stringify(doc)).toBe(before);
    expect(result.document.takes).toEqual(doc.takes);
  });
  it('refuses missing or mismatched aliases, corrupt bytes and stale inline hashes', async () => {
    const mismatch = legacy();
    mismatch.direction.style.referenceCalibration.sprites.background = 'asset:generated-atlas';
    await expect(inlineBrowserStudioReferences(mismatch, sources())).rejects.toThrow(
      /LEGACY_REFERENCE_SPRITE_BINDING_MISMATCH/,
    );
    const missing = legacy();
    missing.direction.style.referenceCalibration.legacySpriteAssetIds.background = 'does-not-exist';
    missing.direction.style.referenceCalibration.sprites.background = 'asset:does-not-exist';
    await expect(inlineBrowserStudioReferences(missing, sources())).rejects.toThrow(
      /LEGACY_REFERENCE_SPRITE_UNRESOLVED/,
    );
    const source = JSON.parse(JSON.stringify(ordinaryProject()));
    const music = source.direction.production.audio.assets.music;
    const bytes = Buffer.from(music.data, 'base64');
    bytes[50] ^= 1;
    music.data = bytes.toString('base64');
    await expect(inlineBrowserStudioReferences(source, {})).rejects.toMatchObject({
      code: 'ASSET_REF_HASH_MISMATCH',
    });
  });
  it('externalizes and inlines checked images and WAV using the real game authoring without losing content identity', async () => {
    const doc = legacy(),
      initial = await inlineBrowserStudioReferences(doc, sources()),
      hydrated = initial.document;
    const writes = new Map<string, Uint8Array>();
    const thin = await blockPlacementAuthoring.externalizeAssets!(
      hydrated,
      async (name, _sha, bytes) => {
        writes.set(name, bytes);
        return `./assets/${name}`;
      },
    );
    expect(thin.ok).toBe(true);
    expect(thin.report.identityUnchanged).toBe(true);
    expect(canon(thin.document)).toBe(canon(hydrated));
    const restored = await blockPlacementAuthoring.inlineAssets!(thin.document, async (ref) => {
      const bytes = writes.get(ref.locator.replace(/^assets\//, ''));
      if (!bytes) throw new Error('missing');
      return bytes;
    });
    expect(restored.report.identityUnchanged).toBe(true);
    expect(canon(restored.document)).toBe(canon(hydrated));
    expect(restored.document!.game).toEqual(hydrated.game);
    expect(restored.document!.takes).toEqual(hydrated.takes);
    const altered = structuredClone(restored.document!) as any;
    const music = altered.direction.production.audio.assets.music;
    const bytes = Buffer.from(music.data, 'base64');
    bytes[50] ^= 1;
    music.data = bytes.toString('base64');
    music.sha256 = await sha256Hex(bytes);
    expect(canon(altered)).not.toBe(canon(restored.document));
  });
  it('rejects cross-game and unverified module versions', async () => {
    const doc = fixture();
    doc.game.game.moduleVersion = '9.0.0';
    await expect(inlineBrowserStudioReferences(doc, sources())).rejects.toMatchObject({
      code: 'ASSET_GAME_UNSUPPORTED',
    });
    doc.game.game.moduleVersion = '1.0.0';
    doc.game.game.id = 'other-game';
    await expect(inlineBrowserStudioReferences(doc, sources())).rejects.toMatchObject({
      code: 'ASSET_GAME_UNSUPPORTED',
    });
  });
});
