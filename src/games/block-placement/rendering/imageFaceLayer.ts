import { drawImageFitted, type ImageFit } from '../../../shared/media/drawImageFitted';

interface ImageFaceOptions {
  ctx: CanvasRenderingContext2D;
  image: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  x: number;
  y: number;
  size: number;
  radius: number;
  opacity: number;
  alpha: number;
  blendMode: GlobalCompositeOperation;
  fit: ImageFit;
  clip: 'arc-to' | 'round-rect';
  fittedOrigin: 'translated' | 'absolute';
  source?: { sx: number; sy: number; sw: number; sh: number };
}

/** Draw one checked face or atlas slice; the caller determines slot precedence. */
export function drawImageFace({
  ctx,
  image,
  sourceWidth,
  sourceHeight,
  x,
  y,
  size,
  radius,
  opacity,
  alpha,
  blendMode,
  fit,
  clip,
  fittedOrigin,
  source,
}: ImageFaceOptions): void {
  ctx.save();
  ctx.globalAlpha *= alpha * opacity;
  ctx.globalCompositeOperation = blendMode;
  ctx.beginPath();
  if (clip === 'round-rect') ctx.roundRect(x, y, size, size, radius);
  else {
    const r = Math.max(0, Math.min(radius, size / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + size, y, x + size, y + size, r);
    ctx.arcTo(x + size, y + size, x, y + size, r);
    ctx.arcTo(x, y + size, x, y, r);
    ctx.arcTo(x, y, x + size, y, r);
    ctx.closePath();
  }
  ctx.clip();
  if (source) ctx.drawImage(image, source.sx, source.sy, source.sw, source.sh, x, y, size, size);
  else if (fittedOrigin === 'translated') {
    ctx.translate(x, y);
    drawImageFitted(ctx, image, size, size, sourceWidth, sourceHeight, fit);
  } else if (fit === 'stretch') ctx.drawImage(image, x, y, size, size);
  else {
    const scale =
      fit === 'contain'
        ? Math.min(size / sourceWidth, size / sourceHeight)
        : Math.max(size / sourceWidth, size / sourceHeight);
    const width = sourceWidth * scale,
      height = sourceHeight * scale;
    ctx.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
  }
  ctx.restore();
}
