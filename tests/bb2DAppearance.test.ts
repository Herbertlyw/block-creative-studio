import { expect, it } from 'vitest';
import {
  createNativeWork,
  createNativeTake,
  appendNativeMove,
} from '../src/contracts/nativeWorkAuthor';
import { openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { setBB2DAppearance, setBBDisplaySetting } from '../src/contracts/setBB2DAppearance';

it('saves a supported clear effect without changing gameplay, timing or the original work', async () => {
  let original = await createNativeWork();
  original = await createNativeTake(original, 'human');
  const source = original.project as any,
    piece = source.game.initialState.data.pieces[0];
  // A newly generated candidate may have no legal placement at the origin.
  let recorded: typeof original | null = null;
  for (let row = 0; row < 8 && !recorded; row++)
    for (let col = 0; col < 8 && !recorded; col++)
      try {
        recorded = await appendNativeMove(
          original,
          'human',
          piece.id,
          row,
          col,
          'human',
          [
            { frameOffset: 0, x: 0.2, y: 0.8 },
            { frameOffset: 15, x: 0.5, y: 0.5 },
          ],
          15,
        );
      } catch {
        /* try the next anchor */
      }
  expect(recorded).not.toBeNull();
  original = recorded!;
  const before = structuredClone(original);
  const updated = await setBB2DAppearance(original, 'clearFx', 'laser-slice');
  expect(original).toEqual(before);
  const prior = before.project as any,
    next = (await openBBWorkPackage(updated)).project as any;
  expect(next.direction.style.reference2d.clearFx).toBe('laser-slice');
  expect(next.game).toEqual(prior.game);
  expect(next.takes).toEqual(prior.takes);
  expect(next.direction.rhythm).toEqual(prior.direction.rhythm);
});

it('rejects unknown settings without modifying the original', async () => {
  const original = await createNativeWork(),
    before = structuredClone(original);
  await expect(setBB2DAppearance(original, 'clearFx', 'imaginary')).rejects.toThrow(/不支持/);
  await expect(setBB2DAppearance(original, 'unknown' as never, 'none')).rejects.toThrow(/不支持/);
  expect(original).toEqual(before);
});

it('restores the skin default rather than confusing an omitted effect with none', async () => {
  const original = await createNativeWork();
  const disabled = await setBB2DAppearance(original, 'screenFx', 'none');
  const restored = await setBB2DAppearance(disabled, 'screenFx', 'default');
  expect((disabled.project as any).direction.style.reference2d.screenFx).toBe('none');
  expect(Object.hasOwn((restored.project as any).direction.style.reference2d, 'screenFx')).toBe(
    false,
  );
  expect(restored).toEqual(original);
});
it('persists best score and pointer visibility without changing gameplay', async () => {
  const original = await createNativeWork(),
    before = structuredClone(original);
  const next = await setBBDisplaySetting(
    await setBBDisplaySetting(original, 'bestScore', 1234),
    'showPointer',
    false,
  );
  expect((next.project as any).direction.style.reference2d.bestScore).toBe(1234);
  expect((next.project as any).direction.style.showPointer).toBe(false);
  expect((next.project as any).game).toEqual((before.project as any).game);
  expect(original).toEqual(before);
  expect((await openBBWorkPackage(JSON.parse(JSON.stringify(next)))).project).toEqual(next.project);
  await expect(setBBDisplaySetting(original, 'bestScore', -1)).rejects.toThrow(/无效/);
});
