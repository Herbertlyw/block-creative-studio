import { createHash } from 'node:crypto';
import { ordinaryProject } from './fixtures/ordinaryProject';
import { syntheticPng, syntheticJpeg } from '../scripts/fixtures/syntheticMedia.mjs';
import { describe, expect, it } from 'vitest';
import { resolveEmbeddedAssets } from '../src/contracts/embeddedAssets';
import { isValidPlacementContract } from '../src/contracts/validateContract';
import {
  agentSequenceFrameIndex,
  parseAgentSequencePlayback,
} from '../src/nativeReference/agent-assets/sequences';
import { parseAgentAssetRef } from '../src/nativeReference/agent-assets/refs';
const fixture = (name: string) => {
  const doc = JSON.parse(JSON.stringify(ordinaryProject())),
    entries = doc.direction.style.agentAssets.entries;
  if (name === 'embedded-background-negative/missing') delete entries['synthetic-background'];
  if (name === 'embedded-background-negative/mismatch')
    entries['synthetic-background'].sha256 = '0'.repeat(64);
  if (name === 'embedded-background-negative/corrupt') {
    const bytes = Buffer.from('not a PNG');
    Object.assign(entries['synthetic-background'], {
      data: bytes.toString('base64'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
    });
  }
  if (name === 'native-slots-local-ref') {
    entries['generated-tile'].encoding = 'ref';
    entries['generated-tile'].ref = './assets/generated-tile.png';
    delete entries['generated-tile'].data;
  }
  if (name === 'native-v2-batch-reopened') {
    const bytes = syntheticJpeg([200, 60, 90]);
    Object.assign(entries['generated-tile'], {
      data: bytes.toString('base64'),
      mimeType: 'image/jpeg',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
    });
  }
  return doc;
};
const decode = async (blob: Blob) => {
  const b = await blob.arrayBuffer(),
    v = new DataView(b);
  return { width: v.getUint32(16), height: v.getUint32(20) };
};

describe('reference V2 asset registration', () => {
  it('validates and registers background, tile face and atlas, preserving the original document', async () => {
    const source = fixture('native-slots-both'),
      before = JSON.stringify(source);
    expect(isValidPlacementContract(source)).toBe(true);
    const bindings = await resolveEmbeddedAssets(source, decode);
    expect(bindings.background?.slotId).toBe('background.base');
    expect(bindings.tileFace?.slotId).toBe('tile.face');
    expect(bindings.boardAtlas?.slotId).toBe('board.atlas');
    expect(bindings.tileFace?.inset).toBe(0.06);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('rejects missing, wrong hash and damaged image rather than falling back', async () => {
    for (const [name, code] of [
      ['missing', 'asset-missing'],
      ['mismatch', 'hash-mismatch'],
      ['corrupt', 'image-corrupt'],
    ] as const) {
      const source = fixture('embedded-background-negative/' + name);
      await expect(resolveEmbeddedAssets(source, decode)).rejects.toMatchObject({ code });
    }
  });
  it('refuses slots and transforms without a BB consumer', async () => {
    const source = fixture('native-slots-both');
    source.direction.style.agentAssets.bindings['tile.face'].transform = { rotationDeg: 30 };
    await expect(resolveEmbeddedAssets(source, decode)).rejects.toMatchObject({
      code: 'unsupported',
    });
    const sequence = fixture('native-slots-both');
    sequence.direction.style.agentAssets.bindings['unavailable.sequence'] = {
      slotId: 'unavailable.sequence',
      assetId: 'generated-tile',
      role: 'effect-sequence',
      fit: 'cover',
      opacity: 1,
      blendMode: 'source-over',
      inset: 0,
    };
    await expect(resolveEmbeddedAssets(sequence, decode)).rejects.toMatchObject({
      code: 'slot-unsupported',
    });
  });
  it('parses local reference formats and calculates sequence indices while rendering stays explicitly unsupported', () => {
    expect(parseAgentAssetRef('./assets/tile.png')).toMatchObject({
      kind: 'attachment',
      locator: 'assets/tile.png',
    });
    expect(() => parseAgentAssetRef('../secret')).toThrow();
    const playback = parseAgentSequencePlayback({ loop: true, holdLastFrame: false })!;
    expect(
      [0, 5, 10, 15, 20].map((elapsedFrames) =>
        agentSequenceFrameIndex({
          elapsedFrames,
          presentationFps: 30,
          sequenceFps: 6,
          frameCount: 3,
          playback,
        }),
      ),
    ).toEqual([0, 1, 2, 0, 1]);
  });
});

it('resolves an explicitly selected local reference by hash without rewriting the project', async () => {
  const source = fixture('native-slots-local-ref'),
    before = JSON.stringify(source);
  expect(isValidPlacementContract(source)).toBe(true);
  const bytes = syntheticPng([220, 80, 85], 64, 64);
  await expect(resolveEmbeddedAssets(source, decode)).rejects.toMatchObject({
    code: 'unresolved-ref',
  });
  await expect(
    resolveEmbeddedAssets(source, decode, [new Blob(['wrong image'])]),
  ).rejects.toMatchObject({ code: 'hash-mismatch' });
  const found = await resolveEmbeddedAssets(source, decode, [
    new Blob([bytes], { type: 'image/png' }),
  ]);
  expect(found.tileFace?.sourceUri).toBe('local-ref:./assets/generated-tile.png');
  expect(found.tileFace?.contentHash).toBe(
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  );
  expect(JSON.stringify(source)).toBe(before);
  const pinned = structuredClone(source);
  pinned.direction.style.agentAssets.entries['generated-tile'].ref = `cas:sha256-${'0'.repeat(64)}`;
  await expect(resolveEmbeddedAssets(pinned, decode, [new Blob([bytes])])).rejects.toMatchObject({
    code: 'hash-mismatch',
  });
});

it('reports unsupported format and unknown slot separately', async () => {
  const format = fixture('native-slots-both');
  format.direction.style.agentAssets.entries['generated-tile'].mimeType = 'image/webp';
  await expect(resolveEmbeddedAssets(format, decode)).rejects.toMatchObject({
    code: 'format-unsupported',
  });
  const slot = fixture('native-slots-both');
  slot.direction.style.agentAssets.bindings['not-a-slot'] = {
    ...slot.direction.style.agentAssets.bindings['tile.face'],
    slotId: 'not-a-slot',
  };
  await expect(resolveEmbeddedAssets(slot, decode)).rejects.toMatchObject({
    code: 'slot-unsupported',
  });
});

it('validates the saved JPEG tile and PNG background with real format inspection', async () => {
  const { inspectImageBytes } = await import('../src/nativeReference/agent-assets/image');
  const doc = fixture('native-v2-batch-reopened'),
    before = JSON.stringify(doc);
  const decoder = async (blob: Blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer()));
  const bindings = await resolveEmbeddedAssets(doc, decoder);
  expect(bindings.tileFace).toMatchObject({ mimeType: 'image/jpeg', width: 64, height: 64 });
  expect(bindings.background).toMatchObject({ mimeType: 'image/png', width: 32, height: 32 });
  expect(JSON.stringify(doc)).toBe(before);
});
