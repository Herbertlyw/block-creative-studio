import { drawBoundBackground } from './backgroundLayer';
import type { ReferenceCalibration } from '../calibrated/parseCalibration';
import type { ImageBindings } from '../calibrated/imageBindings';

type BackgroundSpec = Pick<ReferenceCalibration, 'theme' | 'appearance'>;

/** The plate is painted both before and, when requested, inside the camera transform. */
export function paintObservedPlate(
  ctx: CanvasRenderingContext2D,
  spec: BackgroundSpec,
  bindings: ImageBindings,
  images: Record<string, HTMLImageElement>,
  time: number,
): void {
  if (bindings.background && images.workBackground) {
    const image = images.workBackground;
    drawBoundBackground(
      ctx,
      image,
      1080,
      1920,
      image.naturalWidth,
      image.naturalHeight,
      bindings.background,
    );
  } else if (images.background) ctx.drawImage(images.background, 0, 0, 1080, 1920);
  if (images.backgroundAtlas && spec.appearance?.backdropTimeline) {
    const entries = spec.appearance.backdropTimeline,
      entry = [...entries].reverse().find((item) => item.at <= time) ?? entries[0];
    if (!entry) throw new Error('BB_BACKGROUND_TIMELINE_EMPTY');
    ctx.drawImage(images.backgroundAtlas, ...entry.rect, 0, 0, 1080, 1920);
  }
}

export function paintObservedBase(
  ctx: CanvasRenderingContext2D,
  spec: BackgroundSpec,
  bindings: ImageBindings,
  images: Record<string, HTMLImageElement>,
  time: number,
  early: boolean,
): string {
  const bg =
    spec.theme === 'pink'
      ? '#435899'
      : spec.theme === 'grey'
        ? '#b0b3b0'
        : early
          ? '#f3fafb'
          : '#b4a6dd';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 1080, 1920);
  paintObservedPlate(ctx, spec, bindings, images, time);
  return bg;
}

/** Theme bands belong to the camera-transformed background, not the board. */
export function paintObservedCameraBackground(
  ctx: CanvasRenderingContext2D,
  spec: BackgroundSpec,
  bindings: ImageBindings,
  images: Record<string, HTMLImageElement>,
  time: number,
): void {
  if (spec.appearance?.shakeBackground) paintObservedPlate(ctx, spec, bindings, images, time);
  if (images.background || images.workBackground) return;
  if (spec.theme === 'pink') {
    const gradient = ctx.createLinearGradient(0, 0, 0, 1920);
    gradient.addColorStop(0, '#435899');
    gradient.addColorStop(0.7, '#4d61a1');
    gradient.addColorStop(1, '#435899');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 1080, 1920);
  }
  if (spec.theme === 'grey')
    for (const [y, h, color] of [
      [0, 18, '#bdbbbb'],
      [296, 19, '#b2b0b0'],
      [432, 170, '#a9acaa'],
      [840, 80, '#abadab'],
      [1328, 79, '#a5a9a6'],
      [1407, 278, '#a4a2a3'],
      [1685, 235, '#999e9b'],
    ] as const) {
      ctx.fillStyle = color;
      ctx.fillRect(-24, y === 0 ? -24 : y, 1128, h + (y === 0 || y + h >= 1920 ? 24 : 0));
    }
}
