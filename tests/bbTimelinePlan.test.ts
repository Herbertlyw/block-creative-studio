import { syntheticAuthoredFixture } from './fixtures/syntheticAuthored';
import { expect, it } from 'vitest';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { normalizeAuthoredTake } from '../src/games/block-placement/planning/normalizeAuthoredTake';
import {
  evaluateBBTimeline,
  validateBBTimelinePlan,
} from '../src/games/block-placement/planning/bbTimelinePlan';

const syntheticAuthored = await syntheticAuthoredFixture();

it('samples committed game state, display board and events on one frame clock', () => {
  const doc = structuredClone(syntheticAuthored).project;
  const { compiled, rhythm, frameSource } = compileNativeTake(doc, 'human-drag');
  const plan = normalizeAuthoredTake('human-drag', compiled, rhythm),
    action = compiled.actions[0]!;
  const commit = action.releaseFrame + 1;
  const before = evaluateBBTimeline(plan, commit - 1),
    after = evaluateBBTimeline(plan, commit);
  expect(before.activeAction?.phase).toBe('drag');
  expect(after.activeAction?.phase).toBe('placed');
  expect(evaluateBBTimeline(plan, action.clearStartFrame).activeAction?.phase).toBe('clearing');
  expect(evaluateBBTimeline(plan, action.clearEndFrame + 1).activeAction?.phase).toBe('settled');
  expect(before.rules.completedCount).toBe(0);
  expect(after.rules.completedCount).toBe(1);
  expect(after.rules.gameState.board.cells[0]!.every((cell) => cell === null)).toBe(true);
  expect(after.board[0]!.every((cell) => cell !== null)).toBe(true);
  expect(after.events).toEqual(frameSource.evaluate(commit).semanticEvents);
  expect(() => evaluateBBTimeline(plan, plan.totalFrames)).toThrow(/OUT_OF_RANGE/);
});

it('rejects a display transition bound to a different action', () => {
  const doc = structuredClone(syntheticAuthored).project;
  const { compiled, rhythm } = compileNativeTake(doc, 'human-drag');
  const plan = normalizeAuthoredTake('human-drag', compiled, rhythm);
  plan.display.steps[0]!.actionId = 'different';
  expect(() => validateBBTimelinePlan(plan)).toThrow(/ACTION_MISMATCH/);
});

it('samples recolor feedback from the active action and expires it on the common clock', () => {
  const doc = structuredClone(syntheticAuthored).project;
  const { compiled, rhythm } = compileNativeTake(doc, 'human-drag');
  const plan = {
    ...structuredClone(normalizeAuthoredTake('human-drag', compiled, rhythm)),
    recolorFlash: true,
  };
  const render = plan.renderActions[0]!;
  for (let col = 0; col < plan.geometry.board.cols; col++) {
    render.step.before.board.cells[0]![col] = 'white';
    render.step.after.board.cells[0]![col] = 'cyan';
  }
  const start = Math.ceil(render.timing.clear * plan.fps);
  const before = evaluateBBTimeline(plan, start - 1),
    first = evaluateBBTimeline(plan, start),
    later = evaluateBBTimeline(plan, start + 3),
    after = evaluateBBTimeline(plan, Math.ceil((render.timing.clear + 0.4) * plan.fps));
  expect(before.recolorFlash).toBeNull();
  expect(first.recolorFlash?.actionId).toBe(render.step.action.id);
  expect(first.recolorFlash?.cells).toEqual(
    Array.from({ length: plan.geometry.board.cols }, (_, col) => ({ row: 0, col })),
  );
  expect(first.recolorFlash!.opacity).toBeGreaterThan(later.recolorFlash!.opacity);
  expect(after.recolorFlash).toBeNull();
});

it('samples appearance surfaces without changing rule or display board colors', () => {
  const doc = structuredClone(syntheticAuthored).project;
  const { compiled, rhythm } = compileNativeTake(doc, 'human-drag');
  const original = normalizeAuthoredTake('human-drag', compiled, rhythm);
  const frameIndex = compiled.actions[0]!.releaseFrame + 1;
  const start = frameIndex / original.fps,
    end = (frameIndex + 2) / original.fps;
  const plan = {
    ...structuredClone(original),
    boardSurface: {
      start,
      end,
      faces: Array.from({ length: 8 }, () => Array(8).fill(2)),
      dragPreview: true,
    },
  };
  validateBBTimelinePlan(plan);
  const frame = evaluateBBTimeline(plan, frameIndex),
    baseline = evaluateBBTimeline(original, frameIndex);
  expect(frame.board).toEqual(baseline.board);
  expect(frame.rules).toEqual(baseline.rules);
  expect(frame.renderBoard[0]!.every((cell) => cell === 'observed-face:2')).toBe(true);
  expect(evaluateBBTimeline(plan, frameIndex + 2).boardSurface).toBeNull();
  expect(() =>
    validateBBTimelinePlan({ ...plan, boardSurface: { ...plan.boardSurface, faces: [[2]] } }),
  ).toThrow(/BOARD_SURFACE_INVALID/);
});

it('samples clear face overrides in the common frame without mutating the stored transition', () => {
  const doc = structuredClone(syntheticAuthored).project;
  const { compiled, rhythm } = compileNativeTake(doc, 'human-drag');
  const original = normalizeAuthoredTake('human-drag', compiled, rhythm),
    action = compiled.actions[0]!;
  const plan = {
    ...structuredClone(original),
    boardSurface: { start: 0, end: 100, faces: Array.from({ length: 8 }, () => Array(8).fill(2)) },
  };
  const render = plan.renderActions[0]!;
  render.timing.clearFace = 3;
  const before = structuredClone(render.step);
  const frame = evaluateBBTimeline(plan, action.clearStartFrame);
  const clear = frame.clearRenders.find((item) => item.effect.actionId === render.step.action.id);
  expect(clear).toBeDefined();
  for (const cell of clear!.render.step.clear.cells)
    expect(clear!.render.step.placedColors?.[`${cell.row},${cell.col}`]).toBe('observed-face:3');
  expect(render.step).toEqual(before);
});
