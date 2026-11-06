import type { RuntimeImageFit } from '../../../assets/runtimeAssetBindings';

export interface BoardAtlasCellQuery {
  imageWidth: number;
  imageHeight: number;
  rows: number;
  cols: number;
  row: number;
  col: number;
  fit: RuntimeImageFit;
}

export interface BoardAtlasCellSource {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface BoardAtlasCellUv {
  offset: [number, number];
  repeat: [number, number];
}

/** Where the source image sits on the unit board square before it is sliced. */
export function placedImageOnBoard(
  imageWidth: number,
  imageHeight: number,
  fit: RuntimeImageFit,
): { x: number; y: number; w: number; h: number } {
  if (fit === 'stretch' || imageWidth <= 0 || imageHeight <= 0) {
    return { x: 0, y: 0, w: 1, h: 1 };
  }
  const aspect = imageWidth / imageHeight;
  if (fit === 'cover') {
    if (aspect >= 1) return { x: (1 - aspect) / 2, y: 0, w: aspect, h: 1 };
    const height = 1 / aspect;
    return { x: 0, y: (1 - height) / 2, w: 1, h: height };
  }
  if (aspect >= 1) return { x: 0, y: (1 - 1 / aspect) / 2, w: 1, h: 1 / aspect };
  return { x: (1 - aspect) / 2, y: 0, w: aspect, h: 1 };
}

/**
 * Pixel rectangle inside the atlas image for one occupied board cell.
 * Returns null when the cell lies entirely in contain-letterbox empty space.
 */
export function boardAtlasCellSourceRect(query: BoardAtlasCellQuery): BoardAtlasCellSource | null {
  const { imageWidth, imageHeight, rows, cols, row, col, fit } = query;
  if (
    imageWidth < 1
    || imageHeight < 1
    || rows < 1
    || cols < 1
    || row < 0
    || col < 0
    || row >= rows
    || col >= cols
  ) {
    return null;
  }
  const placed = placedImageOnBoard(imageWidth, imageHeight, fit);
  const imgU0 = (col / cols - placed.x) / placed.w;
  const imgU1 = ((col + 1) / cols - placed.x) / placed.w;
  const imgV0 = (row / rows - placed.y) / placed.h;
  const imgV1 = ((row + 1) / rows - placed.y) / placed.h;
  const sx = Math.max(0, Math.min(imageWidth, imgU0 * imageWidth));
  const sy = Math.max(0, Math.min(imageHeight, imgV0 * imageHeight));
  const ex = Math.max(0, Math.min(imageWidth, imgU1 * imageWidth));
  const ey = Math.max(0, Math.min(imageHeight, imgV1 * imageHeight));
  const sw = ex - sx;
  const sh = ey - sy;
  if (sw < 0.5 || sh < 0.5) return null;
  return { sx, sy, sw, sh };
}

/** WebGL UV for the same cell. Image origin is top-left; GL offset origin is bottom-left. */
export function boardAtlasCellUv(query: BoardAtlasCellQuery): BoardAtlasCellUv | null {
  const source = boardAtlasCellSourceRect(query);
  if (!source) return null;
  return {
    offset: [source.sx / query.imageWidth, 1 - (source.sy + source.sh) / query.imageHeight],
    repeat: [source.sw / query.imageWidth, source.sh / query.imageHeight],
  };
}
