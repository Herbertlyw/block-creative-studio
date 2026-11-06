import {
  materialTheme,
  paintMaterialStage,
} from '../../../nativeReference/games/block-placement/render/materialThemes';
import { hash32, seededFloat } from '../../../nativeReference/domain/rng';
import {
  BLAST_BACKGROUND,
  REFERENCE_BACKGROUND,
  REFERENCE_CANVAS,
} from '../../../nativeReference/reference2d/referenceProfile';
import type { StyleSpec } from '../../../nativeReference/domain/types';
import type { RuntimeAssetBindings } from '../../../nativeReference/assets/runtimeAssetBindings';
import { drawBoundBackground } from './backgroundLayer';
const TWO_PI = Math.PI * 2;

export function paintAuthoredBackground(
  context: CanvasRenderingContext2D,
  style: StyleSpec,
  assets: RuntimeAssetBindings,
  image: HTMLImageElement | null,
  seed: number,
  seconds: number,
  solidColor: string | null = null,
): void {
  const blast = style.reference2d.tileMaterial === 'candy-blast';
  const themed = materialTheme(style.reference2d.materialTheme);
  const backgroundBinding = assets.background;
  const backgroundImage = image;
  if (solidColor) {
    context.fillStyle = solidColor;
    context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
  } else if (themed && !(backgroundBinding && backgroundImage)) {
    paintMaterialStage(context, themed, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
  } else if (backgroundBinding && backgroundImage) {
    drawBoundBackground(
      context,
      backgroundImage,
      REFERENCE_CANVAS.width,
      REFERENCE_CANVAS.height,
      Math.max(1, backgroundImage.width),
      Math.max(1, backgroundImage.height),
      backgroundBinding,
    );

    // Keep a restrained grade over uploaded art so HUD and board contrast
    // remain stable across arbitrary Agent- or designer-authored images.
    const grade = context.createLinearGradient(0, 0, 0, REFERENCE_CANVAS.height);
    if (blast) {
      grade.addColorStop(0, 'rgba(12,20,48,0.08)');
      grade.addColorStop(0.58, 'rgba(16,28,64,0.05)');
      grade.addColorStop(1, 'rgba(8,12,36,0.18)');
    } else {
      grade.addColorStop(0, 'rgba(0,40,48,0.08)');
      grade.addColorStop(0.58, 'rgba(8,72,58,0.06)');
      grade.addColorStop(1, 'rgba(2,32,34,0.22)');
    }
    context.fillStyle = grade;
    context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
  } else {
    const background = blast ? BLAST_BACKGROUND : REFERENCE_BACKGROUND;
    const gradient = context.createLinearGradient(0, 0, 0, REFERENCE_CANVAS.height);
    gradient.addColorStop(0, background.top);
    gradient.addColorStop(0.48, background.middle);
    gradient.addColorStop(1, background.bottom);
    context.fillStyle = gradient;
    context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
  }

  if (!blast) {
    const halo = context.createRadialGradient(532, 730, 0, 532, 730, 760);
    halo.addColorStop(0, REFERENCE_BACKGROUND.halo);
    halo.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = halo;
    context.fillRect(0, 0, REFERENCE_CANVAS.width, REFERENCE_CANVAS.height);
  }

  if (style.reference2d.ambientFx === 'none') return;
  for (let index = 0; index < 22; index += 1) {
    const baseX = seededFloat(hash32(seed + index * 17), index + 3) * REFERENCE_CANVAS.width;
    const baseY = 260 + seededFloat(hash32(seed + index * 29), index + 11) * 1420;
    const drift = Math.sin(seconds * (0.35 + (index % 5) * 0.06) + index) * (10 + (index % 4) * 5);
    const alpha = 0.08 + 0.12 * (0.5 + 0.5 * Math.sin(seconds * 0.9 + index));
    context.save();
    context.translate(baseX + drift, baseY);
    context.rotate(seconds * 0.09 + index);
    context.fillStyle =
      index % 3 === 0
        ? `rgba(255,235,117,${alpha})`
        : index % 3 === 1
          ? `rgba(255,113,151,${alpha})`
          : `rgba(94,228,219,${alpha})`;
    const size = 2 + (index % 4);
    context.fillRect(-size / 2, -size / 2, size, size);
    context.restore();
  }
  drawAmbientFlower(context, 862, 1445, seconds);
}

function drawAmbientFlower(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  seconds: number,
): void {
  const pulse = 0.82 + Math.sin(seconds * 1.35) * 0.12;
  context.save();
  context.translate(x, y);
  context.scale(pulse, pulse);
  context.globalAlpha = 0.18;
  context.shadowColor = '#fff47c';
  context.shadowBlur = 22;
  for (let index = 0; index < 5; index += 1) {
    context.save();
    context.rotate((index / 5) * TWO_PI);
    context.fillStyle = index % 2 === 0 ? '#ff77a8' : '#7be8c9';
    context.beginPath();
    context.ellipse(0, -27, 12, 25, 0, 0, TWO_PI);
    context.fill();
    context.restore();
  }
  context.fillStyle = '#fff16a';
  context.beginPath();
  context.arc(0, 0, 8, 0, TWO_PI);
  context.fill();
  context.restore();
}
