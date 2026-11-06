// Derived production module; supplied reference files remain unchanged.
/** White reward lettering with the reference's magenta-to-mint outline. */
export function drawColorGone(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  age: number,
  alpha: number,
  palette?: string,
) {
  const multiple = /^[2-9]/.test(label),
    rose = palette === 'rose',
    pop = Math.min(1.06, Math.max(0.15, age / 0.09));
  ctx.save();
  ctx.translate(x, y);
  ctx.font = 'italic 900 100px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const natural = ctx.measureText(label).width;
  ctx.scale((width / natural) * pop, (height / 115) * pop);
  ctx.lineJoin = 'round';
  ctx.globalAlpha *= alpha;
  ctx.shadowColor = '#24164d80';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 8;
  ctx.lineWidth = 15;
  ctx.strokeStyle = multiple ? '#682d80' : rose ? '#9f3349' : '#555778';
  ctx.strokeText(label, 0, 0);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = 9;
  const g = ctx.createLinearGradient(-natural / 2, 0, natural / 2, 0);
  g.addColorStop(0, multiple ? '#f048e2' : rose ? '#f47596' : '#929bb1');
  g.addColorStop(0.43, multiple ? '#e978e8' : rose ? '#ffadbb' : '#b2bbcf');
  g.addColorStop(0.69, multiple ? '#45ead5' : rose ? '#ffadbb' : '#b2bbcf');
  g.addColorStop(1, multiple ? '#31d85b' : rose ? '#f47596' : '#929bb1');
  ctx.strokeStyle = g;
  ctx.strokeText(label, 0, 0);
  ctx.fillStyle = '#fffefa';
  ctx.fillText(label, 0, 0);
  ctx.restore();
}
