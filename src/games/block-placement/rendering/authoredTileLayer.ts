import { materialFaceSwatch } from '../../../nativeReference/games/block-placement/render/materialClearPalette';
import { boardAtlasCellSourceRect } from '../../../nativeReference/games/block-placement/render/boardAtlas';
import {
  BLAST_FACE_PALETTE,
  type ReferenceTilePalette,
} from '../../../nativeReference/reference2d/referenceProfile';
import type { BoardState, StyleSpec, TileColor } from '../../../nativeReference/domain/types';
import type { RuntimeAssetBindings } from '../../../nativeReference/assets/runtimeAssetBindings';
import { drawImageFace } from './imageFaceLayer';
import { paintCandyBlastTile } from './authoredCandyTile';
interface AuthoredImages {
  tileFace: HTMLImageElement | null;
  boardAtlas: HTMLImageElement | null;
}
const TWO_PI = Math.PI * 2;
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export function paintAuthoredTile(
  context: CanvasRenderingContext2D,
  style: StyleSpec,
  palette: ReferenceTilePalette,
  assets: RuntimeAssetBindings,
  images: AuthoredImages,
  board: BoardState | null,
  centerX: number,
  centerY: number,
  size: number,
  color: TileColor,
  alpha: number,
  scale: number,
  motif: boolean,
  atlasCell?: { row: number; col: number },
): void {
  if (alpha <= 0) return;
  const drawSize = size * scale;
  const x = centerX - drawSize / 2;
  const y = centerY - drawSize / 2;
  const candyBlast = style.reference2d.tileMaterial === 'candy-blast';
  const radius = candyBlast ? Math.max(1.2, drawSize * 0.055) : Math.max(4, drawSize * 0.075);
  context.save();
  context.globalAlpha = clamp01(alpha);
  if (candyBlast) {
    const materialFace = assets.tileFace
      ? materialFaceSwatch(style.reference2d.materialTheme)
      : undefined;
    paintCandyBlastTile(context, x, y, drawSize, materialFace ?? BLAST_FACE_PALETTE[color]);
  } else {
    const softBevel = style.reference2d.tileMaterial === 'soft-bevel';
    context.shadowColor = softBevel ? 'rgba(18,74,45,0.42)' : 'rgba(18,74,45,0.22)';
    context.shadowBlur = softBevel ? Math.max(2, drawSize * 0.045) : Math.max(1, drawSize * 0.018);
    context.shadowOffsetX = softBevel ? drawSize * 0.035 : 0;
    context.shadowOffsetY = softBevel ? drawSize * 0.055 : drawSize * 0.018;
    roundedRect(context, x, y, drawSize, drawSize, radius);
    if (softBevel) {
      const gradient = context.createLinearGradient(x, y, x, y + drawSize);
      gradient.addColorStop(0, palette.top);
      gradient.addColorStop(0.44, palette.base);
      gradient.addColorStop(1, palette.bottom);
      context.fillStyle = gradient;
    } else {
      context.fillStyle = palette.base;
    }
    context.fill();
    context.shadowColor = 'transparent';
    context.strokeStyle = palette.edge;
    context.lineWidth = Math.max(1.4, drawSize * 0.018);
    context.stroke();

    if (softBevel) {
      roundedRect(
        context,
        x + drawSize * 0.055,
        y + drawSize * 0.045,
        drawSize * 0.89,
        drawSize * 0.86,
        radius * 0.72,
      );
      context.strokeStyle = 'rgba(255,255,255,0.22)';
      context.lineWidth = Math.max(1, drawSize * 0.014);
      context.stroke();
    }
  }

  const tileFaceBinding = assets.tileFace;
  const tileFaceImage = images.tileFace;
  const atlasBinding = assets.boardAtlas;
  const atlasImage = images.boardAtlas;
  const atlasSource =
    atlasCell && board && atlasBinding && atlasImage
      ? boardAtlasCellSourceRect({
          imageWidth: Math.max(1, atlasImage.naturalWidth || atlasBinding.width || 1),
          imageHeight: Math.max(1, atlasImage.naturalHeight || atlasBinding.height || 1),
          rows: board.rows,
          cols: board.cols,
          row: atlasCell.row,
          col: atlasCell.col,
          fit: atlasBinding.fit,
        })
      : null;
  if (motif && atlasSource && atlasBinding && atlasImage) {
    const inset = drawSize * atlasBinding.inset;
    drawImageFace({
      ctx: context,
      image: atlasImage,
      sourceWidth: Math.max(1, atlasImage.width),
      sourceHeight: Math.max(1, atlasImage.height),
      x: x + inset,
      y: y + inset,
      size: Math.max(1, drawSize - inset * 2),
      radius: Math.max(2, radius - inset * 0.35),
      opacity: atlasBinding.opacity,
      alpha: 1,
      blendMode: atlasBinding.blendMode,
      fit: atlasBinding.fit,
      clip: 'arc-to',
      fittedOrigin: 'absolute',
      source: atlasSource,
    });
  } else if (tileFaceBinding && tileFaceImage) {
    const inset = drawSize * tileFaceBinding.inset;
    drawImageFace({
      ctx: context,
      image: tileFaceImage,
      sourceWidth: Math.max(1, tileFaceImage.width),
      sourceHeight: Math.max(1, tileFaceImage.height),
      x: x + inset,
      y: y + inset,
      size: Math.max(1, drawSize - inset * 2),
      radius: Math.max(2, radius - inset * 0.35),
      opacity: tileFaceBinding.opacity,
      alpha: 1,
      blendMode: tileFaceBinding.blendMode,
      fit: tileFaceBinding.fit,
      clip: 'arc-to',
      fittedOrigin: 'absolute',
    });
  } else if (motif && !candyBlast && style.reference2d.tileFaceSet === 'botanical-reference') {
    context.save();
    context.translate(centerX, centerY + drawSize * 0.025);
    context.fillStyle = palette.motif;
    context.globalAlpha *= 0.52;
    // The full-video audit confirms multiple botanical families but not a
    // definitive color-to-motif assignment rule. This deterministic mapping
    // is therefore a renderer approximation, not gameplay truth.
    if (color === 'lime') drawLeafMotif(context, drawSize * 0.24);
    else if (color === 'cyan') drawMonsteraMotif(context, drawSize * 0.24);
    else if (color === 'rose') drawRoseMotif(context, drawSize * 0.25);
    else if (color === 'amber') drawFlowerMotif(context, drawSize * 0.19, 7);
    else drawFlowerMotif(context, drawSize * 0.22, color === 'blue' ? 5 : 4);
    context.restore();
  }
  context.restore();
}

