import type { ReferenceCalibration } from './parseCalibration';
import { recolorPixels } from './tileColors';

/** Resolve and validate every observed sprite before the scene is usable. */
export async function loadObservedAssets(
  spec: ReferenceCalibration,
  images: Record<string, HTMLImageElement>,
  tinted: Record<string, HTMLCanvasElement>,
  materialSprites: HTMLCanvasElement[],
  materialFaceColors: string[],
): Promise<void> {
  await Promise.all(
    Object.entries(spec.sprites ?? {}).map(
      ([name, url]) =>
        new Promise<void>((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            images[name] = image;
            resolve();
          };
          image.onerror = () => reject(new Error(`REFERENCE_SPRITE_LOAD:${name}`));
          image.src = url;
        }),
    ),
  );
  for (const event of spec.appearance?.praiseEvents ?? []) {
    if (!event.spriteRect) continue;
    const [x, y, width, height] = event.spriteRect,
      image = images.praiseAtlas;
    if (!image || x + width > image.naturalWidth || y + height > image.naturalHeight)
      throw new Error('REFERENCE_PRAISE_ATLAS_BOUNDS');
  }
  for (const [x, y, width, height] of spec.effects?.stoneFragmentRects ?? []) {
    const image = images.stoneFragments;
    if (!image || x + width > image.naturalWidth || y + height > image.naturalHeight)
      throw new Error('REFERENCE_STONE_FRAGMENT_BOUNDS');
  }
  if (spec.tileColors && images.tilePink) {
    for (const color of spec.tileColors) {
      const source = images.tilePink,
        buffer = document.createElement('canvas');
      buffer.width = source.naturalWidth;
      buffer.height = source.naturalHeight;
      const paint = buffer.getContext('2d')!;
      paint.drawImage(source, 0, 0);
      const pixels = paint.getImageData(0, 0, buffer.width, buffer.height);
      recolorPixels(pixels.data, color);
      paint.putImageData(pixels, 0, 0);
      tinted[color] = buffer;
    }
  }
  if (spec.tileMaterial || spec.appearance) {
    const material = spec.tileMaterial ?? {
      kind: 'palette-atlas',
      atlasRects: spec.appearance!.atlasRects,
    };
    const atlas = images[material.kind === 'palette-atlas' ? 'tileMaterialAtlas' : 'tileGemAtlas'];
    if (!atlas) throw new Error('REFERENCE_MATERIAL_ATLAS_MISSING');
    for (const [x, y, width, height] of material.atlasRects) {
      if (x + width > atlas.naturalWidth || y + height > atlas.naturalHeight)
        throw new Error('REFERENCE_MATERIAL_ATLAS_BOUNDS');
      const buffer = document.createElement('canvas');
      buffer.width = width;
      buffer.height = height;
      buffer.getContext('2d')!.drawImage(atlas, x, y, width, height, 0, 0, width, height);
      materialSprites.push(buffer);
      const pixel = buffer
        .getContext('2d')!
        .getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
      materialFaceColors.push(
        '#' +
          [...pixel]
            .slice(0, 3)
            .map((value) => value.toString(16).padStart(2, '0'))
            .join(''),
      );
    }
  }
}
