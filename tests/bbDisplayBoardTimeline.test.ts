import { expect, it } from 'vitest';
import {
  createBBDisplayBoardTimeline,
  evaluateBBDisplayBoard,
} from '../src/games/block-placement/planning/displayBoardTimeline';

it('keeps the placed board until the supplied clear boundary, independent of rule commit', () => {
  const initial = [['blue', null]],
    placed = [['blue', 'blue']],
    cleared = [[null, null]];
  const plan = createBBDisplayBoardTimeline(initial, [
    { actionId: 'move', commitSeconds: 0.7, finalBoardSeconds: 0.9, placed, after: cleared },
  ]);
  expect(evaluateBBDisplayBoard(plan, 0, 0.69)).toEqual(initial);
  expect(evaluateBBDisplayBoard(plan, 1, 0.7)).toEqual(placed);
  expect(evaluateBBDisplayBoard(plan, 1, 0.899)).toEqual(placed);
  expect(evaluateBBDisplayBoard(plan, 1, 0.9)).toEqual(cleared);
  const sampled = evaluateBBDisplayBoard(plan, 1, 0.7);
  sampled[0]![0] = null;
  expect(evaluateBBDisplayBoard(plan, 1, 0.7)).toEqual(placed);
  expect(() => evaluateBBDisplayBoard(plan, 1, 0.6)).toThrow(/COMMIT_MISMATCH/);
});

it('rejects malformed boards and mismatched or reversed action boundaries', () => {
  expect(() => createBBDisplayBoardTimeline([[null], [null, null]], [])).toThrow(/BOARD_INVALID/);
  const board = [[null]];
  expect(() =>
    createBBDisplayBoardTimeline(board, [
      { actionId: 'a', commitSeconds: 1, finalBoardSeconds: 0.5, placed: board, after: board },
    ]),
  ).toThrow(/STEP_INVALID/);
  expect(() =>
    createBBDisplayBoardTimeline(board, [
      { actionId: 'a', commitSeconds: 1, finalBoardSeconds: 1, placed: board, after: board },
      { actionId: 'a', commitSeconds: 2, finalBoardSeconds: 2, placed: board, after: board },
    ]),
  ).toThrow(/STEP_INVALID/);
});
