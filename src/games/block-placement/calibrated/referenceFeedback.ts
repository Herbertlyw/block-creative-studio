// Derived production module; supplied reference files remain unchanged.
import { boardSide, type CalibratedBoardGeometry } from './boardGeometry';
import type { ReferenceCalibration } from '../../../nativeReference/games/block-placement/presentation/referenceCalibration';
const sat = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  v = sat(v);
  return v * v * (3 - 2 * v);
};
const noise = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
type C = CanvasRenderingContext2D;

export function referenceHudAt(spec: ReferenceCalibration, t: number) {
  const track = spec.scoreTrack;
  let score = track[0]?.[1] ?? 0,
    pulse = 0;
  for (let i = 1; i < track.length; i++) {
    const prev = track[i - 1]!,
      next = track[i]!;
    if (next[1] !== prev[1] && spec.effects?.scoreHud?.enabled) {
      const age = t - next[0];
      if (age >= 0 && age < 0.32) pulse = Math.max(pulse, Math.sin((Math.PI * age) / 0.32));
    }
    if (t >= next[0]) score = next[1];
    else {
      if (
        spec.effects?.scoreHud?.enabled &&
        spec.effects.scoreHud.interpolate &&
        next[0] - prev[0] <= 0.35
      ) {
        score = Math.round(
          prev[1] + (next[1] - prev[1]) * sat((t - prev[0]) / (next[0] - prev[0])),
        );
      }
      break;
    }
  }
  return { score, pulse: spec.effects?.scoreHud?.diamondPulse ? pulse : 0 };
}

