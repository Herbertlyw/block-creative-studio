import {
  sampleDropLandingSurfaceFlashOpacity,
  type DropLandingSurfaceFlashCue,
  type DropLandingSurfaceFlashFrame,
} from '../profiles/landingSurfaceFlash';

/**
 * Local rectangular front material only. Called after the native face, inside
 * its existing transform/board clip; depth shadows and later foreground remain.
 * Atlas UV crops are not a screen-space/front-alpha mask. Irregular faces need
 * a separate future material-mask contract instead of a fixed screen patch.
 */
export function drawDropLandingSurfaceFlash(
  c: CanvasRenderingContext2D,
  cues: readonly DropLandingSurfaceFlashCue[] | undefined,
  flashes: readonly DropLandingSurfaceFlashFrame[] | undefined,
  cell: { id: string; presentationLayer?: string; appearance?: string },
  outputFps: number,
  x: number,
  y: number,
  size: number,
): void {
  if (
    !cues?.length ||
    !flashes?.length ||
    cell.presentationLayer === 'interaction' ||
    cell.appearance === 'debris-fragment'
  )
    return;
  for (const flash of flashes) {
    if (!flash.cellIds.includes(cell.id)) continue;
    const cue = cues[flash.cueIndex];
    if (!cue) continue;
    const opacity = sampleDropLandingSurfaceFlashOpacity(cue, flash.elapsedFrames, outputFps);
    if (opacity <= 0) continue;
    c.save();
    try {
      c.globalCompositeOperation = 'source-over';
      c.globalAlpha *= opacity;
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.fillStyle = cue.color;
      c.fillRect(x, y, size, size);
    } finally {
      c.restore();
    }
  }
}
