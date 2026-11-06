// Derived production module; supplied reference files remain unchanged.
// Reuses the premium-block-fx vocabulary: layered bloom, faceted jewels and folded ribbons.
// Geometry is now supplied by the calibrated board rather than the old fixed layout.
export type C = CanvasRenderingContext2D;
export const sat = (v: number) => Math.max(0, Math.min(1, v));
export const smooth = (v: number) => {
  v = sat(v);
  return v * v * (3 - 2 * v);
};
export const noise = (a: number, b = 0) => {
  let x = (a | 0) ^ Math.imul(b + 1, 0x9e3779b1);
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};
export const palette = ['#ffcf66', '#ff8ebe', '#be98ff', '#75e6ff', '#a9efd4', '#ffb37f'];
export const envelope = (age: number, life = 0.85) =>
  smooth(age / 0.045) * (1 - smooth((age - life * 0.4) / (life * 0.6)));
export function polygon(c: C, pts: number[][]) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x!, y!) : c.moveTo(x!, y!)));
  c.closePath();
}
export function glow(
  c: C,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
  sx = 1,
  sy = 1,
) {
  if (alpha <= 0 || r <= 0) return;
  c.save();
  c.translate(x, y);
  c.scale(sx, sy);
  c.globalAlpha *= alpha;
  const g = c.createRadialGradient(0, 0, 0, 0, 0, r);
  g.addColorStop(0, color);
  g.addColorStop(0.22, color + '80');
  g.addColorStop(0.6, color + '20');
  g.addColorStop(1, color + '00');
  c.fillStyle = g;
  c.fillRect(-r, -r, r * 2, r * 2);
  c.restore();
}
export function star(
  c: C,
  x: number,
  y: number,
  size: number,
  color: string,
  alpha = 1,
  rotation = 0,
) {
  if (size <= 0 || alpha <= 0) return;
  c.save();
  c.translate(x, y);
  c.rotate(rotation);
  c.globalAlpha *= alpha;
  glow(c, 0, 0, size * 3, color, 0.3);
  polygon(c, [
    [0, -size],
    [size * 0.18, -size * 0.18],
    [size, 0],
    [size * 0.18, size * 0.18],
    [0, size],
    [-size * 0.18, size * 0.18],
    [-size, 0],
    [-size * 0.18, -size * 0.18],
  ]);
  c.fillStyle = color;
  c.fill();
  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(0, 0, size * 0.12, 0, Math.PI * 2);
  c.fill();
  c.restore();
}
export function lightPath(c: C, pts: number[][], color: string, alpha: number, width = 3) {
  if (alpha <= 0) return;
  c.save();
  c.globalCompositeOperation = 'screen';
  c.lineCap = 'round';
  c.lineJoin = 'round';
  for (const [w, a, col] of [
    [width * 7, 0.1, color],
    [width * 3, 0.3, color],
    [width, 0.8, color],
    [Math.max(0.8, width * 0.25), 0.9, '#ffffff'],
  ] as const) {
    c.globalAlpha = alpha * a;
    c.strokeStyle = col;
    c.lineWidth = w;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x!, y!) : c.moveTo(x!, y!)));
    c.stroke();
  }
  c.restore();
}
/** Thin refractive facets: transparent body, darker turned faces, selective highlights. */
export function jewel(
  c: C,
  x: number,
  y: number,
  size: number,
  angle: number,
  alpha: number,
  color = '#bba0f4',
  aspect = 1,
) {
  if (size < 0.1 || alpha <= 0) return;
  c.save();
  c.translate(x, y);
  c.rotate(angle);
  c.scale(aspect, 1);
  c.globalAlpha *= alpha;
  const pts = [
    [-0.48, -0.32],
    [0.06, -0.57],
    [0.5, -0.13],
    [0.29, 0.49],
    [-0.36, 0.32],
  ].map((p) => p.map((v) => v * size));
  polygon(c, pts);
  const body = c.createLinearGradient(-size * 0.4, -size * 0.4, size * 0.5, size * 0.5);
  body.addColorStop(0, '#f5efff9a');
  body.addColorStop(0.24, color + '95');
  body.addColorStop(0.49, color + '25');
  body.addColorStop(0.53, '#ffffff9a');
  body.addColorStop(0.59, color + '40');
  body.addColorStop(1, '#39265890');
  c.fillStyle = body;
  c.fill();
  const center = [size * 0.04, -size * 0.03];
  for (let j = 0; j < 5; j++) {
    polygon(c, [pts[j]!, pts[(j + 1) % 5]!, center]);
    c.fillStyle = ['#ffffff38', '#ffffff0b', '#24103930', '#48376d20', '#ffffff45'][j]!;
    c.fill();
  }
  polygon(c, pts);
  c.strokeStyle = color + '9a';
  c.lineWidth = 0.7;
  c.stroke();
  c.beginPath();
  c.moveTo(...(pts[4] as [number, number]));
  c.lineTo(...(pts[0] as [number, number]));
  c.lineTo(...(pts[1] as [number, number]));
  c.strokeStyle = '#fff9ffe8';
  c.lineWidth = 1.3;
  c.stroke();
  c.beginPath();
  c.moveTo(...(pts[1] as [number, number]));
  c.lineTo(...(center as [number, number]));
  c.strokeStyle = '#ffffff70';
  c.lineWidth = 0.6;
  c.stroke();
  c.restore();
}
export function ribbon(
  c: C,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: string,
  alpha: number,
  paper = false,
) {
  c.save();
  c.translate(x, y);
  c.rotate(angle * 0.5);
  c.scale(0.15 + 0.85 * Math.abs(Math.cos(angle)), 1);
  c.globalAlpha *= alpha;
  const g = c.createLinearGradient(-size, 0, size, 0);
  g.addColorStop(0, '#563760');
  g.addColorStop(0.18, color);
  g.addColorStop(0.43, color);
  g.addColorStop(0.49, '#fff5e8');
  g.addColorStop(0.55, color);
  g.addColorStop(0.85, color);
  g.addColorStop(1, '#56405f');
  c.fillStyle = g;
  if (paper) {
    polygon(c, [
      [-size * 0.6, -size * 0.4],
      [size * 0.5, -size * 0.35],
      [size * 0.5, size * 0.4],
      [-size * 0.5, size * 0.4],
    ]);
    c.fill();
    c.beginPath();
    c.moveTo(-size * 0.5, -size * 0.34);
    c.lineTo(size * 0.42, -size * 0.29);
    c.strokeStyle = '#ffffff75';
    c.lineWidth = 0.7;
    c.stroke();
  } else {
    c.beginPath();
    c.moveTo(-size * 0.22, -size * 2);
    c.bezierCurveTo(size * 1.15, -size, -size * 1.2, size, size * 0.1, size * 2);
    c.lineTo(size * 0.32, size * 2);
    c.bezierCurveTo(-size * 0.85, size, size * 1.5, -size, size * 0.12, -size * 2);
    c.closePath();
    c.fill();
    c.strokeStyle = '#ffffff30';
    c.lineWidth = 0.6;
    c.stroke();
  }
  c.restore();
}
export function butterfly(c: C, x: number, y: number, size: number, phase: number, alpha: number) {
  c.save();
  c.translate(x, y);
  c.rotate(Math.sin(phase) * 0.35);
  c.scale(0.3 + 0.7 * Math.abs(Math.sin(phase * 3)), 1);
  c.globalAlpha *= alpha;
  c.fillStyle = '#ffe1fa';
  c.shadowColor = '#f69bdc';
  c.shadowBlur = 12;
  for (const sign of [-1, 1]) {
    c.beginPath();
    c.moveTo(0, 0);
    c.bezierCurveTo(
      sign * size * 1.5,
      -size * 1.7,
      sign * size * 1.8,
      size * 0.1,
      sign * size * 0.3,
      size * 0.2,
    );
    c.bezierCurveTo(sign * size, size * 1.8, sign * size * 0.1, size, 0, 0);
    c.fill();
  }
  c.restore();
}
