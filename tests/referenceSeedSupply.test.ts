import vectors from './fixtures/bb-seeded-vectors.json';
import { describe, expect, it } from 'vitest';
import {
  applyPlacement,
  createGame,
  createPieceSet,
} from '../src/nativeReference/games/block-placement/runtime/gameEngine';
import { createEmptyBoard } from '../src/nativeReference/games/block-placement/runtime/boardPresets';
import { getShape } from '../src/nativeReference/games/block-placement/runtime/shapes';

describe('current BB seeded supply', () => {
  it.each(vectors)(
    'matches deterministic seed $seed round $round',
    ({ seed, round, monochrome, multicolor }) => {
      const pieces = createPieceSet(seed, round);
      expect(pieces.map((p) => `${p.shapeId}:${p.color}`)).toEqual(monochrome);
      expect(pieces.every((p) => p.cellColors === undefined)).toBe(true);
      expect(
        createPieceSet(seed, round, undefined, { multiColor: true }).map((p) => p.cellColors),
      ).toEqual(multicolor);
    },
  );
  it('supports explicit multicolor without changing seeded shapes', () => {
    const plain = createPieceSet(99, 0),
      colored = createPieceSet(99, 0, undefined, { multiColor: true });
    expect(colored.map((p) => p.shapeId)).toEqual(plain.map((p) => p.shapeId));
    for (const piece of colored)
      expect(piece.cellColors).toHaveLength(getShape(piece.shapeId).cells.length);
  });
  it('refreshes to the next seeded round after all three candidates are placed', () => {
    const pieces = createPieceSet(99, 0, ['single', 'single', 'single']);
    let state = createGame(createEmptyBoard(), 99, pieces);
    for (let i = 0; i < 3; i++) {
      const result = applyPlacement(state, {
        id: `a${i}`,
        actor: 'human',
        pieceId: pieces[i]!.id,
        anchor: { row: 0, col: i },
        durationFrames: 10,
        pointerPath: [],
      });
      expect(result).not.toBeNull();
      state = result!.after;
    }
    expect(state.pieces).toEqual(createPieceSet(99, 1));
  });
  it('supports authored shapes without adding them to seeded generation', () => {
    const pieces = createPieceSet(0, 0, ['authored-rect23-00', 'single', 'single']);
    const result = applyPlacement(createGame(createEmptyBoard(), 0, pieces), {
      id: 'authored',
      actor: 'human',
      pieceId: pieces[0]!.id,
      anchor: { row: 1, col: 1 },
      durationFrames: 10,
      pointerPath: [],
    });
    expect(result!.placementPoints).toBe(6);
    for (let round = 0; round < 5; round++)
      expect(createPieceSet(0, round).every((p) => !p.shapeId.startsWith('authored-'))).toBe(true);
  });
});
