// Derived production module; supplied reference files remain unchanged.
import { boardSide, type CalibratedBoardGeometry } from './boardGeometry';
import { drawIridescentButterflyRim } from './iridescentRim';
import { drawButterflyRim } from './referenceFeedback';
import type { ReferenceAppearance } from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';
type Decoration = NonNullable<ReferenceAppearance['decorations']>[number];
const sat = (v: number) => Math.max(0, Math.min(1, v));
export function decorationOpacity(e: Decoration, t: number) {
  return sat((t - e.start) / 0.06) * sat((e.end - t) / 0.12);
}
export function drawReferenceDecoration(
  ctx: CanvasRenderingContext2D,
  e: Decoration,
  t: number,
  board: CalibratedBoardGeometry,
) {
  const a = decorationOpacity(e, t);
  if (!a) return;
  ctx.save();
  ctx.globalAlpha = a;
  if (e.kind === 'hud-panel-glow' && e.rect) {
    const [x, y, w, h] = e.rect,
      pulse = 0.85 + 0.15 * Math.sin((t - e.start) * 9);
    ctx.shadowColor = e.color;
    for (const [width, blur, alpha] of [
      [12, 24, 0.35],
      [5, 12, 0.8],
      [2, 3, 1],
    ]) {
      ctx.globalAlpha = a * pulse * alpha;
      ctx.strokeStyle = width === 2 ? '#fff8b0' : e.color;
      ctx.shadowBlur = blur;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(h * 0.28, 36));
      ctx.stroke();
    }
    ctx.globalAlpha = a * 0.75;
    ctx.fillStyle = e.color;
    ctx.shadowBlur = 9;
    for (let i = 0; i < 10; i++) {
      const xx = x + ((i * 0.618 + t * 0.12) % 1) * w,
        yy = y + (i % 2 ? h : 0) + Math.sin(i + t * 4) * 9;
      ctx.fillRect(xx - 2, yy - 2, 4, 4);
    }
    ctx.restore();
    return;
  }
  if (e.kind === ('clear-panel' as any)) {
    const age = t - e.start,
      fade = sat(age / 0.16) * sat((e.end - t) / 0.16),
      width = e.size,
      height = e.size * 0.79,
      left = e.x - width / 2,
      top = e.y - height / 2;
    const g = ctx.createLinearGradient(0, top, 0, top + height);
    g.addColorStop(0, '#2c9af610');
    g.addColorStop(0.55, '#227edc3b');
    g.addColorStop(1, '#127dffaa');
    ctx.globalAlpha = fade;
    ctx.fillStyle = g;
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = '#21eaff';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#0dbfff';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.moveTo(left, top + height);
    ctx.lineTo(left + width, top + height);
    ctx.stroke();
    ctx.globalAlpha = fade * 0.7;
    ctx.fillStyle = '#38b8f5';
    for (let i = 0; i < 17; i++) {
      const x = left + ((i * 0.618) % 1) * width,
        y = top + ((i * 0.319 + age * 0.06) % 1) * height,
        size = 3 + (i % 4) * 2;
      ctx.fillRect(x, y, size, size);
    }
    ctx.restore();
    return;
  }

  if (e.kind === 'spark-ring') {
    const u = sat((t - e.start) / (e.end - e.start)),
      radius = e.size * 0.5 * (0.1 + 0.9 * (1 - Math.pow(1 - u, 2)));
    ctx.translate(e.x, e.y);
    ctx.globalCompositeOperation = 'screen';
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, e.size * 0.36);
    glow.addColorStop(0, e.color + 'a0');
    glow.addColorStop(0.28, e.color + '38');
    glow.addColorStop(1, e.color + '00');
    ctx.globalAlpha = a * (1 - sat(u / 0.85));
    ctx.fillStyle = glow;
    ctx.fillRect(-e.size / 2, -e.size / 2, e.size, e.size);
    for (let i = 0; i < 34; i++) {
      const angle = i * 2.399963 + e.x * 0.01,
        r = radius * (0.66 + ((((Math.sin(i * 127.1) * 43758.5453) % 1) + 1) % 1) * 0.34),
        x = Math.cos(angle) * r,
        y = Math.sin(angle) * r + u * u * 25;
      const twinkle = 0.55 + 0.45 * Math.sin(i * 3 + t * 27),
        size = (i % 5 === 0 ? 22 : 9) * (1 - u * 0.6);
      ctx.save();
      ctx.translate(x, y);
      ctx.globalAlpha = a * twinkle;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#fffde2';
      ctx.beginPath();
      ctx.moveTo(-size, 0);
      ctx.lineTo(-size * 0.2, -size * 0.2);
      ctx.lineTo(0, -size * 1.5);
      ctx.lineTo(size * 0.2, -size * 0.2);
      ctx.lineTo(size, 0);
      ctx.lineTo(size * 0.2, size * 0.2);
      ctx.lineTo(0, size * 1.5);
      ctx.lineTo(-size * 0.2, size * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  if (e.kind === 'neon-rim') {
    const [x, y, p] = board;
    ctx.shadowColor = e.color;
    for (const [w, blur, alpha] of [
      [26, 50, 0.35],
      [11, 22, 0.9],
      [3.5, 5, 1],
    ]) {
      ctx.globalAlpha = a * alpha;
      ctx.strokeStyle = w < 4 ? '#ffffd7' : e.color;
      ctx.shadowBlur = blur;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.roundRect(x - 8, y - 8, p * boardSide(board) + 16, p * boardSide(board) + 16, 8);
      ctx.stroke();
    }
    ctx.globalAlpha = a;
    ctx.fillStyle = e.color;
    ctx.shadowBlur = 9;
    for (let i = 0; i < 56; i++) {
      const q = (i * 0.618 + t * 0.04) % 1,
        side = i % 4,
        drift = 10 + 12 * Math.sin(i * 8 + t * 7),
        xx =
          side < 2
            ? side
              ? x + p * boardSide(board) + drift
              : x - drift
            : x + q * p * boardSide(board),
        yy =
          side > 1
            ? side === 2
              ? y - drift
              : y + p * boardSide(board) + drift
            : y + q * p * boardSide(board),
        size = 3 + (i % 4) * 2;
      ctx.fillRect(xx - size / 2, yy - size / 2, size, size);
    }
    ctx.restore();
    return;
  }
  if (e.kind === 'heart-rim') {
    const [x, y, p] = board;
    ctx.strokeStyle = e.color;
    ctx.shadowColor = e.color;
    for (const [w, blur, alpha] of [
      [9, 28, 0.25],
      [4, 14, 0.65],
      [2, 2, 1],
    ]) {
      ctx.lineWidth = w;
      ctx.shadowBlur = blur;
      ctx.globalAlpha = a * alpha;
      ctx.beginPath();
      ctx.roundRect(x - 8, y - 8, p * boardSide(board) + 16, p * boardSide(board) + 16, 8);
      ctx.stroke();
    }
    ctx.globalAlpha = a;
    for (let i = 0; i < 38; i++) {
      const q = (i * 0.618 + t * 0.024) % 1,
        side = i % 4,
        xx =
          side < 2 ? (side ? x + p * boardSide(board) + 14 : x - 14) : x + q * p * boardSide(board),
        yy =
          side > 1
            ? side === 2
              ? y - 16
              : y + p * boardSide(board) + 16
            : y + q * p * boardSide(board);
      ctx.save();
      ctx.translate(xx, yy);
      ctx.scale(2.5, 2.5);
      ctx.fillStyle = '#ffeaff';
      ctx.beginPath();
      ctx.moveTo(0, 2);
      ctx.bezierCurveTo(-3, 0, -3, -3, 0, -1);
      ctx.bezierCurveTo(3, -3, 3, 0, 0, 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  if (e.kind === 'iridescent-butterfly-rim') {
    drawIridescentButterflyRim(ctx, board, Math.min(0.45, t - e.start), t, 28);
    ctx.restore();
    return;
  }
  if (e.kind === 'butterfly-rim') {
    drawButterflyRim(ctx, board, Math.min(0.45, t - e.start), t, 28);
    ctx.restore();
    return;
  }
  ctx.translate(e.x, e.y);
  const pop = 0.88 + 0.12 * sat((t - e.start) / 0.12);
  ctx.scale(pop, pop);
  if (e.kind === 'tile-thumbs') {
    const rows = e.rows ?? 3,
      cols = e.cols ?? 3,
      p = e.size / cols,
      age = t - e.start;
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        ctx.save();
        ctx.translate((col - (cols - 1) / 2) * p, (row - (rows - 1) / 2) * p);
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 24;
        if (e.outline || age < 0.03) {
          const g = ctx.createRadialGradient(0, 0, 0, 0, 0, p * 0.48);
          g.addColorStop(0, '#ffffed');
          g.addColorStop(0.2, e.color);
          g.addColorStop(1, e.color + '00');
          ctx.fillStyle = g;
          ctx.fillRect(-p * 0.48, -p * 0.48, p * 0.96, p * 0.96);
        } else {
          ctx.scale(p / 115, p / 115);
          ctx.save();
          ctx.strokeStyle = e.color;
          ctx.globalAlpha *= 0.4;
          ctx.lineWidth = 2;
          for (let k = 0; k < 12; k++) {
            const a = (k * Math.PI) / 6;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * 32, Math.sin(a) * 32);
            ctx.lineTo(Math.cos(a) * 49, Math.sin(a) * 49);
            ctx.stroke();
          }
          ctx.restore();
          ctx.fillStyle = e.color;
          ctx.strokeStyle = '#305e50';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(-9, 24);
          ctx.lineTo(16, 24);
          ctx.quadraticCurveTo(23, 23, 27, -12);
          ctx.quadraticCurveTo(27, -17, 9, -15);
          ctx.lineTo(12, -32);
          ctx.quadraticCurveTo(10, -42, 2, -32);
          ctx.lineTo(-8, -12);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillRect(-23, -8, 10, 31);
          ctx.strokeRect(-23, -8, 10, 31);
        }
        ctx.restore();
      }
    ctx.restore();
    return;
  }
  if (e.kind === 'flower-pop') {
    const r = e.size / 2;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 22;
    ctx.fillStyle = e.color;
    for (let i = 0; i < 5; i++) {
      ctx.save();
      ctx.rotate((i * Math.PI * 2) / 5 + t * 0.6);
      ctx.beginPath();
      ctx.ellipse(0, -r * 0.42, r * 0.27, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = '#fffce7';
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  if (e.kind === 'paired-thumbs') {
    for (const sign of [-1, 1]) {
      ctx.save();
      ctx.translate(sign * e.size * 2.6, 0);
      ctx.rotate(sign * 0.22);
      ctx.scale(e.size / 50, e.size / 50);
      ctx.shadowColor = '#194f6d66';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 3;
      const g = ctx.createLinearGradient(0, -30, 0, 28);
      g.addColorStop(0, '#7dfff0');
      g.addColorStop(0.45, '#27dcc8');
      g.addColorStop(0.5, '#4aa9ff');
      g.addColorStop(1, '#b65eef');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-8, 23);
      ctx.lineTo(18, 23);
      ctx.quadraticCurveTo(24, 20, 26, -8);
      ctx.quadraticCurveTo(25, -14, 9, -13);
      ctx.lineTo(10, -29);
      ctx.quadraticCurveTo(8, -38, 1, -28);
      ctx.lineTo(-7, -11);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#b66bff';
      ctx.fillRect(-23, -6, 11, 32);
      ctx.restore();
    }
    ctx.restore();
    return;
  }
  const r = e.size / 2;
  ctx.shadowColor = e.color;
  ctx.shadowBlur = 24;
  if (e.kind === 'hud-heart' && (e as any).soft) {
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, r * 0.8);
      ctx.bezierCurveTo(-r * 0.7, r * 0.15, -r * 1.05, -r * 0.28, -r * 0.8, -r * 0.68);
      ctx.bezierCurveTo(-r * 0.55, -r, -r * 0.12, -r * 0.95, 0, -r * 0.5);
      ctx.bezierCurveTo(r * 0.2, -r * 1.08, r * 0.78, -r * 0.92, r * 0.87, -r * 0.48);
      ctx.bezierCurveTo(r, r * 0.04, r * 0.34, r * 0.5, 0, r * 0.8);
    };
    const phase = sat((t - e.start) / (e.end - e.start)),
      pulse = 1 + 0.08 * Math.sin(phase * Math.PI);
    ctx.scale(pulse, pulse);
    path();
    if (e.outline === false) {
      ctx.fillStyle = e.color;
      ctx.shadowColor = e.color;
      ctx.shadowBlur = 24;
      ctx.fill();
      ctx.globalAlpha *= 0.55;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.restore();
      return;
    }
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    g.addColorStop(0, e.color + 'd0');
    g.addColorStop(0.7, e.color + '90');
    g.addColorStop(1, e.color + '28');
    ctx.fillStyle = g;
    ctx.shadowBlur = 0;
    ctx.fill();
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 8;
    ctx.shadowColor = e.color;
    ctx.shadowBlur = 32;
    for (let i = 0; i < 3; i++) ctx.stroke();
    ctx.shadowBlur = 14;
    ctx.globalAlpha *= 0.65;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.scale(1.5, 1.5);
    path();
    ctx.globalAlpha = a * 0.17;
    ctx.lineWidth = 3;
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (e.kind === 'hud-heart') {
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, '#fff8ff');
    g.addColorStop(0.2, e.color);
    g.addColorStop(1, e.color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, r * 0.8);
    ctx.bezierCurveTo(-r * 0.7, r * 0.15, -r * 1.05, -r * 0.28, -r * 0.8, -r * 0.68);
    ctx.bezierCurveTo(-r * 0.55, -r, -r * 0.12, -r * 0.95, 0, -r * 0.5);
    ctx.bezierCurveTo(r * 0.2, -r * 1.08, r * 0.78, -r * 0.92, r * 0.87, -r * 0.48);
    ctx.bezierCurveTo(r, r * 0.04, r * 0.34, r * 0.5, 0, r * 0.8);
    if (e.outline) {
      ctx.save();
      ctx.globalAlpha *= 0.12;
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = 13;
      ctx.strokeStyle = e.color;
      ctx.shadowBlur = 30;
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.shadowBlur = 6;
      ctx.strokeStyle = '#fff5ff';
      ctx.stroke();
    } else {
      ctx.fill();
      ctx.shadowBlur = 8;
      ctx.lineWidth = 5;
      ctx.strokeStyle = '#ffffffcc';
      ctx.stroke();
    }
  } else {
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = e.color;
    ctx.lineWidth = 8;
    const g = ctx.createLinearGradient(-r, -r, r, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, e.color);
    g.addColorStop(1, '#75c8ee');
    ctx.fillStyle = g;
    ctx.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
    if (e.outline !== false) ctx.strokeRect(-r * 0.77, -r * 0.77, r * 1.54, r * 1.54);
    ctx.shadowBlur = 0;
    ctx.globalAlpha *= 0.2;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-r * 0.48, -r * 0.48, r * 0.96, r * 0.96);
  }
  ctx.restore();
}
