import { expect, it } from 'vitest';
import { syntheticPng } from '../scripts/fixtures/syntheticMedia.mjs';
import { createNativeWork } from '../src/contracts/nativeWorkAuthor';
import { openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import {
  readWorkbenchBackground,
  setWorkbenchBackground,
} from '../src/contracts/workbenchBackground';
import { setNativeWorkImage } from '../src/contracts/setNativeWorkImage';
import { inspectImageBytes } from '../src/nativeReference/agent-assets/image';

it('saves, reopens and removes an explicit solid backdrop without changing gameplay', async () => {
  const original = await createNativeWork(),
    before = structuredClone(original);
  const changed = await setWorkbenchBackground(original, '#123456');
  expect(readWorkbenchBackground(changed.project)?.color).toBe('#123456');
  expect((changed.project as any).game).toEqual((before.project as any).game);
  expect(original).toEqual(before);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(changed)))).project).toEqual(
    changed.project,
  );
  expect(await setWorkbenchBackground(changed, null)).toEqual(original);
  await expect(setWorkbenchBackground(original, 'not-a-color')).rejects.toThrow(/合同无效/);
});
it('rejects conflicts with a real image or unsupported background fields', async () => {
  const file = new File([new Uint8Array(syntheticPng([30, 60, 90])).buffer], 'background.png', {
    type: 'image/png',
  });
  const original = await createNativeWork(),
    decode = async (blob: Blob) => inspectImageBytes(new Uint8Array(await blob.arrayBuffer()));
  const withImage = await setNativeWorkImage(original, 'background.base', file, decode),
    before = JSON.stringify(withImage);
  await expect(setWorkbenchBackground(withImage, '#123456')).rejects.toThrow(/同时绑定/);
  expect(JSON.stringify(withImage)).toBe(before);
  const solid = await setWorkbenchBackground(original, '#123456');
  await expect(setNativeWorkImage(solid, 'background.base', file, decode)).rejects.toThrow(
    /同时绑定/,
  );
  const invalid = structuredClone(solid) as any;
  invalid.project.direction.style.workbenchBackground2DV1.extra = true;
  await expect(openBBWorkPackage(invalid)).rejects.toThrow(/合同无效/);
});
