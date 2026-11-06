import { expect, it } from 'vitest';
import {
  createGame,
  createPieceSet,
} from '../src/nativeReference/games/block-placement/runtime/gameEngine';
import { createEmptyBoard } from '../src/nativeReference/games/block-placement/runtime/boardPresets';

it('uses the current clear rule for the drag preview', async () => {
  const { evaluateBBGhost } = await import('../src/games/block-placement/planning/ghostTimeline');
  const snapshot = createGame(
    createEmptyBoard(),
    42,
    createPieceSet(42, 0, ['single', 'single', 'single']),
  );
  for (let row = 0; row < 7; row++) snapshot.board.cells[row]![4] = 'blue';
  snapshot.clearAxes = 'rows';
  const piece = snapshot.pieces[0]!,
    drag = {
      actionId: 'preview',
      pieceId: piece.id,
      cells: [[0, 0] as const],
      color: piece.color,
      cellColors: null,
      target: { row: 7, col: 4 },
      hover: { row: 7, col: 4 },
      pose: {
        x: 0,
        y: 0,
        size: 50,
        pitch: 50,
        space: 'design' as const,
        anchor: 'center' as const,
      },
      progress: 0.5,
    };
  const policy = { kind: 'center' as const, linePreview: true };
  const preview = evaluateBBGhost(policy, drag, snapshot, snapshot.board.cells, 0);
  expect(preview?.lines?.cols).toEqual([]);
  snapshot.referenceClearRules = [{ turn: 0, axes: 'columns' }];
  expect(evaluateBBGhost(policy, drag, snapshot, snapshot.board.cells, 0)?.lines?.cols).toEqual([
    4,
  ]);
});
