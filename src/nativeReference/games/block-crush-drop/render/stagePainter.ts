import { simulateClearSheet } from '../profiles/clearSheet';
export { simulateClearSheet } from '../profiles/clearSheet';
import { BLOCK_CRUSH_DROP_CRUSHZR29976_FOREGROUND_OCCLUDER } from './lookPack';
import {
  evaluateClearPhysics,
  evaluateClearPhysicsWorld,
  sampleClearPhysicsWorldHistory,
  type ClearPhysicsHistoryPose,
  type ClearPhysicsEvent,
  type ClearPhysicsObservation,
  type ClearPhysicsSeed,
} from './clearPhysics';
import { drawReferenceBlock, referenceBlockColor, referenceQueueColor } from './referenceBlocks';
import {
  BLOCK_CRUSH_DROP_DEFAULT_FRAGMENT_APPEARANCE,
  type BlockCrushDropPresentationFrame,
} from '../presentation/presentationAdapter';
import type { BlockCrushDropCell, BlockCrushDropState } from '../types';
import type { BlockCrushDropTrayGlyphLayout } from './lookPack';
import { crushCanvasFilter, type BlockCrushDropPalette } from './palette';
import type { RuntimeImageAssetBinding } from '../../../assets/runtimeAssetBindings';
import { drawRuntimeImage } from '../../../agent-assets/runtimeImage';
import { crushSourceOutgoingTrayScale, crushSourceTrayRefillScale } from './trayRefill';

/** Clear-debris choreography: the measured 29976 folding sheet, or the candy fountain. */
export type BlockCrushDropDebrisStyle = 'sheet' | 'fountain';

/** Saturated candy hues matching the bb 落消 quota-bar order (pink…red). */
export const CANDY_POP_CELL_COLORS = [
  '#ff5e7a',
  '#3ddc5a',
  '#ffd02e',
  '#ff7a1a',
  '#29c5ff',
  '#a55dff',
  '#3d6bff',
  '#f03737',
] as const;

/** Stable presentation-only colour assignment; a cell keeps its hue across moves. */
export function candyPopColorForCellId(id: string): string {
  const scramble = (unitHash(`candy:${id}`) * 12.9898 + unitHash(`pop:${id}`) * 78.233) % 1;
  const index =
    Math.floor(Math.abs(scramble) * CANDY_POP_CELL_COLORS.length) % CANDY_POP_CELL_COLORS.length;
  return CANDY_POP_CELL_COLORS[index]!;
}

export const BLOCK_CRUSH_DROP_STAGE = {
  width: 1080,
  height: 1920,
} as const;

interface BlockCrushDropLayout {
  gridX: number;
  gridY: number;
  gridWidth: number;
  contentYOffset: number;
}

