import type { ReferenceCalibration } from '../calibrated/parseCalibration';
import type { BBTimelineFrame } from '../planning/bbTimelinePlan';
import type { createBBTileLayer } from './tileLayer';
import { drawRackGlow } from '../calibrated/referenceFeedback';
import { measuredCellColor } from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';

type RackSpec = Pick<ReferenceCalibration, 'appearance' | 'effects'>;
type Tile = ReturnType<typeof createBBTileLayer>;

/** Paint the already-sampled pieces and reveal amounts without replaying supply. */
export function paintObservedRack(
  ctx: CanvasRenderingContext2D,
  spec: RackSpec,
  frame: BBTimelineFrame,
  time: number,
  sourceTime: number,
  { tile, shape }: Tile,
): void {
  for (const { piece, cells, rows, cols, x, y, size, reveal: amount } of frame.rackDrawables) {
    if (spec.effects?.rackGlow?.enabled)
      drawRackGlow(
        ctx,
        x,
        y,
        cols * size,
        rows * size,
        time,
        piece.slotIndex,
        spec.effects.rackGlow.intensity,
      );
    ctx.save();
    ctx.shadowColor = '#30324445';
    ctx.shadowOffsetX = 10;
    ctx.shadowOffsetY = 11;
    if (amount >= 1) shape(cells, x, y, size, piece.color, sourceTime);
    else if (amount > 0)
      for (const [row, col] of cells)
        tile(
          x + (col + (1 - amount) / 2) * size,
          y + (row + (1 - amount) / 2) * size,
          size * amount,
          measuredCellColor(spec.appearance, piece.color, row, col),
          sourceTime,
        );
    ctx.restore();
  }
}
