import { describe, expect, it } from 'vitest';
import { normalizeAuthoredTake } from '../src/games/block-placement/planning/normalizeAuthoredTake';
import { createBBTimelineSource } from '../src/games/block-placement/planning/timelineFrameSource';
import { compileTake } from '../src/nativeReference/games/block-placement/presentation/presentationCompiler';
import { RHYTHM_PRESETS } from '../src/nativeReference/director/rhythmPresets';
import { createEmptyBoard } from '../src/nativeReference/games/block-placement/runtime/boardPresets';
import { blastPraiseTier } from '../src/nativeReference/domain/types';
import {
  applyPlacement,
  createGame,
  createPieceSet,
  replayActions,
} from '../src/nativeReference/games/block-placement/runtime/gameEngine';
import type { BoardState, PlacementAction, TileColor } from '../src/nativeReference/domain/types';

function place(pieceId: string, row: number, col: number): PlacementAction {
  return {
    id: `p-${pieceId}-${row}-${col}`,
    actor: 'human',
    pieceId,
    anchor: { row, col },
    durationFrames: 12,
    pointerPath: [],
  };
}

function board6(fill: (cells: Array<Array<TileColor | null>>) => void): BoardState {
  const cells = Array.from({ length: 6 }, () => Array<TileColor | null>(6).fill(null));
  fill(cells);
  return { rows: 6, cols: 6, cells };
}