function layoutFor(state: BlockCrushDropState): BlockCrushDropLayout {
  const calibration = state.config.presentation.referenceCalibration;
  if (calibration)
    return {
      gridX: calibration.board.x,
      gridY: calibration.board.y,
      gridWidth: calibration.board.cell * state.config.columns,
      contentYOffset: 0,
    };
  const width = Math.min(1_031, (1_718.4 / state.config.rows) * state.config.columns);
  return state.config.presentation.layout === 'top-queue-full-height'
    ? // CRUSHZR29976 is not laid out on an exact 57 px pitch. Measuring the
      // repeated source tile from the encoded reference gives a 57.28 px pitch,
      // anchored at x=22 and y=205 (including the content offset). Keeping the
      // former 57 px pitch accumulated a 5-7 px drift across the board.
      { gridX: 22 + (1_031 - width) / 2, gridY: 197, gridWidth: width, contentYOffset: 8 }
    : { gridX: 248, gridY: 207, gridWidth: 780, contentYOffset: 0 };
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawWood(
  context: CanvasRenderingContext2D,
  palette: BlockCrushDropPalette = 'classic-wood',
): void {
  if (palette === 'candy-pop' || palette === 'arcade-bevel') {
    const gradient = context.createLinearGradient(0, 0, 0, BLOCK_CRUSH_DROP_STAGE.height);
    gradient.addColorStop(0, '#263057');
    gradient.addColorStop(0.45, '#1b2342');
    gradient.addColorStop(1, '#12172e');
    context.fillStyle = gradient;
    context.fillRect(0, 0, BLOCK_CRUSH_DROP_STAGE.width, BLOCK_CRUSH_DROP_STAGE.height);
    const glow = context.createRadialGradient(540, 760, 180, 540, 860, 1_150);
    glow.addColorStop(0, 'rgba(88,120,255,0.16)');
    glow.addColorStop(0.6, 'rgba(58,76,190,0.07)');
    glow.addColorStop(1, 'rgba(6,8,20,0.42)');
    context.fillStyle = glow;
    context.fillRect(0, 0, BLOCK_CRUSH_DROP_STAGE.width, BLOCK_CRUSH_DROP_STAGE.height);
    return;
  }
  if (palette === 'honey-gold') {
    const gradient = context.createLinearGradient(0, 0, BLOCK_CRUSH_DROP_STAGE.width, 0);
    gradient.addColorStop(0, '#1a2416');
    gradient.addColorStop(0.46, '#24321c');
    gradient.addColorStop(1, '#182014');
    context.fillStyle = gradient;
    context.fillRect(0, 0, BLOCK_CRUSH_DROP_STAGE.width, BLOCK_CRUSH_DROP_STAGE.height);
    return;
  }
  const gradient = context.createLinearGradient(0, 0, BLOCK_CRUSH_DROP_STAGE.width, 0);
  gradient.addColorStop(0, '#7a431f');
  gradient.addColorStop(0.46, '#9b6236');
  gradient.addColorStop(1, '#77401e');
  context.fillStyle = gradient;
  context.fillRect(0, 0, BLOCK_CRUSH_DROP_STAGE.width, BLOCK_CRUSH_DROP_STAGE.height);

  context.save();
  context.globalAlpha = 0.18;
  for (let y = 10; y < BLOCK_CRUSH_DROP_STAGE.height; y += 13) {
    context.beginPath();
    for (let x = -20; x <= BLOCK_CRUSH_DROP_STAGE.width + 20; x += 18) {
      const wave = Math.sin(x * 0.017 + y * 0.031) * 3 + Math.sin(x * 0.004 + y) * 1.4;
      if (x === -20) context.moveTo(x, y + wave);
      else context.lineTo(x, y + wave);
    }
    context.strokeStyle = y % 39 === 0 ? '#3c1b0c' : '#d29a63';
    context.lineWidth = y % 39 === 0 ? 1.5 : 0.7;
    context.stroke();
  }
  context.restore();

  const vignette = context.createRadialGradient(560, 870, 350, 540, 960, 1_140);
  vignette.addColorStop(0.55, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(31,10,2,0.36)');
  context.fillStyle = vignette;
  context.fillRect(0, 0, BLOCK_CRUSH_DROP_STAGE.width, BLOCK_CRUSH_DROP_STAGE.height);
}

function drawScoreProgressHud(context: CanvasRenderingContext2D): void {
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = 'rgba(52,25,7,0.9)';
  context.shadowBlur = 9;
  context.shadowOffsetY = 5;
  context.fillStyle = '#fff0c7';
  context.font = '900 92px Georgia, serif';
  context.fillText('8873', 595, 91);

  context.textAlign = 'left';
  context.font = '700 36px Georgia, serif';
  context.fillStyle = '#d6a45b';
  context.fillText('♛  1909780', 35, 67);
  context.fillStyle = '#f5b74b';
  context.fillText('♛  1009790', 35, 119);
  context.restore();

  context.save();
  context.shadowColor = 'rgba(0,0,0,0.55)';
  context.shadowBlur = 8;
  roundedRect(context, 42, 145, 994, 22, 11);
  context.fillStyle = '#5f2f14';
  context.fill();
  roundedRect(context, 47, 149, 981, 14, 7);
  const progress = context.createLinearGradient(47, 0, 1_028, 0);
  progress.addColorStop(0, '#ffdf08');
  progress.addColorStop(0.82, '#e6b80a');
  progress.addColorStop(1, '#94631a');
  context.fillStyle = progress;
  context.fill();
  context.restore();
}

function drawQueuePiece(
  context: CanvasRenderingContext2D,
  state: BlockCrushDropState,
  batchIndex: number,
  traySlot: number,
  centerX: number,
  sourceTrayTile?: CanvasImageSource,
  trayGlyphLayouts?: Readonly<Record<string, BlockCrushDropTrayGlyphLayout>>,
  glyphScale = 1,
  palette: BlockCrushDropPalette = 'classic-wood',
): void {
  const trayPiece = state.config.trayBatches[batchIndex]?.[traySlot];
  const piece = state.config.pieces.find((candidate) => candidate.id === trayPiece?.pieceId);
  if (!piece || !trayPiece) return;
  const rotated = piece.cells.map((cell) => {
    switch (trayPiece.quarterTurns) {
      case 1:
        return { x: cell.y, y: -cell.x };
      case 2:
        return { x: -cell.x, y: -cell.y };
      case 3:
        return { x: -cell.y, y: cell.x };
      default:
        return { ...cell };
    }
  });
  const offsetX = Math.min(...rotated.map((cell) => cell.x));
  const offsetY = Math.min(...rotated.map((cell) => cell.y));
  const cells = rotated.map((cell) => ({ x: cell.x - offsetX, y: cell.y - offsetY }));
  // Queue objects in CRUSHZR29976 use their own presentation scale and pivot;
  // they are not board cells reduced to one shared size. Keep these measured
  // look-pack coordinates outside gameplay state and only activate them when
  // the source-derived tray texture is present.
  const sourceLayout = sourceTrayTile ? trayGlyphLayouts?.[`${batchIndex}:${traySlot}`] : undefined;
  const pitch = sourceLayout?.pitch ?? 24;
  const size = sourceLayout?.size ?? 24;
  const minimumX = Math.min(...cells.map((cell) => cell.x));
  const maximumX = Math.max(...cells.map((cell) => cell.x));
  const minimumY = Math.min(...cells.map((cell) => cell.y));
  const maximumY = Math.max(...cells.map((cell) => cell.y));
  const width = (maximumX - minimumX) * pitch + size;
  const height = (maximumY - minimumY) * pitch + size;
  const pivotX = (sourceLayout?.x ?? centerX - width / 2) + width / 2;
  const pivotY = (sourceLayout?.y ?? 104 - height / 2) + height / 2;
  cells.forEach((cell) => {
    const unscaledX = (sourceLayout?.x ?? centerX - width / 2) + (cell.x - minimumX) * pitch;
    const unscaledY = (sourceLayout?.y ?? 104 - height / 2) + (maximumY - cell.y) * pitch;
    const scaledSize = size * glyphScale;
    const x = pivotX + (unscaledX - pivotX) * glyphScale;
    const y = pivotY + (unscaledY - pivotY) * glyphScale;
    if (sourceTrayTile) context.drawImage(sourceTrayTile, x, y, scaledSize, scaledSize);
    else if (palette === 'arcade-bevel')
      drawReferenceBlock(context, x, y, scaledSize, referenceQueueColor(batchIndex, traySlot));
    else if (palette === 'candy-pop')
      drawCandyTile(context, x, y, scaledSize, 1, candyPopColorForCellId(piece.id));
    else drawEmbossedStar(context, x, y, scaledSize, 1, palette);
  });
}

function scoreForFrame(frame: BlockCrushDropPresentationFrame): number {
  if (frame.displayScore !== undefined) return frame.displayScore;
  if (frame.phase === 'idle') return frame.before.score;
  const trayPiece = frame.action
    ? frame.before.config.trayBatches[frame.before.batchIndex]?.[frame.action.traySlot]
    : undefined;
  const piece = frame.before.config.pieces.find((candidate) => candidate.id === trayPiece?.pieceId);
  const placementScore = (piece?.cells.length ?? 0) * frame.before.config.rules.scoring.placedCell;
  if (frame.phase === 'commit')
    return frame.progress >= 1 ? frame.before.score + placementScore : frame.before.score;
  if (frame.phase === 'detect' || frame.phase === 'resolve')
    return frame.before.score + placementScore;
  if (frame.phase === 'reconfigure') {
    const revealPower = frame.before.clearEventCount === 0 ? 2.6 : 1.75;
    const revealProgress = 1 - Math.pow(1 - Math.max(0, Math.min(1, frame.progress)), revealPower);
    return (
      frame.before.score +
      placementScore +
      (frame.after.score - frame.before.score - placementScore) * revealProgress
    );
  }
  return frame.after.score;
}

function drawTimerTrayHud(
  context: CanvasRenderingContext2D,
  frame: BlockCrushDropPresentationFrame,
  drawChrome = true,
  sourceTrayTile?: CanvasImageSource,
  trayGlyphLayouts?: Readonly<Record<string, BlockCrushDropTrayGlyphLayout>>,
  palette: BlockCrushDropPalette = 'classic-wood',
): void {
  const state = frame.before;
  const gold = palette === 'honey-gold';
  const candy = palette === 'candy-pop' || palette === 'arcade-bevel';
  context.save();
  if (drawChrome) {
    const header = context.createLinearGradient(0, 0, 0, 198);
    if (candy) {
      header.addColorStop(0, '#2c3766');
      header.addColorStop(1, '#1a2140');
    } else if (gold) {
      header.addColorStop(0, '#c4a45a');
      header.addColorStop(1, '#8a6a28');
    } else {
      header.addColorStop(0, '#e6bf83');
      header.addColorStop(1, '#c99659');
    }
    context.fillStyle = header;
    context.fillRect(0, 0, BLOCK_CRUSH_DROP_STAGE.width, 198);
  }
  context.fillStyle = candy ? '#eef2ff' : gold ? '#2e2208' : '#5a260e';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (drawChrome) {
    context.font = '800 35px Georgia, serif';
    context.fillText('time', 136, 75);
    context.fillText('score', 944, 75);
  }
  context.font = '900 64px "Arial Black", Arial, sans-serif';
  const drawHudNumber = (value: string, centerX: number, horizontalScale: number) => {
    context.save();
    context.translate(centerX, 142);
    context.scale(horizontalScale, 1);
    context.strokeStyle = candy ? '#0c1126' : gold ? '#2e2208' : '#5a260e';
    context.lineWidth = candy ? 5 : 1.2;
    context.strokeText(value, 0, 0);
    context.fillText(value, 0, 0);
    context.restore();
  };
  drawHudNumber(
    String(
      frame.displayCountdownSeconds ??
        (state.config.rules.settlement
          ? Math.floor(frame.frameIndex / frame.fps)
          : Math.max(0, 178 - Math.floor(frame.frameIndex / frame.fps))),
    ),
    139,
    0.86,
  );
  drawHudNumber(String(Math.round(scoreForFrame(frame))), 944, 0.9);

  [392, 540, 688].forEach((centerX, index) => {
    if (drawChrome) {
      roundedRect(context, centerX - 67, 38, 134, 132, 13);
      context.fillStyle = candy ? '#141a34' : gold ? '#5a4318' : '#6d371a';
      context.shadowColor = candy
        ? 'rgba(4,6,16,0.8)'
        : gold
          ? 'rgba(28,20,6,0.7)'
          : 'rgba(58,25,9,0.7)';
      context.shadowBlur = 5;
      context.fill();
      context.shadowColor = 'transparent';
      roundedRect(context, centerX - 60, 46, 120, 116, 9);
      context.fillStyle = candy ? '#232c52' : gold ? '#6e5420' : '#7f441f';
      context.fill();
      if (candy) {
        roundedRect(context, centerX - 60, 46, 120, 116, 9);
        context.strokeStyle = 'rgba(122,148,255,0.4)';
        context.lineWidth = 2;
        context.stroke();
      }
    }
    // A source-bound next batch grows into the tray after the last pickup.
    // Canonical time keeps the HUD animation equivalent at30/60fps.
    const displayBatchIndex = frame.after.batchIndex;
    const availableSlots = new Set(frame.after.remainingTraySlots);
    const sourceRefill = Boolean(
      sourceTrayTile &&
        trayGlyphLayouts &&
        frame.interaction &&
        frame.action &&
        frame.before.batchIndex !== displayBatchIndex,
    );
    const sincePickup = frame.interaction ? frame.canonicalTick - frame.interaction.startFrame : 0;
    if (sourceRefill && frame.action!.traySlot === index) {
      const oldScale = crushSourceOutgoingTrayScale(sincePickup);
      if (oldScale > 0)
        drawQueuePiece(
          context,
          state,
          frame.before.batchIndex,
          index,
          centerX,
          sourceTrayTile,
          trayGlyphLayouts,
          oldScale,
          palette,
        );
    }
    let outgoingScale = 0;
    if (
      frame.phase === 'commit' &&
      frame.action &&
      frame.interaction &&
      frame.before.batchIndex === displayBatchIndex &&
      frame.action.traySlot === index
    ) {
      const configuredFrames = Number(frame.interaction.metadata?.trayReleaseFrames);
      const releaseFrames = Number.isFinite(configuredFrames) ? Math.max(1, configuredFrames) : 1;
      outgoingScale =
        1 - smoothstep((frame.canonicalTick - frame.interaction.startFrame) / releaseFrames);
      if (outgoingScale > 0) availableSlots.add(index);
    }
    if (availableSlots.has(index)) {
      drawQueuePiece(
        context,
        state,
        displayBatchIndex,
        index,
        centerX,
        sourceTrayTile,
        trayGlyphLayouts,
        sourceRefill
          ? crushSourceTrayRefillScale(sincePickup)
          : outgoingScale > 0
            ? outgoingScale
            : 1,
        palette,
      );
    }
  });
  context.restore();
}

function drawHud(
  context: CanvasRenderingContext2D,
  frame: BlockCrushDropPresentationFrame,
  palette: BlockCrushDropPalette = 'classic-wood',
): void {
  if (frame.before.config.presentation.hud === 'timer-score-queue') {
    drawTimerTrayHud(context, frame, true, undefined, undefined, palette);
  } else drawScoreProgressHud(context);
}

export function blockCrushDropCellSize(state: BlockCrushDropState): number {
  return layoutFor(state).gridWidth / state.config.columns;
}

export function blockCrushDropScreenPosition(
  state: BlockCrushDropState,
  x: number,
  y: number,
  fieldRiseOffsetCells = 0,
): { x: number; y: number } {
  const size = blockCrushDropCellSize(state);
  const layout = layoutFor(state);
  const screenRow = state.config.rows - 1 - y;
  return {
    x: layout.gridX + x * size,
    y: layout.gridY + screenRow * size + layout.contentYOffset - fieldRiseOffsetCells * size,
  };
}

function drawEmptyGrid(
  context: CanvasRenderingContext2D,
  state: BlockCrushDropState,
  palette: BlockCrushDropPalette = 'classic-wood',
): void {
  const size = blockCrushDropCellSize(state);
  const layout = layoutFor(state);
  const gridHeight = state.config.rows * size;
  const fullHeight = state.config.presentation.layout === 'top-queue-full-height';
  const outerX = layout.gridX - (fullHeight ? 15 : 40);
  const outerY = layout.gridY - (fullHeight ? 10 : 31);
  const outerWidth = layout.gridWidth + (fullHeight ? 30 : 58);
  const outerHeight = gridHeight + 55;

  const gold = palette === 'honey-gold';
  const candy = palette === 'candy-pop' || palette === 'arcade-bevel';
  context.save();
  context.shadowColor = candy
    ? 'rgba(3,5,14,0.8)'
    : gold
      ? 'rgba(8,16,6,0.7)'
      : 'rgba(24,9,2,0.66)';
  context.shadowBlur = 11;
  roundedRect(context, outerX, outerY, outerWidth, outerHeight, 22);
  const frame = context.createLinearGradient(outerX, outerY, outerX + outerWidth, outerY);
  if (candy) {
    frame.addColorStop(0, '#3a4678');
    frame.addColorStop(0.5, '#5f6ea8');
    frame.addColorStop(1, '#333d6e');
  } else if (gold) {
    frame.addColorStop(0, '#8a6a28');
    frame.addColorStop(0.5, '#e8c56a');
    frame.addColorStop(1, '#7a5a1e');
  } else {
    frame.addColorStop(0, '#c58e58');
    frame.addColorStop(0.5, '#e1b77d');
    frame.addColorStop(1, '#b97945');
  }
  context.fillStyle = frame;
  context.fill();
  context.restore();

  // Empty source cells are not separate recessed wells. They are one dark
  // vertical-plank playfield; only occupied cubes introduce horizontal cell
  // boundaries. Drawing an empty square grid was a visible false abstraction.
  const boardWood = context.createLinearGradient(0, layout.gridY, 0, layout.gridY + gridHeight);
  if (candy) {
    boardWood.addColorStop(0, '#10162e');
    boardWood.addColorStop(0.5, '#141c3a');
    boardWood.addColorStop(1, '#0d1226');
  } else if (gold) {
    boardWood.addColorStop(0, '#142014');
    boardWood.addColorStop(0.44, '#1c2c18');
    boardWood.addColorStop(1, '#10180e');
  } else {
    boardWood.addColorStop(0, '#321006');
    boardWood.addColorStop(0.44, '#682d11');
    boardWood.addColorStop(1, '#3b1408');
  }
  context.fillStyle = boardWood;
  context.fillRect(layout.gridX, layout.gridY, layout.gridWidth, gridHeight);
  context.save();
  context.beginPath();
  context.rect(layout.gridX, layout.gridY, layout.gridWidth, gridHeight);
  context.clip();
  for (let column = 1; column < state.config.columns; column += 1) {
    const x = layout.gridX + column * size;
    context.strokeStyle = candy
      ? 'rgba(126,150,255,0.09)'
      : gold
        ? column % 3 === 0
          ? 'rgba(6,12,4,0.72)'
          : 'rgba(10,18,8,0.42)'
        : column % 3 === 0
          ? 'rgba(24,6,2,0.58)'
          : 'rgba(31,8,3,0.38)';
    context.lineWidth = column % 3 === 0 ? 2.3 : 1.2;
    context.beginPath();
    context.moveTo(x, layout.gridY);
    context.lineTo(x, layout.gridY + gridHeight);
    context.stroke();
  }
  if (candy) {
    for (let row = 1; row < state.config.rows; row += 1) {
      const y = layout.gridY + row * size;
      context.strokeStyle = 'rgba(126,150,255,0.06)';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(layout.gridX, y);
      context.lineTo(layout.gridX + layout.gridWidth, y);
      context.stroke();
    }
  }
  if (!gold && !candy) {
    context.globalAlpha = 0.13;
    for (let y = layout.gridY + 12; y < layout.gridY + gridHeight; y += 15) {
      context.beginPath();
      for (let x = layout.gridX - 10; x <= layout.gridX + layout.gridWidth + 10; x += 16) {
        const wave = Math.sin(x * 0.019 + y * 0.026) * 3.3 + Math.sin(x * 0.004 + y) * 1.2;
        if (x === layout.gridX - 10) context.moveTo(x, y + wave);
        else context.lineTo(x, y + wave);
      }
      context.strokeStyle = y % 45 === 0 ? '#180501' : '#bd7040';
      context.lineWidth = y % 45 === 0 ? 1.3 : 0.7;
      context.stroke();
    }
  }
  context.restore();
}

function mixHex(hex: string, toward: string, amount: number): string {
  const parse = (value: string) =>
    [
      Number.parseInt(value.slice(1, 3), 16),
      Number.parseInt(value.slice(3, 5), 16),
      Number.parseInt(value.slice(5, 7), 16),
    ] as const;
  const from = parse(hex);
  const to = parse(toward);
  const mix = from.map((channel, index) => Math.round(channel + (to[index]! - channel) * amount));
  return `rgb(${mix[0]},${mix[1]},${mix[2]})`;
}

export function drawEmbossedStar(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha = 1,
  palette: BlockCrushDropPalette = 'classic-wood',
): void {
  const gold = palette === 'honey-gold';
  const outerRadius = Math.max(1.1, size * (gold ? 0.1 : 0.14));
  const bevel = Math.max(2.4, size * (gold ? 0.16 : 0.14));
  const innerRadius = Math.max(1.6, size * (gold ? 0.07 : 0.1));
  const base = gold ? '#b8860b' : '#d4a05e';
  const inner = { x: x + bevel, y: y + bevel, size: size - bevel * 2 };
  context.save();
  context.globalAlpha = alpha;
  context.shadowColor = gold ? 'rgba(12, 10, 2, 0.62)' : 'rgba(28, 10, 2, 0.55)';
  context.shadowBlur = Math.max(2, size * 0.08);
  context.shadowOffsetX = size * 0.02;
  context.shadowOffsetY = Math.max(1.6, size * 0.07);
  roundedRect(context, x, y, size, size, outerRadius);
  context.fillStyle = mixHex(base, gold ? '#2a1c04' : '#4a220c', 0.42);
  context.fill();
  context.shadowColor = 'transparent';

  context.save();
  roundedRect(context, x, y, size, size, outerRadius);
  context.clip();
  const right = x + size;
  const bottom = y + size;
  const innerRight = inner.x + inner.size;
  const innerBottom = inner.y + inner.size;
  context.beginPath();
  context.moveTo(x, bottom);
  context.lineTo(right, bottom);
  context.lineTo(innerRight, innerBottom);
  context.lineTo(inner.x, innerBottom);
  context.closePath();
  context.fillStyle = mixHex(base, gold ? '#1c1404' : '#3d1808', 0.55);
  context.fill();
  context.beginPath();
  context.moveTo(right, y);
  context.lineTo(right, bottom);
  context.lineTo(innerRight, innerBottom);
  context.lineTo(innerRight, inner.y);
  context.closePath();
  context.fillStyle = mixHex(base, gold ? '#6a520c' : '#6a3012', 0.28);
  context.fill();
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(inner.x, inner.y);
  context.lineTo(inner.x, innerBottom);
  context.lineTo(x, bottom);
  context.closePath();
  context.fillStyle = mixHex(base, gold ? '#8a7018' : '#8a4a1c', 0.18);
  context.fill();
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(right, y);
  context.lineTo(innerRight, inner.y);
  context.lineTo(inner.x, inner.y);
  context.closePath();
  context.fillStyle = mixHex(base, gold ? '#fff6c4' : '#fff4d8', 0.42);
  context.fill();
  context.restore();

  roundedRect(context, inner.x, inner.y, inner.size, inner.size, innerRadius);
  const face = context.createLinearGradient(inner.x, inner.y, inner.x, innerBottom);
  face.addColorStop(0, mixHex(base, gold ? '#ffe9a0' : '#fff1d0', 0.38));
  face.addColorStop(0.55, base);
  face.addColorStop(1, mixHex(base, gold ? '#6e520c' : '#8d4b25', 0.22));
  context.fillStyle = face;
  context.fill();

  if (!gold) {
    const centerX = x + size / 2;
    const centerY = y + size / 2 - size * 0.02;
    context.beginPath();
    for (let point = 0; point < 10; point += 1) {
      const radius = (point % 2 === 0 ? 0.22 : 0.1) * size;
      const angle = -Math.PI / 2 + (point * Math.PI) / 5;
      const pointX = centerX + Math.cos(angle) * radius;
      const pointY = centerY + Math.sin(angle) * radius;
      if (point === 0) context.moveTo(pointX, pointY);
      else context.lineTo(pointX, pointY);
    }
    context.closePath();
    context.fillStyle = 'rgba(255, 236, 196, 0.55)';
    context.fill();
  }
  context.restore();
}

export function drawCandyTile(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha = 1,
  color = '#3ddc5a',
): void {
  const gap = Math.max(0.6, size * 0.03);
  const left = x + gap;
  const top = y + gap;
  const edge = size - gap * 2;
  const radius = Math.max(1.6, size * 0.18);
  context.save();
  context.globalAlpha = alpha;
  context.shadowColor = 'rgba(4, 6, 18, 0.55)';
  context.shadowBlur = Math.max(2, size * 0.07);
  context.shadowOffsetY = Math.max(1.2, size * 0.05);
  roundedRect(context, left, top, edge, edge, radius);
  context.fillStyle = mixHex(color, '#0c1030', 0.3);
  context.fill();
  context.shadowColor = 'transparent';

  roundedRect(context, left, top, edge, edge, radius);
  const face = context.createLinearGradient(left, top, left, top + edge);
  face.addColorStop(0, mixHex(color, '#ffffff', 0.52));
  face.addColorStop(0.28, mixHex(color, '#ffffff', 0.14));
  face.addColorStop(0.62, color);
  face.addColorStop(1, mixHex(color, '#0c1030', 0.34));
  context.fillStyle = face;
  context.fill();

  context.save();
  roundedRect(context, left, top, edge, edge, radius);
  context.clip();
  context.beginPath();
  context.ellipse(
    left + edge * 0.32,
    top + edge * 0.2,
    edge * 0.3,
    edge * 0.13,
    -0.35,
    0,
    Math.PI * 2,
  );
  context.fillStyle = 'rgba(255,255,255,0.55)';
  context.fill();
  context.beginPath();
  context.moveTo(left, top + edge);
  context.lineTo(left + edge, top + edge);
  context.lineTo(left + edge * 0.86, top + edge * 0.86);
  context.lineTo(left + edge * 0.14, top + edge * 0.86);
  context.closePath();
  context.fillStyle = 'rgba(8,10,30,0.22)';
  context.fill();
  context.restore();
  context.restore();
}

export function drawIvoryPyramid(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  alpha = 1,
): void {
  const inset = Math.max(1.5, size * 0.035);
  const left = x + inset;
  const top = y + inset;
  const right = x + size - inset;
  const bottom = y + size - inset;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  context.save();
  context.globalAlpha = alpha;
  context.shadowColor = 'rgba(25,11,3,0.75)';
  context.shadowBlur = size * 0.12;
  context.shadowOffsetX = size * 0.055;
  context.shadowOffsetY = size * 0.08;
  context.fillStyle = '#c99e62';
  context.fillRect(left, top, right - left, bottom - top);
  context.shadowColor = 'transparent';

  const triangle = (points: Array<[number, number]>, fill: string) => {
    context.beginPath();
    context.moveTo(points[0]![0], points[0]![1]);
    points.slice(1).forEach(([pointX, pointY]) => context.lineTo(pointX, pointY));
    context.closePath();
    context.fillStyle = fill;
    context.fill();
  };
  triangle(
    [
      [left, top],
      [right, top],
      [centerX, centerY],
    ],
    '#f8edcf',
  );
  triangle(
    [
      [right, top],
      [right, bottom],
      [centerX, centerY],
    ],
    '#d6ae72',
  );
  triangle(
    [
      [right, bottom],
      [left, bottom],
      [centerX, centerY],
    ],
    '#ba8648',
  );
  triangle(
    [
      [left, bottom],
      [left, top],
      [centerX, centerY],
    ],
    '#ead9b4',
  );
  context.strokeStyle = 'rgba(91,52,22,0.5)';
  context.lineWidth = Math.max(1, size * 0.025);
  context.strokeRect(left, top, right - left, bottom - top);
  context.restore();
}

function drawTrayPieces(context: CanvasRenderingContext2D): void {
  const size = 58;
  const pieces: Array<{ x: number; y: number; cells: Array<[number, number]> }> = [
    {
      x: 65,
      y: 225,
      cells: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    },
    {
      x: 52,
      y: 486,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
        [1, 1],
      ],
    },
    {
      x: 55,
      y: 742,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
        [2, 1],
        [2, 2],
      ],
    },
    {
      x: 65,
      y: 1_038,
      cells: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
    },
    {
      x: 67,
      y: 1_278,
      cells: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
    },
    {
      x: 50,
      y: 1_505,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
      ],
    },
    {
      x: 49,
      y: 1_720,
      cells: [
        [0, 0],
        [1, 0],
        [2, 0],
        [0, 1],
        [0, 2],
      ],
    },
  ];
  pieces.forEach((piece) =>
    piece.cells.forEach(([column, row]) => {
      drawIvoryPyramid(context, piece.x + column * size, piece.y + row * size, size);
    }),
  );
}

