import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { makeNativeTestAudio } from '../src/exporter/nativeTestAudio';
import { makeNativeV2Fixture } from './fixtures/nativeV2';

it('schedules synthetic audio on the reference frame clock, not a fixed AAC compensation', () => {
  const structure = JSON.parse(
    readFileSync(new URL('./fixtures/synthetic-v2-structure.json', import.meta.url), 'utf8'),
  );
  const { compiled } = compileNativeTake(makeNativeV2Fixture(structure), 'synthetic-take');
  const { pcm, cues } = makeNativeTestAudio(compiled);
  expect(cues.map((cue) => [cue.kind, cue.frame, cue.sample])).toEqual([
    ['place', 50, 80000],
    ['clear', 53, 84800],
    ['place', 121, 193600],
  ]);
  expect(pcm.length).toBe(241600);
  expect(pcm.slice(0, 79000).every((sample) => sample === 0)).toBe(true);
  expect(pcm.slice(80000, 81680).some((sample) => Math.abs(sample) > 0.1)).toBe(true);
});
