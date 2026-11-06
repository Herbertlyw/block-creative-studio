import { hash32, seededFloat } from '../../../nativeReference/domain/rng';
import type { GridCell, ClearResult } from '../../../nativeReference/domain/types';

export const TWO_PI = Math.PI * 2;

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function easeOutCubic(value: number): number {
  const t = clamp01(value);
  return 1 - (1 - t) ** 3;
}

export function easeOutBack(value: number): number {
  const t = clamp01(value);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  appendRoundedRect(context, x, y, width, height, radius);
}

function appendRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

export function colorWithAlpha(hex: string, alpha: number): string {
  const [red, green, blue] = parseHex(hex);
  return `rgba(${red},${green},${blue},${clamp01(alpha)})`;
}

/** 六段彩虹渐变(消除光带、文字光晕共用), 沿 (x0,y0)->(x1,y1)。 */
export function rainbowGradient(
  context: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  alpha: number,
): CanvasGradient {
  const gradient = context.createLinearGradient(x0, y0, x1, y1);
  for (let i = 0; i <= 6; i += 1) {
    gradient.addColorStop(i / 6, `hsla(${i * 60}, 100%, 62%, ${clamp01(alpha)})`);
  }
  return gradient;
}

function parseHex(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export const BLAST_CONFETTI = [
  '#ffd24a',
  '#ff8a3a',
  '#c86bff',
  '#5ad6ff',
  '#ff6bb5',
  '#7dff6a',
] as const;

export function burstTravel(progress: number): number {
  return 1 - (1 - clamp01(progress)) ** 2;
}

export function blastBurstPose(
  cell: GridCell,
  clear: ClearResult,
  progress: number,
  seed: number,
  index: number,
  copy = 0,
): { dx: number; dy: number; rotation: number; scale: number; alpha: number } {
  const t = burstTravel(progress);
  const punch = progress < 0.14 ? 1 + (1 - progress / 0.14) * 0.2 : 1;
  const spin = seededFloat(hash32(seed + index * 97 + copy * 13), index + 4);
  const scatter = seededFloat(hash32(seed + index * 53 + copy * 19), index + 11);
  const lift = seededFloat(hash32(seed + index * 71 + copy * 29), index + 19);
  const inRow = clear.rows.includes(cell.row);
  const inCol = clear.cols.includes(cell.col);
  const copySpread = copy * (34 + scatter * 18);
  let vx = (scatter - 0.5) * 110 + (copy === 1 ? copySpread : copy === 2 ? -copySpread : 0);
  let vy = -90 - lift * 170 + (scatter - 0.42) * 70;
  if (inRow) vx += (cell.col - 3.5) * (42 + spin * 30);
  if (inCol) vy += (cell.row - 3.5) * 18 - 36;
  return {
    dx: vx * t,
    dy: vy * t + 190 * progress * progress,
    rotation: (spin - 0.5) * 0.9 * Math.PI * t,
    scale: punch * (1.06 - progress * 0.1),
    alpha: 1 - clamp01((progress - 0.58) / 0.42),
  };
}
