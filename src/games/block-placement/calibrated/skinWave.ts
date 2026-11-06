// Derived production module; supplied reference files remain unchanged.
const sat = (x: number) => Math.max(0, Math.min(1, x));
const noise = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const rainbow = [
  '#ed4938',
  '#ffa931',
  '#f2e242',
  '#70dc39',
  '#31e28a',
  '#29c6ec',
  '#4883ec',
  '#bc60e9',
];
/** Deform actual cell faces; the Take remains the sole owner of occupancy. */
export function drawSkinWave(h: any, st: any, age: number, time: number, board: any[][]) {
  // Before the clear, legal board/drag/preview passes own the tiles. Repainting
  // them here hides the glow and can cover the moving piece with stale faces.
  if (age < 0) return;
  const { ctx, gx, gy, pitch, tile } = h,
    mode = h.style,
    face = Object.values(st.placedColors ?? {})[0] ?? st.piece.color;
  for (const [k, c] of st.clear.cells.entries()) {
    // Before the clear, the legal board still owns these cells. Paint the
    // synchronized line face above it; after the clear, respect new placements.
    if (age >= 0 && board[c.row][c.col] != null) continue;
    const horizontal = st.clear.rows.includes(c.row),
      rawAxis = horizontal ? c.col : c.row,
      axis = h.rainbowReverse ? board.length - 1 - rawAxis : rawAxis,
      delay = mode === 'rainbow-sweep' ? axis * 0.022 : mode === 'panel-flip' ? axis * 0.022 : 0,
      local = age - (h.rainbowGapSeconds ?? 0) - delay;
    const phase = h.rainbowCells?.find((p: any) => p.row === c.row && p.col === c.col);
    if (phase) {
      const mat =
        st.placedColors?.[`${c.row},${c.col}`] ?? st.before.board.cells[c.row][c.col] ?? face;
      if (age < phase.hide) {
        tile(gx + c.col * pitch, gy + c.row * pitch, pitch, mat, time);
        continue;
      }
      if (age < phase.show) continue;
      const u = sat((age - phase.show) / Math.max(0.01, phase.end - phase.show)),
        scale = 1 - sat((u - 0.28) / 0.72),
        col = rainbow[h.rainbowReverse ? rawAxis : board.length - 1 - rawAxis],
        cx = gx + (c.col + 0.5) * pitch,
        cy = gy + (c.row + 0.5) * pitch;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.shadowColor = col;
      ctx.shadowBlur = 25 * (1 - u);
      if (scale > 0) {
        ctx.save();
        ctx.scale(scale, scale);
        tile(-pitch / 2, -pitch / 2, pitch, mat, time, 1, col);
        ctx.restore();
      }
      const travel = Math.max(0, age - phase.show - 0.035);
      if (travel < 0.4)
        for (let j = 0; j < 6; j++) {
          const seed = k * 23 + j * 11,
            n = noise(seed),
            m = noise(seed + 1),
            z = (6 + n * 16) * (1 - travel / 0.4);
          ctx.save();
          ctx.globalAlpha = sat(travel / 0.02) * (1 - travel / 0.4);
          ctx.fillStyle = col;
          ctx.translate(
            (n - 0.5) * pitch * (0.4 + travel * 6),
            (m - 0.5) * pitch * (0.4 + travel * 6),
          );
          ctx.rotate(n * 5 + travel * 4);
          ctx.fillRect(-z / 2, -z / 2, z, z);
          ctx.restore();
        }
      ctx.restore();
      continue;
    }
    const gap = h.rainbowGapSeconds ?? 0,
      placed = st.placedCells.some((p: any) => p.row === c.row && p.col === c.col);
    if (mode === 'rainbow-sweep' && gap > 0 && age < gap && !placed) continue;
    const material =
      mode === 'jelly-wave' || mode === 'panel-flip'
        ? face
        : (st.before.board.cells[c.row][c.col] ?? face);
    const tint =
        mode === 'rainbow-sweep'
          ? rainbow[
              h.rainbowGapSeconds !== undefined
                ? h.rainbowReverse
                  ? rawAxis
                  : board.length - 1 - rawAxis
                : rawAxis
            ]
          : undefined,
      color = tint ?? h.faceColor?.(material) ?? '#bfffff';
    const alpha = 1 - sat((local - 0.22) / 0.24),
      cx = gx + (c.col + 0.5) * pitch,
      cy = gy + (c.row + 0.5) * pitch;
    if (alpha > 0) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = alpha;
      if (mode === 'panel-flip')
        ctx.scale(
          horizontal ? 1 : Math.max(0.04, Math.abs(Math.cos(Math.max(0, local - 0.12) * 11))),
          horizontal ? Math.max(0.04, Math.abs(Math.cos(Math.max(0, local - 0.12) * 11))) : 1,
        );
      else if (mode === 'jelly-wave') {
        ctx.translate(
          0,
          Math.sin(axis * 0.65 + local * 15) * pitch * 0.14 * sat((local + 0.02) * 8),
        );
        ctx.transform(1, Math.sin(axis + local * 13) * 0.09, 0, 1, 0, 0);
        ctx.scale(1.02, 1 + Math.sin(local * 12 + axis * 0.6) * 0.12);
      } else {
        const scale = 1 - sat((local - 0.04) / 0.095);
        ctx.scale(scale, scale);
      }
      tile(-pitch / 2, -pitch / 2, pitch, material, time, 1, tint);
      ctx.restore();
      if (mode !== 'rainbow-sweep' && age < 0.13) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = (1 - sat(Math.max(0, age) / 0.13)) * 0.65;
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, pitch * 0.65);
        g.addColorStop(0, '#f8ffcfa0');
        g.addColorStop(0.35, color + '77');
        g.addColorStop(1, color + '00');
        ctx.fillStyle = g;
        ctx.fillRect(cx - pitch, cy - pitch, pitch * 2, pitch * 2);
        ctx.restore();
      }
    }
    if (local < 0 || local > 0.65) continue;
    if (mode === 'rainbow-sweep') {
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      const g = ctx.createRadialGradient(cx, cy, 1, cx, cy, pitch * 0.95);
      g.addColorStop(0, color + 'aa');
      g.addColorStop(1, color + '00');
      ctx.globalAlpha = (1 - sat(local / 0.6)) * 0.65;
      ctx.fillStyle = g;
      ctx.fillRect(cx - pitch, cy - pitch, pitch * 2, pitch * 2);
      ctx.restore();
    }
    for (let j = 0; j < 5; j++) {
      const n = noise(k * 23 + j * 7),
        m = noise(k * 23 + j * 7 + 1),
        travel = Math.max(0, local - (mode === 'rainbow-sweep' ? 0.035 : 0.1)),
        x = cx + (n - 0.5) * pitch * (0.5 + travel * 4),
        y = cy + (m - 0.5) * pitch * (0.5 + travel * 4) + travel * travel * 150,
        size = (7 + n * 15) * (1 - sat(travel / 0.8));
      ctx.save();
      ctx.globalAlpha = sat(travel / 0.03) * (1 - sat((travel - 0.18) / 0.4));
      ctx.shadowColor = color;
      ctx.shadowBlur = mode === 'rainbow-sweep' ? 14 : 3;
      ctx.fillStyle = j === 0 ? '#fff7ba' : color;
      ctx.translate(x, y);
      ctx.rotate(n * 4 + travel * 3);
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();
    }
  }
}