export function comboPose(age: number, pink = false) {
  const end = pink ? 0.64 : 0.94;
  const pop = (a: number) => {
    const p = sat(a / 0.16);
    return 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;
  };
  return {
    wordScale: Math.max(0, pop(age - 0.025)) * (1 - smooth((age - (end - 0.22)) / 0.14)),
    digitScale: Math.max(0, pop(age - 0.085)) * (1 - smooth((age - (end - 0.12)) / 0.14)),
    wordAlpha: smooth((age - 0.025) / 0.04) * (1 - smooth((age - (end - 0.22)) / 0.14)),
    digitAlpha: smooth((age - 0.085) / 0.045) * (1 - smooth((age - (end - 0.12)) / 0.14)),
  };
}
function glow(c: C, x: number, y: number, r: number, color: string, a: number) {
  if (a <= 0) return;
  c.save();
  c.globalAlpha *= a;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(0.32, color + '99');
  g.addColorStop(1, color + '00');
  c.fillStyle = g;
  c.fillRect(x - r, y - r, 2 * r, 2 * r);
  c.restore();
}
function star(c: C, x: number, y: number, r: number, a: number, color = '#fff5cf') {
  c.save();
  c.globalAlpha *= a;
  c.translate(x, y);
  c.fillStyle = color;
  c.shadowColor = color;
  c.shadowBlur = r * 1.5;
  c.beginPath();
  c.moveTo(0, -r);
  c.lineTo(r * 0.22, -r * 0.22);
  c.lineTo(r, 0);
  c.lineTo(r * 0.22, r * 0.22);
  c.lineTo(0, r);
  c.lineTo(-r * 0.22, r * 0.22);
  c.lineTo(-r, 0);
  c.lineTo(-r * 0.22, -r * 0.22);
  c.closePath();
  c.fill();
  c.restore();
}
export function drawHudPulse(c: C, theme: string, pulse: number) {
  if (pulse <= 0 || theme === 'pink') return;
  const y = theme === 'purple' ? 235 : 211;
  c.save();
  c.globalCompositeOperation = 'screen';
  glow(c, 540, y, 155, '#bdfaff', pulse * 0.32);
  c.translate(540, y);
  c.rotate(Math.PI / 4);
  c.globalAlpha = pulse * 0.5;
  c.fillStyle = '#eaffff';
  c.shadowColor = '#85f4ff';
  c.shadowBlur = 25;
  c.fillRect(-63, -63, 126, 126);
  c.restore();
}
export function drawRackGlow(
  c: C,
  x: number,
  y: number,
  w: number,
  h: number,
  t: number,
  slot: number,
  intensity: number,
) {
  c.save();
  c.globalCompositeOperation = 'screen';
  const breath = 0.5 + 0.5 * Math.sin(t * 2.8 + slot * 1.8);
  c.save();
  c.translate(x + w / 2, y + h * 0.55);
  c.scale(1, 0.65);
  glow(c, 0, 0, Math.max(w, h) * 0.85, '#79ecff', intensity * (0.15 + breath * 0.23));
  c.restore();
  for (let j = 0; j < 5; j++) {
    const phase = (t * 0.33 + j * 0.2 + slot * 0.13) % 1;
    const xx = x - 12 + noise(j + slot * 11) * (w + 24),
      yy = y + h + 10 - phase * (h + 40);
    star(
      c,
      xx,
      yy,
      2.5 + noise(j + 2) * 3,
      Math.sin(phase * Math.PI) * intensity * 0.65,
      '#d3fbff',
    );
  }
  c.restore();
}
export function drawButterflyRim(
  c: C,
  board: CalibratedBoardGeometry,
  age: number,
  t: number,
  density: number,
) {
  const [gx, gy, p] = board,
    s = p * boardSide(board),
    a = smooth(age / 0.1) * (1 - smooth((age - 0.68) / 0.4));
  if (a <= 0) return;
  c.save();
  c.globalAlpha = a;
  c.shadowColor = '#dcc5ff';
  c.shadowBlur = 24;
  c.strokeStyle = '#e8d0ff';
  c.lineWidth = 3;
  c.beginPath();
  c.roundRect(gx - 10, gy - 10, s + 20, s + 20, 14);
  c.stroke();
  c.globalCompositeOperation = 'screen';
  for (const y of [gy - 10, gy + s + 10]) {
    c.save();
    c.translate(gx + s / 2, y);
    c.scale(1, 0.13);
    glow(c, 0, 0, s * 0.57, '#ecc5ff', 0.3 * a);
    c.restore();
  }
  for (let i = 0; i < density; i++) {
    const side = i % 4,
      u = (noise(i + 9) + t * 0.014) % 1,
      offset = 13 + Math.sin(t * 2 + i) * 10;
    const x = side === 0 ? gx - offset : side === 1 ? gx + s + offset : gx + u * s,
      y = side === 2 ? gy - offset : side === 3 ? gy + s + offset : gy + u * s;
    c.save();
    c.translate(x, y);
    c.rotate(Math.sin(i + t) * 0.45);
    const size = 4 + noise(i + 3) * 6,
      flap = 0.35 + 0.65 * Math.abs(Math.sin(t * 13 + i * 2));
    c.scale(flap, 1);
    c.fillStyle = i % 3 ? '#fff6ff' : '#aeffff';
    c.shadowBlur = 12;
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
    c.restore();
  }
  c.restore();
}
function thumb(
  c: C,
  x: number,
  y: number,
  size: number,
  color: string,
  angle: number,
  alpha: number,
) {
  c.save();
  c.globalAlpha *= alpha;
  c.translate(x, y);
  c.rotate(angle);
  c.scale(size / 64, size / 64);
  c.shadowColor = '#123b6555';
  c.shadowBlur = 4;
  c.shadowOffsetY = 3;
  c.strokeStyle = color === '#48bdfa' ? '#087fc4' : '#b84f74';
  c.lineWidth = 3;
  c.lineJoin = 'round';
  const g = c.createLinearGradient(-12, -40, 20, 25);
  g.addColorStop(0, color === '#48bdfa' ? '#91e7ff' : '#ffd1db');
  g.addColorStop(0.5, color);
  g.addColorStop(1, color === '#48bdfa' ? '#239de7' : '#e27f9c');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-10, 22);
  c.lineTo(16, 22);
  c.quadraticCurveTo(23, 22, 24, 15);
  c.lineTo(31, -10);
  c.quadraticCurveTo(32, -18, 23, -18);
  c.lineTo(8, -18);
  c.lineTo(12, -31);
  c.quadraticCurveTo(12, -45, 3, -44);
  c.quadraticCurveTo(-3, -44, -4, -35);
  c.lineTo(-8, -23);
  c.lineTo(-15, -12);
  c.lineTo(-15, 19);
  c.closePath();
  c.fill();
  c.stroke();
  c.beginPath();
  c.roundRect(-28, -12, 11, 35, 3);
  c.fill();
  c.stroke();
  c.shadowBlur = 0;
  c.strokeStyle = '#ffffff66';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(-23, -7);
  c.lineTo(-23, 16);
  c.moveTo(10, -12);
  c.lineTo(25, -12);
  c.stroke();
  c.restore();
}
export function drawLikes(
  c: C,
  spec: ReferenceCalibration,
  step: any,
  age: number,
  style: string,
  index: number,
) {
  const [gx, gy, p] = spec.board,
    scale = spec.effects!.likes!.scale;
  const q = sat((age - 0.12) / 0.8),
    alpha = smooth((age - 0.12) / 0.08) * (1 - smooth((age - 0.68) / 0.24));
  if (!alpha) return;
  if (style === 'blue-badge') {
    thumb(
      c,
      gx + (p * step.before.board.cells[0].length) / 2,
      gy + p * 4.5 * (step.before.board.cells.length / 8) - q * 60,
      116 * scale,
      '#48bdfa',
      Math.sin(q * 6) * 0.08,
      alpha,
    );
    return;
  }
  const cells = step.clear.cells.filter(
    (_: unknown, i: number) => i % Math.max(1, Math.ceil(step.clear.cells.length / 9)) === 0,
  );
  for (const [i, cell] of cells.entries())
    thumb(
      c,
      gx + (cell.col + 0.5) * p + Math.sin(index + i) * 14,
      gy + (cell.row + 0.5) * p - q * 75,
      46 * scale,
      '#ee9ab6',
      -0.16 + noise(i + index) * 0.3,
      alpha,
    );
}
export function drawPerfectCelebration(
  c: C,
  board: CalibratedBoardGeometry,
  age: number,
  seed: number,
  density: number,
) {
  const [gx, gy, p] = board,
    alpha = smooth(age / 0.1) * (1 - smooth((age - 0.65) / 0.45));
  if (!alpha) return;
  const cols = ['#ffd354', '#ff7f76', '#b975ee', '#60dce8'];
  for (let i = 0; i < density; i++) {
    const n = noise(i + seed * 17),
      m = noise(i * 7 + seed),
      side = i % 2,
      sign = side ? -1 : 1;
    const x = gx + noise(i + seed * 37) * p * boardSide(board) + sign * age * (45 + n * 190),
      y =
        gy +
        p * (3.5 + noise(i * 3 + seed) * 2.8) * (boardSide(board) / 8) -
        age * (150 + m * 350) +
        age * age * 240;
    c.save();
    c.globalAlpha = alpha;
    c.translate(x, y);
    c.rotate(i + age * (3 + n * 6));
    c.fillStyle = cols[i % 4]!;
    if (i % 6 === 0) {
      c.strokeStyle = cols[i % 4]!;
      c.lineWidth = 6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(-18, -26);
      c.bezierCurveTo(26, -8, -25, 8, 18, 28);
      c.stroke();
    } else {
      c.scale(0.3 + 0.7 * Math.abs(Math.cos(age * 7 + i)), 1);
      c.fillRect(-8, -11, 16 + n * 10, 22 + n * 7);
    }
    c.restore();
  }
  for (let i = 0; i < 9; i++)
    star(
      c,
      gx + (1 + noise(i + seed) * 6) * p * (boardSide(board) / 8),
      gy + (2 + noise(i + seed + 7) * 4) * p * (boardSide(board) / 8),
      8 + noise(i) * 11,
      alpha * (0.45 + 0.55 * Math.sin(age * 10 + i) ** 2),
    );
}
export function drawLayeredCombo(
  c: C,
  theme: string,
  combo: number,
  age: number,
  x: number,
  y: number,
) {
  const pose = comboPose(age, theme === 'pink'),
    digits = String(combo || 1),
    edge = theme === 'purple' ? '#a73fac' : '#1558a7';
  c.save();
  c.translate(x, y);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineJoin = 'round';
  c.font = 'italic 900 122px "Arial Rounded MT Bold",Arial,sans-serif';
  const ww = c.measureText('Combo').width;
  c.font = 'italic 900 168px "Arial Rounded MT Bold",Arial,sans-serif';
  const nw = c.measureText(digits).width;
  const width = ww + nw + 30,
    wx = -width / 2 + ww / 2,
    nx = width / 2 - nw / 2;
  const paint = (
    label: string,
    xx: number,
    size: number,
    scale: number,
    alpha: number,
    isDigit: boolean,
  ) => {
    if (alpha <= 0 || scale <= 0) return;
    c.save();
    c.translate(xx, 0);
    c.scale(scale, scale);
    c.globalAlpha = alpha;
    if (isDigit && theme !== 'pink') {
      glow(c, 0, 0, 130, '#ffe97a', 0.38);
      for (let j = 0; j < 7; j++) {
        const a = j * 2.4 + age * 2;
        star(c, Math.cos(a) * 88, Math.sin(a) * 78, 4 + Math.sin(age * 12 + j) ** 2 * 4, 0.8);
      }
    }
    c.font = `italic 900 ${size}px "Arial Rounded MT Bold",Arial,sans-serif`;
    c.shadowColor = '#26223e77';
    c.shadowBlur = 6;
    c.shadowOffsetY = 6;
    c.lineWidth = 17;
    c.strokeStyle = edge;
    c.strokeText(label, 0, 0);
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.lineWidth = 6;
    c.strokeStyle = theme === 'purple' ? '#f39de1' : '#84c2ff';
    c.strokeText(label, 0, 0);
    const g = c.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    g.addColorStop(0, isDigit ? '#fff9a3' : '#ffffff');
    g.addColorStop(
      1,
      isDigit
        ? theme === 'purple'
          ? '#ffc6df'
          : '#ffd747'
        : theme === 'purple'
          ? '#ffe8f6'
          : '#c7f4ff',
    );
    c.fillStyle = g;
    c.fillText(label, 0, 0);
    c.restore();
  };
  paint('Combo', wx, 122, pose.wordScale, pose.wordAlpha, false);
  paint(digits, nx, 168, pose.digitScale, pose.digitAlpha, true);
  c.restore();
}
