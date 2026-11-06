import { syntheticAuthoredFixture } from './fixtures/syntheticAuthored';
import { expect, it } from 'vitest';
import {
  completedPreviewLines,
  dragPreviewAnchor,
} from '../src/games/block-placement/planning/ghostGeometry';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { readBBFrame } from '../src/games/block-placement/planning/timelineFrameSource';
import { paintObservedPieces } from '../src/games/block-placement/calibrated/observedPiecesLayer';
import type { ReferenceCalibration } from '../src/games/block-placement/calibrated/parseCalibration';

const syntheticAuthored = await syntheticAuthoredFixture();

it('samples the landing preview and deduplicated row and column without changing the board', () => {
  const board: Array<Array<string | null>> = [
    ['blue', 'blue', null],
    ['blue', null, 'blue'],
    [null, 'blue', 'blue'],
  ];
  const before = structuredClone(board);
  const anchor = dragPreviewAnchor([[0, 0]], board, 10, 10, 10, [0, 0, 10], 1);
  expect(anchor).toEqual({ row: 1, col: 1 });
  expect(completedPreviewLines([[0, 0]], board, anchor!)).toEqual({ rows: [1], cols: [1] });
  expect(board).toEqual(before);
  expect(dragPreviewAnchor([[0, 0]], board, 0, 0, 10, [0, 0, 10], 1)).toBeUndefined();
});

it('rejects malformed geometry and irregular boards instead of guessing an anchor', () => {
  expect(() => dragPreviewAnchor([[0, 0]], [], 0, 0, 1, [0, 0, 1], 1)).toThrow(/BOARD_INVALID/);
  expect(() => completedPreviewLines([[0, 0]], [[null], [null, null]], { row: 0, col: 0 })).toThrow(
    /BOARD_INVALID/,
  );
  expect(() => dragPreviewAnchor([[0]], [[null]], 0, 0, 1, [0, 0, 1], 1)).toThrow(/SHAPE_INVALID/);
  expect(() => dragPreviewAnchor([[0, 0]], [[null]], 0, 0, 1, [0, 0, 0], 1)).toThrow(
    /GEOMETRY_INVALID/,
  );
});

it('reports a missing line-preview style before attempting to draw a clear preview', () => {
  const doc = structuredClone(syntheticAuthored).project;
  const { compiled, frameSource } = compileNativeTake(doc, 'human-drag');
  const frame = readBBFrame(frameSource.evaluate(compiled.actions[0]!.startFrame));
  expect(frame.ghost).not.toBeNull();
  expect(frame.activeRender).not.toBeNull();
  frame.ghost = { ...frame.ghost!, anchor: null, lines: { rows: [0], cols: [] } };
  delete frame.activeRender!.timing.linePreview;
  const spec = { appearance: {} } as ReferenceCalibration;
  const tile = { tile: () => {}, shape: () => {}, pieceCell: () => {} };
  expect(() =>
    paintObservedPieces({} as CanvasRenderingContext2D, spec, frame, [], frame.timeSeconds, tile),
  ).toThrow('REFERENCE_LINE_PREVIEW_MISSING');
});
