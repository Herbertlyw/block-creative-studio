import { expect, it, vi } from 'vitest';
import { drawImageFitted } from '../src/shared/media/drawImageFitted';

it('preserves the requested fit in design coordinates and rejects invalid dimensions', () => {
  const draw = vi.fn(),
    ctx = { drawImage: draw } as unknown as CanvasRenderingContext2D,
    image = {} as CanvasImageSource;
  drawImageFitted(ctx, image, 200, 100, 100, 100, 'contain');
  expect(draw).toHaveBeenLastCalledWith(image, 50, 0, 100, 100);
  drawImageFitted(ctx, image, 200, 100, 100, 100, 'cover');
  expect(draw).toHaveBeenLastCalledWith(image, 0, -50, 200, 200);
  drawImageFitted(ctx, image, 200, 100, 100, 100, 'stretch');
  expect(draw).toHaveBeenLastCalledWith(image, 0, 0, 200, 100);
  expect(() => drawImageFitted(ctx, image, 0, 100, 100, 100, 'cover')).toThrow(/GEOMETRY/);
});
