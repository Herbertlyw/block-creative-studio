export type ImageFit = 'cover' | 'contain' | 'stretch';

/** Draw in design coordinates; the caller controls clipping and compositing. */
export function drawImageFitted(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  fit: ImageFit,
): void {
  if (![width, height, sourceWidth, sourceHeight].every((v) => Number.isFinite(v) && v > 0))
    throw new Error('IMAGE_GEOMETRY_INVALID');
  if (fit === 'stretch') {
    ctx.drawImage(image, 0, 0, width, height);
    return;
  }
  if (fit !== 'cover' && fit !== 'contain') throw new Error('IMAGE_FIT_UNSUPPORTED');
  const scale =
    fit === 'contain'
      ? Math.min(width / sourceWidth, height / sourceHeight)
      : Math.max(width / sourceWidth, height / sourceHeight);
  const w = sourceWidth * scale,
    h = sourceHeight * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}
