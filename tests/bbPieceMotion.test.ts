import { syntheticAuthoredFixture } from './fixtures/syntheticAuthored';
import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it } from 'vitest';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import {
  evaluateBBTimeline,
  validateBBTimelinePlan,
} from '../src/games/block-placement/planning/bbTimelinePlan';
import { readCalibratedFrame } from '../src/contracts/calibratedFrame';
import { getShape } from '../src/nativeReference/games/block-placement/runtime/shapes';
import { referenceRackPose } from '../src/games/block-placement/calibrated/rackPose';
import { materialCellMetrics } from '../src/nativeReference/games/block-placement/render/materialThemes';
import { evaluateCompiledTake } from '../src/nativeReference/games/block-placement/presentation/presentationCompiler';

const syntheticObserved = await syntheticObservedFixture();

const syntheticAuthored = await syntheticAuthoredFixture();

it.each(['human-drag', 'machine'])(
  'carries the authored %s piece identity, shape and hover on the shared timeline',
  (takeId) => {
    const work = structuredClone(syntheticAuthored);
    const { timelinePlan, compiled, rhythm } = compileNativeTake(work.project, takeId);
    for (let i = 0; i < timelinePlan.totalFrames; i++) {
      const sampled = evaluateBBTimeline(timelinePlan, i),
        legacy = evaluateCompiledTake(compiled, i, rhythm);
      if (!legacy.draggedPiece) {
        expect(sampled.drag).toBeNull();
        continue;
      }
      expect(sampled.drag).toMatchObject({
        actionId: legacy.currentActionId,
        pieceId: legacy.draggedPiece.piece.id,
        hover: legacy.draggedPiece.anchor.row < 0 ? null : legacy.draggedPiece.anchor,
        pose: {
          x: legacy.pointer!.x * 1064,
          y: legacy.pointer!.y * 1788,
          space: 'design',
          anchor: 'center',
          size: expect.any(Number),
          pitch: expect.any(Number),
        },
        progress: legacy.draggedPiece.progress,
      });
      expect(sampled.drag!.cells.length).toBeGreaterThan(0);
      const t = Math.max(0, Math.min(1, legacy.draggedPiece.progress / 0.25)),
        pickup = 1 - (1 - t) ** 3;
      const metrics = materialCellMetrics(
        work.project.direction.style.reference2d.cellGapPx,
        pickup,
      );
      expect(sampled.drag!.pose.size).toBe(metrics.dragSize);
      expect(sampled.drag!.pose.pitch).toBe(metrics.dragPitch);
    }
    const invalid = {
      ...timelinePlan,
      pieces: timelinePlan.pieces.map((piece, index) =>
        index ? piece : { ...piece, actionId: 'other' },
      ),
    };
    expect(() => validateBBTimelinePlan(invalid)).toThrow(/ACTION_MISMATCH/);
  },
);

it('uses the selected material gap for authored geometry without changing timing or rules', () => {
  const work = structuredClone(syntheticAuthored);
  const base = compileNativeTake(work.project, 'human-drag'),
    style = structuredClone(work.project.direction.style);
  style.reference2d.cellGapPx = 8;
  const variant = compileNativeTake(work.project, 'human-drag', style);
  const i = base.compiled.actions[0]!.startFrame + 1,
    a = evaluateBBTimeline(base.timelinePlan, i),
    b = evaluateBBTimeline(variant.timelinePlan, i);
  expect(a.rules.logicalStateHash).toBe(b.rules.logicalStateHash);
  expect(a.events).toEqual(b.events);
  expect(base.frameSource.frameSourceHash).not.toBe(variant.frameSource.frameSourceHash);
  expect(base.timelinePlan.identity).toBe(variant.timelinePlan.identity);
  expect(a.drag!.pose.size).not.toBe(b.drag!.pose.size);
  expect(b.rackDrawables[0]!.size).toBe(materialCellMetrics(8).rackSize);
});

it('uses the shared sampler for confirmed observation geometry and keeps returned objects isolated', async () => {
  const work = {
    project: structuredClone(syntheticObserved.document),
    pointer: structuredClone(syntheticObserved.pointer),
  };
  const doc = (await inlineBrowserStudioReferences(work.project, {})).document;
  const { timelinePlan, frameSource } = prepareCalibratedRenderer(doc, 'observed-take');
  for (let i = 0; i < timelinePlan.totalFrames; i++) {
    const sampled = evaluateBBTimeline(timelinePlan, i),
      rendered = readCalibratedFrame(frameSource.evaluate(i));
    expect(
      sampled.clearEffects.map(({ index, actionId, age, clearAge, combo, rows, cols, cells }) => ({
        index,
        actionId,
        age,
        clearAge,
        combo,
        rows,
        cols,
        cells: cells.map(({ row, col }) => ({ row, col })),
      })),
    ).toEqual(
      rendered.clearEffects.map(({ index, actionId, age, clearAge, combo, rows, cols, cells }) => ({
        index,
        actionId,
        age,
        clearAge,
        combo,
        rows,
        cols,
        cells,
      })),
    );
    const visible = rendered.rackState.pieces.filter(
      (piece) =>
        !piece.used &&
        piece.id !== rendered.previewDrag?.pieceId &&
        piece.id !== sampled.drag?.pieceId,
    );
    expect(sampled.rackDrawables.map((item) => item.piece.id)).toEqual(
      visible.map((piece) => piece.id),
    );
    for (const item of sampled.rackDrawables) {
      const expected = referenceRackPose(
        work.project.direction.style.referenceCalibration,
        item.piece,
        getShape(item.piece.shapeId).cells,
      );
      expect(item).toMatchObject(expected);
    }
    if (!rendered.drag) {
      expect(sampled.drag).toBeNull();
      continue;
    }
    expect(sampled.drag).toMatchObject({
      actionId: rendered.actionId,
      pieceId: rendered.activeAction!.step.piece.id,
      pose: { ...rendered.drag, pitch: rendered.drag.size, space: 'design', anchor: 'top-left' },
    });
  }
  const first = evaluateBBTimeline(timelinePlan, 6).drag!;
  (first.target as { row: number }).row = 99;
  expect(evaluateBBTimeline(timelinePlan, 6).drag!.target.row).not.toBe(99);
  const rack = evaluateBBTimeline(timelinePlan, 0).rackDrawables[0]!;
  rack.piece.used = true;
  expect(evaluateBBTimeline(timelinePlan, 0).rackDrawables[0]!.piece.used).toBe(false);
});
