export function hashPixelBytes(bytes: Uint8ClampedArray | Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `pixels-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function hashCanvasPixels(canvas: HTMLCanvasElement): string {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('CANVAS_2D_CONTEXT_UNAVAILABLE');
  return hashPixelBytes(context.getImageData(0, 0, canvas.width, canvas.height).data);
}
