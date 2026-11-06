import { drawImageFitted, type ImageFit } from '../../../shared/media/drawImageFitted';

/** Paint a resolved background in the design canvas; grading remains a style layer. */
export function drawBoundBackground(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
  binding: { fit: ImageFit; opacity: number; blendMode: GlobalCompositeOperation },
): void {
  ctx.save();
  ctx.globalAlpha = binding.opacity;
  ctx.globalCompositeOperation = binding.blendMode;
  drawImageFitted(ctx, image, width, height, sourceWidth, sourceHeight, binding.fit);
  ctx.restore();
}
