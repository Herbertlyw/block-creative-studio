import { syntheticAuthoredFixture } from './fixtures/syntheticAuthored';
import { expect, it } from 'vitest';
import { eachPieceCell } from '../src/games/block-placement/rendering/pieceLayer';
import { paintGhostCells } from '../src/games/block-placement/rendering/ghostLayer';
import { paintAuthoredPieces } from '../src/games/block-placement/rendering/authoredPiecesLayer';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import { readBBFrame } from '../src/games/block-placement/planning/timelineFrameSource';
import {
  authoredBoard,
  authoredClearing,
} from '../src/games/block-placement/rendering/authoredFrameData';

const syntheticAuthored = await syntheticAuthoredFixture();

it('preserves shape order and maps center and top-left anchors independently', () => {
  const cells = [
    [0, 0],
    [1, 0],
    [1, 1],
  ] as const;
  const positions = (pose: Parameters<typeof eachPieceCell>[1]) => {
    const result: Array<[number, number, number]> = [];
    eachPieceCell(cells, pose, (x, y, _r, _c, index) => result.push([x, y, index]));
    return result;
  };
  expect(positions({ x: 20, y: 40, pitch: 8, anchor: 'top-left' })).toEqual([
    [20, 40, 0],
    [20, 48, 1],
    [28, 48, 2],
  ]);
  expect(positions({ x: 24, y: 44, pitch: 8, anchor: 'center', rows: 2, cols: 2 })).toEqual([
    [20, 40, 0],
    [20, 48, 1],
    [28, 48, 2],
  ]);
});

it('rejects a ghost whose cells do not match the bound shape and anchor', () => {
  const ghost = {
    actionId: 'a',
    anchor: { row: 2, col: 3 },
    cells: [
      { row: 2, col: 3 },
      { row: 3, col: 3 },
    ],
    lines: null,
    progress: 0.5,
  };
  const painted: Array<[number, number, number]> = [];
  paintGhostCells(
    ghost,
    [
      [0, 0],
      [1, 0],
    ],
    (r, c, _lr, _lc, i) => painted.push([r, c, i]),
  );
  expect(painted).toEqual([
    [2, 3, 0],
    [3, 3, 1],
  ]);
  expect(() =>
    paintGhostCells(
      {
        ...ghost,
        cells: [
          { row: 2, col: 3 },
          { row: 3, col: 4 },
        ],
      },
      [
        [0, 0],
        [1, 0],
      ],
      () => {},
    ),
  ).toThrow(/BB_GHOST_CELL_MISMATCH/);
});

it('uses the common ghost result to dim an illegal drag without drawing a landing preview', () => {
  const doc = structuredClone(syntheticAuthored).project;
  const { compiled, frameSource } = compileNativeTake(doc, 'human-drag');
  const frame = readBBFrame(frameSource.evaluate(compiled.actions[0]!.startFrame));
  frame.drag = { ...frame.drag!, hover: { row: 0, col: 0 } };
  frame.ghost = { ...frame.ghost!, anchor: null, cells: [], lines: null };
  const alphas: number[] = [],
    ghosts: number[] = [];
  paintAuthoredPieces(
    doc.direction.style,
    frame,
    (_x, _y, _size, _color, alpha) => alphas.push(alpha),
    () => ghosts.push(1),
  );
  expect(alphas).toEqual([0.58]);
  expect(ghosts).toEqual([]);
});

it('rejects unsupported colors even in hidden supply while retaining the visual clear board', () => {
  const doc = structuredClone(syntheticAuthored).project;
  const { compiled, frameSource } = compileNativeTake(doc, 'human-drag'),
    action = compiled.actions[0]!;
  const frame = readBBFrame(frameSource.evaluate(action.clearStartFrame));
  expect(authoredClearing(frame)?.clear.cells.length).toBeGreaterThan(0);
  expect(authoredBoard(frame).cells[0]!.every((color) => color !== null)).toBe(true);
  expect(frame.rules.gameState.board.cells[0]!.every((color) => color === null)).toBe(true);
  frame.visualState.pieces[0]!.color = 'unsupported-color';
  expect(() => authoredBoard(frame)).toThrow('BB_AUTHORED_COLOR_UNSUPPORTED:unsupported-color');
});
