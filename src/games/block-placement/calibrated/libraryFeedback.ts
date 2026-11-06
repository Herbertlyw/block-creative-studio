// Derived production module; supplied reference files remain unchanged.
import { boardSide } from './boardGeometry';
import { drawCraftCelebration } from './craftedCelebration';
import type { ClearEffectLibrary } from '../../../nativeReference/games/block-placement/presentation/effectLibrary';
import type { ClearStep } from './libraryClear';
import {
  sat,
  smooth,
  noise,
  envelope,
  glow,
  star,
  jewel,
  lightPath,
  butterfly,
  ribbon,
  palette,
  type C,
} from './libraryDrawing';
export function rimPoint(board: readonly number[], u: number): [number, number] {
  const [x, y, p] = board as [number, number, number],
    s = p * boardSide(board) + 20,
    q = (((u % 1) + 1) % 1) * 4;
  return q < 1
    ? [x - 10 + q * s, y - 10]
    : q < 2
      ? [x - 10 + s, y - 10 + (q - 1) * s]
      : q < 3
        ? [x - 10 + s * (3 - q), y - 10 + s]
        : [x - 10, y - 10 + s * (4 - q)];
}
export function drawLibraryRim(
  c: C,
  board: readonly number[],
  age: number,
  style: string,
  seed: number,
) {
  if (style === 'off' || age < 0 || age > 1) return;
  const [x, y, p] = board as [number, number, number],
    s = p * boardSide(board),
    a = envelope(age, 1);
  c.save();
  c.globalCompositeOperation = 'screen';
  if (style === 'butterfly-garden') {
    c.globalAlpha = a * 0.7;
    c.lineWidth = 3;
    c.strokeStyle = '#ffc0ed';
    c.shadowColor = '#ff9de8';
    c.shadowBlur = 22;
    c.beginPath();
    c.roundRect(x - 10, y - 10, s + 20, s + 20, 12);
    c.stroke();
    c.shadowBlur = 0;
    c.globalAlpha = 1;
    for (let i = 0; i < 32; i++) {
      const [px, py] = rimPoint(board, i / 32);
      const dx = px - x - s / 2,
        dy = py - y - s / 2,
        r = Math.hypot(dx, dy);
      butterfly(
        c,
        px + (dx / r) * age * 45,
        py + (dy / r) * age * 45,
        6 + noise(seed, i) * 7,
        age * 8 + i,
        a,
      );
    }
  } else if (style === 'corner-nova') {
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = rimPoint(board, i / 4);
      star(c, cx, cy, 24 + 30 * Math.exp(-age * 7), '#fff4d0', a, age * 0.4);
      glow(c, cx, cy, 120, '#f4c7ff', a * 0.5);
      for (const sign of [-1, 1]) {
        const pts = Array.from({ length: 18 }, (_, j) =>
          rimPoint(board, i / 4 + ((sign * j) / 17) * 0.1 * sat(age / 0.2)),
        );
        lightPath(c, pts, '#dfb6ff', a, 4);
      }
    }
  } else if (style === 'cyan-lightning') {
    for (let side = 0; side < 4; side++) {
      const pts = Array.from({ length: 41 }, (_, j) => {
        const [px, py] = rimPoint(board, (side + j / 40) / 4),
          d =
            j === 0 || j === 40
              ? 0
              : (noise(seed + Math.floor(age * 20), j + side * 83) - 0.5) * 17;
        return side % 2 ? [px + d, py] : [px, py + d];
      });
      lightPath(c, pts, side % 2 ? '#ba97ff' : '#81ecff', a, 3.5);
    }
  } else {
    const count = style === 'gold-comet' ? 2 : 4;
    // Dim base keeps the rectangular perimeter readable while heads race around it.
    c.globalAlpha = a * 0.28;
    c.strokeStyle = style === 'gold-comet' ? '#f8dda2' : '#c8b1ff';
    c.lineWidth = 2;
    c.beginPath();
    c.roundRect(x - 10, y - 10, s + 20, s + 20, 12);
    c.stroke();
    c.globalAlpha = 1;
    for (let i = 0; i < count; i++) {
      const head = i / count + age * (style === 'aurora-circuit' ? 0.35 : 0.5),
        col =
          style === 'gold-comet'
            ? '#ffe5a9'
            : style === 'prism-racetrack'
              ? palette[i]!
              : i % 2
                ? '#c69aff'
                : '#87e9ff';
      for (let j = 0; j < 18; j++) {
        const q = head - j * 0.008;
        lightPath(
          c,
          [rimPoint(board, q - 0.008), rimPoint(board, q)],
          col,
          a * (1 - j / 18) ** 1.5,
          style === 'prism-racetrack' ? 5 : style === 'gold-comet' ? 1.3 : 3,
        );
      }
      const [px, py] = rimPoint(board, head);
      star(c, px, py, style === 'gold-comet' ? 9 : 16, '#fff8ee', a);
      glow(
        c,
        px,
        py,
        style === 'gold-comet' ? 28 : 65,
        col,
        a * (style === 'gold-comet' ? 0.18 : 0.4),
      );
    }
  }
  c.restore();
}
export function drawLibraryCelebration(
  c: C,
  board: readonly number[],
  age: number,
  style: string,
  seed: number,
  perfect: boolean,
) {
  if (style === 'crafted-confetti') {
    drawCraftCelebration(c, board, age, seed);
    return;
  }
  if (style === 'off' || age < 0 || age > 1) return;
  const [x, y, p] = board as [number, number, number],
    s = p * boardSide(board),
    cx = x + s / 2,
    cy = y + p * 2.65 * (boardSide(board) / 8),
    a = envelope(age, 1),
    power = perfect ? 1.25 : 1;
  c.save();
  if (style === 'orbital-stars') {
    c.globalCompositeOperation = 'screen';
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2 + age * 1.4,
        r = 78 + 18 * smooth(age / 0.2);
      star(
        c,
        cx + 215 + Math.cos(angle) * r,
        cy + Math.sin(angle) * r * 0.8,
        (i % 3 ? 5 : 11) * power,
        '#ffe6ae',
        a * (0.55 + 0.45 * Math.sin(age * 9 + i) ** 2),
        angle,
      );
    }
  } else if (style === 'radial-rays') {
    c.globalCompositeOperation = 'screen';
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2,
        inner = 80 + age * 100,
        outer = 190 + sat(age / 0.2) * 180;
      const grad = c.createLinearGradient(
        cx + Math.cos(angle) * inner,
        cy + Math.sin(angle) * inner,
        cx + Math.cos(angle) * outer,
        cy + Math.sin(angle) * outer,
      );
      grad.addColorStop(0, '#fff4d900');
      grad.addColorStop(0.3, i % 2 ? '#ead3ffb0' : '#ffe2b780');
      grad.addColorStop(1, '#eedcff00');
      c.strokeStyle = grad;
      c.lineWidth = i % 3 ? 3 : 7;
      c.globalAlpha = a * 0.65;
      c.beginPath();
      c.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
      c.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
      c.stroke();
    }
  } else if (style === 'chromatic-fireworks') {
    c.globalCompositeOperation = 'screen';
    for (let k = 0; k < 3; k++) {
      const q = age - 0.04 - k * 0.085;
      if (q <= 0) continue;
      const ox = cx + (k - 1) * 270,
        oy = cy - 100 + (k % 2) * 170,
        aa = envelope(q, 0.75);
      glow(c, ox, oy, 135, palette[k + 1]!, aa * Math.exp(-q * 8) * 0.5);
      for (let i = 0; i < 22; i++) {
        const angle = (i / 22) * Math.PI * 2,
          d = (1 - Math.exp(-q * 5)) * (90 + noise(seed + k, i) * 110),
          xx = ox + Math.cos(angle) * d,
          yy = oy + Math.sin(angle) * d + q * q * 60;
        lightPath(
          c,
          [
            [ox + Math.cos(angle) * d * 0.7, oy + Math.sin(angle) * d * 0.7 + q * q * 40],
            [xx, yy],
          ],
          palette[(i + k) % 6]!,
          aa,
          2,
        );
        star(c, xx, yy, 4 + noise(seed, i) * 5, '#fff0d9', aa);
      }
    }
  } else if (style === 'jewel-corona') {
    for (let i = 0; i < 22; i++) {
      const angle = Math.PI + (i / 21) * Math.PI,
        r = 130 + smooth(age / 0.35) * 170,
        xx = cx + Math.cos(angle) * r * 1.35,
        yy = cy + 65 + Math.sin(angle) * r + age * age * 100;
      const sz = 20 + noise(seed, i) * 25;
      jewel(c, xx, yy, sz, i + age * 2, a, palette[i % 6]!, 0.65);
      star(c, xx - sz * 0.15, yy - sz * 0.25, sz * 0.23, '#fff8da', a);
    }
  } else {
    const paper = style === 'confetti-fountain',
      total = paper ? 54 : 20;
    for (let i = 0; i < total; i++) {
      const n = noise(seed, i),
        m = noise(seed, i + 61),
        q = Math.max(0, age - n * 0.09),
        side = i % 2,
        sign = side ? -1 : 1;
      const xx = (side ? x + s - 20 : x + 20) + sign * q * (180 + n * 650),
        yy = y + s * 0.7 - q * (550 + m * 450) + q * q * 430;
      ribbon(
        c,
        xx,
        yy,
        (paper ? 15 : 19) + m * (paper ? 15 : 20),
        i + q * (4 + n * 7),
        (paper ? palette : ['#f7d995', '#e8bb7d', '#d9aeec'])[i % (paper ? 6 : 3)]!,
        envelope(q, 0.9),
        paper,
      );
    }
  }
  c.restore();
}