export interface BlockCrushDropVisualCell extends BlockCrushDropCell {
  /** Opt-in true historical orientation; legacy matrices retain Euler output. */
  historyQuaternion?: [number, number, number, number];
  alpha?: number;
  rotationZ?: number;
  rotationX?: number;
  rotationY?: number;
  scale?: number;
  /** Positive values bring transient debris in front of the settled grid. */
  depthZ?: number;
  /** Presentation-only fragments never enter the semantic game state. */
  appearance?: 'settled-cell' | 'debris-fragment';
  /** One deterministic screen-space shutter sample for the cinematic pass. */
  /** Backward displacement in logical cells (+Y up), scaled to one exposure. */
  motionTrail?: { xCells: number; yCells: number };
  /** Source-timed mix from original tile texture (1) to exposed cut face (0). */
  debrisFrontTextureBlend?: number;
  debrisCutFaceAmbient?: number;
  debrisTopFaceAmbient?: number;
  debrisCutFaceTint?: number;
  /** Interaction pieces are not clipped or shifted as settled rising-field cells. */
  presentationLayer?: 'world' | 'interaction';
}

function unitHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_295;
}

function smoothstep(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  return bounded * bounded * (3 - 2 * bounded);
}

/**
 * Below this coverage, neighbouring optical-flow samples may belong to
 * different sides of an already folded sheet. Keep only direct observations
 * and let the deterministic presentation simulation fill the remainder.
 */
