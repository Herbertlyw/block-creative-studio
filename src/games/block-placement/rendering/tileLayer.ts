import { drawImageFace } from './imageFaceLayer';
import { eachPieceCell } from './pieceLayer';
import { boardAtlasCellSourceRect } from '../../../nativeReference/games/block-placement/render/boardAtlas';
import {
  measuredCellColor,
  referenceFaceAt,
} from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';
import {
  tintForColor,
  mixColor,
  shapeCellColor,
  materialSpriteIndex,
} from '../calibrated/tileColors';
import type { ReferenceCalibration } from '../calibrated/parseCalibration';
import type { ImageBindings } from '../calibrated/imageBindings';

/** Runtime assets are resolved and checked by the caller before this layer paints. */
export interface BBTileLayerOptions {
  ctx: CanvasRenderingContext2D;
  style: Pick<ReferenceCalibration, 'theme' | 'appearance' | 'tileColors' | 'tileMaterial'>;
  images: Record<string, HTMLImageElement>;
  tinted: Record<string, HTMLCanvasElement>;
  materialSprites: HTMLCanvasElement[];
  bindings: ImageBindings;
  boardRows: number;
  boardCols: number;
}
const palettes = {
  pink: ['#d26691', '#f8a3bd', '#e783a6', '#a84071', '#bf4f7d'],
  purple: ['#9180ed', '#c0b1fc', '#a595f3', '#62579a', '#776ab8'],
  white: ['#d3e3ed', '#f2fbfe', '#e5f4fa', '#a0b2be', '#b8cbd6'],
  cyan: ['#77b9d7', '#a1dcf2', '#8acde9', '#45829e', '#5997b4'],
  coral: ['#efafae', '#ffd1ca', '#fac2bc', '#bf817e', '#d38f8a'],
  blue: ['#087ddd', '#249dee', '#148bec', '#045498', '#0869b8'],
} as const;
function palette(theme: string, color: string, sourceTime: number) {
  const key =
    theme === 'pink'
      ? 'pink'
      : theme === 'purple'
        ? sourceTime < 16.25
          ? 'blue'
          : 'purple'
        : color === 'coral'
          ? 'coral'
          : color === 'cyan'
            ? 'cyan'
            : 'white';
  return palettes[key];
}

