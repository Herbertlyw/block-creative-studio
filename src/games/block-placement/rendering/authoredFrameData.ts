import { TILE_COLORS } from '../../../nativeReference/games/block-placement/runtime/shapes';
import type { BoardState, ClearingFrame, TileColor } from '../../../nativeReference/domain/types';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';

const colors = new Set<string>(TILE_COLORS);
export function authoredColor(value: string): TileColor {
  if (!colors.has(value)) throw new Error(`BB_AUTHORED_COLOR_UNSUPPORTED:${value}`);
  return value as TileColor;
}
/** The visual board may intentionally differ from the already-committed rule board. */
export function authoredBoard(frame: BBTimelineFrame): BoardState {
  const checkPiece = (piece: { color: string; cellColors?: string[] }) => {
    authoredColor(piece.color);
    piece.cellColors?.forEach(authoredColor);
  };
  frame.visualState.pieces.forEach(checkPiece);
  frame.visualState.fixedPieceSupply?.forEach((round) => round.forEach(checkPiece));
  return {
    ...frame.visualState.board,
    cells: frame.board.map((row) =>
      row.map((color) => (color === null ? null : authoredColor(color))),
    ),
  };
}
export function authoredClearing(frame: BBTimelineFrame): ClearingFrame | null {
  const current = frame.activeAction;
  if (!current || current.phase !== 'clearing') return null;
  const clear = frame.clearEffects.find((effect) => effect.actionId === current.actionId);
  if (!clear || clear.progress === null) throw new Error('BB_AUTHORED_CLEAR_MISSING');
  return {
    clear: {
      rows: clear.rows,
      cols: clear.cols,
      cells: clear.cells.map(({ row, col, logicalColor }) => ({
        row,
        col,
        color: authoredColor(logicalColor),
      })),
    },
    progress: clear.progress,
    seed: clear.seed,
  };
}
