import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it } from 'vitest';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import { pointerAt, verifyObservedPointer } from '../src/contracts/observedPointer';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import {
  evaluateBBTimeline,
  validateBBTimelinePlan,
} from '../src/games/block-placement/planning/bbTimelinePlan';

const syntheticObserved = await syntheticObservedFixture();

it('samples the independently confirmed observed pointer at every output frame', async () => {
  const work = {
    project: structuredClone(syntheticObserved.document),
    pointer: structuredClone(syntheticObserved.pointer),
  };
  const pointer = await verifyObservedPointer(work.project, work.pointer);
  const doc = (await inlineBrowserStudioReferences(work.project, {})).document;
  const prepared = prepareCalibratedRenderer(doc, pointer.takeId, pointer),
    plan = prepared.timelinePlan;
  for (let frame = 0; frame < plan.totalFrames; frame++) {
    const expected = pointerAt(pointer, frame / plan.fps),
      actual = evaluateBBTimeline(plan, frame).pointer;
    expect(actual ? { actionId: actual.actionId, x: actual.x, y: actual.y } : null).toEqual(
      expected,
    );
  }
  const invalid = {
    ...plan,
    pointers: plan.pointers.map((track, index) =>
      index === 0 ? { ...track, actionId: 'wrong-action' } : track,
    ),
  };
  expect(() => validateBBTimelinePlan(invalid)).toThrow(/POINTER_INVALID/);
});
