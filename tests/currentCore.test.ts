import { describe, expect, it } from 'vitest';
import {
  applyPlacement,
  createGame,
  createPieceSet,
  replayActions,
} from '../src/nativeReference/games/block-placement/runtime/gameEngine';
import { createEmptyBoard } from '../src/nativeReference/games/block-placement/runtime/boardPresets';
import {
  createNativeWork,
  createNativeTake,
  appendNativeMove,
  nativeTakeState,
} from '../src/contracts/nativeWorkAuthor';
import { compileNativeTake } from '../src/contracts/compileNativeTake';
import type { PlacementAction } from '../src/nativeReference/domain/types';

describe('current BB runtime', () => {
  it('uses deterministic seven-color single-color supply vectors', () => {
    const vector = (seed: number) =>
      createPieceSet(seed, 0).map(({ shapeId, color, cellColors }) => ({
        shapeId,
        color,
        cellColors,
      }));
    expect(vector(42)).toEqual([
      { shapeId: 'domino-h', color: 'cyan', cellColors: undefined },
      { shapeId: 't-4', color: 'cyan', cellColors: undefined },
      { shapeId: 'l-5', color: 'blue', cellColors: undefined },
    ]);
    expect(vector(41782)).toEqual([
      { shapeId: 'line4-h', color: 'blue', cellColors: undefined },
      { shapeId: 'line4-h', color: 'rose', cellColors: undefined },
      { shapeId: 'l-5', color: 'rose', cellColors: undefined },
    ]);
  });
  it('deduplicates an intersecting row and column, scores and advances combo', () => {
    const board = createEmptyBoard();
    for (let col = 0; col < 8; col++) if (col !== 4) board.cells[5]![col] = 'blue';
    for (let row = 0; row < 8; row++) if (row !== 5) board.cells[row]![4] = 'coral';
    const pieces = createPieceSet(8, 0, ['single', 'single', 'single']);
    const initial = createGame(board, 8, pieces);
    const action: PlacementAction = {
      id: 'cross',
      actor: 'human',
      pieceId: pieces[0]!.id,
      anchor: { row: 5, col: 4 },
      durationFrames: 12,
      pointerPath: [],
    };
    const result = applyPlacement(initial, action);
    expect(result).not.toBeNull();
    expect(result!.clear.rows).toEqual([5]);
    expect(result!.clear.cols).toEqual([4]);
    expect(result!.clear.cells).toHaveLength(15);
    expect(result!.after.combo).toBe(1);
    expect(result!.after.score).toBeGreaterThan(0);
    expect(replayActions(initial, [action])[0]!.after).toEqual(result!.after);
  });
  it('records and compiles the same native Take without mutating the original', async () => {
    const blank = await createNativeWork();
    const before = JSON.stringify(blank);
    let work = await createNativeTake(blank, 'human');
    const piece = nativeTakeState(work, 'human').pieces[0]!;
    work = await appendNativeMove(work, 'human', piece.id, 0, 0, 'human', [
      { frameOffset: 0, x: 0.2, y: 0.8 },
      { frameOffset: 15, x: 0.2, y: 0.2 },
    ]);
    expect(nativeTakeState(work, 'human').turn).toBe(1);
    const compiled = compileNativeTake(work.project, 'human');
    expect(compiled.frameSource.totalFrames).toBeGreaterThan(0);
    expect(JSON.stringify(blank)).toBe(before);
  });
});
