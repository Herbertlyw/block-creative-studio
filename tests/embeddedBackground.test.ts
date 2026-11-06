import { ordinaryProject } from './fixtures/ordinaryProject';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  EmbeddedBackgroundError,
  resolveEmbeddedBackground,
} from '../src/contracts/embeddedBackground';
import { isValidPlacementContract } from '../src/contracts/validateContract';
import { inspectNativeRuntime } from '../src/contracts/inspectNativeRuntime';
const original = JSON.parse(JSON.stringify(ordinaryProject()));
for (const key of ['tile.face', 'board.atlas'])
  delete original.direction.style.agentAssets.bindings[key];
const decode = async () => ({ width: 32, height: 32 });
const entry = (x: typeof original) => x.direction.style.agentAssets.entries['synthetic-background'];

describe('V2 embedded background', () => {
  it('recognizes the real schema and binds the verified original without mutating it', async () => {
    const source = structuredClone(original),
      before = JSON.stringify(source);
    expect(isValidPlacementContract(source)).toBe(true);
    expect(inspectNativeRuntime(source).validated).toBe(true);
    const binding = await resolveEmbeddedBackground(source, decode);
    expect(binding).toMatchObject({
      slotId: 'background.base',
      role: 'background-image',
      width: 32,
      height: 32,
      contentHash: `sha256:${entry(original).sha256}`,
    });
    expect(JSON.stringify(source)).toBe(before);
  });
  it('separately reports missing asset, hash mismatch, corrupt PNG and incorrect dimensions', async () => {
    const missing = structuredClone(original);
    delete missing.direction.style.agentAssets.entries['synthetic-background'];
    await expect(resolveEmbeddedBackground(missing, decode)).rejects.toMatchObject({
      code: 'asset-missing',
    } satisfies Partial<EmbeddedBackgroundError>);
    const wrong = structuredClone(original);
    entry(wrong).sha256 = '0'.repeat(64);
    await expect(resolveEmbeddedBackground(wrong, decode)).rejects.toMatchObject({
      code: 'hash-mismatch',
    });
    const corrupted = structuredClone(original),
      b = Buffer.from(entry(corrupted).data, 'base64').subarray(0, 100);
    entry(corrupted).data = b.toString('base64');
    entry(corrupted).byteLength = b.length;
    entry(corrupted).sha256 = createHash('sha256').update(b).digest('hex');
    await expect(
      resolveEmbeddedBackground(corrupted, async () => {
        throw new Error('decode failure');
      }),
    ).rejects.toMatchObject({ code: 'image-corrupt' });
    const dimensions = structuredClone(original);
    entry(dimensions).width = 31;
    await expect(resolveEmbeddedBackground(dimensions, decode)).rejects.toMatchObject({
      code: 'metadata-mismatch',
    });
  });
  it('does not silently ignore unsupported slots, transforms, missing refs or invalid Base64', async () => {
    const other = structuredClone(original);
    other.direction.style.agentAssets.bindings['tile.face'] = {};
    await expect(resolveEmbeddedBackground(other, decode)).rejects.toMatchObject({
      code: 'unsupported',
    });
    const transformed = structuredClone(original);
    transformed.direction.style.agentAssets.bindings['background.base'].transform = { scale: 1 };
    await expect(resolveEmbeddedBackground(transformed, decode)).rejects.toMatchObject({
      code: 'unsupported',
    });
    const ref = structuredClone(original);
    entry(ref).encoding = 'ref';
    await expect(resolveEmbeddedBackground(ref, decode)).rejects.toMatchObject({
      code: 'unsupported',
    });
    const bad64 = structuredClone(original);
    entry(bad64).data = '$$$$';
    await expect(resolveEmbeddedBackground(bad64, decode)).rejects.toMatchObject({
      code: 'image-corrupt',
    });
  });
});
