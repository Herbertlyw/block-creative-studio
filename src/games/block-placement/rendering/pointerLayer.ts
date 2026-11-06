/** Paint a pointer in the caller's design transform, independently of piece geometry. */
export function paintPointer(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  style: { kind: 'authored'; pressed: boolean } | { kind: 'ring'; radius: number },
): void {
  ctx.save();
  if (style.kind === 'ring') {
    ctx.beginPath();
    ctx.arc(point.x, point.y, style.radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  } else {
    ctx.globalAlpha = style.pressed ? 0.9 : 0.55;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 5;
    ctx.shadowColor = 'rgba(75,235,205,0.8)';
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.arc(point.x, point.y, style.pressed ? 22 : 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
