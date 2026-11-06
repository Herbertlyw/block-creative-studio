// Derived production module; supplied reference files remain unchanged.
import {
  craftMode,
  drawCraftPre,
  drawCraftVanish,
  drawCraftBeam,
  drawCraftParticles,
} from './craftedClear';
import { solidShardMesh } from '../../../nativeReference/rendering/solidShardDrawing';
import type { ClearEffectLibrary } from '../../../nativeReference/games/block-placement/presentation/effectLibrary';
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
  polygon,
  type C,
} from './libraryDrawing';
export interface ClearStep {
  clear: { cells: { row: number; col: number }[]; rows: number[]; cols: number[] };
  before: { board: { cells: (string | null)[][] } };
  piece: { color: string };
  after: { board: { cells: (string | null)[][] }; combo: number };
}
export interface ClearHost {
  ctx: C;
  gx: number;
  gy: number;
  pitch: number;
  tile: (x: number, y: number, size: number, color: string, time: number, alpha?: number) => void;
}
const meshes = new Map<number, ReturnType<typeof solidShardMesh>>();
export function vanishPhase(style: string, age: number, axis: number, boardSize = 8) {
  const delay =
    style === 'domino-dissolve'
      ? axis * 0.036
      : style === 'crystal-fracture'
        ? Math.abs(axis - (boardSize - 1) / 2) * 0.013
        : 0;
  return {
    delay,
    progress: sat((age - delay) / 0.42),
    fade: 1 - smooth((age - delay - 0.18) / 0.35),
  };
}
// Paint only after release: pre-clear illumination never reveals a future legal move.
export function drawLibraryPreClear(
  h: ClearHost,
  st: ClearStep,
  age: number,
  lead: number,
  style: string,
) {
  const crafted = craftMode(style);
  if (crafted) {
    drawCraftPre(h, st, age, lead, crafted);
    return;
  }
  if (style === 'off' || age < -lead || age >= 0.09) return;
  const { ctx: c, gx, gy, pitch: p } = h,
    u = sat((age + lead) / Math.max(0.001, lead)),
    fade = age < 0 ? 1 : 1 - smooth(age / 0.09);
  c.save();
  c.globalCompositeOperation = 'screen';
  for (const cell of st.clear.cells) {
    c.save();
    const axis = st.clear.rows.includes(cell.row) ? cell.col : cell.row,
      x = gx + cell.col * p,
      y = gy + cell.row * p;
    if (style === 'center-sweep') {
      const dist =
          Math.abs(axis - (st.before.board.cells.length - 1) / 2) /
          (st.before.board.cells.length / 2),
        a = Math.exp(-(((dist - u) * 5) ** 2)) * fade;
      glow(c, x + p / 2, y + p / 2, p * 0.8, '#ffcafa', a * 0.7);
      c.globalAlpha = a * 0.9;
      c.fillStyle = '#fff5ff';
      c.fillRect(x + 5, y + p * 0.44, p - 10, p * 0.12);
    } else if (style === 'cell-lantern') {
      glow(c, x + p * 0.42, y + p * 0.36, p * 0.55, '#e7eeff', (0.1 + u * 0.48) * fade);
      c.globalAlpha = fade * u * 0.55;
      c.strokeStyle = '#f1f4ff';
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(x + 8, y + p * 0.36);
      c.lineTo(x + 8, y + 8);
      c.lineTo(x + p * 0.65, y + 8);
      c.stroke();
    } else if (style === 'line-charge') {
      c.globalAlpha = fade * (0.1 + u * 0.38);
      c.fillStyle = '#cfb2ff';
      c.fillRect(x + 2, y + 2, p - 4, p - 4);
      c.globalAlpha = fade * u;
      c.strokeStyle = '#fff3ff';
      c.lineWidth = 3;
      c.strokeRect(x + 4, y + 4, p - 8, p - 8);
    } else if (style === 'edge-trace') {
      c.globalAlpha = fade;
      c.strokeStyle = '#fff6dd';
      c.shadowColor = '#ffd993';
      c.shadowBlur = 5;
      c.lineWidth = 1.6;
      c.setLineDash([p * 4 * u, p * 4]);
      c.strokeRect(x + 3, y + 3, p - 6, p - 6);
      c.setLineDash([]);
    } else if (style === 'prism-scan') {
      c.save();
      c.beginPath();
      c.rect(x + 1, y + 1, p - 2, p - 2);
      c.clip();
      const xx = x - p + u * p * 3;
      const g = c.createLinearGradient(xx - p * 0.6, y, xx + p * 0.6, y + p);
      g.addColorStop(0, '#77ecff00');
      g.addColorStop(0.35, '#80f1ff70');
      g.addColorStop(0.5, '#ffffffd0');
      g.addColorStop(0.65, '#efafffb0');
      g.addColorStop(1, '#efafff00');
      c.globalAlpha = fade;
      c.fillStyle = g;
      c.fillRect(x, y, p, p);
      c.restore();
    } else if (style === 'iris-focus') {
      c.globalAlpha = fade * (0.3 + 0.7 * u);
      c.strokeStyle = '#a5edff';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(x + p / 2, y + p / 2, p * (0.62 - 0.4 * u), 0, Math.PI * 2);
      c.stroke();
      glow(c, x + p / 2, y + p / 2, p * 0.6, '#b6a8ff', fade * u * 0.5);
    }
    c.restore();
  }
  c.restore();
}
export function drawLibraryVanish(
  h: ClearHost,
  st: ClearStep,
  age: number,
  time: number,
  board: (string | null)[][],
  style: string,
) {
  const crafted = craftMode(style);
  if (crafted) {
    drawCraftVanish(h, st, age, time, board, crafted);
    return;
  }
  if (age < 0 || age > 0.65 || style === 'off') return;
  const { ctx: c, gx, gy, pitch: p, tile } = h;
  for (const [k, { row, col }] of st.clear.cells.entries()) {
    if (board[row]![col] != null) continue;
    const x = gx + col * p,
      y = gy + row * p,
      cx = x + p / 2,
      cy = y + p / 2,
      axis = st.clear.rows.includes(row) ? col : row,
      color = st.before.board.cells[row]![col] ?? st.piece.color;
    const { progress: q, fade: a } = vanishPhase(style, age, axis, board.length);
    if (a <= 0) continue;
    if (style === 'soft-fade') {
      tile(x, y, p, color, time, 1 - smooth(age / 0.15));
      continue;
    }
    if (style === 'crystal-fracture') {
      if (q === 0) {
        tile(x, y, p, color, time);
        continue;
      }
      const key = Math.round(p * 100) + k * 100000;
      let facets = meshes.get(key);
      if (!facets) {
        facets = solidShardMesh(p, p, 5, k * 71 + 23);
        if (meshes.size > 128) meshes.clear();
        meshes.set(key, facets);
      }
      for (const [j, facet] of facets.entries()) {
        const n = noise(k, j),
          dx = facet.x * q * 1.2 + (n - 0.5) * p * q * 0.3,
          dy = facet.y * q * 0.9 - q * 16 + q * q * 35;
        c.save();
        c.translate(cx + facet.x + dx, cy + facet.y + dy);
        c.rotate((n - 0.5) * q * 1.4);
        c.scale((1 - q * 0.4) * (0.7 + 0.3 * Math.cos(q * 3 + n)), 1 - q * 0.35);
        c.globalAlpha *= a;
        polygon(
          c,
          facet.points.map((v) => [v.x - facet.x, v.y - facet.y]),
        );
        c.save();
        c.clip();
        tile(-p / 2 - facet.x, -p / 2 - facet.y, p, color, time);
        c.fillStyle = `rgba(36,18,69,${q * 0.18})`;
        c.fillRect(-p, -p, p * 2, p * 2);
        c.restore();
        c.strokeStyle = '#eadeff';
        c.lineWidth = 1.2;
        c.globalAlpha *= 0.65;
        c.stroke();
        c.restore();
      }
    } else if (style === 'star-collapse') {
      const s = 1 - smooth(age / 0.26);
      if (s > 0) tile(cx - (p * s) / 2, cy - (p * s) / 2, p * s, color, time);
      c.save();
      c.globalCompositeOperation = 'screen';
      star(c, cx, cy, p * 0.38 * Math.sin(Math.PI * sat(age / 0.5)), '#fff5ce', a, age * 0.5);
      c.restore();
    } else if (style === 'domino-dissolve') {
      c.save();
      c.beginPath();
      c.rect(x + p * q, y, p * (1 - q), p);
      c.clip();
      tile(x, y, p, color, time);
      c.restore();
      if (q > 0 && q < 1)
        lightPath(
          c,
          [
            [x + p * q, y + 5],
            [x + p * q, y + p - 5],
          ],
          '#9befff',
          a,
          4,
        );
    } else if (style === 'twin-eject') {
      const horizontal = st.clear.rows.includes(row),
        sign = axis < (board.length - 1) / 2 ? -1 : 1,
        dist = p * q * (1 + Math.abs(axis - (board.length - 1) / 2) * 0.26),
        s = 1 - q * 0.6;
      c.save();
      c.translate(
        cx + (horizontal ? sign * dist : Math.sin(k) * q * 20),
        cy + (horizontal ? Math.sin(k) * q * 20 : sign * dist),
      );
      c.rotate(sign * q * 0.45);
      tile((-p * s) / 2, (-p * s) / 2, p * s, color, time, a);
      c.restore();
    } else if (style === 'petal-fold') {
      for (let j = 0; j < 4; j++) {
        c.save();
        c.translate(cx, cy);
        c.rotate((j * Math.PI) / 2);
        c.scale(1, Math.max(0.01, Math.cos((q * Math.PI) / 2)));
        c.translate(0, q * p * 0.15);
        c.globalAlpha *= a;
        polygon(c, [
          [0, 0],
          [-p / 2, -p / 2],
          [p / 2, -p / 2],
        ]);
        c.clip();
        tile(-p / 2, -p / 2, p, color, time);
        c.restore();
      }
    } else if (style === 'vortex-pull') {
      const s = 1 - q,
        dx = ((board.length - 1) / 2 - col) * p * smooth(q) * 0.7,
        dy = ((board.length - 1) / 2 - row) * p * smooth(q) * 0.3;
      c.save();
      c.translate(cx + dx, cy + dy);
      c.rotate(q * 2.2);
      tile((-p * s) / 2, (-p * s) / 2, p * s, color, time, a);
      c.restore();
    }
  }
}
export function drawLibraryBeam(h: ClearHost, st: ClearStep, age: number, style: string) {
  const crafted = craftMode(style);
  if (crafted) {
    drawCraftBeam(h, st, age, crafted);
    return;
  }
  if (age < 0 || age > 0.65 || style === 'off') return;
  const { ctx: c, gx, gy, pitch: p } = h,
    L = p * st.before.board.cells.length,
    a = envelope(age, 0.65);
  for (const horizontal of [true, false])
    for (const n of horizontal ? st.clear.rows : st.clear.cols) {
      c.save();
      c.translate(gx + (horizontal ? 0 : n * p), gy + (horizontal ? n * p : 0));
      if (!horizontal) c.transform(0, 1, 1, 0, 0, 0);
      c.beginPath();
      c.rect(-20, -p * 0.4, L + 40, p * 1.8);
      c.clip();
      if (style === 'rose-laser') {
        const front = sat(age / 0.32) * L;
        lightPath(
          c,
          [
            [Math.max(0, front - L * 0.5), p / 2],
            [front, p / 2],
          ],
          '#ff8fcc',
          a,
          12,
        );
        star(c, front, p / 2, 32, '#fff4fa', a);
      } else if (style === 'dual-aurora') {
        for (const sign of [-1, 1]) {
          const pts = Array.from({ length: 49 }, (_, i) => [
            (i / 48) * L,
            p / 2 + sign * (p * 0.25 * Math.sin((i / 48) * Math.PI * 3 - age * 14)),
          ]);
          lightPath(c, pts, sign < 0 ? '#74e8ff' : '#be91ff', a, 5);
        }
      } else if (style === 'silk-core') {
        c.globalCompositeOperation = 'screen';
        glow(c, L / 2, p / 2, L * 0.48, '#c9d6f8', a * 0.38, 1, 0.035);
        lightPath(
          c,
          [
            [14, p / 2],
            [L - 14, p / 2],
          ],
          '#e5eeff',
          a * 0.85,
          1.4 + 5 * Math.exp(-age * 22),
        );
      } else if (style === 'split-comet') {
        const d = (sat(age / 0.35) * L) / 2;
        for (const sign of [-1, 1]) {
          const front = L / 2 + sign * d;
          lightPath(
            c,
            [
              [L / 2 + sign * Math.max(0, d - 230), p / 2],
              [front, p / 2],
            ],
            '#ffe2a2',
            a,
            2.2,
          );
          star(c, front, p / 2, 13, '#fff4d7', a);
        }
      } else if (style === 'electric-filament') {
        const tick = age * 18,
          base = Math.floor(tick),
          blend = smooth(tick - base);
        for (let branch = 0; branch < 3; branch++) {
          const pts = Array.from({ length: 41 }, (_, i) => {
            const jitter =
              noise(base + n * 31, i + branch * 71) * (1 - blend) +
              noise(base + 1 + n * 31, i + branch * 71) * blend;
            return [
              (i / 40) * L,
              p / 2 + (jitter - 0.5) * p * (branch ? 0.28 : 0.7) * Math.sin((i / 40) * Math.PI),
            ];
          });
          lightPath(
            c,
            pts,
            branch ? '#9280ff' : '#61dcff',
            a * (branch ? 0.55 : 1),
            branch ? 1.2 : 3.2,
          );
        }
      } else if (style === 'prism-ribbon') {
        c.globalCompositeOperation = 'screen';
        for (let j = 0; j < 4; j++) {
          const pts = Array.from({ length: 40 }, (_, i) => [
            (i / 39) * L,
            p / 2 + Math.sin((i / 39) * 4 - age * 9 + j * 0.6) * p * 0.25,
          ]);
          lightPath(c, pts, ['#88e9ff', '#b3adff', '#efa3ed', '#ffe2c0'][j]!, a * 0.65, 6);
        }
      }
      c.restore();
    }
}
export function drawLibraryParticles(
  h: ClearHost,
  st: ClearStep,
  age: number,
  style: string,
  seed: number,
) {
  const crafted = craftMode(style);
  if (crafted) {
    drawCraftParticles(h, st, age, crafted, seed);
    return;
  }
  if (age < 0.07 || age > 1 || style === 'off') return;
  const { ctx: c, gx, gy, pitch: p } = h,
    q = age - 0.07,
    a = envelope(q, 0.88);
  for (const [k, cell] of st.clear.cells.entries())
    for (let j = 0; j < (style === 'light-dust' ? 1 : 3); j++) {
      const n = noise(seed + k * 31, j),
        m = noise(seed + k * 17, j + 79),
        angle = n * Math.PI * 2,
        d = (1 - Math.exp(-q * 4)) * (30 + m * 100),
        cx = gx + (cell.col + 0.5) * p,
        cy = gy + (cell.row + 0.5) * p,
        x = cx + Math.cos(angle) * d,
        y = cy + Math.sin(angle) * d - q * 35 + q * q * 45,
        size = 4 + Math.pow(m, 1.8) * 21;
      if (style === 'glass-flakes')
        jewel(
          c,
          x,
          y,
          size * 1.8,
          n * 6 + q * (m - 0.5) * 8,
          a * 0.8,
          '#c5b5ff',
          0.25 + 0.75 * Math.abs(Math.cos(q * 5 + n)),
        );
      else if (style === 'light-dust')
        lightPath(
          c,
          [
            [x, y + size * (1 + q)],
            [x, y],
          ],
          j % 2 ? '#d4c0ff' : '#a7f6ff',
          a * 0.65,
          0.6 + m * 0.7,
        );
      else if (style === 'fourpoint-stars')
        star(
          c,
          x,
          y,
          size * (0.4 + 0.6 * Math.sin(q * 8 + k) ** 2),
          j % 3 === 0 ? '#fff0d0' : j % 3 === 1 ? '#d5f6ff' : '#eccdff',
          a,
          q + n,
        );
      else if (style === 'comet-trails') {
        lightPath(
          c,
          [
            [cx + Math.cos(angle) * d * 0.55, cy + Math.sin(angle) * d * 0.55],
            [x, y],
          ],
          j % 2 ? '#b8a7ff' : '#96eaff',
          a,
          2.2,
        );
        star(c, x, y, size * 0.45, '#eaffff', a);
      } else if (style === 'pearl-bubbles') {
        c.save();
        c.globalCompositeOperation = 'screen';
        c.globalAlpha = a * 0.65;
        const yy = y - q * 55;
        const g = c.createRadialGradient(x - size * 0.3, yy - size * 0.3, 0, x, yy, size);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.25, '#d2c3ff30');
        g.addColorStop(0.8, '#9dddff10');
        g.addColorStop(1, '#e6dfff90');
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y - q * 55, size, 0, Math.PI * 2);
        c.fill();
        c.restore();
      } else if (style === 'butterfly-motes' && j === 0)
        butterfly(c, x, y - q * 40, size * 0.65, q * 9 + n * 6, a * 0.9);
    }
}
export function drawLibraryClear(
  h: ClearHost,
  st: ClearStep,
  age: number,
  time: number,
  board: (string | null)[][],
  library: ClearEffectLibrary,
  lead: number,
  seed: number,
) {
  if (library.vanish) drawLibraryVanish(h, st, age, time, board, library.vanish);
  if (library.preClear) drawLibraryPreClear(h, st, age, lead, library.preClear);
  if (library.beam) drawLibraryBeam(h, st, age, library.beam);
  if (library.particles) drawLibraryParticles(h, st, age, library.particles, seed);
}
