import { describe, expect, it } from 'vitest';
import * as workbench from '../src/domain/gameEngine';
import * as native from '../src/nativeReference/games/block-placement/runtime/gameEngine';
import { createEmptyBoard } from '../src/domain/boardPresets';
import { SHAPES } from '../src/domain/shapes';
import { getShape as nativeShape } from '../src/nativeReference/games/block-placement/runtime/shapes';

describe('shared BB placement rules during workbench migration', () => {
  it('retains every legacy workbench shape and its ordered cells', () => {
    for (const shape of SHAPES) expect(nativeShape(shape.id).cells, shape.id).toEqual(shape.cells);
  });
  it('uses the native placement result for cross clearing, scoring, combo and fixed supply', () => {
    const board = createEmptyBoard();
    for (let i = 0; i < 8; i++) {
      if (i !== 3) {
        board.cells[3]![i] = 'coral';
        board.cells[i]![3] = 'cyan';
      }
    }
    const first = workbench.createPieceSet(12, 0, ['single', 'single', 'single']);
    const rounds = [first];
    const initial = workbench.createGame(board, 12, first, { fixedPieceSupply: rounds });
    const action = {
      id: 'cross',
      actor: 'human' as const,
      pieceId: first[0]!.id,
      anchor: { row: 3, col: 3 },
      durationFrames: 15,
      pointerPath: [],
    };
    const before = structuredClone(initial);
    const expected = native.applyPlacement(initial, action),
      actual = workbench.applyPlacement(initial, action);
    expect(actual).toEqual(expected);
    expect(initial).toEqual(before);
    expect(actual?.clear.rows).toEqual([3]);
    expect(actual?.clear.cols).toEqual([3]);
    expect(actual?.clear.cells).toHaveLength(15);
    expect(actual?.after.combo).toBe(1);
    expect(actual?.points).toBe(79);
    const next = { ...action, id: 'invalid', pieceId: first[1]!.id, anchor: { row: -1, col: 0 } };
    expect(workbench.applyPlacement(actual!.after, next)).toBeNull();
    expect(native.applyPlacement(actual!.after, next)).toBeNull();
  });
  it('applies the same turn-specific clear override in both callers', () => {
    const board = createEmptyBoard();
    board.cells[0] = Array(8).fill('blue');
    board.cells[0]![0] = null;
    const pieces = workbench.createPieceSet(3, 0, ['single', 'single', 'single']);
    const state = workbench.createGame(board, 3, pieces, {
      referenceClearRules: [{ turn: 0, axes: 'columns' }],
      fixedPieceSupply: [pieces],
    });
    const action = {
      id: 'row',
      actor: 'human' as const,
      pieceId: pieces[0]!.id,
      anchor: { row: 0, col: 0 },
      durationFrames: 15,
      pointerPath: [],
    };
    const expected = native.applyPlacement(state, action),
      actual = workbench.applyPlacement(state, action);
    expect(actual).toEqual(expected);
    expect(actual?.clear.cells).toHaveLength(0);
    expect(actual?.after.score).toBe(1);
    actual!.before.referenceClearRules![0]!.axes = 'rows';
    expect(state.referenceClearRules![0]!.axes).toBe('columns');
  });
});
