import { expect, it } from 'vitest';
import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { ordinaryProject } from './fixtures/ordinaryProject';
import { createBBWorkPackage, updateBBWorkPackageProject } from '../src/contracts/bbWorkPackage';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { verifyObservedPointer } from '../src/contracts/observedPointer';
import { observedPreClipSourceHash } from '../src/contracts/observedClipIdentity';
import { compileBBTimeline } from '../src/contracts/compileBBTimeline';
import { mediaWindow, needsShortAudioProbe } from '../src/cli/mediaContract';
import { stableHash } from '../src/nativeReference/headless/stableHash';
import { compileProductionAudio } from '../src/nativeReference/agent-director/audioMix';
import { createBCDemo } from '../src/games/block-crush/demo';
import { compileBCPlayback } from '../src/games/block-crush/timeline';

it('accepts verified observed pre-clip identity without ignoring stale pointer or other production fields', async () => {
  const { document, pointer } = await syntheticObservedFixture();
  const take = document.takes[0]!,
    verified = await verifyObservedPointer(document, pointer);
  const original = prepareCalibratedRenderer(document, take.takeId, verified).frameSource;
  const work = await createBBWorkPackage(document, pointer, null);
  const edited: any = structuredClone(document);
  edited.direction.production.clips = [
    {
      id: 'opening',
      takeId: take.takeId,
      source: { takeHash: stableHash(take), frameSourceHash: original.frameSourceHash },
      startFrame: 15,
      endFrame: 20,
    },
  ];
  edited.direction.production.selectedClipId = 'opening';
  const updated = await updateBBWorkPackageProject(work, edited);
  const updatedPointer = await verifyObservedPointer(updated.project, updated.pointer);
  expect(() => prepareCalibratedRenderer(updated.project, take.takeId, updatedPointer)).toThrow(
    /clips/,
  );
  expect(() =>
    compileBBTimeline(updated.project, take.takeId, { allowClipMetadata: true }),
  ).not.toThrow();
  const actual = prepareCalibratedRenderer(updated.project, take.takeId, updatedPointer, {
    allowClipMetadata: true,
  }).frameSource;
  expect(actual.frameSourceHash).not.toBe(original.frameSourceHash);
  const equivalent = await observedPreClipSourceHash(updated.project, updatedPointer, take.takeId);
  expect(equivalent).toBe(original.frameSourceHash);
  for (const frame of [0, 15, 20, 50]) {
    expect(actual.evaluate(frame).payload).toEqual(original.evaluate(frame).payload);
    expect(actual.evaluate(frame).semanticEvents).toEqual(original.evaluate(frame).semanticEvents);
  }
  expect(
    mediaWindow(
      { takeId: take.takeId, scope: 'clip', clipId: 'opening' },
      actual.totalFrames,
      take,
      actual.frameSourceHash,
      edited.direction.production.clips,
      [equivalent],
    ),
  ).toMatchObject({ startFrame: 15, endFrame: 20, totalFrames: 6 });
  const changed = {
    ...updatedPointer,
    style: { ...updatedPointer.style, radius: updatedPointer.style.radius + 1 },
  };
  const changedVerified = await verifyObservedPointer(updated.project, changed);
  const changedIdentity = await observedPreClipSourceHash(
    updated.project,
    changedVerified,
    take.takeId,
  );
  expect(changedIdentity).not.toBe(equivalent);
  expect(() =>
    mediaWindow(
      { takeId: take.takeId, scope: 'clip', clipId: 'opening' },
      actual.totalFrames,
      take,
      actual.frameSourceHash,
      edited.direction.production.clips,
      [changedIdentity],
    ),
  ).toThrow(/CLIP_SOURCE_STALE/);
  const unsupported: any = structuredClone(updated.project);
  unsupported.direction.production.camera = { renderer: 'reference-2d' };
  expect(() =>
    prepareCalibratedRenderer(unsupported, take.takeId, null, { allowClipMetadata: true }),
  ).toThrow(/camera/);
});

it('mixes absolute BB and BC windows identically to full-take PCM, including a continuing cue', () => {
  const bb: any = ordinaryProject(),
    bc: any = createBCDemo();
  const cases = [
    { project: bb, source: compileBBTimeline(bb, 'synthetic-take').source, start: 51, end: 80 },
    { project: bc, source: compileBCPlayback(bc, 'demo', true).source, start: 33, end: 62 },
  ];
  for (const { project, source, start, end } of cases) {
    const before = JSON.stringify(project),
      audio = project.direction.production.audio;
    const full = compileProductionAudio(source, audio, 48_000);
    const window = compileProductionAudio(source, audio, 48_000, {
      startFrame: start,
      endFrame: end,
    });
    const offset = Math.round((start / source.fps) * 48_000) * 2;
    expect(window.track.data).toEqual(
      full.track.data.slice(offset, offset + window.track.data.length),
    );
    expect(window.scheduledCues.some((cue) => cue.sourceOffsetSamples > 0)).toBe(true);
    expect(JSON.stringify(project)).toBe(before);
  }
});

it('uses the separate AAC encoder probe only for short audio-bearing clips', () => {
  expect(needsShortAudioProbe(1, 30, true)).toBe(true);
  expect(needsShortAudioProbe(29, 30, true)).toBe(true);
  expect(needsShortAudioProbe(30, 30, true)).toBe(false);
  expect(needsShortAudioProbe(1, 30, false)).toBe(false);
});
