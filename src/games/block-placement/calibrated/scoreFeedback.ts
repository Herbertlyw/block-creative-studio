// Derived production module; supplied reference files remain unchanged.
import type { BBScorePopup } from '../planning/scorePopupTimeline';

export function drawScorePopup(ctx: CanvasRenderingContext2D, p: BBScorePopup) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.scale(p.scale, p.scale);
  ctx.globalAlpha = p.alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 ${p.fontSize}px "Arial Rounded MT Bold", Arial, sans-serif`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = p.style === 'gold' ? 4 : 3;
  ctx.strokeStyle = p.style === 'gold' ? '#9a401b99' : '#30304766';
  ctx.shadowOffsetY = 2;
  ctx.shadowBlur = p.style === 'gold' ? 18 : 3;
  ctx.shadowColor = p.style === 'gold' ? '#ff6c2488' : '#1b263a66';
  ctx.strokeText(p.text, 0, 0);
  if (p.style === 'gold') {
    const g = ctx.createLinearGradient(0, -p.fontSize / 2, 0, p.fontSize / 2);
    g.addColorStop(0, '#fff9b4');
    g.addColorStop(0.6, '#ffe57c');
    g.addColorStop(1, '#ffc759');
    ctx.fillStyle = g;
  } else ctx.fillStyle = '#fff';
  ctx.fillText(p.text, 0, 0);
  ctx.restore();
}
