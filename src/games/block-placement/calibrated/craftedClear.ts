// Derived production module; supplied reference files remain unchanged.
/** Reference-led clear choreography. All ages are absolute seconds; no mutable particle simulation. */
import type { ClearHost, ClearStep } from './libraryClear';
import { noise, sat, smooth, glow, polygon, type C } from './libraryDrawing';
export type CraftMode = 'satin' | 'crystal' | 'spectrum' | 'lattice';
const hues = [
  '#de64ff',
  '#9165ee',
  '#527fed',
  '#24d5eb',
  '#65e479',
  '#f8d94d',
  '#ffa54d',
  '#f574b7',
];
export function craftMode(style: string): CraftMode | null {
  return style.startsWith('crafted-satin')
    ? 'satin'
    : style.startsWith('crafted-crystal')
      ? 'crystal'
      : style.startsWith('crafted-spectrum')
        ? 'spectrum'
        : style.startsWith('crafted-lattice')
          ? 'lattice'
          : null;
}
const rgba = (hex: string, a: number) =>
  hex +
  Math.round(sat(a) * 255)
    .toString(16)
    .padStart(2, '0');
export function craftTiming(mode: CraftMode, age: number, axis: number, boardSize = 8) {
  const delay =
    mode === 'lattice'
      ? 0.04 + Math.abs(axis - (boardSize - 1) / 2) * 0.04
      : mode === 'spectrum'
        ? axis * 0.035
        : mode === 'crystal'
          ? Math.abs(axis - (boardSize - 1) / 2) * 0.009
          : 0;
  const t = age - delay;
  return {
    t,
    compression: smooth(t / 0.115),
    opacity: 1 - smooth((t - 0.23) / 0.24),
    alive: t < 0.49,
  };
}
/** An exact partition into four irregular convex chips, each preserving one source corner. */
export function crystalFacets(seed: number) {
  const center = [(noise(seed, 31) - 0.5) * 0.24, (noise(seed, 73) - 0.5) * 0.24];
  const edge = [
    [-0.5, -0.5],
    [-0.12 + noise(seed, 1) * 0.25, -0.5],
    [0.5, -0.5],
    [0.5, -0.16 + noise(seed, 2) * 0.3],
    [0.5, 0.5],
    [-0.12 + noise(seed, 3) * 0.3, 0.5],
    [-0.5, 0.5],
    [-0.5, -0.16 + noise(seed, 4) * 0.3],
  ];
  return [0, 2, 4, 6].map((i) => {
    const points = [center, edge[(i + 7) % 8]!, edge[i]!, edge[(i + 1) % 8]!];
    return {
      points,
      cx: points.reduce((a, b) => a + b[0]!, 0) / 3,
      cy: points.reduce((a, b) => a + b[1]!, 0) / 3,
    };
  });
}
function field(c: C, x: number, y: number, w: number, h: number, color: string, alpha: number) {
  if (alpha <= 0 || h <= 0) return;
  c.save();
  c.translate(x, y);
  const g = c.createLinearGradient(0, -h / 2, 0, h / 2);
  for (const [u, a] of [
    [0, 0],
    [0.15, 0.045],
    [0.33, 0.2],
    [0.46, 0.64],
    [0.5, 1],
    [0.54, 0.64],
    [0.67, 0.2],
    [0.85, 0.045],
    [1, 0],
  ])
    g.addColorStop(u!, rgba(color, a! * alpha));

  // A narrow capsule with a soft cross section; ends use curved geometry rather than a rectangular glow.
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(-w / 2, 0);
  c.bezierCurveTo(-w * 0.46, -h * 0.5, w * 0.46, -h * 0.5, w / 2, 0);
  c.bezierCurveTo(w * 0.46, h * 0.5, -w * 0.46, h * 0.5, -w / 2, 0);
  c.fill();
  c.restore();
}
function glint(c: C, x: number, y: number, size: number, color: string, a: number, rotation = 0) {
  if (a <= 0 || size <= 0) return;
  c.save();
  c.translate(x, y);
  c.rotate(rotation);
  c.globalAlpha *= a;
  glow(c, 0, 0, size * 3.2, color, 0.38, 1, 0.8);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, -size);
  c.quadraticCurveTo(size * 0.1, -size * 0.1, size, 0);
  c.quadraticCurveTo(size * 0.1, size * 0.1, 0, size);
  c.quadraticCurveTo(-size * 0.1, size * 0.1, -size, 0);
  c.quadraticCurveTo(-size * 0.1, -size * 0.1, 0, -size);
  c.fill();
  c.restore();
}
function bead(c: C, x: number, y: number, r: number, color: string, a: number, angle: number) {
  c.save();
  c.globalAlpha *= a;
  c.translate(x, y);
  c.rotate(angle);
  c.fillStyle = '#171a4e42';
  c.beginPath();
  c.roundRect(-r * 0.5 + 1, -r * 0.5 + 2, r, r, r * 0.18);
  c.fill();
  const g = c.createLinearGradient(-r * 0.4, -r * 0.5, r * 0.3, r * 0.5);
  g.addColorStop(0, '#f0eaff');
  g.addColorStop(0.12, color);
  g.addColorStop(0.73, color);
  g.addColorStop(1, '#37335e');
  c.fillStyle = g;
  c.beginPath();
  c.roundRect(-r * 0.5, -r * 0.5, r, r, r * 0.17);
  c.fill();
  c.strokeStyle = '#f7efff70';
  c.lineWidth = 0.65;
  c.beginPath();
  c.moveTo(-r * 0.4, r * 0.12);
  c.lineTo(-r * 0.4, -r * 0.37);
  c.lineTo(r * 0.3, -r * 0.37);
  c.stroke();
  c.restore();
}
export function drawCraftPre(
  h: ClearHost,
  st: ClearStep,
  age: number,
  lead: number,
  mode: CraftMode,
) {
  if (age < -lead || age > 0.035) return;
  const { ctx: c, gx, gy, pitch: p } = h;
  const q = smooth((age + lead) / Math.max(lead, 0.001)),
    fade = age < 0 ? 1 : 1 - smooth(age / 0.035);
  c.save();
  for (const cell of st.clear.cells) {
    const x = gx + cell.col * p,
      y = gy + cell.row * p,
      axis = st.clear.rows.includes(cell.row) ? cell.col : cell.row,
      col = mode === 'spectrum' ? hues[axis]! : '#d8b5ff';
    glow(c, x + p / 2, y + p / 2, p * 0.78, col, q * fade * 0.22, 1, 0.8);
    c.save();
    c.globalAlpha = q * fade * 0.68;
    c.strokeStyle = mode === 'crystal' ? '#f3d0ff' : '#f5e6ff';
    c.shadowColor = col;
    c.shadowBlur = 9;
    c.lineWidth = 2.5;
    c.beginPath();
    c.roundRect(x + 2.5, y + 2.5, p - 5, p - 5, 2);
    c.stroke();
    c.restore();
    const g = c.createLinearGradient(0, y, 0, y + p);
    g.addColorStop(0, rgba('#fce8ff', q * fade * 0.24));
    g.addColorStop(0.3, '#fce8ff00');
    g.addColorStop(0.7, '#fce8ff00');
    g.addColorStop(1, rgba(col, q * fade * 0.12));
    c.fillStyle = g;
    c.fillRect(x + 4, y + 4, p - 8, p - 8);
  }
  c.restore();
}
export function drawCraftVanish(
  h: ClearHost,
  st: ClearStep,
  age: number,
  time: number,
  board: (string | null)[][],
  mode: CraftMode,
) {
  if (age < 0 || age > 0.85) return;
  const { ctx: c, gx, gy, pitch: p, tile } = h;
  for (const { row, col } of st.clear.cells) {
    if (board[row]?.[col] != null) continue;
    const axis = st.clear.rows.includes(row) ? col : row,
      x = gx + col * p,
      y = gy + row * p,
      cx = x + p / 2,
      cy = y + p / 2,
      color = st.before.board.cells[row]![col] ?? st.piece.color,
      seed = row * 113 + col * 41;
    const { t, compression: q, alive } = craftTiming(mode, age, axis, board.length);
    if (!alive) continue;
    if (t < 0) {
      tile(x, y, p, color, time);
      continue;
    }
    if (mode === 'lattice') {
      const split = smooth(t / 0.28),
        scale = 1 - split * 0.97;
      if (split >= 1) continue;
      const corners = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [0.5, 0.5],
        [-0.5, 0.5],
      ];
      for (let j = 0; j < 4; j++) {
        const a = corners[j]!,
          b = corners[(j + 1) % 4]!,
          mx = ((a[0]! + b[0]!) * p) / 3,
          my = ((a[1]! + b[1]!) * p) / 3;
        c.save();
        c.translate(cx + mx, cy + my);
        c.scale(scale, scale);
        c.translate(-mx, -my);
        polygon(c, [
          [0, 0],
          [a[0]! * p, a[1]! * p],
          [b[0]! * p, b[1]! * p],
        ]);
        c.clip();
        tile(-p / 2, -p / 2, p, color, time);
        c.restore();
      }
      continue;
    }
    if (mode !== 'crystal') {
      if (t < 0.135) {
        const sy = 1 - q * 0.96,
          sx = 1 + Math.sin(q * Math.PI) * 0.035;
        c.save();
        c.translate(cx, cy);
        c.scale(sx, sy);
        tile(-p / 2, -p / 2, p, color, time, 1 - smooth((t - 0.085) / 0.05));
        c.restore();
      }
      continue;
    }
    if (t < 0.025) {
      tile(x, y, p, color, time);
      continue;
    }
    const u = sat((t - 0.025) / 0.33),
      travel = 1 - Math.exp(-u * 3.2),
      shrink = 1 - smooth((u - 0.12) / 0.88) * 0.58;
    const facets = crystalFacets(seed)
      .map((f, j) => ({ f, j, z: Math.sin(u * (2 + noise(seed, j) * 4)) }))
      .sort((a, b) => a.z - b.z);
    for (const { f, j } of facets) {
      const n = noise(seed, j),
        rx = u * (0.45 + n * 0.85) * (j % 2 ? 1 : -1),
        ry = u * (0.35 + noise(seed, j + 19) * 1.1) * (j < 2 ? 1 : -1),
        rz = (noise(seed, j + 33) - 0.5) * u * 0.7;
      const rot = (xx: number, yy: number, zz: number) => {
        const y1 = yy * Math.cos(rx) - zz * Math.sin(rx),
          z1 = yy * Math.sin(rx) + zz * Math.cos(rx),
          x2 = xx * Math.cos(ry) + z1 * Math.sin(ry),
          z2 = -xx * Math.sin(ry) + z1 * Math.cos(ry);
        return {
          x: (x2 * Math.cos(rz) - y1 * Math.sin(rz)) * shrink,
          y: (x2 * Math.sin(rz) + y1 * Math.cos(rz)) * shrink,
          z: z2,
        };
      };
      const thickness = p * 0.022 * Math.min(1, u * 10),
        pts = f.points.map((v) => [(v[0]! - f.cx) * p, (v[1]! - f.cy) * p]);
      const top = pts.map((v) => rot(v[0]!, v[1]!, thickness)),
        bottom = pts.map((v) => rot(v[0]!, v[1]!, -thickness));
      const dx = f.cx * p * travel * (0.28 + n * 0.35),
        dy = f.cy * p * travel * 0.36 - travel * p * (0.015 + n * 0.09) + u * u * p * 0.17;
      c.save();
      c.globalAlpha *= 1 - smooth((t - 0.13) / 0.24);
      c.translate(cx + f.cx * p + dx, cy + f.cy * p + dy);
      for (let k = 0; k < 4; k++) {
        const l = (k + 1) % 4;
        polygon(c, [
          [top[k]!.x, top[k]!.y],
          [top[l]!.x, top[l]!.y],
          [bottom[l]!.x, bottom[l]!.y],
          [bottom[k]!.x, bottom[k]!.y],
        ]);
        c.fillStyle = k === 0 ? '#d2bafa' : '#8e73bc';
        c.fill();
      }
      const normal = rot(0, 0, 1);
      const front = normal.z >= 0 ? top : bottom;
      polygon(
        c,
        front.map((v) => [v.x, v.y]),
      );
      c.save();
      c.clip();
      if (normal.z >= 0) {
        const a = rot(1, 0, 0),
          b = rot(0, 1, 0),
          o = rot(0, 0, thickness);
        c.transform(a.x, a.y, b.x, b.y, o.x, o.y);
        tile(-p / 2 - f.cx * p, -p / 2 - f.cy * p, p, color, time);
        c.fillStyle = rgba('#231534', (1 - Math.abs(normal.z)) * 0.1);
        c.fillRect(-p, -p, p * 2, p * 2);
      } else {
        c.fillStyle = j % 2 ? '#c0a6f1' : '#a389d0';
        c.fillRect(-p, -p, p * 2, p * 2);
      }
      c.restore();
      // A highlight on one light-facing edge; all edges white would flatten the facet.
      c.strokeStyle = rgba('#f7e4ff', (0.2 + 0.5 * Math.max(0, normal.z)) * (1 - u));
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(front[0]!.x, front[0]!.y);
      c.lineTo(front[1]!.x, front[1]!.y);
      c.stroke();
      c.restore();
    }
  }
}
export function drawCraftBeam(h: ClearHost, st: ClearStep, age: number, mode: CraftMode) {
  if (age < 0 || age > 0.8) return;
  const { ctx: c, gx, gy, pitch: p } = h,
    L = p * st.before.board.cells.length;
  for (const horizontal of [true, false])
    for (const row of horizontal ? st.clear.rows : st.clear.cols) {
      c.save();
      c.translate(gx + (horizontal ? 0 : row * p), gy + (horizontal ? row * p : 0));
      if (!horizontal) c.transform(0, 1, 1, 0, 0, 0);
      const peak = Math.sin(Math.PI * sat(age / 0.21)),
        tail = Math.exp(-Math.max(0, age - 0.12) * 11),
        col = mode === 'crystal' ? '#cc83e8' : '#be9ef5';
      if (mode === 'lattice') {
        const a = smooth(age / 0.025) * (1 - smooth((age - 0.16) / 0.095)),
          width = L * smooth(age / 0.15);
        field(c, L / 2, p / 2, width, p * 0.92, '#eea6f1', a * 0.5);
        field(c, L / 2, p / 2, width * 0.98, p * 0.36, '#ffd4f8', a * 0.92);
        field(c, L / 2, p / 2, width * 0.97, p * 0.1, '#fff3fc', a);
        const tail = smooth((age - 0.16) / 0.11) * (1 - smooth((age - 0.46) / 0.3));
        field(c, L / 2, p / 2, L, p * 0.92, '#dca4f4', tail * 0.3);
      } else if (mode === 'spectrum') {
        const front = (age / 0.49) * L,
          Ltail = p * 1.3;
        for (let i = 0; i < st.before.board.cells.length; i++) {
          const xx = (i + 0.5) * p,
            t = age - i * 0.035,
            a = smooth(t / 0.035) * (1 - smooth((t - 0.14) / 0.28));
          if (a <= 0) continue;
          glow(c, xx, p / 2, p * 0.94, hues[i]!, a * 0.4, 1, 0.68);
          field(c, xx, p / 2, p * 1.9, p * 0.56, hues[i]!, a * 0.65);
        }
        field(
          c,
          front - Ltail * 0.36,
          p / 2,
          Ltail,
          p * 0.11,
          '#fbddf4',
          Math.sin(Math.PI * sat(age / 0.45)) * 0.4,
        );
      } else {
        const a = smooth(age / 0.022) * (1 - smooth((age - 0.085) / 0.32));
        field(c, L / 2, p / 2, L + 12, p * 0.76, col, a * 0.45);
        field(c, L / 2, p / 2, L * 0.98, p * (0.035 + 0.21 * peak), '#d8c6ff', a * 0.85);
        field(c, L / 2, p / 2, L * 0.96, p * (0.018 + 0.048 * peak), '#fcf3ff', a * 0.95);
        // Central flare is brief; the quieter broad bloom remains after the bright core collapses.
        glow(c, L / 2, p / 2, p * 1.2, '#e1b4ff', peak * tail * 0.22, 3, 0.45);
      }
      c.restore();
    }
}
export function drawCraftParticles(
  h: ClearHost,
  st: ClearStep,
  age: number,
  mode: CraftMode,
  seed: number,
) {
  if (age < 0.065 || age > 1.05) return;
  const { ctx: c, gx, gy, pitch: p } = h;
  for (const cell of st.clear.cells) {
    const axis = st.clear.rows.includes(cell.row) ? cell.col : cell.row,
      s = seed + cell.row * 173 + cell.col * 61,
      delay =
        mode === 'lattice'
          ? 0.12 + Math.abs(axis - (st.before.board.cells.length - 1) / 2) * 0.04
          : mode === 'spectrum'
            ? axis * 0.035
            : 0;
    const count = mode === 'satin' ? 4 : mode === 'crystal' ? 5 : 5;
    for (let j = 0; j < count; j++) {
      const n = noise(s, j),
        m = noise(s, j + 39),
        start = 0.065 + delay + noise(s, j + 82) * 0.055,
        q = age - start,
        life = 0.32 + m * 0.28;
      if (q < 0 || q > life) continue;
      const fade = smooth(q / 0.025) * (1 - smooth((q - life * 0.48) / (life * 0.52))),
        a = fade * (j === 0 ? 0.94 : 0.7),
        u = 1 - Math.exp(-q * 5),
        angle = noise(s, j + 64) * Math.PI * 2,
        dist = p * (mode === 'lattice' ? 0.045 + m * 0.07 : 0.15 + m * 0.65) * u;
      const x = gx + (cell.col + 0.24 + noise(s, j + 91) * 0.52) * p + Math.cos(angle) * dist,
        y =
          gy +
          (cell.row + 0.36 + noise(s, j + 101) * 0.26) * p +
          Math.sin(angle) * dist -
          q * p * 0.25 +
          q * q * p * 0.45;
      const color =
          mode === 'spectrum'
            ? hues[axis]!
            : mode === 'lattice'
              ? j % 3
                ? '#d895e8'
                : '#ecbafa'
              : j % 3
                ? '#ba96ef'
                : '#e5d5ff',
        size = p * (j === 0 ? 0.17 + m * 0.07 : 0.024 + m * 0.075) * (1 - smooth(q / life) * 0.45);
      if (j === 0 && mode !== 'crystal') glow(c, x, y, size * 3.8, color, a * 0.32);
      if (mode === 'crystal' && j < 2) {
        c.save();
        c.translate(x, y);
        c.rotate(n * 6 + q * (m - 0.5) * 9);
        c.globalAlpha = a;
        polygon(c, [
          [-size * 0.6, -size * 0.2],
          [size * 0.25, -size * 0.55],
          [size * 0.6, size * 0.3],
          [-size * 0.25, size * 0.4],
        ]);
        const g = c.createLinearGradient(-size, -size, size, size);
        g.addColorStop(0, '#ead8ff');
        g.addColorStop(0.28, color);
        g.addColorStop(0.52, '#7c5fae');
        g.addColorStop(0.57, '#f7eaff');
        g.addColorStop(1, '#9175b8');
        c.fillStyle = g;
        c.fill();
        c.restore();
      } else bead(c, x, y, size, color, a, n * 3 + q * (m - 0.5) * 3);
      if (j === 0 && m > 0.64)
        glint(c, x - size * 0.2, y - size * 0.2, size * 0.38, '#f7ebff', a * 0.8);
    }
  }
}
