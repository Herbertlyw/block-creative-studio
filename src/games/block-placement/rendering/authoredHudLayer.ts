import { materialTheme } from '../../../nativeReference/games/block-placement/render/materialThemes';
import {
  BLAST_CROWN,
  paintBlastCrown,
  paintBlastGear,
} from '../../../nativeReference/games/block-placement/render/blastHud';
import { REFERENCE_LAYOUT } from '../../../nativeReference/reference2d/referenceProfile';
import type { ClearingFrame, StyleSpec } from '../../../nativeReference/domain/types';
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

export function paintAuthoredHud(
  context: CanvasRenderingContext2D,
  style: StyleSpec,
  score: number,
  clearing: ClearingFrame | null,
): void {
  const best = Math.max(style.reference2d.bestScore, score);
  const blast = style.reference2d.tileMaterial === 'candy-blast';
  if (blast) {
    const crown = REFERENCE_LAYOUT.hud.blastCrown;
    paintBlastCrown(context, crown.x, crown.y);
    context.save();
    context.font = '800 54px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillStyle = materialTheme(style.reference2d.materialTheme)?.hud.best ?? '#ffb434';
    context.shadowColor = 'rgba(113,84,24,0.35)';
    context.shadowBlur = 6;
    context.shadowOffsetY = 4;
    context.fillText(
      String(best),
      crown.x + BLAST_CROWN.width + 8,
      crown.y + BLAST_CROWN.height * 0.58,
    );
    context.restore();
  } else {
    drawCrown(context, 118, 86, 1);
    context.save();
    context.font = '800 54px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.lineWidth = 5;
    context.strokeStyle = 'rgba(145,91,24,0.25)';
    context.strokeText(String(best), 181, 91);
    context.fillStyle = '#ffb434';
    context.shadowColor = 'rgba(113,84,24,0.35)';
    context.shadowBlur = 6;
    context.shadowOffsetY = 4;
    context.fillText(String(best), 181, 91);
    context.restore();
  }

  const scorePulse = clearing
    ? 1 + Math.sin(clamp01(clearing.progress) * Math.PI) * (blast ? 0.12 : 0.035)
    : 1;
  context.save();
  context.translate(REFERENCE_LAYOUT.hud.scoreCenter.x, REFERENCE_LAYOUT.hud.scoreCenter.y);
  context.scale(scorePulse, scorePulse);
  context.font = '900 102px "Arial Rounded MT Bold", "Trebuchet MS", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (blast) {
    if (clearing) {
      context.shadowColor = 'rgba(255, 230, 120, 0.85)';
      context.shadowBlur = 28 + Math.sin(clamp01(clearing.progress) * Math.PI) * 18;
    } else {
      context.shadowColor = 'rgba(16,28,64,0.45)';
      context.shadowBlur = 8;
    }
    context.fillStyle = materialTheme(style.reference2d.materialTheme)?.hud.score ?? '#ffffff';
    context.shadowOffsetY = 5;
    context.fillText(String(score), 0, 0);
  } else {
    context.lineWidth = 6;
    context.strokeStyle = 'rgba(47,89,61,0.23)';
    context.strokeText(String(score), 0, 0);
    context.fillStyle = materialTheme(style.reference2d.materialTheme)?.hud.score ?? '#ffffff';
    context.shadowColor = 'rgba(34,91,60,0.45)';
    context.shadowBlur = 8;
    context.shadowOffsetY = 5;
    context.fillText(String(score), 0, 0);
  }
  context.restore();

  if (!blast) {
    drawGalleryIcon(context, 823, 88);
    drawBetaRibbon(context, 850, 61);
  }
  if (blast) {
    paintBlastGear(context, REFERENCE_LAYOUT.hud.blastGear.x, REFERENCE_LAYOUT.hud.blastGear.y);
  } else {
    drawGear(context, blast, 949, 89);
  }
}

function drawCrown(context: CanvasRenderingContext2D, x: number, y: number, scale: number): void {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.shadowColor = 'rgba(57,61,43,0.42)';
  context.shadowBlur = 5;
  context.shadowOffsetY = 4;
  const gradient = context.createLinearGradient(0, -42, 0, 36);
  gradient.addColorStop(0, '#f4e6cf');
  gradient.addColorStop(1, '#b79b82');
  context.fillStyle = gradient;
  context.strokeStyle = '#9b806e';
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(-43, 25);
  context.lineTo(-35, -20);
  context.lineTo(-8, 5);
  context.lineTo(0, -38);
  context.lineTo(10, 5);
  context.lineTo(37, -20);
  context.lineTo(43, 25);
  context.closePath();
  context.fill();
  context.stroke();
  roundedRect(context, -42, 22, 84, 17, 7);
  context.fill();
  context.stroke();
  for (const [cx, cy] of [
    [-35, -21],
    [0, -40],
    [37, -21],
  ] as const) {
    context.beginPath();
    context.arc(cx, cy, 8, 0, TWO_PI);
    context.fill();
    context.stroke();
  }
  context.restore();
}

function drawGalleryIcon(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.shadowColor = 'rgba(32,72,69,0.35)';
  context.shadowBlur = 5;
  context.shadowOffsetY = 4;
  roundedRect(context, x - 38, y - 34, 76, 68, 10);
  context.fillStyle = '#a8c8f1';
  context.fill();
  context.strokeStyle = '#5483bf';
  context.lineWidth = 3;
  context.stroke();
  context.fillStyle = '#365c9f';
  context.beginPath();
  context.arc(x - 13, y - 12, 8, 0, TWO_PI);
  context.fill();
  context.beginPath();
  context.moveTo(x - 29, y + 22);
  context.lineTo(x - 5, y - 3);
  context.lineTo(x + 9, y + 9);
  context.lineTo(x + 22, y - 3);
  context.lineTo(x + 32, y + 22);
  context.closePath();
  context.fill();
  context.restore();
}

function drawBetaRibbon(context: CanvasRenderingContext2D, x: number, y: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(-0.04);
  roundedRect(context, -31, -15, 70, 31, 7);
  const gradient = context.createLinearGradient(0, -15, 0, 16);
  gradient.addColorStop(0, '#e25df6');
  gradient.addColorStop(1, '#8c3fd5');
  context.fillStyle = gradient;
  context.fill();
  context.strokeStyle = '#7231b5';
  context.lineWidth = 2;
  context.stroke();
  context.fillStyle = '#fff';
  context.font = '900 22px "Arial Rounded MT Bold", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('Beta', 4, 1);
  context.restore();
}

function drawGear(context: CanvasRenderingContext2D, blast: boolean, x: number, y: number): void {
  context.save();
  context.translate(x, y);
  context.fillStyle = blast ? '#d7f0ff' : '#edffdc';
  context.strokeStyle = blast ? 'rgba(90,140,190,0.28)' : 'rgba(70,119,72,0.28)';
  context.lineWidth = 3;
  context.shadowColor = blast ? 'rgba(16,28,64,0.35)' : 'rgba(36,83,55,0.35)';
  context.shadowBlur = 5;
  context.shadowOffsetY = 3;
  for (let index = 0; index < 10; index += 1) {
    context.save();
    context.rotate((index / 10) * TWO_PI);
    roundedRect(context, -7, -39, 14, 24, 4);
    context.fill();
    context.restore();
  }
  context.beginPath();
  context.arc(0, 0, 28, 0, TWO_PI);
  context.fill();
  context.stroke();
  context.fillStyle = blast ? '#4a7cb0' : '#76b56e';
  context.beginPath();
  context.arc(0, 0, 12, 0, TWO_PI);
  context.fill();
  context.restore();
}
