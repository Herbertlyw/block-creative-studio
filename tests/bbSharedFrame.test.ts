import { syntheticAuthoredFixture } from './fixtures/syntheticAuthored';
import { syntheticObservedFixture } from './fixtures/syntheticObserved';
import { expect, it, vi } from 'vitest';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { prepareCalibratedRenderer } from '../src/contracts/calibratedRenderer';
import { inlineBrowserStudioReferences } from '../src/contracts/browserAssetReferences';
import {
  readBBFrame,
  BB_FRAME_SCHEMA,
} from '../src/games/block-placement/planning/timelineFrameSource';
import { compileBBTimeline } from '../src/contracts/compileBBTimeline';
import * as evaluator from '../src/games/block-placement/planning/bbTimelinePlan';

const syntheticObserved = await syntheticObservedFixture();

const syntheticAuthored = await syntheticAuthoredFixture();

it('uses the same frame source and actual evaluator for authored and observed samples', async () => {
  const authored = structuredClone(syntheticAuthored).project;
  const observation = {
    project: structuredClone(syntheticObserved.document),
    pointer: structuredClone(syntheticObserved.pointer),
  }.project;
  const { timelinePlan, frameSource: ordinary } = compileNativeTake(authored, 'human-drag');
  const validated = compileBBTimeline(authored, 'human-drag').source;
  expect(validated.frameSourceHash).toBe(ordinary.frameSourceHash);
  const observed = prepareCalibratedRenderer(
    (await inlineBrowserStudioReferences(observation, {})).document,
    'observed-take',
  ).frameSource;
  const spy = vi.spyOn(evaluator, 'evaluateBBTimeline');
  try {
    const authoredIndex = timelinePlan.actions[0]!.motion.start;
    const a = ordinary.evaluate(authoredIndex),
      b = observed.evaluate(6);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(a.payloadSchemaId).toBe(BB_FRAME_SCHEMA);
    expect(b.payloadSchemaId).toBe(BB_FRAME_SCHEMA);
    const first = readBBFrame(a),
      second = readBBFrame(b);
    expect(first.activeAction?.actionId).toBe('human-drag-action-1');
    expect(first.drag?.pose.anchor).toBe('center');
    expect(second.activeAction?.actionId).toBe('1');
    expect(second.drag?.pose.anchor).toBe('top-left');
    expect(second.geometry.canvas).toEqual({ width: 1080, height: 1920 });
    expect(first.geometry.canvas).toEqual({ width: 1064, height: 1788 });
    for (const sample of [first, second]) {
      const board = sample.geometry.board;
      expect(sample.boardDrawables).toHaveLength(board.rows * board.cols);
      for (const cell of sample.boardDrawables) {
        expect(cell).toMatchObject({
          x: board.x + cell.col * board.pitch,
          y: board.y + cell.row * board.pitch,
          size: board.cell,
          color: sample.board[cell.row]![cell.col],
        });
      }
    }
    expect(readBBFrame(observed.evaluate(21)).rules.gameState.turn).toBe(1);
    expect(() => readBBFrame({ ...b, identity: { ...b.identity, frameIndex: 7 } })).toThrow(
      /BB_FRAME_CONTRACT_INVALID/,
    );
    expect(() => readBBFrame({ ...b, identity: { ...b.identity, takeId: 'other' } })).toThrow(
      /BB_FRAME_CONTRACT_INVALID/,
    );
    expect(() => readBBFrame({ ...b, identity: { ...b.identity, fps: 60 } })).toThrow(
      /BB_FRAME_CONTRACT_INVALID/,
    );
    const altered = structuredClone(b),
      alteredFrame = (altered.payload as { frame: evaluator.BBTimelineFrame }).frame;
    alteredFrame.boardDrawables[0]!.x += 1;
    expect(() => readBBFrame(altered)).toThrow(/BB_FRAME_BOARD_INVALID/);
  } finally {
    spy.mockRestore();
  }
});
