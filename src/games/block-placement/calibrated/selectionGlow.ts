// Derived production module; supplied reference files remain unchanged.
import type { ReferenceEffects } from '../../../nativeReference/games/block-placement/presentation/referenceEffects';
export { selectionGlowAt } from '../planning/selectionGlowTimeline';

type Glow = NonNullable<ReferenceEffects['selectionGlow']>;
type Edge = [number, number, number, number];

/** Local cell-space perimeter; shared edges must not double the outer bloom. */
export function selectionPerimeter(cells: readonly (readonly number[])[]): Edge[] {
  const occupied = new Set(cells.map(([r, c]) => `${r},${c}`)),
    edges: Edge[] = [];
  for (const [r, c] of cells) {
    if (!occupied.has(`${r - 1},${c}`)) edges.push([c, r, c + 1, r]);
    if (!occupied.has(`${r},${c + 1}`)) edges.push([c + 1, r, c + 1, r + 1]);
    if (!occupied.has(`${r + 1},${c}`)) edges.push([c + 1, r + 1, c, r + 1]);
    if (!occupied.has(`${r},${c - 1}`)) edges.push([c, r + 1, c, r]);
  }
  return edges;
}

/** All coordinates come from the moving piece, never its future landing anchor. */
export function drawSelectionGlow(
  ctx: CanvasRenderingContext2D,
  cells: readonly (readonly number[])[],
  x: number,
  y: number,
  size: number,
  config: Glow,
  amount: number,
  pass: 'halo' | 'edge',
) {
  if (amount <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalCompositeOperation = 'screen';
  ctx.lineJoin = 'round';
  const scale = size / 120;
  if (pass === 'halo') {
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of selectionPerimeter(cells)) {
      ctx.moveTo(x1 * size, y1 * size);
      ctx.lineTo(x2 * size, y2 * size);
    }
    ctx.globalAlpha *= amount * 0.65;
    ctx.strokeStyle = '#ffb4df';
    ctx.lineWidth = config.edgePx * scale * 2;
    ctx.shadowColor = '#ff8fce';
    ctx.shadowBlur = config.haloPx * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.stroke();
  } else {
    ctx.globalAlpha *= amount * 0.8;
    ctx.lineWidth = config.edgePx * scale;
    ctx.shadowColor = '#ffa7d7';
    ctx.shadowBlur = config.haloPx * scale * 0.3;
    for (const [r, c] of cells) {
      const left = c * size + 1.5 * scale,
        top = r * size + 1.5 * scale,
        side = size - 3 * scale;
      const gradient = ctx.createLinearGradient(left, top, left + side, top + side);
      gradient.addColorStop(0, '#fff8fc');
      gradient.addColorStop(0.45, '#ffdbef');
      gradient.addColorStop(1, '#ff9acb');
      ctx.strokeStyle = gradient;
      ctx.strokeRect(left, top, side, side);
    }
  }
  ctx.restore();
}