export const BLOCK_CRUSH_DROP_OBSERVED_INTERPOLATION_MIN_COVERAGE = 0.5;

function interactionAnchorAt(
  interaction: NonNullable<BlockCrushDropPresentationFrame['interaction']> | undefined,
  canonicalTick: number,
  state: BlockCrushDropState,
): { x: number; y: number } | undefined {
  const samples = interaction?.samples;
  if (!interaction || !samples || samples.length === 0) return undefined;
  const offset = canonicalTick - interaction.startFrame;
  const ordered = [...samples].sort((left, right) => left.frameOffset - right.frameOffset);
  const logicalColumns = Number(interaction.metadata?.logicalColumns);
  const logicalRows = Number(interaction.metadata?.logicalRows);
  const isLogicalAnchor =
    interaction.metadata?.coordinateSpace === 'block-crush-logical-anchor-normalized' &&
    Number.isFinite(logicalColumns) &&
    Number.isFinite(logicalRows);
  const decode = (sample: { x: number; y: number }) => {
    if (interaction.metadata?.coordinateSpace === 'stage-normalized') {
      const origin = blockCrushDropScreenPosition(state, 0, state.config.rows - 1);
      const pitch = blockCrushDropCellSize(state);
      return {
        x: (sample.x * BLOCK_CRUSH_DROP_STAGE.width - origin.x) / pitch,
        y: state.config.rows - 1 - (sample.y * BLOCK_CRUSH_DROP_STAGE.height - origin.y) / pitch,
      };
    }
    return isLogicalAnchor
      ? { x: sample.x * logicalColumns, y: sample.y * logicalRows }
      : { x: sample.x, y: sample.y };
  };
  if (offset <= ordered[0]!.frameOffset) return decode(ordered[0]!);
  for (let index = 1; index < ordered.length; index += 1) {
    const right = ordered[index]!;
    if (offset > right.frameOffset) continue;
    const left = ordered[index - 1]!;
    const span = Math.max(1, right.frameOffset - left.frameOffset);
    const progress = smoothstep((offset - left.frameOffset) / span);
    const decodedLeft = decode(left);
    const decodedRight = decode(right);
    return {
      x: decodedLeft.x + (decodedRight.x - decodedLeft.x) * progress,
      y: decodedLeft.y + (decodedRight.y - decodedLeft.y) * progress,
    };
  }
  return decode(ordered.at(-1)!);
}

function interactionAnchor(
  frame: BlockCrushDropPresentationFrame,
): { x: number; y: number } | undefined {
  return interactionAnchorAt(frame.interaction, frame.canonicalTick, frame.before);
}

function interactionPickupScale(
  interaction: NonNullable<BlockCrushDropPresentationFrame['interaction']> | undefined,
  canonicalTick: number,
): number {
  if (!interaction) return 1;
  const configuredStart = Number(interaction.metadata?.pickupStartScale);
  const configuredFrames = Number(interaction.metadata?.pickupScaleFrames);
  const startScale = Number.isFinite(configuredStart)
    ? Math.max(0.05, Math.min(1, configuredStart))
    : 1;
  const scaleFrames = Number.isFinite(configuredFrames) ? Math.max(0, configuredFrames) : 0;
  if (scaleFrames === 0) return startScale;
  const progress = smoothstep((canonicalTick - interaction.startFrame) / scaleFrames);
  return startScale + (1 - startScale) * progress;
}

/**
 * Candy-pop clear: every cleared logical cell bursts into a 2x2 lattice of
 * independent chunks that launch upward on a deterministic ballistic arc,
 * tumble fast, and fade near the apex. Unlike the measured 29976 sheet this
 * is pure presentation art direction; it shares only the cue endpoints.
 */
function withFountainClear(
  frame: BlockCrushDropPresentationFrame,
  cells: BlockCrushDropVisualCell[],
): BlockCrushDropVisualCell[] {
  const cue = frame.lingeringClear;
  if (!cue) return cells;
  const activeCellCascade =
    Boolean(frame.before.config.rules.settlement) &&
    frame.before.config.rules.settlement !== 'cut-component-cascade';
  const motionProgress = Math.max(0, Math.min(1, cue.motionProgress));
  const lifetimeProgress = Math.max(0, Math.min(1, cue.progress));
  const columns = frame.before.config.columns;
  const eliminatedRows = [...new Set(cue.eliminatedCells.map((cell) => cell.y))].sort(
    (left, right) => left - right,
  );
  const eliminatedIds = new Set(cue.eliminatedCells.map((cell) => cell.id));
  const survivors = cells
    .filter((cell) => !eliminatedIds.has(cell.id))
    .map((cell) => ({ ...cell }));
  const subColumns = Math.max(1, columns * 2);
  const simulationSteps = Math.max(0, Math.round(motionProgress * 55));
  const tiltScale = cue.fragmentTiltScale ?? 1.45;
  const fadeProgress = smoothstep((lifetimeProgress - 0.58) / 0.34);
  const debris: BlockCrushDropVisualCell[] = [];
  for (const cell of cue.eliminatedCells) {
    const rowIndex = Math.max(0, eliminatedRows.indexOf(cell.y));
    for (let fragmentY = 0; fragmentY < 2; fragmentY += 1) {
      for (let fragmentX = 0; fragmentX < 2; fragmentX += 1) {
        const fragmentId = `${cell.id}:fragment-${fragmentX}-${fragmentY}`;
        const subColumn = cell.x * 2 + fragmentX;
        const xNormal = subColumn / Math.max(1, subColumns - 1);
        const releaseStep =
          1 +
          Math.round((9 * subColumn) / Math.max(1, subColumns - 1)) +
          Math.round(20 * rowIndex * Math.max(0, Math.min(1, cue.rowStaggerProgress)));
        const age = simulationSteps - releaseStep + 1;
        const originX = cell.x + (fragmentX - 0.5) * 0.5;
        const originY = cell.y + (fragmentY - 0.5) * 0.5;
        if (age <= 0) {
          debris.push({
            ...cell,
            id: fragmentId,
            x: originX,
            y: originY,
            scale: 0.5,
            depthZ: 24,
            appearance: 'debris-fragment',
          });
          continue;
        }
        const launch = unitHash(`${fragmentId}:launch`);
        const lateral = unitHash(`${fragmentId}:lateral`);
        const spin = unitHash(`${fragmentId}:spin`);
        const tumbleX = unitHash(`${fragmentId}:tumble-x`);
        const tumbleY = unitHash(`${fragmentId}:tumble-y`);
        const velocityX = (lateral - 0.5) * 0.15 + (xNormal - 0.5) * 0.13;
        const velocityY = activeCellCascade ? 0.14 + 0.22 * launch : 0.5 + 0.34 * launch;
        const gravity = 0.023;
        const x = originX + velocityX * age;
        const y = originY + velocityY * age - 0.5 * gravity * age * age;
        const grow = Math.min(1, age / 6);
        debris.push({
          ...cell,
          id: fragmentId,
          x,
          y,
          rotationZ: (spin - 0.5) * 0.26 * age,
          rotationX: tiltScale * (0.045 + 0.075 * tumbleX) * age,
          rotationY: tiltScale * (0.04 + 0.07 * tumbleY) * age,
          alpha: Math.max(0, 1 - fadeProgress),
          scale:
            0.5 *
            (1 + 0.22 * grow) *
            (activeCellCascade ? Math.sqrt(1 - fadeProgress) : 1 - 0.3 * fadeProgress),
          depthZ: 25 + 5 * Math.min(1, age / 8),
          appearance: 'debris-fragment',
        });
      }
    }
  }
  survivors.push(...debris);
  return survivors;
}

