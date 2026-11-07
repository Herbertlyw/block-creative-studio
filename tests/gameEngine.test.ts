import { describe, expect, it } from 'vitest';
import { createCrossClearBoard, createEmptyBoard } from '../src/domain/boardPresets';
import {
  applyPlacement,
  boardFingerprint,
  canPlace,
  chooseGreedyMove,
  createGame,
  createPieceSet,
  replayActions,
} from '../src/domain/gameEngine';
import type { PlacementAction, TileColor } from '../src/domain/types';

function action(pieceId: string, row: number, col: number): PlacementAction {
  return {
    id: `place-${pieceId}-${row}-${col}`,
    actor: 'human',
    pieceId,
    anchor: { row, col },
    durationFrames: 16,
    pointerPath: [],
  };
}

describe('game engine', () => {
  it('accepts a legal placement and rejects overlap', () => {
    const pieces = createPieceSet(1, 0, ['square-2', 'single', 'tri-h']);
    const game = createGame(createEmptyBoard(), 1, pieces);
    expect(canPlace(game.board, pieces[0]!, { row: 0, col: 0 })).toBe(true);
    const transition = applyPlacement(game, action(pieces[0]!.id, 0, 0));
    expect(transition).not.toBeNull();
    expect(canPlace(transition!.after.board, pieces[1]!, { row: 0, col: 0 })).toBe(false);
  });

  it('places reference-style multi-color cells in shape order', () => {
    const pieces = createPieceSet(5, 0, ['tri-h', 'single', 'single']);
    pieces[0]!.cellColors = ['coral', 'lime', 'blue'];
    const game = createGame(createEmptyBoard(), 5, pieces);
    const transition = applyPlacement(game, action(pieces[0]!.id, 2, 3));
    expect(transition).not.toBeNull();
    expect(transition!.after.board.cells[2]!.slice(3, 6)).toEqual(['coral', 'lime', 'blue']);
  });

  it('clears a row and a column simultaneously', () => {
    const pieces = createPieceSet(8, 0, ['single', 'tri-h', 'square-2']);
    const game = createGame(createCrossClearBoard(), 8, pieces);
    const transition = applyPlacement(game, action(pieces[0]!.id, 5, 4));
    expect(transition).not.toBeNull();
    expect(transition!.clear.rows).toEqual([5]);
    expect(transition!.clear.cols).toEqual([4]);
    expect(transition!.clear.cells).toHaveLength(15);
    expect(transition!.after.board.cells[5]!.every((cell) => cell === null)).toBe(true);
  });

  it('refills the three-piece tray after all pieces are used', () => {
    const pieces = createPieceSet(12, 0, ['single', 'single', 'single']);
    let game = createGame(createEmptyBoard(), 12, pieces);
    for (let index = 0; index < 3; index += 1) {
      const live = game.pieces.find((piece) => !piece.used)!;
      const transition = applyPlacement(game, action(live.id, 0, index));
      expect(transition).not.toBeNull();
      game = transition!.after;
    }
    expect(game.setIndex).toBe(1);
    expect(game.pieces.every((piece) => !piece.used)).toBe(true);
  });

  it('preserves a nonzero candidate set index when constructing a snapshot', () => {
    const pieces = createPieceSet(13, 4, ['single', 'domino-h', 'tri-v']);
    const game = createGame(createEmptyBoard(), 13, pieces);
    expect(game.setIndex).toBe(4);
    expect(game.pieces.every((piece) => piece.setIndex === 4)).toBe(true);
  });

  it('keeps all seven observed palette colors distinct in the board fingerprint', () => {
    const fingerprints = new Set(
      (['coral', 'amber', 'lime', 'cyan', 'blue', 'violet', 'rose'] satisfies TileColor[]).map((color) => {
        const board = createEmptyBoard();
        board.cells[0]![0] = color;
        return boardFingerprint(board);
      }),
    );
    expect(fingerprints.size).toBe(7);
  });

  it('replays deterministically and offers a greedy bot move', () => {
    const pieces = createPieceSet(21, 0, ['single', 'domino-h', 'tri-v']);
    const initial = createGame(createEmptyBoard(), 21, pieces);
    const first = chooseGreedyMove(initial);
    expect(first).not.toBeNull();
    const a1 = action(first!.pieceId, first!.anchor.row, first!.anchor.col);
    const t1 = applyPlacement(initial, a1)!;
    const second = chooseGreedyMove(t1.after)!;
    const a2 = action(second.pieceId, second.anchor.row, second.anchor.col);
    const replayed = replayActions(initial, [a1, a2]);
    expect(boardFingerprint(replayed[1]!.after.board)).toBe(
      boardFingerprint(applyPlacement(t1.after, a2)!.after.board),
    );
  });

  it('marks a board with no legal placement as game over', () => {
    const board = createEmptyBoard();
    for (const row of board.cells) row.fill('blue');
    const pieces = createPieceSet(33, 0, ['single', 'single', 'single']);
    expect(createGame(board, 33, pieces).status).toBe('game-over');
  });
});
