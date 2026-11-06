import { authoredColor } from './authoredFrameData';
import type { StyleSpec, TileColor } from '../../../nativeReference/domain/types';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import { eachPieceCell } from './pieceLayer';
import { paintGhostCells } from './ghostLayer';

type TilePainter = (
  x: number,
  y: number,
  size: number,
  color: TileColor,
  alpha: number,
  scale: number,
  motif: boolean,
) => void;
type GhostPainter = (row: number, col: number, color: TileColor, alpha: number) => void;

/** Candidate placements use the same already-sampled geometry as hit testing. */
export function paintAuthoredRack(bbFrame: BBTimelineFrame, drawTile: TilePainter): void {
  for (const item of bbFrame.rackDrawables) {
    const piece = item.piece;
    eachPieceCell(
      item.cells,
      { x: item.x, y: item.y, pitch: item.pitch, anchor: 'top-left' },
      (x, y, _row, _col, index) =>
        drawTile(
          x + item.pitch / 2,
          y + item.pitch / 2,
          item.size,
          authoredColor(piece.cellColors?.[index] ?? piece.color),
          1,
          1,
          true,
        ),
    );
  }
}

/** Ghost legality and the drag pose have already been evaluated by BB timeline. */
export function paintAuthoredPieces(
  style: StyleSpec,
  bbFrame: BBTimelineFrame,
  drawTile: TilePainter,
  drawPreviewCell: GhostPainter,
): void {
  const motion = bbFrame.drag;
  if (!motion) return;
  const piece = bbFrame.visualState.pieces.find((candidate) => candidate.id === motion.pieceId);
  if (!piece) throw new Error(`BB_SCENE_DRAG_PIECE_MISSING:${motion.pieceId}`);
  const hover = motion.hover,
    ghost = bbFrame.ghost;
  if (!ghost) throw new Error(`BB_SCENE_GHOST_MISSING:${motion.actionId}`);
  if (ghost.anchor && hover) {
    if (style.reference2d.previewFx === 'full-line-tint') {
      const rows = new Set(ghost.lines?.rows ?? []),
        cols = new Set(ghost.lines?.cols ?? []);
      for (let row = 0; row < 8; row++)
        for (let col = 0; col < 8; col++)
          if (rows.has(row) || cols.has(col)) drawPreviewCell(row, col, 'violet', 0.44);
    }
    paintGhostCells(ghost, motion.cells, (row, col, _localRow, _localCol, index) =>
      drawPreviewCell(row, col, authoredColor(piece.cellColors?.[index] ?? piece.color), 0.66),
    );
  }
  const rows = Math.max(...motion.cells.map(([row]) => row)) + 1,
    cols = Math.max(...motion.cells.map(([, col]) => col)) + 1;
  const { x, y, size, pitch } = motion.pose;
  // A non-null hover without a ghost is an illegal board placement.
  const opacity = hover && ghost.anchor === null ? 0.58 : 0.98;
  eachPieceCell(
    motion.cells,
    { x, y, pitch, anchor: 'center', rows, cols },
    (px, py, _row, _col, index) =>
      drawTile(
        px,
        py,
        size,
        authoredColor(piece.cellColors?.[index] ?? piece.color),
        opacity,
        1,
        true,
      ),
  );
}