const physicsObservations = new WeakMap<object, ClearPhysicsObservation[]>();
function makePhysicsSeeds(
  frame: BlockCrushDropPresentationFrame,
  eliminated: NonNullable<BlockCrushDropPresentationFrame['lingeringClear']>['eliminatedCells'],
  rise: number,
  layers: 1 | 2,
): ClearPhysicsSeed[] {
  const sortedRows = [...new Set(eliminated.map((cell) => cell.y))].sort((a, b) => a - b);
  return eliminated.flatMap((cell) =>
    [0, 1].flatMap((fy) =>
      [0, 1].flatMap((fx) =>
        Array.from({ length: layers }, (_, layer) => ({
          id: `${cell.id}:fragment-${fx}-${fy}${layers === 2 ? `:layer-${layer}` : ''}`,
          x: cell.x + (fx - 0.5) * 0.5,
          y: cell.y + (fy - 0.5) * 0.5 + rise,
          column: cell.x * 2 + fx,
          row: (sortedRows.length - 1 - sortedRows.indexOf(cell.y)) * 2 + (1 - fy),
          ...(layers === 2 ? { z: layer === 0 ? 0.25 : -0.25, layer } : {}),
        })),
      ),
    ),
  );
}
function convertPhysicsObservations(
  frame: BlockCrushDropPresentationFrame,
  observed: NonNullable<
    BlockCrushDropPresentationFrame['lingeringClear']
  >['observedFragmentMotion'],
): ClearPhysicsObservation[] | undefined {
  if (!observed) return undefined;
  let observations = physicsObservations.get(observed);
  if (!observations) {
    observations = observed.frames.map((sample) => ({
      frame: (sample.frameOffset * 30) / observed.canonicalFps,
      tracks: sample.tracks.map(([id, x, y]): [number, number, number] => [
        id,
        (x - observed.gridX) / observed.cellPitch - 0.5,
        frame.before.config.rows - 0.5 - (y - observed.gridTop) / observed.cellPitch,
      ]),
    }));
    physicsObservations.set(observed, observations);
  }
  return observations;
}

export function clearPhysicsEventsForFrame(
  frame: BlockCrushDropPresentationFrame,
): ClearPhysicsEvent[] {
  const columns = frame.before.config.columns * 2,
    riseSpeed = 30 / frame.before.config.rules.fieldMotion.ticksPerCell;
  return frame.physicsCueSchedule
    ? frame.physicsCueSchedule.map((event) => {
        return {
          startSeconds: event.startSeconds,
          endSeconds: event.endSeconds,
          input: {
            columns,
            riseSpeed,
            profile: event.fragmentAppearance.inertialPhysics!,
            fragmentSize: {
              baseScale: event.fragmentAppearance.baseScale,
              releaseGrowthScale: event.fragmentAppearance.releaseGrowthScale,
            },
            ...(event.observedFragmentMotion
              ? { observations: convertPhysicsObservations(frame, event.observedFragmentMotion)! }
              : {}),
            seeds: makePhysicsSeeds(
              frame,
              event.eliminatedCells,
              event.riseAtStartCells,
              event.fragmentAppearance.inertialPhysics!.depthLayers ?? 1,
            ),
          },
        };
      })
    : [];
}
function withInertialClear(
  frame: BlockCrushDropPresentationFrame,
  cells: BlockCrushDropVisualCell[],
  historyPoses?: Map<string, ClearPhysicsHistoryPose>,
): BlockCrushDropVisualCell[] {
  const cue = frame.lingeringClear!;
  const appearance = cue.fragmentAppearance!;
  const physical = appearance.inertialPhysics!;
  const elapsed = cue.elapsedFrames / frame.fps;
  const columns = frame.before.config.columns * 2;
  const riseSpeed = 30 / frame.before.config.rules.fieldMotion.ticksPerCell;
  const seeds = makePhysicsSeeds(
    frame,
    cue.eliminatedCells,
    frame.fieldRiseOffsetCells - elapsed * riseSpeed,
    physical.depthLayers ?? 1,
  );
  const observations = convertPhysicsObservations(frame, cue.observedFragmentMotion);
  const events = physical.sharedContact ? clearPhysicsEventsForFrame(frame) : [];
  const poses =
    historyPoses ??
    (events.length
      ? evaluateClearPhysicsWorld(events, frame.frameIndex / frame.fps)
      : evaluateClearPhysics({
          seeds,
          columns,
          elapsedSeconds: elapsed,
          riseSpeed,
          profile: physical,
          fragmentSize: {
            baseScale: appearance.baseScale,
            releaseGrowthScale: appearance.releaseGrowthScale,
          },
          ...(observations ? { observations } : {}),
        }));
  // Legacy progress counts the currently sampled frame. Recover the exclusive
  // duration before calculating a continuous, fps-independent remaining time.
  const cueDurationFrames = cue.progress > 0 ? (cue.elapsedFrames + 1) / cue.progress : Infinity;
  const remainingCanonicalFrames = ((cueDurationFrames - cue.elapsedFrames) * 30) / frame.fps;
  const removed = new Set(cue.eliminatedCells.map((cell) => cell.id));
  const result = cells.filter((cell) => !removed.has(cell.id));
  for (const seed of seeds) {
    const pose = poses.get(seed.id)!;
    result.push({
      id: seed.id,
      kind: frame.before.config.presentation.tile,
      x: pose.x,
      y: pose.y - frame.fieldRiseOffsetCells,
      rotationX: pose.rotationX,
      rotationY: pose.rotationY,
      rotationZ: pose.rotationZ,
      ...(historyPoses ? { historyQuaternion: historyPoses.get(seed.id)!.quaternion } : {}),
      depthZ: 60 + pose.z * blockCrushDropCellSize(frame.before),
      appearance: 'debris-fragment',
      scale: appearance.baseScale + appearance.releaseGrowthScale * pose.releaseAge,
      alpha:
        appearance.exitFadeFrames !== undefined
          ? smoothstep(remainingCanonicalFrames / appearance.exitFadeFrames)
          : 1 -
            smoothstep(
              ((historyPoses
                ? (cue.elapsedFrames + frame.fps / 30) / cue.durationFrames
                : cue.progress) -
                0.97) /
                0.03,
            ),
      ...(appearance.cutFaceAmbient !== undefined
        ? { debrisCutFaceAmbient: appearance.cutFaceAmbient }
        : {}),
      ...(appearance.topFaceAmbient !== undefined
        ? { debrisTopFaceAmbient: appearance.topFaceAmbient }
        : {}),
      ...(appearance.cutFaceTint !== undefined
        ? { debrisCutFaceTint: appearance.cutFaceTint }
        : {}),
      debrisFrontTextureBlend:
        seed.layer === 1
          ? 0
          : 1 - (1 - (appearance.frontTextureEndBlend ?? 0.1)) * smoothstep(pose.releaseAge / 0.6),
      motionTrail: {
        xCells: (-pose.velocityX / frame.fps) * 0.35,
        yCells: (-pose.velocityY / frame.fps) * 0.35,
      },
    });
  }
  return result;
}

