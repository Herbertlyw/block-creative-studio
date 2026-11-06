// Derived production module; supplied reference files remain unchanged.
import { mixColor } from './tileColors';
const sat = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  x = sat(x);
  return x * x * (3 - 2 * x);
};

/** Measured at 60 fps: the fracture reaches the outer cells after the centre. */
export function pinkFracturePhase(age: number, distanceInCells: number) {
  const local = age - (0.055 + distanceInCells * 0.068);
  const fractureDuration = Math.max(0.23, 0.36 - distanceInCells * 0.024);
  return {
    local,
    split: smooth(local / fractureDuration),
    motes: sat((local - 0.15) / 0.13) * (1 - smooth((local - 0.35) / 0.47)),
  };
}

export function drawPinkClear(h: any, st: any, age: number, time: number, board: any[][]) {
  const { ctx, gx, gy, pitch, tile } = h;
  if (age < 0) return;
  const cells = st.clear.cells;
  const cr = cells.reduce((s: number, c: any) => s + c.row, 0) / cells.length;
  const cc = cells.reduce((s: number, c: any) => s + c.col, 0) / cells.length;
  for (const [k, { row, col }] of cells.entries()) {
    if (board[row][col] != null) continue;
    const x = gx + col * pitch,
      y = gy + row * pitch,
      cx = x + pitch / 2,
      cy = y + pitch / 2;
    const color =
      st.before.board.cells[row][col] ?? st.placedColors?.[`${row},${col}`] ?? st.piece.color;
    const tint = h.tintForColor?.(color),
      light = tint ? mixColor(tint, 0.55) : '#ffbbd6',
      base = tint ?? '#f78dbc',
      dark = tint ? mixColor(tint, -0.25) : '#d4598f';
    const { local, split, motes } = pinkFracturePhase(age, Math.hypot(row - cr, col - cc));
    if (local <= 0) tile(x, y, pitch, color, time);
    else if (split < 1) {
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
      for (const points of triangles) {
        const mx = points.reduce((s, p) => s + p[0], 0) / 3,
          my = points.reduce((s, p) => s + p[1], 0) / 3,
          scale = 1 - split * 0.97;
        ctx.save();
        ctx.translate(x + mx, y + my);
        ctx.scale(scale, scale);
        ctx.translate(-mx, -my);
        ctx.beginPath();
        points.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
        ctx.closePath();
        ctx.clip();
        tile(0, 0, pitch, color, time);
        ctx.restore();
      }
    }
    // The fragments stay close to their original grid; the reference is not a blast.
    if (motes > 0) {
      for (let j = 0; j < 5; j++) {
        const dx = j === 0 ? 0 : (j % 2 ? -0.29 : 0.29) * pitch,
          dy = j === 0 ? 0 : (j < 3 ? -0.29 : 0.29) * pitch;
        const n = ((k * 13 + j * 7) % 19) / 19,
          drift = sat(local) * 12;
        const px = cx + dx + Math.sin(k + j) * (drift + 7),
          py = cy + dy + Math.cos(k * 2 + j) * 7 + local * 9;
        const size =
          (j === 0 ? 29 : 11 + n * 9) * (1 - sat(local) * 0.35) * (h.polish ? 0.85 + n * 0.25 : 1);
        ctx.save();
        ctx.globalAlpha =
          motes *
          (j === 0 ? 0.95 : 0.8) *
          (h.polish ? 0.78 + 0.22 * Math.sin(local * 13 + k) ** 2 : 1);
        ctx.translate(px, py);
        ctx.rotate((j === 0 ? 0 : Math.PI / 4) + (h.polish ? Math.sin(k + j) * local * 0.45 : 0));
        const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
        g.addColorStop(0, light);
        g.addColorStop(0.35, base);
        g.addColorStop(1, dark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, j === 0 ? 4 : 1);
        ctx.fill();
        ctx.fillStyle = (tint ? mixColor(tint, 0.8) : '#ffdfeb') + '88';
        ctx.fillRect(-size / 2 + 2, -size / 2 + 1, size - 4, 2);
        ctx.restore();
        if (h.polish && j === 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = motes * 0.35 * (1 - sat(local));
          ctx.shadowColor = light;
          ctx.shadowBlur = 14;
          ctx.fillStyle = tint ? mixColor(tint, 0.92) : '#fff2fb';
          ctx.fillRect(px - 2, py - size * 0.3, 4, size * 0.6);
          ctx.fillRect(px - size * 0.3, py - 2, size * 0.6, 4);
          ctx.restore();
        }
      }
    }
  }
  // Draw AFTER the intact/splitting tiles, otherwise those tiles hide the flash.
  const axes = [
    ...st.clear.rows.map((n: number) => ({ horizontal: true, n })),
    ...st.clear.cols.map((n: number) => ({ horizontal: false, n })),
  ];
  for (const { horizontal, n } of axes) {
    const r = horizontal ? n : 3,
      c = horizontal ? 3 : n,
      tint = h.tintForColor?.(st.before.board.cells[r][c] ?? st.piece.color);
    const beam = tint ? mixColor(tint, 0.25) : '#ff94d0',
      core = tint ? mixColor(tint, 0.86) : '#ffe9f6',
      tailColor = tint ?? '#fb62ae';
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : n * pitch), gy + (horizontal ? n * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    const a = smooth((age - 0.04) / 0.025) * (1 - smooth((age - 0.19) / 0.065));
    const width = pitch * board.length * smooth((age - 0.035) / 0.145),
      left = (pitch * board.length - width) / 2;
    if (a > 0 && width > 1) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = a * 0.6;
      ctx.shadowColor = tint ?? '#ff89d0';
      ctx.shadowBlur = 35;
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.roundRect(left, pitch * 0.3, width, pitch * 0.4, 20);
      ctx.fill();
      ctx.globalAlpha = a * 0.9;
      ctx.shadowBlur = 15;
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.roundRect(left + 5, pitch * 0.415, Math.max(1, width - 10), pitch * 0.17, 9);
      ctx.fill();
    }
    // A low, broad pink afterglow follows the moving fracture wave.
    const tail = smooth((age - 0.16) / 0.13) * (1 - smooth((age - 0.55) / 0.42));
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = tail * 0.28;
    const g = ctx.createLinearGradient(0, 0, 0, pitch);
    g.addColorStop(0, tailColor + '00');
    g.addColorStop(0.5, tailColor);
    g.addColorStop(1, tailColor + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, pitch * board.length, pitch);
    ctx.restore();
  }
}
