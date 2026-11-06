// Derived production module; supplied reference files remain unchanged.
import { boardSide } from './boardGeometry';
import { noise, smooth, glow, star, type C } from './libraryDrawing';
const colors = ['#ffcd55', '#ec8cca', '#69d2e6', '#a893ed', '#ee9478', '#92d5af'];
/** Paper and curled streamers: varied emission times, perspective flips and bounded ballistic arcs. */
export function drawCraftCelebration(c: C, board: readonly number[], age: number, seed: number) {
  if (age < 0 || age > 1) return;
  const [x, y, p] = board as [number, number, number],
    s = p * boardSide(board);
  for (let i = 0; i < 36; i++) {
    const n = noise(seed, i),
      m = noise(seed, i + 79),
      q = age - noise(seed, i + 33) * 0.11;
    if (q <= 0) continue;
    const sign = i % 2 ? 1 : -1,
      ox = x + s / 2 + sign * s * 0.46,
      oy = y + s * 0.53 + (m - 0.5) * p * 0.9;
    const xx = ox - sign * (120 + n * 620) * q,
      yy = oy - (270 + m * 480) * q + q * q * 420,
      alpha = smooth(q / 0.035) * (1 - smooth((q - 0.5) / 0.39));
    const size = 12 + m * 20,
      col = colors[i % 6]!;
    c.save();
    c.translate(xx, yy);
    c.rotate(n * 6 + q * (m - 0.5) * 5);
    c.globalAlpha = alpha;
    if (i % 7 === 0) {
      const length = 45 + n * 45;
      c.scale(Math.max(0.25, Math.abs(Math.cos(q * 3 + n * 5))), 1);
      const path = () => {
        c.beginPath();
        c.moveTo(-length / 2, 5);
        c.bezierCurveTo(-length * 0.38, -22, -length * 0.2, -22, -length * 0.1, 0);
        c.bezierCurveTo(length * 0.05, 23, length * 0.2, 23, length * 0.29, 0);
        c.bezierCurveTo(length * 0.34, -12, length * 0.4, -12, length * 0.5, -4);
      };
      path();
      c.strokeStyle = col;
      c.lineWidth = 4 + m * 3;
      c.lineCap = 'round';
      c.stroke();
      c.translate(0, -0.65);
      path();
      c.strokeStyle = '#fff5e875';
      c.lineWidth = 0.8;
      c.stroke();
    } else {
      const flip = Math.cos(q * (4 + n * 7) + n * 5),
        w = size * Math.max(0.12, Math.abs(flip)),
        h = size * (0.55 + n * 0.35);
      c.beginPath();
      c.moveTo(-w / 2, -h / 2);
      c.lineTo(w * 0.45, -h * 0.45);
      c.lineTo(w / 2, h * 0.5);
      c.lineTo(-w * 0.45, h * 0.42);
      c.closePath();
      const g = c.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
      g.addColorStop(0, flip > 0 ? '#fff3d9' : col);
      g.addColorStop(0.13, col);
      g.addColorStop(0.8, col);
      g.addColorStop(1, flip > 0 ? '#9b749b' : '#eee0ec');
      c.fillStyle = g;
      c.fill();
    }
    c.restore();
  }
  for (let i = 0; i < 4; i++) {
    const q = age - 0.1 - i * 0.06;
    if (q < 0 || q > 0.5) continue;
    const xx = x + s * 0.63 + Math.cos(i * 1.8) * p * 1.05,
      yy = y + p * 2.65 + Math.sin(i * 1.8) * p * 0.78,
      a = Math.sin((q / 0.5) * Math.PI);
    glow(c, xx, yy, 33, '#ffdb76', a * 0.35);
    star(c, xx, yy, 6 + 3 * a, '#fff2bd', a);
  }
}
