// Derived production module; supplied reference files remain unchanged.
import { boardSide, type CalibratedBoardGeometry } from './boardGeometry';
type C = CanvasRenderingContext2D;
const sat = (v: number) => Math.max(0, Math.min(1, v));
const noise = (n: number) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
/** Soft prismatic board-rim celebration, never alters board/cell state.
 * age may be held at .45 by an explicitly timed decoration. */
export function drawIridescentButterflyRim(
  c: C,
  board: CalibratedBoardGeometry,
  age: number,
  t: number,
  density: number,
) {
  const [gx, gy, p] = board,
    s = p * boardSide(board),
    alpha = sat(age / 0.09) * (1 - sat((age - 0.72) / 0.34));
  if (alpha <= 0) return;
  const colors = ['#fff6d0', '#d5ffe6', '#dcefff', '#e8d4ff', '#ffd6ed'];
  c.save();
  c.globalAlpha *= alpha;
  c.globalCompositeOperation = 'screen';
  const hue = c.createLinearGradient(gx, gy, gx + s, gy + s);
  colors.forEach((color, i) => hue.addColorStop(i / (colors.length - 1), color));
  // Low oval halos outside the upper and lower border: broad enough to read at
  // preview resolution, but translucent so the fixed UI remains unobstructed.
  for (const edge of [-1, 1]) {
    const cy = edge < 0 ? gy - 8 : gy + s + 8;
    c.save();
    c.translate(gx + s / 2, cy);
    const radial = c.createRadialGradient(0, 0, s * 0.18, 0, 0, s * 0.56);
    radial.addColorStop(0, '#e9e2ff00');
    radial.addColorStop(0.46, edge < 0 ? '#e3d3ff12' : '#ffe7b522');
    radial.addColorStop(0.74, edge < 0 ? '#d6f4ff20' : '#e3ffd934');
    radial.addColorStop(0.9, '#ffdcf416');
    radial.addColorStop(1, '#ffffff00');
    c.save();
    c.scale(1, 0.17);
    c.fillStyle = radial;
    c.fillRect(-s * 0.6, -s * 0.6, s * 1.2, s * 1.2);
    c.restore();
    for (let band = 0; band < 3; band++) {
      const g = c.createLinearGradient(-s * 0.53, 0, s * 0.53, 0);
      g.addColorStop(0, '#ccf7eb00');
      g.addColorStop(0.15, '#d6efff');
      g.addColorStop(0.4, colors[(band + 1) % 5]!);
      g.addColorStop(0.66, colors[(band + 3) % 5]!);
      g.addColorStop(0.9, '#dfffda');
      g.addColorStop(1, '#e9d8ff00');
      c.globalAlpha = alpha * (0.1 - band * 0.018);
      c.strokeStyle = g;
      c.lineWidth = 12 - band * 3;
      c.shadowColor = '#e8e2ff';
      c.shadowBlur = 14;
      c.beginPath();
      c.ellipse(
        0,
        edge * 3,
        s * (0.53 - band * 0.021),
        s * (0.074 - band * 0.012),
        0,
        edge < 0 ? Math.PI : 0,
        edge < 0 ? Math.PI * 2 : Math.PI,
      );
      c.stroke();
    }
    c.restore();
  }
  for (const [width, blur, a] of [
    [9, 24, 0.13],
    [3, 9, 0.38],
    [1.5, 2, 0.62],
  ]) {
    c.globalAlpha = alpha * a;
    c.strokeStyle = hue;
    c.shadowColor = '#e7d9ff';
    c.shadowBlur = blur;
    c.lineWidth = width;
    c.beginPath();
    c.roundRect(gx - 9, gy - 9, s + 18, s + 18, 14);
    c.stroke();
  }
  for (let i = 0; i < density; i++) {
    const side = i % 4,
      u = (noise(i + 9) + t * 0.016) % 1,
      offset = 16 + Math.sin(t * 1.9 + i) * 8;
    const x = side === 0 ? gx - offset : side === 1 ? gx + s + offset : gx + u * s,
      y = side === 2 ? gy - offset : side === 3 ? gy + s + offset : gy + u * s;
    const size = 4 + noise(i + 3) * 6,
      flap = 0.38 + 0.62 * Math.abs(Math.sin(t * 12 + i * 2)),
      color = colors[i % colors.length]!;
    c.save();
    c.globalAlpha = alpha * (0.64 + noise(i + 31) * 0.34);
    c.translate(x, y);
    c.rotate(Math.sin(i + t) * 0.45);
    c.scale(flap, 1);
    c.fillStyle = color;
    c.shadowColor = color;
    c.shadowBlur = 8;
    for (const dir of [-1, 1]) {
      c.beginPath();
      c.moveTo(0, 0);
      c.bezierCurveTo(
        dir * size * 1.5,
        -size * 1.7,
        dir * size * 1.9,
        size * 0.15,
        dir * size * 0.35,
        size * 0.2,
      );
      c.bezierCurveTo(dir * size * 1.3, size * 1.8, dir * size * 0.1, size * 1.25, 0, 0);
      c.fill();
    }
    c.fillStyle = '#fffef8';
    c.shadowBlur = 3;
    c.fillRect(-0.7, -size * 0.38, 1.4, size * 0.8);
    c.restore();
  }
  c.restore();
}