/** Shared drawing primitive; it does not own the board, a Take, or a clock. */
export function createBBTileLayer({
  ctx,
  style,
  images,
  tinted,
  materialSprites,
  bindings,
  boardRows,
  boardCols,
}: BBTileLayerOptions) {
  function polygon(points: readonly (readonly [number, number])[], fill: string) {
    ctx.beginPath();
    points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  }
  function base(
    x: number,
    y: number,
    size: number,
    color: string,
    time: number,
    alpha = 1,
    override?: string,
  ) {
    if (style.appearance && color.startsWith('observed-face:') && !override) {
      const sprite =
        materialSprites[referenceFaceAt(style.appearance, Number(color.split(':')[1]), time)];
      if (!sprite) throw new Error('REFERENCE_APPEARANCE_SPRITE_MISSING');
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(sprite, x, y, size, size);
      ctx.restore();
      return;
    }
    if (style.tileMaterial && !override) {
      const sprite = materialSprites[materialSpriteIndex(color, style.tileMaterial.kind)];
      if (!sprite) throw new Error('REFERENCE_MATERIAL_SPRITE_MISSING');
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(sprite, x, y, size, size);
      ctx.restore();
      return;
    }
    const tint = override ?? tintForColor(style.tileColors, color);
    const sprite =
      (tint ? tinted[tint] : undefined) ??
      images[
        style.theme === 'pink'
          ? 'tilePink'
          : style.theme === 'purple'
            ? time < 16.25
              ? 'tileBlue'
              : 'tilePurple'
            : color === 'coral'
              ? 'tileCoral'
              : color === 'cyan'
                ? 'tileCyan'
                : 'tileWhite'
      ];
    if (sprite && !override) {
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.drawImage(sprite, x, y, size, size);
      ctx.restore();
      return;
    }
    const p: readonly [string, string, string, string, string] = tint
        ? [
            tint,
            mixColor(tint, 0.55),
            mixColor(tint, 0.25),
            mixColor(tint, -0.38),
            mixColor(tint, -0.2),
          ]
        : palette(style.theme, color, time),
      b = size * 0.15;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = style.theme === 'pink' ? '#49334e' : '#3d3c47';
    ctx.fillRect(x, y, size, size);
    x += 1.3;
    y += 1.3;
    size -= 2.6;
    ctx.fillStyle = p[0];
    ctx.fillRect(x, y, size, size);
    polygon(
      [
        [x, y],
        [x + size, y],
        [x + size - b, y + b],
        [x + b, y + b],
      ],
      p[1],
    );
    polygon(
      [
        [x, y],
        [x + b, y + b],
        [x + b, y + size - b],
        [x, y + size],
      ],
      p[2],
    );
    polygon(
      [
        [x, y + size],
        [x + b, y + size - b],
        [x + size - b, y + size - b],
        [x + size, y + size],
      ],
      p[3],
    );
    polygon(
      [
        [x + size, y],
        [x + size, y + size],
        [x + size - b, y + size - b],
        [x + size - b, y + b],
      ],
      p[4],
    );
    const grad = ctx.createLinearGradient(0, y + b, 0, y + size - b);
    grad.addColorStop(0, p[0]);
    grad.addColorStop(0.5, p[0]);
    grad.addColorStop(1, p[2]);
    ctx.globalAlpha *= 0.24;
    ctx.fillStyle = grad;
    ctx.fillRect(x + b, y + b, size - 2 * b, size - 2 * b);
    ctx.globalAlpha /= 0.24;
    ctx.restore();
  }
  function tile(
    x: number,
    y: number,
    size: number,
    color: string,
    time: number,
    alpha = 1,
    override?: string,
    cell?: { row: number; col: number },
  ) {
    base(x, y, size, color, time, alpha, override);
    const atlas =
      cell && bindings.atlas && images.workBoardAtlas
        ? boardAtlasCellSourceRect({
            imageWidth: images.workBoardAtlas.naturalWidth,
            imageHeight: images.workBoardAtlas.naturalHeight,
            rows: boardRows,
            cols: boardCols,
            row: cell.row,
            col: cell.col,
            fit: bindings.atlas.fit,
          })
        : null;
    const binding = atlas ? bindings.atlas : bindings.face,
      image = atlas ? images.workBoardAtlas : images.workTileFace;
    if (!binding || !image) return;
    const inset = size * binding.inset,
      side = Math.max(1, size - 2 * inset);
    drawImageFace({
      ctx,
      image,
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
      x: x + inset,
      y: y + inset,
      size: side,
      radius: Math.max(2, side * 0.1),
      opacity: binding.opacity,
      alpha,
      blendMode: binding.blendMode,
      fit: binding.fit,
      clip: 'round-rect',
      fittedOrigin: 'translated',
      ...(atlas ? { source: atlas } : {}),
    });
  }
  function pieceCell(
    x: number,
    y: number,
    size: number,
    color: string,
    time: number,
    row: number,
    col: number,
    alpha = 1,
  ) {
    tile(
      x,
      y,
      size,
      measuredCellColor(
        style.appearance,
        shapeCellColor(color, row, col, style.tileMaterial),
        row,
        col,
      ),
      time,
      alpha,
    );
  }
  function shape(
    cells: readonly (readonly [number, number])[],
    x: number,
    y: number,
    size: number,
    color: string,
    time: number,
    alpha = 1,
  ) {
    eachPieceCell(cells, { x, y, pitch: size, anchor: 'top-left' }, (px, py, r, c) =>
      pieceCell(px, py, size, color, time, r, c, alpha),
    );
  }
  return { tile, shape, pieceCell };
}
