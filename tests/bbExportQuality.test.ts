import { expect, it } from 'vitest';
import { createNativeWork } from '../src/contracts/nativeWorkAuthor';
import { openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { readBBExportQuality, setBBExportQuality } from '../src/contracts/bbExportQuality';
import { syntheticObservedPackageFixture } from './fixtures/syntheticObserved';
import { createBBWorkPackage } from '../src/contracts/bbWorkPackage';

it('saves and reopens an explicit quality without changing gameplay or the default', async () => {
  const original = await createNativeWork(),
    before = structuredClone(original);
  expect(readBBExportQuality(original.project)).toBe('preview');
  const updated = await setBBExportQuality(original, 'standard');
  expect(
    readBBExportQuality((await openBBWorkPackage(JSON.parse(JSON.stringify(updated)))).project),
  ).toBe('standard');
  expect((updated.project as any).game).toEqual((before.project as any).game);
  expect(original).toEqual(before);
  expect(await setBBExportQuality(updated, 'preview')).toEqual(original);
  await expect(setBBExportQuality(original, 'other' as never)).rejects.toThrow(/不支持/);
  const invalid = structuredClone(updated) as any;
  invalid.project.direction.style.workbenchExportQualityV1.extra = true;
  await expect(openBBWorkPackage(invalid)).rejects.toThrow(/合同无效/);
});
it('preserves observed source, pointer and takes when changing output quality', async () => {
  const fixture = await syntheticObservedPackageFixture(),
    original = await createBBWorkPackage(fixture.project, fixture.pointer, fixture.source);
  const before = JSON.stringify(original),
    updated = await setBBExportQuality(original, 'standard');
  expect(readBBExportQuality(updated.project)).toBe('standard');
  expect(JSON.stringify(original)).toBe(before);
  expect((updated.project as any).takes).toEqual(fixture.project.takes);
  expect(updated.pointer?.tracks).toEqual(fixture.pointer.tracks);
  expect(updated.source?.observation).toEqual(fixture.source.observation);
  await openBBWorkPackage(JSON.parse(JSON.stringify(updated)));
});
