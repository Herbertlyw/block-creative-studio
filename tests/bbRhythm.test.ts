import { expect, it } from 'vitest';
import { createNativeWork, generateNativeMachineTake } from '../src/contracts/nativeWorkAuthor';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { setBBRhythm, setBBRhythmPreset } from '../src/contracts/setBBRhythm';

it('recompiles a deliberate action interval change while preserving replay and the original', async () => {
  const work = await generateNativeMachineTake(await createNativeWork(), 'machine', 3),
    before = structuredClone(work);
  const old = compileNativeTake(work.project, 'machine');
  const next = await setBBRhythm(work, 'betweenActionFrames', 60),
    updated = compileNativeTake(next.project, 'machine');
  expect(work).toEqual(before);
  expect(updated.compiled.totalFrames).toBeGreaterThan(old.compiled.totalFrames);
  expect((next.project as any).game).toEqual((before.project as any).game);
  expect((next.project as any).takes).toEqual((before.project as any).takes);
  expect((next.project as any).direction.rhythm.betweenActionFrames).toBe(60);
});
it('applies a full rhythm preset and replays the same actions on the shared timeline', async () => {
  const work = await generateNativeMachineTake(await createNativeWork(), 'machine', 3),
    before = structuredClone(work);
  const initial = compileNativeTake(work.project, 'machine').compiled.totalFrames;
  const updated = await setBBRhythmPreset(work, 'tight-fast');
  expect((updated.project as any).direction.rhythm.id).toBe('tight-fast');
  expect(compileNativeTake(updated.project, 'machine').compiled.totalFrames).not.toBe(initial);
  expect((updated.project as any).takes).toEqual((before.project as any).takes);
  expect(work).toEqual(before);
  await expect(setBBRhythmPreset(work, 'unknown')).rejects.toThrow(/不支持/);
});

it('rejects invalid tempo values without changing the work', async () => {
  const work = await createNativeWork(),
    before = structuredClone(work);
  await expect(setBBRhythm(work, 'globalSpeed', 0)).rejects.toThrow(/无效/);
  await expect(setBBRhythm(work, 'clearDurationFrames', 0)).rejects.toThrow(/无效/);
  await expect(setBBRhythm(work, 'unknown' as never, 1)).rejects.toThrow(/不支持/);
  expect(work).toEqual(before);
});