function withLingeringClear(
  frame: BlockCrushDropPresentationFrame,
  cells: BlockCrushDropVisualCell[],
  debrisStyle: BlockCrushDropDebrisStyle = 'sheet',
): BlockCrushDropVisualCell[] {
  if (frame.lingeringClear?.sequence) {
    const removed = new Set(frame.lingeringClear.eliminatedCells.map((c) => c.id));
    return cells.filter((c) => !removed.has(c.id));
  }
  if (debrisStyle === 'fountain') return withFountainClear(frame, cells);
  const cue = frame.lingeringClear;
  if (!cue) return cells;
  if (cue.fragmentAppearance?.inertialPhysics) return withInertialClear(frame, cells);
  const progress = Math.max(0, Math.min(1, cue.motionProgress));
  const lifetimeProgress = Math.max(0, Math.min(1, cue.progress));
  const columns = frame.before.config.columns;
  const eliminatedRows = [...new Set(cue.eliminatedCells.map((cell) => cell.y))].sort(
    (left, right) => left - right,
  );
  // A clear is a replacement event, not an overlay. The source switches the
  // completed logical rows to their 2x2 children on the impact frame itself.
  // Keeping the parents behind the children filled every seam and made the
  // board look as though the rows had not cleared yet (most visibly at f245).
  const eliminatedIds = new Set(cue.eliminatedCells.map((cell) => cell.id));
  const result = cells.filter((cell) => !eliminatedIds.has(cell.id)).map((cell) => ({ ...cell }));
  const debrisRecords: Array<{
    cell: BlockCrushDropVisualCell;
    subColumn: number;
    subRow: number;
  }> = [];
  const appearance = cue.fragmentAppearance ?? BLOCK_CRUSH_DROP_DEFAULT_FRAGMENT_APPEARANCE;
  const sheet = simulateClearSheet(
    cue.eliminatedCells,
    eliminatedRows,
    columns,
    progress,
    appearance,
    cue.rowStaggerProgress,
  );
  for (const cell of cue.eliminatedCells) {
    const rowIndex = Math.max(0, eliminatedRows.indexOf(cell.y));
    // CRUSHZR29976 does not explode a cleared row in place. The left edge
    // releases first and a flexible four-/two-row sheet folds downward while
    // the release front travels right. Collision disorder begins on the old
    // released edge before the still-attached side has left the grid.
    const releaseGrowthFade =
      appearance.releaseGrowthEndLifetimeProgress === undefined
        ? 1
        : 1 -
          smoothstep(
            (lifetimeProgress - appearance.releaseGrowthEndLifetimeProgress) /
              (appearance.releaseGrowthFadeLifetimeProgress ?? 0.001),
          );
    const frontTextureFade =
      appearance.frontTextureFadeStartLifetimeProgress === undefined
        ? 0
        : smoothstep(
            (lifetimeProgress - appearance.frontTextureFadeStartLifetimeProgress) /
              (appearance.frontTextureFadeLifetimeProgress ?? 0.001),
          );
    const frontTextureBlend = 1 + ((appearance.frontTextureEndBlend ?? 1) - 1) * frontTextureFade;
    const clusterScatter = appearance.clusterScatterCells;
    const fragmentScatter = appearance.fragmentScatterCells;
    const clusterScatterX = (unitHash(`${cell.id}:cluster-x`) - 0.5) * clusterScatter;
    const clusterScatterY = (unitHash(`${cell.id}:cluster-y`) - 0.5) * clusterScatter;
    const fadeProgress = smoothstep((lifetimeProgress - 0.97) / 0.03);
    const fadeScale = Math.max(0.82, 1 - fadeProgress * 0.18);
    // Sample the deformation at every half-cell, rather than deforming a
    // parent and rotating four children around it. That keeps the pitch
    // continuous across logical-cell boundaries and removes visible 2x2
    // clumps while preserving the source-observed subdivision.
    for (let fragmentY = 0; fragmentY < 2; fragmentY += 1) {
      for (let fragmentX = 0; fragmentX < 2; fragmentX += 1) {
        const fragmentId = `${cell.id}:fragment-${fragmentX}-${fragmentY}`;
        const fragmentRandom = unitHash(fragmentId);
        const pose = sheet.get(fragmentId)!;
        const fragmentTiltScale = cue.fragmentTiltScale ?? 1.45;
        const fragmentMotionBlurScale = cue.fragmentMotionBlurScale ?? 0;
        const scatterStart = appearance.scatterStartReleaseAge;
        const lateScatter = smoothstep((pose.releaseAge - scatterStart) / (1 - scatterStart));
        const tumble = smoothstep(pose.releaseAge);
        // A sampled deformation curve may plateau while authored debris keeps
        // colliding. That residual motion belongs to the director profile, not
        // to the semantic rule or to a guessed "two-row" physics mode.
        const residual = cue.residualMotion;
        const tailTurbulence = residual
          ? smoothstep(
              (lifetimeProgress - residual.startLifetimeProgress) / residual.rampLifetimeProgress,
            )
          : 0;
        const elapsedCanonicalFrames = (cue.elapsedFrames * 30) / frame.fps;
        const collisionPhase = residual
          ? elapsedCanonicalFrames * residual.horizontalAngularVelocityRadiansPerCanonicalFrame +
            residual.horizontalPhaseOffsetRadians +
            unitHash(`${cell.id}:tail-phase`) * Math.PI * 2
          : 0;
        const collisionFlutterX = residual
          ? Math.sin(collisionPhase) * residual.horizontalAmplitudeCells * tailTurbulence
          : 0;
        const collisionFlutterY = residual
          ? -Math.sin(
              (elapsedCanonicalFrames - residual.verticalZeroCrossingCanonicalFrame) *
                residual.verticalAngularVelocityRadiansPerCanonicalFrame,
            ) *
            residual.verticalAmplitudeCells *
            tailTurbulence
          : 0;
        // Collision disorder is correlated at the logical-cell scale. Fully
        // independent noise produces a sparse spray, while the reference
        // remains a dense pile of locally adjacent cubes.
        const scatterX = (clusterScatterX + (fragmentRandom - 0.5) * fragmentScatter) * lateScatter;
        const scatterY =
          (clusterScatterY + (unitHash(`${fragmentId}:y`) - 0.5) * fragmentScatter) * lateScatter;
        const foldProfile = cue.fragmentFoldSpread;
        const foldSpread = foldProfile
          ? smoothstep(
              (progress - foldProfile.startMotionProgress) / foldProfile.rampMotionProgress,
            )
          : 0;
        const foldPivotX = (columns - 0.5) * (foldProfile?.pivotXNormalized ?? 1);
        const foldPivotY =
          (eliminatedRows.at(-1) ?? cell.y) + (foldProfile?.pivotYOffsetCells ?? 0);
        const horizontalScale = 1 + ((foldProfile?.horizontalScale ?? 1) - 1) * foldSpread;
        const verticalScale = 1 + ((foldProfile?.verticalScale ?? 1) - 1) * foldSpread;
        const foldedX = foldPivotX + (pose.x - foldPivotX) * horizontalScale;
        const foldedY = foldPivotY + (pose.y - foldPivotY) * verticalScale;
        debrisRecords.push({
          subColumn: cell.x * 2 + fragmentX,
          // Gameplay y increases upward; optical-flow lattice rows increase
          // downward in source pixels. Reverse both the logical-row order and
          // the two child rows before joining presentation evidence to debris.
          subRow: (eliminatedRows.length - 1 - rowIndex) * 2 + (1 - fragmentY),
          cell: {
            ...cell,
            id: fragmentId,
            x: foldedX + scatterX + collisionFlutterX,
            y: foldedY + scatterY + collisionFlutterY,
            rotationZ: pose.rotationZ + (fragmentRandom - 0.5) * Math.PI * 0.72 * lateScatter,
            rotationX:
              fragmentTiltScale *
              (tumble * Math.PI * (0.1 + 0.07 * Math.sin((cell.x + 1) * 0.71)) +
                (unitHash(`${fragmentId}:rx`) - 0.5) * Math.PI * 0.32 * lateScatter),
            rotationY:
              fragmentTiltScale *
              (tumble * Math.PI * (0.08 + 0.06 * Math.cos((cell.x + rowIndex + 1) * 0.63)) +
                (unitHash(`${fragmentId}:ry`) - 0.5) * Math.PI * 0.32 * lateScatter),
            alpha: Math.max(0, 1 - fadeProgress),
            // A cleared logical tile is visibly quartered into a 2x2 lattice.
            scale:
              (appearance.baseScale +
                appearance.releaseGrowthScale * pose.releaseAge * releaseGrowthFade) *
              fadeScale,
            // Settled source cubes extend roughly 20 px toward the camera. Put
            // the clear band beyond that face so it remains visible while it
            // folds across the occupied lower board.
            depthZ: 24 + 3 * pose.releaseAge + (fragmentRandom - 0.5) * 0.8 * lateScatter,
            appearance: 'debris-fragment',
            debrisFrontTextureBlend: frontTextureBlend,
            ...(fragmentMotionBlurScale > 0 && pose.releaseAge > 0
              ? {
                  motionTrail: {
                    xCells: -pose.velocityX * fragmentMotionBlurScale,
                    yCells: -pose.velocityY * fragmentMotionBlurScale,
                  },
                }
              : {}),
          },
        });
      }
    }
  }
  const observedMotion = cue.observedFragmentMotion;
  if (observedMotion) {
    const targetOffset = (cue.elapsedFrames * observedMotion.canonicalFps) / frame.fps;
    const finalReliableOffset = observedMotion.frames.at(-1)!.frameOffset;
    if (targetOffset <= finalReliableOffset) {
      const sample = observedMotion.frames.reduce(
        (closest, candidate) =>
          Math.abs(candidate.frameOffset - targetOffset) <
          Math.abs(closest.frameOffset - targetOffset)
            ? candidate
            : closest,
        observedMotion.frames[0]!,
      );
      const recordsByLattice = new Map(
        debrisRecords.map((record) => [`${record.subColumn}:${record.subRow}`, record] as const),
      );
      const observedPositions = new Map<string, { x: number; y: number }>();
      const observedDisplacements: Array<{
        subColumn: number;
        subRow: number;
        sourceDeltaX: number;
        sourceDeltaY: number;
      }> = [];
      const fragmentPitch = observedMotion.cellPitch / 2;
      for (const [trackId, sourceX, sourceY] of sample.tracks) {
        const subColumn = trackId % observedMotion.subColumns;
        const subRow = Math.floor(trackId / observedMotion.subColumns);
        const record = recordsByLattice.get(`${subColumn}:${subRow}`);
        if (!record) continue;
        const initialSourceX = observedMotion.gridX + (subColumn + 0.5) * fragmentPitch;
        const initialSourceY = observedMotion.gridTop + (subRow + 0.5) * fragmentPitch;
        const targetX = (sourceX - observedMotion.gridX) / observedMotion.cellPitch - 0.5;
        const targetY =
          frame.before.config.rows -
          0.5 -
          (sourceY - observedMotion.gridTop) / observedMotion.cellPitch -
          frame.fieldRiseOffsetCells;
        observedPositions.set(`${subColumn}:${subRow}`, { x: targetX, y: targetY });
        observedDisplacements.push({
          subColumn,
          subRow,
          sourceDeltaX: sourceX - initialSourceX,
          sourceDeltaY: sourceY - initialSourceY,
        });
      }
      for (const record of debrisRecords) {
        let observed = observedPositions.get(`${record.subColumn}:${record.subRow}`);
        if (
          !observed &&
          observedDisplacements.length >= 4 &&
          observedDisplacements.length / Math.max(1, debrisRecords.length) >=
            (observedMotion.interpolationMinimumCoverage ??
              BLOCK_CRUSH_DROP_OBSERVED_INTERPOLATION_MIN_COVERAGE)
        ) {
          // Optical flow naturally loses features as cubes turn away from the
          // camera. Reconstruct the missing lattice centres from the local
          // displacement field instead of snapping those fragments back to a
          // separate guessed simulation. This is still presentation evidence:
          // it never creates cells or changes clear/compaction state.
          const neighbours = observedDisplacements
            .map((candidate) => {
              const deltaColumn = candidate.subColumn - record.subColumn;
              const deltaRow = candidate.subRow - record.subRow;
              return {
                ...candidate,
                distanceSquared: deltaColumn * deltaColumn + deltaRow * deltaRow,
              };
            })
            .sort((left, right) => left.distanceSquared - right.distanceSquared)
            .slice(0, 8);
          let weightSum = 0;
          let sourceDeltaX = 0;
          let sourceDeltaY = 0;
          for (const neighbour of neighbours) {
            const weight = 1 / Math.pow(0.35 + neighbour.distanceSquared, 1.5);
            weightSum += weight;
            sourceDeltaX += neighbour.sourceDeltaX * weight;
            sourceDeltaY += neighbour.sourceDeltaY * weight;
          }
          if (weightSum > 0) {
            const sourceX =
              observedMotion.gridX +
              (record.subColumn + 0.5) * fragmentPitch +
              sourceDeltaX / weightSum;
            const sourceY =
              observedMotion.gridTop +
              (record.subRow + 0.5) * fragmentPitch +
              sourceDeltaY / weightSum;
            observed = {
              x: (sourceX - observedMotion.gridX) / observedMotion.cellPitch - 0.5,
              y:
                frame.before.config.rows -
                0.5 -
                (sourceY - observedMotion.gridTop) / observedMotion.cellPitch -
                frame.fieldRiseOffsetCells,
            };
          }
        }
        if (!observed) continue;
        record.cell.x = observed.x;
        record.cell.y = observed.y;
      }
    }
  }
  result.push(...debrisRecords.map((record) => record.cell));
  return result;
}

