// Derived production module; supplied reference files remain unchanged.
import { drawLuminousGranules } from './luminousGranules';
import { drawCubeBurst } from './cubeBurst';
import { drawShimmerSquares } from './shimmerSquares';
import { drawPrismFracture } from './prismFracture';
import { drawStoneSpray } from './stoneSpray';
import { drawLatticeStrip } from './latticeStrip';
import { drawFruitBurst } from './fruitBurst';
import { drawStoneBurst } from './stoneBurst';
import { drawSkinWave } from './skinWave';
import { drawIceClear } from './iceClear';
import { drawIceAvalanche } from './iceAvalanche';
import { drawNeonStrip } from './neonStrip';
import { drawJewelBurst } from './jewelBurst';
import { drawTumbleClear } from './tumbleClear';
import { drawPinkClear } from './pinkClear';
import { drawMaterialStrip } from './materialStrip';
import { drawPhotoStrip } from './photoStrip';
// Reference-specific phases: an intact line highlight precedes the breakup.
// These functions only draw; the native game replay still owns all board changes.
const sat = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  v = sat(v);
  return v * v * (3 - 2 * v);
};
const spectrum = [
  '#ee77df',
  '#9766f6',
  '#248ded',
  '#24d7e4',
  '#36df57',
  '#dbed37',
  '#ffd82c',
  '#ff853c',
];
const random = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export function polishedStripPhase(age: number) {
  return {
    height:
      age < 0.085 ? 1 - smooth(age / 0.085) * 0.86 : 0.14 + smooth((age - 0.085) / 0.12) * 0.42,
    alpha: age < 0 ? 0 : 1 - smooth((age - 0.22) / 0.4),
  };
}

