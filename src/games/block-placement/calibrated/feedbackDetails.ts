// Derived production module; supplied reference files remain unchanged.
import type { ReferenceAppearance } from '../../../nativeReference/games/block-placement/presentation/referenceAppearance';
export function diamondPose(track: NonNullable<ReferenceAppearance['hudDiamondTrack']>, t: number) {
  if (t < track[0][0] || t > track[track.length - 1][0]) return undefined;
  let hi = track.findIndex((k) => k[0] >= t);
  if (hi < 1) return track[0].slice(1);
  const p = track[hi - 1],
    q = track[hi],
    u = (t - p[0]) / (q[0] - p[0]);
  return p.slice(1).map((v, i) => v + (q[i + 1] - v) * u);
}
export function drawMeasuredDiamond(
  ctx: CanvasRenderingContext2D,
  track: NonNullable<ReferenceAppearance['hudDiamondTrack']>,
  t: number,
) {
  const pose = diamondPose(track, t);
  if (!pose) return;
  const [x, y, size, hue, alpha] = pose;
  if (alpha <= 0 || size < 1) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.rotate(Math.PI / 4);
  const side = size / Math.SQRT2;
  ctx.shadowColor = `hsl(${hue} 95% 56%)`;
  ctx.shadowBlur = 24 * alpha;
  const g = ctx.createLinearGradient(-side / 2, -side / 2, side / 2, side / 2);
  g.addColorStop(0, `hsl(${hue} 92% 58%)`);
  g.addColorStop(0.55, `hsl(${hue} 93% 47%)`);
  g.addColorStop(1, `hsl(${hue} 82% 36%)`);
  ctx.fillStyle = g;
  ctx.fillRect(-side / 2, -side / 2, side, side);
  ctx.shadowBlur = 0;
  ctx.globalAlpha *= 0.24;
  ctx.fillStyle = '#cfffff';
  ctx.fillRect(-side * 0.33, -side * 0.33, side * 0.66, side * 0.66);
  ctx.restore();
}
export function drawTileGlow(
  ctx: CanvasRenderingContext2D,
  events: NonNullable<ReferenceAppearance['tileGlowEvents']>,
  t: number,
  board: any[][],
  geometry: number[],
) {
  const [gx, gy, pitch] = geometry;
  for (const e of events) {
    if (t < e.start || t >= e.end) continue;
    const u = (t - e.start) / (e.end - e.start),
      a = Math.min(1, u / 0.16) * Math.min(1, (1 - u) / 0.32);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.strokeStyle = e.color;
    ctx.shadowColor = e.color;
    for (let r = 0; r < board.length; r++)
      for (let c = 0; c < board[r].length; c++) {
        if (!board[r][c]) continue;
        const x = gx + c * pitch,
          y = gy + r * pitch;
        ctx.globalAlpha = a * 0.2;
        ctx.fillStyle = '#ebffff';
        ctx.shadowColor = e.color;
        ctx.shadowBlur = 30;
        ctx.fillRect(x + 1, y + 1, pitch - 2, pitch - 2);
        for (const [w, blur, opacity] of [
          [14, 34, 0.8],
          [5, 15, 1],
        ]) {
          ctx.globalAlpha = a * opacity;
          ctx.shadowBlur = blur;
          ctx.lineWidth = w;
          ctx.strokeRect(x + 2, y + 2, pitch - 4, pitch - 4);
        }
        const q = 0.5 + 0.5 * Math.sin(t * 18 + r * 2.1 + c * 3.9);
        ctx.globalAlpha = a * q;
        ctx.fillStyle = '#ffffff';
        ctx.shadowBlur = 14;
        const xx = x + pitch * (0.12 + (0.76 * ((r * 7 + c * 11) % 17)) / 17),
          yy = y + pitch * 0.15;
        ctx.beginPath();
        ctx.moveTo(xx - 9, yy);
        ctx.lineTo(xx - 2, yy - 2);
        ctx.lineTo(xx, yy - 13);
        ctx.lineTo(xx + 2, yy - 2);
        ctx.lineTo(xx + 9, yy);
        ctx.lineTo(xx + 2, yy + 2);
        ctx.lineTo(xx, yy + 13);
        ctx.lineTo(xx - 2, yy + 2);
        ctx.closePath();
        ctx.fill();
      }
    ctx.restore();
  }
}