function withFieldPreview(
  frame: BlockCrushDropPresentationFrame,
  cells: BlockCrushDropVisualCell[],
): BlockCrushDropVisualCell[] {
  const rows = frame.fieldPreviewRows;
  const config = frame.before.config;
  const shifted = cells
    .map((cell) => ({ ...cell, y: cell.y + rows }))
    .filter((cell) => cell.y < config.rows);
  const incomingRows = config.rules.fieldMotion.incomingRows;
  for (let offset = 0; offset < rows; offset += 1) {
    const pattern =
      incomingRows.length > 0
        ? incomingRows[(frame.fieldIncomingRowIndex + offset) % incomingRows.length]!
        : '0'.repeat(config.columns);
    [...pattern].forEach((value, x) => {
      if (value !== '1') return;
      shifted.push({
        id: config.rules.settlement
          ? `rising-row-${frame.fieldIncomingRowIndex + offset}-${x}`
          : `field-preview-${frame.fieldIncomingRowIndex + offset}-${x}`,
        kind: config.presentation.tile,
        x,
        y: rows - 1 - offset,
      });
    });
  }
  // Continuous rise reveals the next authored row from below before it is
  // committed to the integer-y rules state. Omitting this partial row made the
  // board bottom visibly empty for most of every 60-frame rise cycle.
  if (frame.fieldRiseOffsetCells > 0 && incomingRows.length > 0) {
    const incomingIndex = frame.fieldIncomingRowIndex + rows;
    const pattern = incomingRows[incomingIndex % incomingRows.length]!;
    [...pattern].forEach((value, x) => {
      if (value !== '1') return;
      shifted.push({
        id: config.rules.settlement
          ? `rising-row-${incomingIndex}-${x}`
          : `field-preview-partial-${incomingIndex}-${x}`,
        kind: config.presentation.tile,
        x,
        y: -1,
      });
    });
  }
  return shifted;
}

function withWorldMotion(
  frame: BlockCrushDropPresentationFrame,
  cells: BlockCrushDropVisualCell[],
  debrisStyle: BlockCrushDropDebrisStyle = 'sheet',
): BlockCrushDropVisualCell[] {
  const offsets = new Map<string, { x: number; y: number }>();
  for (const offset of frame.earlyGravityOffsets ?? []) {
    const previous = offsets.get(offset.id);
    offsets.set(offset.id, { x: (previous?.x ?? 0) + offset.x, y: (previous?.y ?? 0) + offset.y });
  }
  const worldCells = cells
    .filter((cell) => cell.presentationLayer !== 'interaction')
    .map((cell) => {
      const offset = offsets.get(cell.id);
      return offset ? { ...cell, x: cell.x + offset.x, y: cell.y + offset.y } : cell;
    });
  const interactionCells = cells.filter((cell) => cell.presentationLayer === 'interaction');
  let result = [...withFieldPreview(frame, worldCells), ...interactionCells];
  const cues = frame.lingeringClears ?? (frame.lingeringClear ? [frame.lingeringClear] : []);
  for (const cue of cues)
    result = withLingeringClear({ ...frame, lingeringClear: cue }, result, debrisStyle);
  return result.map((cell) => {
    if (cell.presentationLayer === 'interaction') return cell;
    const shift = (frame.lateMovementOffsets ?? [])
      .filter((o) => cell.id === o.id || cell.id.startsWith(o.id + ':fragment-'))
      .reduce((v, o) => ({ x: v.x + o.x, y: v.y + o.y }), { x: 0, y: 0 });
    return shift.x || shift.y ? { ...cell, x: cell.x + shift.x, y: cell.y + shift.y } : cell;
  });
}

export function cellsForBlockCrushDropFrame(
  frame: BlockCrushDropPresentationFrame,
  options: { debrisStyle?: BlockCrushDropDebrisStyle } = {},
): BlockCrushDropVisualCell[] {
  const debrisStyle = options.debrisStyle ?? 'sheet';
  if (frame.phase === 'idle') return withWorldMotion(frame, frame.before.cells, debrisStyle);
  const stepBefore = frame.stepBeforeCells ?? frame.before.cells;
  const stepAfter = frame.stepAfterCells ?? frame.after.cells;
  if (frame.phase === 'commit' && frame.step) {
    const spawnedIds = new Set(
      frame.step.deltas.filter((delta) => delta.kind === 'spawn').map((delta) => delta.entityId),
    );
    const cells: BlockCrushDropVisualCell[] = stepBefore
      .filter((cell) => !spawnedIds.has(cell.id))
      .map((cell) => ({ ...cell }));
    for (const delta of frame.step.deltas) {
      if (delta.kind !== 'spawn') continue;
      const from = delta.from ?? delta.to;
      if (delta.entityId.startsWith('rising-row-')) {
        continue;
      }
      const relativeX = from.x - (frame.action?.release.x ?? from.x);
      const relativeY = from.y - (frame.action?.release.y ?? from.y);
      const pointerAnchor = interactionAnchor(frame);
      if (frame.interaction && frame.canonicalTick < frame.interaction.startFrame) {
        // The semantic action can own the current commit phase before the
        // source visibly lifts its tray glyph. Until pickup begins, the piece
        // exists only in the tray presentation layer.
        continue;
      }
      if (pointerAnchor && frame.interaction && frame.canonicalTick <= frame.interaction.endFrame) {
        const scale = interactionPickupScale(frame.interaction, frame.canonicalTick);
        cells.push({
          id: delta.entityId,
          kind: frame.before.config.presentation.tile,
          // Scale the whole glyph about its authored anchor. Scaling each tile
          // independently left full-cell gaps during pickup and was visibly
          // unlike the compact 2x2 object in the reference.
          x: pointerAnchor.x + relativeX * scale,
          y: pointerAnchor.y + relativeY * scale,
          scale,
          presentationLayer: 'interaction',
        });
        continue;
      }
      if (frame.interaction && frame.canonicalTick > frame.interaction.endFrame) {
        const fallProgress = smoothstep(
          (frame.canonicalTick - frame.interaction.endFrame) /
            Math.max(
              1,
              (frame.action?.impactTick ?? frame.interaction.endFrame + 1) -
                frame.interaction.endFrame,
            ),
        );
        cells.push({
          id: delta.entityId,
          kind: frame.before.config.presentation.tile,
          x: from.x + (delta.to.x - from.x) * fallProgress,
          y: from.y + (delta.to.y - from.y) * fallProgress,
          presentationLayer: 'interaction',
        });
        continue;
      }
      const trayAnchorX = [6, 8, 11][frame.action?.traySlot ?? 0] ?? from.x;
      const trayStart = {
        x: trayAnchorX + relativeX,
        y: frame.before.config.rows + relativeY,
      };
      const dragDistance = Math.hypot(trayStart.x - from.x, trayStart.y - from.y);
      const dragFraction = dragDistance > 1 ? 0.48 : 0.04;
      const dragging = frame.progress < dragFraction;
      const progress = dragging
        ? smoothstep(frame.progress / dragFraction)
        : smoothstep((frame.progress - dragFraction) / (1 - dragFraction));
      const start = dragging ? trayStart : from;
      const end = dragging ? from : delta.to;
      cells.push({
        id: delta.entityId,
        kind: frame.before.config.presentation.tile,
        x: start.x + (end.x - start.x) * progress,
        y: start.y + (end.y - start.y) * progress,
        presentationLayer: 'interaction',
      });
    }
    return withWorldMotion(frame, cells, debrisStyle);
  }
  if (frame.phase === 'detect') return withWorldMotion(frame, stepBefore, debrisStyle);
  if (frame.phase === 'resolve' && frame.step) {
    const removedIds = new Set(
      frame.step.deltas.filter((delta) => delta.kind === 'remove').map((delta) => delta.entityId),
    );
    return withWorldMotion(
      frame,
      stepBefore.map((cell) =>
        removedIds.has(cell.id)
          ? { ...cell, scale: 1 + Math.sin(frame.progress * Math.PI) * 0.12 }
          : { ...cell },
      ),
      debrisStyle,
    );
  }
  if (frame.phase === 'reconfigure' && frame.step) {
    const moveById = new Map(
      frame.step.deltas
        .filter((delta) => delta.kind === 'move')
        .map((delta) => [delta.entityId, delta]),
    );
    const cutCascade = frame.before.config.rules.settlement === 'cut-component-cascade';
    const snap =
      frame.reconfigureProgress ??
      (frame.before.config.rules.settlement
        ? frame.step.tags?.includes('active-cell-gravity') ||
          frame.step.tags?.includes('cut-component-gravity')
          ? frame.progress * frame.progress
          : cutCascade
            ? smoothstep((frame.progress - 0.72) / 0.28)
            : smoothstep(frame.progress)
        : smoothstep((frame.progress - 0.72) / 0.28));
    const cells: BlockCrushDropVisualCell[] = stepBefore.map((cell) => {
      const delta = moveById.get(cell.id);
      if (!delta || delta.kind !== 'move') return { ...cell };
      return {
        ...cell,
        x: delta.from.x + (delta.to.x - delta.from.x) * snap,
        y: delta.from.y + (delta.to.y - delta.from.y) * snap,
      };
    });
    return withWorldMotion(frame, cells, debrisStyle);
  }
  if (frame.phase === 'settle') {
    const bounce = Math.sin(frame.progress * Math.PI) * (frame.settleBounceCells ?? 0.08);
    return withWorldMotion(
      frame,
      stepAfter.map((cell) => ({ ...cell, y: cell.y + bounce })),
      debrisStyle,
    );
  }
  return withWorldMotion(frame, stepAfter, debrisStyle);
}