export function drawReferenceClear(h: any, st: any, age: number, time: number, board: any[][]) {
  if (h.style === 'luminous-granules') {
    drawLuminousGranules(h, st, age, time, board);
    return;
  }
  if (h.style === 'cube-burst') {
    drawCubeBurst(h, st, age, time, board);
    return;
  }
  if (
    h.style === 'shimmer-squares' ||
    h.style === 'luminous-squares' ||
    h.style === 'luminous-bands'
  ) {
    drawShimmerSquares(h, st, age, time, board);
    return;
  }
  if (h.style === 'prism-fracture') {
    drawPrismFracture(h, st, age, time, board);
    return;
  }
  if (h.style === 'lattice-strip') {
    drawLatticeStrip(h, st, age, time, board);
    return;
  }
  if (h.style === 'fruit-burst') {
    drawFruitBurst(h, st, age, time, board);
    return;
  }
  if (h.style === 'stone-spray') {
    drawStoneSpray(h, st, age, time, board);
    return;
  }
  if (h.style === 'stone-burst') {
    drawStoneBurst(h, st, age, time, board);
    return;
  }
  if (h.style === 'photo-strip') {
    drawPhotoStrip(h, st, age, time, board);
    return;
  }
  if (['panel-flip', 'jelly-wave', 'rainbow-sweep'].includes(h.style)) {
    drawSkinWave(h, st, age, time, board);
    return;
  }
  if (h.style === 'neon-strip' || h.style === 'neon-motes') {
    drawNeonStrip(h, st, age, time, board);
    return;
  }
  if (h.style === 'ice-avalanche') {
    drawIceAvalanche(h, st, age, time, board);
    return;
  }
  if (h.style === 'material-strip') {
    drawMaterialStrip(h, st, age, time, board);
    return;
  }
  if (h.style === 'jewel-burst') {
    drawJewelBurst(h, st, age, time, board);
    return;
  }
  if (h.style === 'ice-shatter') {
    drawIceClear(h, st, age, time, board);
    return;
  }
  if (
    h.style === 'tile-tumble' ||
    h.style === 'rapid-tumble' ||
    h.style === 'confetti-tumble' ||
    h.style === 'reference-fall' ||
    h.style === 'column-rain'
  ) {
    drawTumbleClear(h, st, age, time, board);
    return;
  }
  if (h.theme === 'pink') {
    drawPinkClear(h, st, age, time, board);
    return;
  }
  const { ctx, gx, gy, pitch, theme, tile, glow } = h;
  const pink = theme === 'pink',
    grey = theme === 'grey',
    spectrumClear = grey && h.style !== 'spark-strip';
  const materialColor =
    st.piece.color === 'coral' ? '#f1aaa7' : st.piece.color === 'cyan' ? '#75c9eb' : '#c9e1ed';
  const lineColor = pink ? '#ff85cf' : grey ? materialColor : '#c7aaff';
  const colorAt = (r: number, c: number) => st.before.board.cells[r][c] ?? st.piece.color;
  const axes = [
    ...st.clear.rows.map((n: number) => ({ horizontal: true, n })),
    ...st.clear.cols.map((n: number) => ({ horizontal: false, n })),
  ];
  // Warm-up is a continuous line frame, not an unrelated outline on every cell.
  for (const { horizontal, n } of axes) {
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : n * pitch), gy + (horizontal ? n * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    const warm = age < 0 ? 1 : 1 - smooth(age / (grey ? 0.16 : 0.1));
    if (warm > 0 && h.layers?.preClear !== false) {
      const gradient = ctx.createLinearGradient(0, 0, pitch * board.length, 0);
      spectrum.forEach((color: string, i: number) =>
        gradient.addColorStop(i / 7, spectrumClear ? color : lineColor),
      );
      ctx.globalAlpha = warm;
      ctx.strokeStyle = gradient;
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 22;
      ctx.lineWidth = 6;
      ctx.strokeRect(1, 2, pitch * board.length - 2, pitch - 4);
      ctx.shadowBlur = 7;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#fff7fc';
      ctx.strokeRect(2, 3, pitch * board.length - 4, pitch - 6);
      ctx.globalAlpha = warm * 0.17;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, pitch * board.length, pitch);
    }
    // The purple reference contracts into a flat lilac strip, then square motes.
    if (!pink && !spectrumClear && age >= 0 && age < 0.62 && h.layers?.beam !== false) {
      const polished = h.polish && theme === 'purple';
      const phase = polishedStripPhase(age);
      const opacity = polished ? phase.alpha : 1 - smooth((age - 0.18) / 0.44);
      const height =
        pitch *
        (polished
          ? phase.height
          : age < 0.08
            ? 1 - smooth(age / 0.08) * 0.85
            : 0.15 + smooth((age - 0.08) / 0.09) * 0.7);
      ctx.globalAlpha = opacity * 0.2;
      ctx.fillStyle = grey ? materialColor : '#a786ff';
      ctx.shadowBlur = 17;
      ctx.shadowColor = lineColor;
      ctx.fillRect(0, (pitch - height) / 2, pitch * board.length, height);
      ctx.globalAlpha = opacity * 0.6;
      ctx.strokeStyle = grey ? materialColor : '#d9c0ff';
      ctx.lineWidth = 3;
      ctx.strokeRect(0, (pitch - height) / 2, pitch * board.length, height);
      if (polished) {
        ctx.globalCompositeOperation = 'screen';
        const g = ctx.createLinearGradient(0, (pitch - height) / 2, 0, (pitch + height) / 2);
        g.addColorStop(0, '#e9d1ff00');
        g.addColorStop(0.16, '#d9b6ff66');
        g.addColorStop(0.5, '#bda0ef33');
        g.addColorStop(0.84, '#d9b6ff66');
        g.addColorStop(1, '#e9d1ff00');
        ctx.fillStyle = g;
        ctx.globalAlpha = opacity;
        ctx.fillRect(0, (pitch - height) / 2, pitch * board.length, height);
        for (let j = 0; j < board.length * 2; j++) {
          const x = (j + 0.3) * pitch * 0.5,
            yy = pitch / 2 + Math.sin(j * 7 + age * 3) * height * 0.25,
            size = (4 + random(j + n) * 9) * (1 - smooth((age - 0.3) / 0.32));
          ctx.fillStyle = j % 3 ? '#e9d4ff' : '#fff4ff';
          ctx.globalAlpha = opacity * (0.3 + random(j + 3) * 0.5);
          ctx.fillRect(x - size / 2, yy - size / 2, size, size);
        }
      }
    }
    // Pink flashes have a brief white core; no long, persistent laser beam.
    if (pink && age >= 0 && age < 0.38 && h.layers?.beam !== false) {
      const a = (1 - smooth(age / 0.38)) * 0.8;
      ctx.globalAlpha = a;
      ctx.shadowColor = lineColor;
      ctx.shadowBlur = 22;
      ctx.fillStyle = '#ffe9fa';
      const gradient = ctx.createLinearGradient(0, 0, pitch * board.length, 0);
      gradient.addColorStop(0, 'transparent');
      gradient.addColorStop(0.4, '#fff3fa');
      gradient.addColorStop(0.6, '#fff3fa');
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, pitch * 0.45, pitch * board.length, pitch * 0.1);
    }
    ctx.restore();
  }
  if (age < 0) return;
  for (const [k, cell] of st.clear.cells.entries()) {
    const { row, col } = cell,
      x = gx + col * pitch,
      y = gy + row * pitch,
      cx = x + pitch / 2,
      cy = y + pitch / 2;
    // A subsequent legal placement must remain on top of the preceding clear.
    if (board[row][col] != null) continue;
    const axis = st.clear.rows.includes(row) ? col : row;
    const color = spectrumClear
      ? spectrum[axis]
      : grey
        ? materialColor
        : pink
          ? '#ed78ad'
          : '#b3a0f5';
    const material = colorAt(row, col);
    if (pink) {
      const split = smooth((age - 0.07) / 0.47);
      if (split < 1) {
        // Four clipped faces pull apart and shrink around their own centroids.
        const triangles = [
          [
            [0, 0],
            [pitch, 0],
            [pitch / 2, pitch / 2],
          ],
          [
            [pitch, 0],
            [pitch, pitch],
            [pitch / 2, pitch / 2],
          ],
          [
            [pitch, pitch],
            [0, pitch],
            [pitch / 2, pitch / 2],
          ],
          [
            [0, pitch],
            [0, 0],
            [pitch / 2, pitch / 2],
          ],
        ];
        for (const [j, points] of triangles.entries()) {
          const mx = points.reduce((s, p) => s + p[0], 0) / 3,
            my = points.reduce((s, p) => s + p[1], 0) / 3,
            scale = 1 - split * 0.91;
          ctx.save();
          ctx.translate(
            x + mx + (mx - pitch / 2) * split * 0.16,
            y + my + (my - pitch / 2) * split * 0.16,
          );
          ctx.scale(scale, scale);
          ctx.translate(-mx, -my);
          ctx.beginPath();
          points.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
          ctx.closePath();
          ctx.clip();
          tile(0, 0, pitch, material, time, 1 - split * 0.15);
          ctx.restore();
        }
      }
      glow(cx, cy, pitch * 0.8, color + '70', (1 - smooth(age / 0.55)) * 0.65);
    } else if (spectrumClear) {
      const local = age - 0.12 - axis * 0.025;
      if (local < 0.05) tile(x, y, pitch, material, time);
      if (local >= 0 && local < 0.16) {
        const s = 1 - smooth((local - 0.03) / 0.13),
          sz = pitch * s;
        tile(cx - sz / 2, cy - sz / 2, sz, material, time, 1, color);
      }
      glow(cx, cy, pitch * 1.13, color + 'c0', (1 - smooth((local - 0.03) / 0.45)) * 0.8);
      if (local < 0) continue;
    }
    const local = spectrumClear ? age - 0.12 - axis * 0.025 : pink ? age - 0.16 : age - 0.07;
    if (local < 0) continue;
    const life = spectrumClear ? 0.52 : pink ? 0.72 : 0.5,
      a = sat(1 - local / life);
    for (
      let j = 0;
      j < (h.layers?.particles === false ? 0 : pink ? 5 : spectrumClear ? 5 : 3);
      j++
    ) {
      const seed = k * 17 + j * 13 + row * 23,
        n = random(seed),
        n2 = random(seed + 3);
      const travel = 1 - Math.exp(-local * 5),
        angle = n * Math.PI * 2;
      const xx =
        cx +
        (n - 0.5) * pitch * 0.7 +
        Math.cos(angle) * travel * (spectrumClear ? 84 : pink ? 62 : 25);
      const yy =
        cy +
        (n2 - 0.5) * pitch * (spectrumClear ? 0.65 : pink ? 0.7 : 0.3) +
        Math.sin(angle) * travel * (spectrumClear ? 78 : pink ? 60 : 14) +
        local * local * (pink ? 90 : 28);
      const size =
        (spectrumClear ? 18 + n * 15 : pink ? 8 + n * 15 : 8 + n * 12) * (1 - local * 0.5);
      ctx.save();
      ctx.translate(xx, yy);
      ctx.rotate(spectrumClear ? n + local * 2 : pink ? (j % 2 ? Math.PI / 4 : 0) : 0);
      ctx.globalAlpha = a * (spectrumClear ? 0.95 : 0.8);
      if (spectrumClear) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 14;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, 3);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff55';
        ctx.fillRect(-size / 2 + 1, -size / 2 + 1, size - 2, 3);
      } else {
        const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
        g.addColorStop(0, pink ? '#ffa3ca' : grey ? '#edfaff' : '#dacaff');
        g.addColorStop(1, color);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, pink ? 1.5 : 3);
        ctx.fill();
      }
      ctx.restore();
    }
  }
}
