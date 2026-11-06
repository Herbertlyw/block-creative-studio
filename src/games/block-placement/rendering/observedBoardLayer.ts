import type { ReferenceCalibration } from '../calibrated/parseCalibration';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import type { createBBTileLayer } from './tileLayer';
import { paintBoardCells } from './boardLayer';

type Spec = Pick<ReferenceCalibration, 'theme' | 'appearance' | 'backdrop'>;
type Tile = ReturnType<typeof createBBTileLayer>['tile'];
function round(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
}
function ease(value: number) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

/** Board style draws from the common board cells; effects remain separate layers. */
export function paintObservedBoard(
  ctx: CanvasRenderingContext2D,
  spec: Spec,
  frame: BBTimelineFrame,
  board: readonly (readonly (string | null)[])[],
  background: HTMLImageElement | undefined,
  tile: Tile,
  time: number,
  sourceTime: number,
  early: boolean,
): void {
  const { x: gx, y: gy, pitch, rows: boardRows, cols: boardCols } = frame.geometry.board,
    boardSize = boardRows;
  for (const guide of spec.appearance?.boardGuides ?? []) {
    if (time < guide.start || time >= guide.end) continue;
    ctx.save();
    ctx.strokeStyle = guide.color;
    ctx.lineWidth = guide.width;
    ctx.setLineDash(guide.dash);
    ctx.strokeRect(...guide.rect);
    ctx.restore();
  }
  if (!spec.appearance?.staticBoard) {
    round(
      ctx,
      gx - (spec.theme === 'pink' ? 12 : 17),
      gy - (spec.theme === 'pink' ? 12 : 17),
      pitch * boardSize + (spec.theme === 'pink' ? 24 : 34),
      pitch * boardSize + (spec.theme === 'pink' ? 24 : 34),
      spec.theme === 'pink' ? 14 : 24,
      spec.backdrop?.boardFrame ??
        (spec.theme === 'pink'
          ? '#304275'
          : spec.theme === 'grey'
            ? '#8d908e'
            : early
              ? '#e7eff0'
              : '#9589af'),
    );
    round(
      ctx,
      gx - 3,
      gy - 3,
      pitch * boardSize + 6,
      pitch * boardSize + 6,
      7,
      spec.backdrop?.boardGrid ??
        (spec.theme === 'pink'
          ? '#18253d'
          : spec.theme === 'grey'
            ? '#30332f'
            : early
              ? '#d0dadd'
              : '#3e3c4a'),
    );
  }
  if (background && spec.appearance?.cleanBoardSample) {
    const rect = spec.appearance.cleanBoardSample;
    ctx.fillStyle = '#102158';
    ctx.fillRect(gx - 8, gy - 9, pitch * boardSize + 8, pitch * boardSize + 9);
    for (let r = 0; r < boardRows; r++)
      for (let c = 0; c < boardCols; c++)
        ctx.drawImage(background, ...rect, gx + c * pitch, gy + r * pitch, pitch, pitch);
  }
  paintBoardCells(frame.boardDrawables, 'interleaved', {
    slot: ({ x, y }) => {
      ctx.fillStyle =
        spec.backdrop?.boardCell ??
        (spec.theme === 'pink'
          ? '#232950'
          : spec.theme === 'grey'
            ? '#3f3f3f'
            : early
              ? '#fafcfc'
              : '#4f4668');
      if (!spec.appearance?.staticBoard) ctx.fillRect(x + 2, y + 2, pitch - 4, pitch - 4);
    },
    occupied: ({ row, col, x, y }) => {
      const color = board[row]?.[col];
      if (!color) throw new Error(`BB_SCENE_BOARD_CELL_MISSING:${row}:${col}`);
      const reveal = spec.appearance?.initialRevealSeconds,
        scale = reveal && time < reveal ? ease(time / reveal) : 1;
      if (scale > 0)
        tile(
          x + (pitch * (1 - scale)) / 2,
          y + (pitch * (1 - scale)) / 2,
          pitch * scale,
          color,
          sourceTime,
          1,
          undefined,
          { row, col },
        );
    },
  });
}
