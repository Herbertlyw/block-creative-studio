// Derived production module; supplied reference files remain unchanged.
import {
  progressHudAt,
  type ReferenceProgressHud,
} from '../../../nativeReference/games/block-placement/presentation/referenceProgressHud';
export function drawProgressHud(
  ctx: CanvasRenderingContext2D,
  m: ReferenceProgressHud,
  time: number,
) {
  if (time < m.start || time >= m.end) return;
  const [x, y, w, h] = m.rect,
    p = progressHudAt(m, time),
    r = h * 0.24;
  ctx.save();
  ctx.shadowColor = '#10132b60';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 3;
  ctx.lineWidth = 3;
  ctx.strokeStyle = m.border;
  ctx.fillStyle = m.background;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, m.fill);
  g.addColorStop(1, m.fill);
  ctx.fillStyle = g;
  if (p.fraction > 0) {
    ctx.beginPath();
    ctx.roundRect(x + 2, y + 2, Math.max(1, (w - 4) * p.fraction), h - 4, r);
    ctx.fill();
  }
  ctx.font = `900 ${m.labelSize}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff9e5';
  ctx.shadowColor = '#241d4570';
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 2;
  if (m.kind === 'bubble' && m.goalLabel) {
    const cx = x + w,
      cy = y + h / 2;
    ctx.fillStyle = m.background;
    ctx.strokeStyle = m.border;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, h * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffca3a';
    ctx.fillText(m.goalLabel, cx, cy + 2);
  }
  if (m.kind === 'bubble') {
    const cx = x + w * p.fraction,
      cy = y + h / 2,
      rad = h * 0.95,
      bg = ctx.createLinearGradient(cx - rad, cy - rad, cx + rad, cy + rad);
    bg.addColorStop(0, '#61cbe8');
    bg.addColorStop(0.5, m.fill);
    bg.addColorStop(1, '#1379ad');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(p.label, cx, cy + 2);
  } else ctx.fillText(p.label, x + w / 2, y + h / 2);
  if (p.suffix) {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff072';
    ctx.fillText(p.suffix, x + w + 13, y + h / 2);
  }
  ctx.restore();
}
