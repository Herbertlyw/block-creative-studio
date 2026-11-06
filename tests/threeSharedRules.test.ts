import { expect, it } from 'vitest';
import { SHAPES as previousShapes } from '../src/domain/shapes';
import { getShape as nativeShape } from '../src/nativeReference/games/block-placement/runtime/shapes';
import { boardFingerprint as oldFingerprint } from '../src/domain/gameEngine';
import { boardFingerprint as nativeFingerprint } from '../src/nativeReference/games/block-placement/runtime/gameEngine';
import type { BoardState } from '../src/nativeReference/domain/types';

it('preserves 3D shape geometry and board identities when using the native BB rules', () => {
  for (const shape of previousShapes)
    expect(nativeShape(shape.id).cells, shape.id).toEqual(shape.cells);
  const board: BoardState = {
    rows: 2,
    cols: 4,
    cells: [
      ['coral', 'amber', 'lime', 'cyan'],
      ['blue', 'violet', 'rose', null],
    ],
  };
  expect(nativeFingerprint(structuredClone(board))).toBe(oldFingerprint(structuredClone(board)));
});
