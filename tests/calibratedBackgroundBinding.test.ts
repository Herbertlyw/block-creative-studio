import { syntheticPng } from '../scripts/fixtures/syntheticMedia.mjs';
import { syntheticObservedPackageFixture } from './fixtures/syntheticObserved';
import { createBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { expect, it } from 'vitest';
import { openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { setNativeWorkImage } from '../src/contracts/setNativeWorkImage';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { inspectImageBytes } from '../src/nativeReference/agent-assets/image';

it('binds a normal background slot to an observed work without changing take, pointer path or source observation', async () => {
  const fixture = await syntheticObservedPackageFixture(),
    input = await createBBWorkPackage(fixture.project, fixture.pointer, fixture.source);
  const file = new File([new Uint8Array(syntheticPng([30, 60, 90])).buffer], 'background.png', {
    type: 'image/png',
  });
  const decode = async (blob: Blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer()));
  const work = await openBBWorkPackage(input),
    original = JSON.stringify(work);
  const result = await setNativeWorkImage(work, 'background.base', file, decode);
  expect(JSON.stringify(work)).toBe(original);
  expect((result.project as any).takes).toEqual((work.project as any).takes);
  expect(result.pointer?.tracks).toEqual(work.pointer?.tracks);
  expect(result.source?.observation).toEqual(work.source?.observation);
  expect(result.source?.provenance?.relation).toBe('derived');
  const binding = (result.project as any).direction.style.agentAssets.bindings['background.base'];
  expect(binding).toMatchObject({
    slotId: 'background.base',
    role: 'background-image',
    fit: 'cover',
    opacity: 1,
    blendMode: 'source-over',
  });
  const resolved = (await inlineBrowserStudioReferences(result.project, {})).document;
  const prepared = prepareCalibratedRenderer(resolved, 'observed-take');
  const previous = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(work.project, {})).document,
    'observed-take',
  );
  expect(prepared.frameSource.frameSourceHash).not.toBe(previous.frameSource.frameSourceHash);
  expect(await openBBWorkPackage(JSON.parse(JSON.stringify(result)))).toEqual(result);
  const atlas = await setNativeWorkImage(work, 'board.atlas', file, decode);
  expect((atlas.project as any).direction.style.agentAssets.bindings['board.atlas'].role).toBe(
    'board-atlas-image',
  );
  await expect(
    setNativeWorkImage(work, 'background.base', new File(['bad'], 'bad.png'), decode),
  ).rejects.toThrow(/损坏/);
  const invalid = structuredClone(result) as any;
  invalid.project.direction.style.agentAssets.entries[binding.assetId].sha256 = '0'.repeat(64);
  await expect(openBBWorkPackage(invalid)).rejects.toThrow(/SHA256|哈希/);
  const unsupported = structuredClone(resolved) as any;
  unsupported.direction.style.agentAssets.bindings['future.slot'] = {
    ...binding,
    slotId: 'future.slot',
    role: 'tile-face-image',
  };
  expect(() => prepareCalibratedRenderer(unsupported, 'observed-take')).toThrow(
    /尚未消费素材槽.*future.slot/,
  );
  expect(JSON.stringify(work)).toBe(original);
});
