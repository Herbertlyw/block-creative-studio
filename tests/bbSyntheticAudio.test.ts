import { expect, it } from 'vitest';
import { syntheticObservedPackageFixture } from './fixtures/syntheticObserved';
import { createBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { createNativeWork, generateNativeMachineTake } from '../src/contracts/nativeWorkAuthor';
import { openBBWorkPackage } from '../src/contracts/bbWorkPackage';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import {
  DEFAULT_BB_TEST_AUDIO,
  readBBTestAudio,
  setBBTestAudio,
} from '../src/contracts/bbSyntheticAudio';
import {
  makeBBConfiguredTestAudio,
  makeBBDefaultTestAudio,
} from '../src/exporter/bbSyntheticAudio';
import { makeNativeTestAudio } from '../src/exporter/nativeTestAudio';
import type { CompiledFrameSource } from '../src/nativeReference/game-runtime/frameSource';

it('keeps diagnostic tone timing and samples on the shared ordinary event clock', async () => {
  const work = await generateNativeMachineTake(await createNativeWork(), 'machine', 3),
    compiled = compileNativeTake(work.project, 'machine');
  expect(makeBBDefaultTestAudio(compiled.frameSource, 'authored')).toEqual(
    makeNativeTestAudio(compiled.compiled).pcm,
  );
});
it('deduplicates event spans, applies per-event gain/offset and reports unmatched or truncated cues', () => {
  const placement = { id: 'commit-a', type: 'block-placement.placement-committed' },
    clear = { id: 'line-a', type: 'block-placement.line-cleared' };
  const source = {
    fps: 10,
    totalFrames: 20,
    evaluate: (frame: number) => ({
      semanticEvents: frame === 5 || frame === 6 ? [placement] : frame === 10 ? [clear] : [],
    }),
  } as unknown as CompiledFrameSource;
  const config = {
    ...structuredClone(DEFAULT_BB_TEST_AUDIO),
    bgmGain: 0,
    cueOverrides: [
      { kind: 'place' as const, gain: 0.1, offsetSeconds: 0 },
      { kind: 'place' as const, eventId: 'commit-a', gain: 0.5, offsetSeconds: 0.1 },
      { kind: 'praise' as const, eventId: 'missing', gain: 1, offsetSeconds: 0 },
      { kind: 'line-cleared' as const, gain: 1, offsetSeconds: 2 },
    ],
  };
  const result = makeBBConfiguredTestAudio(source, config);
  expect(result.events).toHaveLength(2);
  expect(result.events[0]).toMatchObject({
    id: 'commit-a',
    frame: 5,
    startSample: 28800,
    truncated: false,
  });
  expect(result.events[1]?.truncated).toBe(true);
  expect(result.warning).toMatch(/未命中/);
  expect(result.warning).toMatch(/超出视频边界/);
  expect(result.pcm.slice(0, 28800).every((value) => value === 0)).toBe(true);
  expect(result.pcm.slice(28800, 29000).some((value) => value !== 0)).toBe(true);
});
it('saves test mix settings without changing real WAV or observed source tracks', async () => {
  const fixture = await syntheticObservedPackageFixture(),
    original = await createBBWorkPackage(fixture.project, fixture.pointer, fixture.source),
    before = JSON.stringify(original);
  const updated = await setBBTestAudio(original, structuredClone(DEFAULT_BB_TEST_AUDIO));
  expect(readBBTestAudio(updated.project)?.bgmPattern).toBe('melody-v1');
  expect((updated.project as any).direction.production.audio).toEqual(
    fixture.project.direction.production.audio,
  );
  expect(updated.pointer?.tracks).toEqual(fixture.pointer.tracks);
  expect(updated.source?.observation).toEqual(fixture.source.observation);
  expect(JSON.stringify(original)).toBe(before);
  await openBBWorkPackage(JSON.parse(JSON.stringify(updated)));
  const invalid = structuredClone(updated) as any;
  invalid.project.direction.style.workbenchSyntheticAudioV1.bgmGain = 2;
  await expect(openBBWorkPackage(invalid)).rejects.toThrow(/合同无效/);
});
