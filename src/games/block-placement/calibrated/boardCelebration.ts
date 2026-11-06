// Derived production module; supplied reference files remain unchanged.
import type { ReferenceAppearance } from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';
type Event = NonNullable<ReferenceAppearance['boardCelebrations']>[number];
const sat = (v: number) => Math.max(0, Math.min(1, v));
/** Deterministic decorative rising/falling grid; never modifies the rules board. */
export function celebrationCellAlpha(e: Event, t: number, row: number, rows: number) {
  if (t < e.start || t >= e.end) return 0;
  const fill = sat((t - e.start) / (e.fillEnd - e.start)) * rows;
  const erase = sat((t - e.holdEnd) / (e.end - e.holdEnd)) * rows;
  return Math.min(sat(fill - (rows - 1 - row)), sat(rows - row - erase));
}
export function drawBoardCelebration(h: any, e: Event, t: number) {
  if (t < e.start || t >= e.end) return;
  const { ctx, gx, gy, pitch, background, tile, sourceTime } = h,
    n = e.faces.length;
  if (!background) throw new Error('REFERENCE_CELEBRATION_BACKGROUND_REQUIRED');
  ctx.save();
  ctx.drawImage(background, gx, gy, pitch * n, pitch * n, gx, gy, pitch * n, pitch * n);
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const alpha = celebrationCellAlpha(e, t, r, n);
      if (alpha)
        tile(
          gx + c * pitch,
          gy + r * pitch,
          pitch,
          `observed-face:${e.faces[r]![c]}`,
          sourceTime,
          alpha,
        );
    }
  ctx.restore();
}