describe('reference rule alignment', () => {
  it('keeps the native seven-color seeded supply stable and supports explicit multicolor pieces', () => {
    const first = createPieceSet(99, 0);
    const again = createPieceSet(99, 0);
    expect(
      again.map((piece) => `${piece.shapeId}:${piece.color}:${piece.cellColors?.join(',')}`),
    ).toEqual(
      first.map((piece) => `${piece.shapeId}:${piece.color}:${piece.cellColors?.join(',')}`),
    );
    expect(first.every((piece) => piece.cellColors === undefined)).toBe(true);
    expect(createPieceSet(99, 0).map((piece) => piece.shapeId)).toEqual(
      createPieceSet(99, 0, undefined, { multiColor: false }).map((piece) => piece.shapeId),
    );
    expect(
      createPieceSet(99, 0, undefined, { multiColor: true }).every(
        (piece) => piece.cellColors && piece.cellColors.length > 0,
      ),
    ).toBe(true);
    expect(createPieceSet(99, 1).map((piece) => piece.id)).not.toEqual(
      first.map((piece) => piece.id),
    );
  });

  it('exhausts an authored supply instead of generating another round', () => {
    const round0 = createPieceSet(4, 0, ['single', 'single', 'single']);
    let game = createGame(createEmptyBoard(), 4, round0, [round0]);
    for (let index = 0; index < 3; index += 1) {
      const live = game.pieces.find((piece) => !piece.used)!;
      game = applyPlacement(game, place(live.id, 0, index))!.after;
    }
    expect(game.supplyExhausted).toBe(true);
    expect(game.setIndex).toBe(0);
    expect(game.pieces.every((piece) => piece.used)).toBe(true);
  });

  it('scores a cross clear once per cell and steps combo', () => {
    const pieces = createPieceSet(8, 0, ['single', 'single', 'single']);
    const cells = Array.from({ length: 8 }, () => Array<TileColor | null>(8).fill(null));
    for (let col = 0; col < 8; col += 1) if (col !== 4) cells[5]![col] = 'blue';
    for (let row = 0; row < 8; row += 1) if (row !== 5) cells[row]![4] = 'amber';
    const game = createGame({ rows: 8, cols: 8, cells }, 8, pieces);
    const step = applyPlacement(game, place(pieces[0]!.id, 5, 4))!;
    expect(step.clear.rows).toEqual([5]);
    expect(step.clear.cols).toEqual([4]);
    expect(step.clear.cells).toHaveLength(15);
    expect(step.placementPoints).toBe(1);
    expect(step.clearBonusPoints).toBe(15 * 2 + 4 * 12);
    expect(step.after.combo).toBe(1);
    expect(blastPraiseTier(step.after.combo, 2)).toBe('good');
    expect(blastPraiseTier(3, 1)).toBe('great');
    expect(blastPraiseTier(4, 1)).toBe('amazing');
    expect(blastPraiseTier(6, 1)).toBe('fantastic');
    expect(blastPraiseTier(1, 4)).toBe('unbelievable');
  });

  it('honors row-only, full-board and turn-bound clear rules', () => {
    const rowsOnly = board6((cells) => {
      for (let row = 0; row < 3; row += 1) cells[row]![5] = 'blue';
      for (let row = 3; row < 6; row += 1)
        for (let col = 0; col < 5; col += 1) cells[row]![col] = 'blue';
    });
    const pieces = createPieceSet(2, 0, ['tri-v', 'line5-h', 'single']);
    const rowGame = createGame(rowsOnly, 2, pieces, undefined, 'rows');
    const rowStep = applyPlacement(rowGame, place(pieces[0]!.id, 3, 5))!;
    expect(rowStep.clear.rows).toEqual([3, 4, 5]);
    expect(rowStep.clear.cols).toEqual([]);
    expect(rowStep.after.board.cells.flat().filter(Boolean)).toHaveLength(3);

    const fullCells = Array.from({ length: 6 }, () => Array<TileColor | null>(6).fill('blue'));
    fullCells[0]![0] = null;
    fullCells[5]![5] = null;
    const singles = createPieceSet(3, 0, ['single', 'single', 'single']);
    const full = createGame(
      { rows: 6, cols: 6, cells: fullCells },
      3,
      singles,
      undefined,
      undefined,
      'board-full',
    );
    const steps = replayActions(full, [place(singles[0]!.id, 0, 0), place(singles[1]!.id, 5, 5)]);
    expect(steps[0]!.clear.cells).toHaveLength(0);
    expect(steps[1]!.clear.cells).toHaveLength(36);

    const override = createGame(rowsOnly, 2, pieces, undefined, undefined, undefined, [
      { turn: 0, axes: 'rows' },
    ]);
    const first = applyPlacement(override, place(pieces[0]!.id, 3, 5))!;
    expect(first.clear.cols).toEqual([]);
    expect(first.after.clearAxes).toBeUndefined();
  });

  it('places praise and clear events on different clocks without duplicating a cross clear', () => {
    const pieces = createPieceSet(8, 0, ['single', 'single', 'single']);
    const cells = Array.from({ length: 8 }, () => Array<TileColor | null>(8).fill(null));
    for (let col = 0; col < 8; col += 1) if (col !== 4) cells[5]![col] = 'blue';
    for (let row = 0; row < 8; row += 1) if (row !== 5) cells[row]![4] = 'amber';
    const initial = createGame({ rows: 8, cols: 8, cells }, 8, pieces);
    const action = place(pieces[0]!.id, 5, 4);
    const compiled = compileTake(
      {
        id: 'take',
        name: 'take',
        createdAt: '2026-09-01T00:00:00.000Z',
        initial,
        actions: [action],
      },
      RHYTHM_PRESETS['tight-fast'],
      30,
    );
    const source = createBBTimelineSource(
      normalizeAuthoredTake('take', compiled, RHYTHM_PRESETS['tight-fast']),
    );
    const events = new Map<string, { type: string; frame: number }>();
    for (let frame = 0; frame < source.totalFrames; frame++)
      for (const event of source.evaluate(frame).semanticEvents)
        if (!events.has(event.id)) events.set(event.id, { type: event.type, frame });
    const values = [...events.values()];
    expect(values.filter((event) => event.type === 'block-placement.cross-cleared')).toHaveLength(
      1,
    );
    expect(values.some((event) => event.type === 'block-placement.line-cleared')).toBe(false);
    const clear = values.find((event) => event.type === 'block-placement.cross-cleared')!;
    const praise = values.find((event) => event.type.startsWith('block-placement.praise-'))!;
    expect(clear.frame).toBe(compiled.actions[0]!.clearStartFrame);
    expect(praise.frame).toBe(clear.frame);
    expect(
      values.find((event) => event.type === 'block-placement.placement-committed')!.frame,
    ).toBe(compiled.actions[0]!.releaseFrame + 1);
  });
});

it('matches the documented three-cell cross and second-combo score example', () => {
  const pieces = createPieceSet(8, 0, ['tri-h', 'single', 'single']);
  const cells = Array.from({ length: 8 }, () => Array<TileColor | null>(8).fill(null));
  for (let col = 0; col < 8; col++) if (![4, 5, 6].includes(col)) cells[5]![col] = 'blue';
  for (let row = 0; row < 8; row++) if (row !== 5) cells[row]![4] = 'amber';
  const initial = createGame({ rows: 8, cols: 8, cells }, 8, pieces);
  initial.combo = 1;
  const transition = applyPlacement(initial, place(pieces[0]!.id, 5, 4))!;
  expect(transition.clear.cells).toHaveLength(15);
  expect(transition.after.combo).toBe(2);
  expect(transition.placementPoints).toBe(3);
  expect(transition.clearBonusPoints).toBe(96);
  expect(transition.points).toBe(99);
});
