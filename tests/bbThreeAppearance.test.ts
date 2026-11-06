import { expect, it } from 'vitest';
import { createNativeWork } from '../src/contracts/nativeWorkAuthor';
import { openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { setBBThreeAppearance, setBBThreeGeometry } from '../src/contracts/setBBThreeAppearance';

it('saves one 3D material change while preserving the original and gameplay', async () => {
  const original = await createNativeWork(),
    before = structuredClone(original);
  const next = await setBBThreeAppearance(original, 'material', 'crystal-glass');
  expect(original).toEqual(before);
  const beforeProject = before.project as any,
    afterProject = (await openBBWorkPackage(next)).project as any;
  expect(afterProject.direction.style.material).toBe('crystal-glass');
  expect(afterProject.game).toEqual(beforeProject.game);
  expect(afterProject.takes).toEqual(beforeProject.takes);
  expect(afterProject.direction.style.camera).toBe(beforeProject.direction.style.camera);
  expect(afterProject.direction.style.reference2d).toEqual(
    beforeProject.direction.style.reference2d,
  );
});

it('rejects unsupported 3D options and invalid colors without changing the work', async () => {
  const original = await createNativeWork(),
    before = structuredClone(original);
  await expect(setBBThreeAppearance(original, 'lighting', 'neutral-lookdev')).rejects.toThrow(
    /不支持/,
  );
  await expect(setBBThreeAppearance(original, 'background', 'not-a-color')).rejects.toThrow(/颜色/);
  await expect(setBBThreeAppearance(original, 'unknown' as never, 'value')).rejects.toThrow(
    /不支持的 3D 外观字段/,
  );
  expect(original).toEqual(before);
});
it('persists one 3D geometry dimension and rejects out-of-range changes', async () => {
  const original = await createNativeWork(),
    before = structuredClone(original);
  const next = await setBBThreeGeometry(original, 'depth', 0.55),
    prior = (before.project as any).direction.style.geometry,
    geometry = (next.project as any).direction.style.geometry;
  expect(geometry).toEqual({ ...prior, depth: 0.55 });
  expect(original).toEqual(before);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(next)))).project).toEqual(next.project);
  await expect(setBBThreeGeometry(original, 'depth', 3)).rejects.toThrow(/范围/);
  await expect(setBBThreeGeometry(original, 'bad' as never, 0)).rejects.toThrow(/范围/);
});
