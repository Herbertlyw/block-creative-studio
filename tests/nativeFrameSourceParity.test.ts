import { syntheticAuthoredFixture } from './fixtures/syntheticAuthored';
import { ordinaryProject } from './fixtures/ordinaryProject';
import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it, vi } from 'vitest';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { blockPlacementPacketFromFrame } from '../src/nativeReference/games/block-placement/presentation/legacyPresentationAdapter';
import { readBBFrame } from '../src/games/block-placement/planning/timelineFrameSource';
import { authoredPacketFrame } from '../src/games/block-placement/presentation/evaluateAuthoredFrame';
import { evaluateCompiledTake } from '../src/nativeReference/games/block-placement/presentation/presentationCompiler';
import * as frozenCompiler from '../src/nativeReference/games/block-placement/presentation/presentationCompiler';

const legacyFrame = (
  packet: ReturnType<ReturnType<typeof compileNativeTake>['frameSource']['evaluate']>,
) => authoredPacketFrame(readBBFrame(packet), packet.identity.fps, packet.identity.totalFrames);

const syntheticAuthored = await syntheticAuthoredFixture();
const observed = await syntheticObservedFixture();

it('feeds the same frames to normal rendering and semantic audio across a clear', () => {
  const doc = ordinaryProject();
  const { compiled, rhythm, frameSource } = compileNativeTake(doc, 'synthetic-take');
  const types = new Set<string>();
  for (let frame = 0; frame < frameSource.totalFrames; frame++) {
    const packet = frameSource.evaluate(frame);
    const reference = evaluateCompiledTake(compiled, frame, rhythm);
    const baseline = blockPlacementPacketFromFrame('synthetic-take', reference);
    expect(legacyFrame(packet)).toEqual(reference);
    expect(packet.semanticEvents).toEqual(baseline.semanticEvents);
    expect(
      blockPlacementPacketFromFrame('synthetic-take', legacyFrame(packet)).identity
        .presentationHash,
    ).toBe(baseline.identity.presentationHash);
    for (const event of packet.semanticEvents) types.add(event.type);
  }
  expect(types.has('block-placement.cross-cleared')).toBe(true);
  expect(types.has('block-placement.placement-committed')).toBe(true);
});

it('binds frame-source identity to motion even when timing and game states are unchanged', () => {
  const doc = structuredClone(observed.document);
  const changed = structuredClone(doc);
  changed.takes[0]!.interactions![0]!.samples![0]!.x = 0.31;
  const a = compileNativeTake(doc, 'observed-take'),
    b = compileNativeTake(changed, 'observed-take');
  expect(a.compiled.actions.map((x) => [x.startFrame, x.releaseFrame, x.clearStartFrame])).toEqual(
    b.compiled.actions.map((x) => [x.startFrame, x.releaseFrame, x.clearStartFrame]),
  );
  expect(a.compiled.final).toEqual(b.compiled.final);
  expect(a.frameSource.frameSourceHash).not.toBe(b.frameSource.frameSourceHash);
  expect(legacyFrame(a.frameSource.evaluate(31)).pointer?.x).not.toBe(
    legacyFrame(b.frameSource.evaluate(31)).pointer?.x,
  );
});

it.each([30, 45, 60])('preserves every ordinary display frame at %i fps', (fps) => {
  const doc = ordinaryProject();
  doc.production.output.fps = fps;
  const { compiled, rhythm, frameSource } = compileNativeTake(doc, 'synthetic-take');
  for (let frame = 0; frame < frameSource.totalFrames; frame++)
    expect(legacyFrame(frameSource.evaluate(frame))).toEqual(
      evaluateCompiledTake(compiled, frame, rhythm),
    );
});

it('evaluates the production authored source without calling the frozen visual evaluator', () => {
  const doc = ordinaryProject();
  const spy = vi.spyOn(frozenCompiler, 'evaluateCompiledTake').mockImplementation(() => {
    throw new Error('frozen evaluator was called');
  });
  try {
    const { frameSource } = compileNativeTake(doc, 'synthetic-take');
    for (let frame = 0; frame < frameSource.totalFrames; frame++) frameSource.evaluate(frame);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

it.each(['human-drag', 'machine'])(
  'preserves every authored event for %s across the complete take',
  (takeId) => {
    const doc = structuredClone(syntheticAuthored).project;
    const { compiled, rhythm, frameSource } = compileNativeTake(doc, takeId);
    for (let frame = 0; frame < frameSource.totalFrames; frame++) {
      const expected = blockPlacementPacketFromFrame(
        takeId,
        evaluateCompiledTake(compiled, frame, rhythm),
      );
      const actual = frameSource.evaluate(frame);
      expect(actual.semanticEvents).toEqual(expected.semanticEvents);
      expect(
        blockPlacementPacketFromFrame(takeId, legacyFrame(actual)).identity.presentationHash,
      ).toBe(expected.identity.presentationHash);
    }
  },
);

it.each([0, 1, 4])('preserves release and clear boundaries with %i delay frames', (delay) => {
  const doc = ordinaryProject();
  doc.direction.rhythm.clearDelayFrames = delay;
  doc.direction.rhythm.placementSettleFrames = 0;
  const { compiled, rhythm, frameSource } = compileNativeTake(doc, 'synthetic-take');
  for (let frame = 0; frame < frameSource.totalFrames; frame++) {
    const reference = blockPlacementPacketFromFrame(
      'synthetic-take',
      evaluateCompiledTake(compiled, frame, rhythm),
    );
    const actual = frameSource.evaluate(frame);
    expect(legacyFrame(actual)).toEqual(reference.payload);
    expect(actual.semanticEvents).toEqual(reference.semanticEvents);
  }
});

it.each(['easeOutCubic', 'easeInOutCubic', 'easeOutBack'] as const)(
  'preserves authored motion with %s easing',
  (easing) => {
    const doc = structuredClone(syntheticAuthored).project;
    doc.direction.rhythm.easing = easing;
    const { compiled, rhythm, frameSource } = compileNativeTake(doc, 'machine');
    for (let frame = 0; frame < frameSource.totalFrames; frame++)
      expect(legacyFrame(frameSource.evaluate(frame))).toEqual(
        evaluateCompiledTake(compiled, frame, rhythm),
      );
  },
);
