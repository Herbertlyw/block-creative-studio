import type { RuntimeImageAssetBinding } from '../assets/runtimeAssetBindings';

export async function loadRuntimeImage(binding: RuntimeImageAssetBinding | null): Promise<CanvasImageSource | null> {
  if (!binding) return null;
  if (typeof Image === 'undefined') throw new Error('AGENT_ASSET_IMAGE_ENVIRONMENT_UNAVAILABLE');
  const image = new Image();
  image.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error(`AGENT_ASSET_IMAGE_LOAD_FAILED: ${binding.sourceUri}`));
    image.src = binding.objectUrl;
  });
  return image;
}

export function drawRuntimeImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  binding: RuntimeImageAssetBinding,
  width: number,
  height: number,
): void {
  const inset = Math.min(width, height) * binding.inset;
  const x = inset;
  const y = inset;
  const targetWidth = Math.max(1, width - inset * 2);
  const targetHeight = Math.max(1, height - inset * 2);
  const sourceWidth = Math.max(1, binding.width ?? (Number((image as { width?: unknown }).width) || 1));
  const sourceHeight = Math.max(1, binding.height ?? (Number((image as { height?: unknown }).height) || 1));
  context.save();
  context.globalAlpha *= binding.opacity;
  context.globalCompositeOperation = binding.blendMode;
  if (binding.fit === 'stretch') {
    context.drawImage(image, x, y, targetWidth, targetHeight);
  } else {
    const scale = binding.fit === 'cover'
      ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
      : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const drawnWidth = sourceWidth * scale;
    const drawnHeight = sourceHeight * scale;
    if (binding.fit === 'cover') {
      const cropWidth = targetWidth / scale;
      const cropHeight = targetHeight / scale;
      context.drawImage(
        image,
        (sourceWidth - cropWidth) / 2,
        (sourceHeight - cropHeight) / 2,
        cropWidth,
        cropHeight,
        x,
        y,
        targetWidth,
        targetHeight,
      );
    } else {
      context.drawImage(image, x + (targetWidth - drawnWidth) / 2, y + (targetHeight - drawnHeight) / 2, drawnWidth, drawnHeight);
    }
  }
  context.restore();
}