export function drawBlockCrushDropStage(
  context: CanvasRenderingContext2D,
  frame: BlockCrushDropPresentationFrame,
  options: {
    drawTiles?: boolean;
    sourceBackplate?: CanvasImageSource;
    sourceTrayTile?: CanvasImageSource;
    trayGlyphLayouts?: Readonly<Record<string, BlockCrushDropTrayGlyphLayout>>;
    palette?: BlockCrushDropPalette;
    debrisStyle?: BlockCrushDropDebrisStyle;
    backgroundBinding?: RuntimeImageAssetBinding;
    backgroundImage?: CanvasImageSource;
    tileFaceImage?: CanvasImageSource;
    tileAtlasImage?: CanvasImageSource;
  } = {},
): void {
  context.save();
  context.filter = crushCanvasFilter(options.palette ?? 'classic-wood');
  context.clearRect(0, 0, BLOCK_CRUSH_DROP_STAGE.width, BLOCK_CRUSH_DROP_STAGE.height);
  const sourceAligned =
    options.sourceBackplate &&
    !options.backgroundImage &&
    frame.before.config.presentation.layout === 'top-queue-full-height';
  if (sourceAligned) {
    drawWood(context, options.palette ?? 'classic-wood');
    context.drawImage(
      options.sourceBackplate!,
      0,
      0,
      BLOCK_CRUSH_DROP_STAGE.width,
      BLOCK_CRUSH_DROP_STAGE.height,
    );
    drawTimerTrayHud(context, frame, false, options.sourceTrayTile, options.trayGlyphLayouts);
  } else {
    drawWood(context, options.palette ?? 'classic-wood');
    if (options.backgroundBinding && options.backgroundImage) {
      drawRuntimeImage(
        context,
        options.backgroundImage,
        options.backgroundBinding,
        BLOCK_CRUSH_DROP_STAGE.width,
        BLOCK_CRUSH_DROP_STAGE.height,
      );
    }
    drawHud(context, frame, options.palette ?? 'classic-wood');
    drawEmptyGrid(context, frame.before, options.palette ?? 'classic-wood');
    if (frame.before.config.presentation.layout === 'side-tray-narrow') drawTrayPieces(context);
  }
  if (options.drawTiles !== false) {
    const size = blockCrushDropCellSize(frame.before);
    const palette = options.palette ?? 'classic-wood';
    for (const cell of cellsForBlockCrushDropFrame(frame, {
      ...(options.debrisStyle !== undefined ? { debrisStyle: options.debrisStyle } : {}),
    })) {
      const position = blockCrushDropScreenPosition(
        frame.before,
        cell.x,
        cell.y,
        frame.fieldRiseOffsetCells,
      );
      context.save();
      context.translate(position.x + size / 2, position.y + size / 2);
      context.rotate(cell.rotationZ ?? 0);
      const scale = cell.scale ?? 1;
      context.scale(scale, scale);
      if (palette === 'arcade-bevel') {
        drawReferenceBlock(
          context,
          -size / 2,
          -size / 2,
          size,
          referenceBlockColor(cell.id, frame.before.config),
          cell.alpha ?? 1,
        );
      } else if (palette === 'candy-pop') {
        const parentId = cell.id.replace(/:fragment-[01]-[01]$/, '');
        drawCandyTile(
          context,
          -size / 2,
          -size / 2,
          size,
          cell.alpha ?? 1,
          candyPopColorForCellId(parentId),
        );
      } else if (options.tileFaceImage) {
        context.globalAlpha = cell.alpha ?? 1;
        if (
          options.tileAtlasImage &&
          cell.presentationLayer !== 'interaction' &&
          cell.appearance !== 'debris-fragment'
        ) {
          const atlas = options.tileAtlasImage as { width: number; height: number };
          const patchWidth = atlas.width / frame.before.config.columns;
          const patchHeight = atlas.height / frame.before.config.rows;
          const column = Math.max(0, Math.min(frame.before.config.columns - 1, Math.round(cell.x)));
          const row = Math.max(
            0,
            Math.min(
              frame.before.config.rows - 1,
              Math.round(frame.before.config.rows - 1 - cell.y),
            ),
          );
          context.drawImage(
            options.tileAtlasImage,
            column * patchWidth,
            row * patchHeight,
            patchWidth,
            patchHeight,
            -size / 2,
            -size / 2,
            size,
            size,
          );
        } else if (cell.appearance === 'debris-fragment') {
          const match = cell.id.match(/:fragment-([01])-([01])$/);
          const tile = options.tileFaceImage as { width: number; height: number };
          context.drawImage(
            options.tileFaceImage,
            (Number(match?.[1] ?? 0) * tile.width) / 2,
            ((1 - Number(match?.[2] ?? 0)) * tile.height) / 2,
            tile.width / 2,
            tile.height / 2,
            -size / 2,
            -size / 2,
            size,
            size,
          );
        } else context.drawImage(options.tileFaceImage, -size / 2, -size / 2, size, size);
      } else if (frame.before.config.presentation.tile === 'embossed-star') {
        drawEmbossedStar(context, -size / 2, -size / 2, size, cell.alpha ?? 1, palette);
      } else {
        drawIvoryPyramid(context, -size / 2, -size / 2, size, cell.alpha ?? 1);
      }
      context.restore();
    }
  }
  context.restore();
}

/** Historical life/scale/material and actual cached q; current field origin cancels once. */
export function clearExposureCellsAt(
  frame: BlockCrushDropPresentationFrame,
  sampleSeconds: number,
  selectedOrdinals?: Set<number>,
): BlockCrushDropVisualCell[] {
  if (!frame.physicsCueSchedule)
    throw new Error('CRUSH_EXPOSURE_REQUIRES_COMPLETE_SHARED_SCHEDULE');
  const current = frame.frameIndex / frame.fps,
    events = clearPhysicsEventsForFrame(frame),
    poses = sampleClearPhysicsWorldHistory(events, current, sampleSeconds),
    cells: BlockCrushDropVisualCell[] = [];
  for (const event of frame.physicsCueSchedule) {
    if (event.sequence) continue;
    if (selectedOrdinals && !selectedOrdinals.has(event.clearOrdinal!)) continue;
    if (sampleSeconds < event.startSeconds) {
      // The semantic board has already removed these parents at the current
      // timestamp. Earlier photons in this same shutter still saw their intact
      // surfaces. Draw the original tile artwork, not unborn physics fragments.
      // Future cues remain absent from this transient pass.
      if (
        current >= event.startSeconds &&
        sampleSeconds >= current - (frame.clearExposureSeconds ?? 0) - 1e-9
      ) {
        const riseSpeed = 30 / frame.before.config.rules.fieldMotion.ticksPerCell;
        cells.push(
          ...event.eliminatedCells.map((cell) => ({
            ...cell,
            y:
              cell.y +
              event.riseAtStartCells +
              (sampleSeconds - event.startSeconds) * riseSpeed -
              frame.fieldRiseOffsetCells,
          })),
        );
      }
      continue;
    }
    if (sampleSeconds >= event.endSeconds) continue;
    const elapsedFrames = (sampleSeconds - event.startSeconds) * frame.fps,
      durationFrames = (event.endSeconds - event.startSeconds) * frame.fps;
    const cue: NonNullable<BlockCrushDropPresentationFrame['lingeringClear']> = {
      elapsedFrames,
      durationFrames,
      progress: (elapsedFrames + 1) / durationFrames,
      motionProgress: 0,
      rowStaggerProgress: 0,
      eliminatedCells: event.eliminatedCells,
      fragmentAppearance: event.fragmentAppearance,
      ...(event.observedFragmentMotion
        ? { observedFragmentMotion: event.observedFragmentMotion }
        : {}),
    };
    const historyFrame = { ...frame, frameIndex: sampleSeconds * frame.fps, lingeringClear: cue };
    cells.push(
      ...withInertialClear(historyFrame, [], poses).map((cell) => {
        const clean = { ...cell };
        delete clean.motionTrail;
        return clean;
      }),
    );
  }
  return cells;
}

/** Repaint only the native HUD aperture layer above full-stage imported effects. */
export function drawClearSequenceHeader(
  context: CanvasRenderingContext2D,
  frame: BlockCrushDropPresentationFrame,
  options: Parameters<typeof drawBlockCrushDropStage>[2] = {},
): void {
  context.save();
  context.beginPath();
  context.rect(0, 0, 1080, BLOCK_CRUSH_DROP_CRUSHZR29976_FOREGROUND_OCCLUDER.headerBottomY);
  for (const a of BLOCK_CRUSH_DROP_CRUSHZR29976_FOREGROUND_OCCLUDER.headerApertures)
    context.rect(a.x, a.y, a.width, a.height);
  context.clip('evenodd');
  drawBlockCrushDropStage(context, frame, { ...options, drawTiles: false });
  context.restore();
}
