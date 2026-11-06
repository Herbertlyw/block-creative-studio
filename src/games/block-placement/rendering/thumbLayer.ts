export function paintThumb(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
): void {
  context.save();
  context.translate(x, y);
  context.scale(scale, scale);
  context.fillStyle = '#fff9a7';
  context.strokeStyle = '#36a862';
  context.lineWidth = 5;
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(-20, 9);
  context.lineTo(-3, 9);
  context.lineTo(4, -22);
  context.quadraticCurveTo(10, -31, 18, -24);
  context.quadraticCurveTo(23, -18, 18, -6);
  context.lineTo(31, -6);
  context.quadraticCurveTo(40, -6, 39, 3);
  context.lineTo(34, 22);
  context.quadraticCurveTo(32, 29, 23, 29);
  context.lineTo(-3, 29);
  context.lineTo(-3, 14);
  context.lineTo(-20, 14);
  context.closePath();
  context.fill();
  context.stroke();
  context.restore();
}