function drawLeafMotif(context: CanvasRenderingContext2D, size: number): void {
  context.save();
  context.rotate(-0.72);
  context.beginPath();
  context.moveTo(-size * 0.85, size * 0.58);
  context.bezierCurveTo(-size * 0.5, -size, size * 0.95, -size * 0.9, size, -size * 0.85);
  context.bezierCurveTo(
    size * 0.8,
    size * 0.6,
    -size * 0.36,
    size * 0.98,
    -size * 0.85,
    size * 0.58,
  );
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,0.12)';
  context.lineWidth = Math.max(1, size * 0.08);
  context.beginPath();
  context.moveTo(-size * 0.62, size * 0.48);
  context.lineTo(size * 0.63, -size * 0.52);
  context.stroke();
  context.restore();
}

function drawFlowerMotif(context: CanvasRenderingContext2D, size: number, petals: number): void {
  for (let index = 0; index < petals; index += 1) {
    context.save();
    context.rotate((index / petals) * TWO_PI);
    context.beginPath();
    context.ellipse(0, -size * 0.66, size * 0.38, size * 0.7, 0, 0, TWO_PI);
    context.fill();
    context.restore();
  }
  context.globalAlpha *= 0.85;
  context.beginPath();
  context.arc(0, 0, size * 0.28, 0, TWO_PI);
  context.fill();
}

function drawMonsteraMotif(context: CanvasRenderingContext2D, size: number): void {
  context.save();
  context.rotate(-0.42);
  context.beginPath();
  context.moveTo(-size * 0.18, size * 0.95);
  context.bezierCurveTo(-size * 0.98, size * 0.32, -size * 0.82, -size * 0.72, 0, -size);
  context.bezierCurveTo(
    size * 0.86,
    -size * 0.68,
    size * 0.98,
    size * 0.28,
    size * 0.2,
    size * 0.94,
  );
  context.bezierCurveTo(
    size * 0.08,
    size * 1.03,
    -size * 0.08,
    size * 1.03,
    -size * 0.18,
    size * 0.95,
  );
  context.fill();

  context.strokeStyle = 'rgba(255,255,255,0.13)';
  context.lineWidth = Math.max(1, size * 0.075);
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(0, size * 0.92);
  context.lineTo(0, -size * 0.82);
  for (const direction of [-1, 1] as const) {
    for (let index = 0; index < 3; index += 1) {
      const y = size * (0.48 - index * 0.42);
      context.moveTo(0, y);
      context.lineTo(direction * size * (0.48 + index * 0.08), y - size * 0.24);
    }
  }
  context.stroke();
  context.restore();
}

function drawRoseMotif(context: CanvasRenderingContext2D, size: number): void {
  context.save();
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.strokeStyle = context.fillStyle;
  context.lineWidth = Math.max(1.5, size * 0.14);
  context.beginPath();
  context.arc(0, 0, size * 0.18, -0.4, Math.PI * 1.6);
  context.arc(-size * 0.04, size * 0.02, size * 0.34, Math.PI * 1.55, Math.PI * 3.15);
  context.arc(size * 0.02, size * 0.05, size * 0.54, Math.PI * 0.05, Math.PI * 1.65);
  context.stroke();
  for (let index = 0; index < 5; index += 1) {
    context.save();
    context.rotate((index / 5) * TWO_PI + 0.3);
    context.beginPath();
    context.ellipse(0, -size * 0.55, size * 0.34, size * 0.52, 0, 0, TWO_PI);
    context.stroke();
    context.restore();
  }
  context.restore();
}
