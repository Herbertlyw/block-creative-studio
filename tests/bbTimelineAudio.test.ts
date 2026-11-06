import { syntheticAuthoredFixture } from './fixtures/syntheticAuthored';
import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it, vi } from 'vitest';
import { compileBBTimeline } from '../src/contracts/compileBBTimeline';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { compileNativeProductionAudio } from '../src/contracts/nativeProductionAudio';
import * as calibratedRenderer from '../src/contracts/calibratedRenderer';

const syntheticObserved = await syntheticObservedFixture();

const syntheticAuthored = await syntheticAuthoredFixture();

it.each(['human-drag', 'machine'])(
  'mixes %s from the common event timeline with identical PCM',
  async (takeId) => {
    const work = structuredClone(syntheticAuthored);
    const doc = (await inlineBrowserStudioReferences(work.project, {})).document;
    const original = compileNativeTake(doc, takeId).frameSource,
      { source } = compileBBTimeline(doc, takeId);
    for (let i = 0; i < source.totalFrames; i++) {
      expect(source.evaluate(i).semanticEvents).toEqual(original.evaluate(i).semanticEvents);
      expect(source.evaluate(i).identity.stateHash).toBe(original.evaluate(i).identity.stateHash);
    }
    const [a, b] = await Promise.all([
      compileNativeProductionAudio(doc, original),
      compileNativeProductionAudio(doc, source),
    ]);
    expect(b.pcmHash).toBe(a.pcmHash);
    expect(b.track.data).toEqual(a.track.data);
    expect(b.scheduledCues).toEqual(a.scheduledCues);
  },
);

it('mixes the selected observation using the same common event timeline', async () => {
  const work = {
    project: structuredClone(syntheticObserved.document),
    pointer: structuredClone(syntheticObserved.pointer),
  };
  const doc = (await inlineBrowserStudioReferences(work.project, {})).document,
    takeId = 'observed-take';
  const original = prepareCalibratedRenderer(doc, takeId).frameSource,
    { source } = compileBBTimeline(doc, takeId);
  for (let i = 0; i < source.totalFrames; i++) {
    expect(source.evaluate(i).semanticEvents).toEqual(original.evaluate(i).semanticEvents);
    expect(source.evaluate(i).identity.stateHash).toBe(original.evaluate(i).identity.stateHash);
  }
  const [a, b] = await Promise.all([
    compileNativeProductionAudio(doc, original),
    compileNativeProductionAudio(doc, source),
  ]);
  expect(b.pcmHash).toBe(a.pcmHash);
  expect(b.track.data).toEqual(a.track.data);
  expect(b.scheduledCues).toEqual(a.scheduledCues);
});

it('prepares an observed audio timeline without constructing a rendering backend', async () => {
  const work = {
    project: structuredClone(syntheticObserved.document),
    pointer: structuredClone(syntheticObserved.pointer),
  };
  const doc = (await inlineBrowserStudioReferences(work.project, {})).document;
  const renderer = vi
    .spyOn(calibratedRenderer, 'prepareCalibratedRenderer')
    .mockImplementation(() => {
      throw new Error('unexpected renderer');
    });
  try {
    const { source } = compileBBTimeline(doc, 'observed-take');
    expect(source.evaluate(0).identity.takeId).toBe('observed-take');
    expect((await compileNativeProductionAudio(doc, source)).scheduledCues.length).toBeGreaterThan(
      0,
    );
    expect(renderer).not.toHaveBeenCalled();
  } finally {
    renderer.mockRestore();
  }
});
