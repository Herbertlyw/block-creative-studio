import { describe, expect, it } from 'vitest';
import * as native from '../src/nativeReference/games/block-placement/runtime/gameEngine';
import { createEmptyBoard } from '../src/nativeReference/games/block-placement/runtime/boardPresets';
import expectedShapes from './fixtures/shape-cells.json';
import { getShape as nativeShape } from '../src/nativeReference/games/block-placement/runtime/shapes';

describe('current BB placement and clear rules', () => {
  it('retains unique shape IDs and their ordered cells', () => {
    for (const shape of expectedShapes)
      expect(nativeShape(shape.id).cells, shape.id).toEqual(shape.cells);
  });
  it('uses the native placement result for cross clearing, scoring, combo and fixed supply', () => {
    const board = createEmptyBoard();
    for (let i = 0; i < 8; i++) {
      if (i !== 3) {
        board.cells[3]![i] = 'coral';
        board.cells[i]![3] = 'cyan';
      }
    }
    const first = native.createPieceSet(12, 0, ['single', 'single', 'single']);
    const rounds = [first];
    const initial = native.createGame(board, 12, first, rounds);
    const action = {
      id: 'cross',
      actor: 'human' as const,
      pieceId: first[0]!.id,
      anchor: { row: 3, col: 3 },
      durationFrames: 15,
      pointerPath: [],
    };
    const before = structuredClone(initial);
    const actual = native.applyPlacement(initial, action);
    expect(initial).toEqual(before);
    expect(actual?.clear.rows).toEqual([3]);
    expect(actual?.clear.cols).toEqual([3]);
    expect(actual?.clear.cells).toHaveLength(15);
    expect(actual?.after.combo).toBe(1);
    expect(actual?.points).toBe(79);
    const next = { ...action, id: 'invalid', pieceId: first[1]!.id, anchor: { row: -1, col: 0 } };
    expect(native.applyPlacement(actual!.after, next)).toBeNull();
  });
  it('applies a turn-specific clear override without mutating its input', () => {
    const board = createEmptyBoard();
    board.cells[0] = Array(8).fill('blue');
    board.cells[0]![0] = null;
    const pieces = native.createPieceSet(3, 0, ['single', 'single', 'single']);
    const state = native.createGame(board, 3, pieces, [pieces], undefined, undefined, [
      { turn: 0, axes: 'columns' },
    ]);
    const action = {
      id: 'row',
      actor: 'human' as const,
      pieceId: pieces[0]!.id,
      anchor: { row: 0, col: 0 },
      durationFrames: 15,
      pointerPath: [],
    };
    const actual = native.applyPlacement(state, action);
    expect(actual?.clear.cells).toHaveLength(0);
    expect(actual?.after.score).toBe(1);
    actual!.before.referenceClearRules![0]!.axes = 'rows';
    expect(state.referenceClearRules![0]!.axes).toBe('columns');
  });
});
