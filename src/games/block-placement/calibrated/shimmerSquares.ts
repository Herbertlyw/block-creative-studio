// Derived production module; supplied reference files remain unchanged.
const sat = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  v = sat(v);
  return v * v * (3 - 2 * v);
};
const rnd = (v: number) => {
  const x = Math.sin(v * 127.1 + 31.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Soft illuminated faces dissolve into filled and hollow square motes. */
export function drawShimmerSquares(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < 0) return;
  const { ctx, gx, gy, pitch } = h,
    bands = h.style === 'luminous-bands',
    luminous = h.style === 'luminous-squares' || bands;
  if (bands) {
    const c = st.clear.cells[0],
      face =
        st.placedColors?.[`${c.row},${c.col}`] ??
        st.before.board.cells[c.row][c.col] ??
        st.piece.color,
      color = h.faceColor?.(face) ?? '#6eeaff',
      a = 1 - smooth((age - 0.1) / 0.38);
    if (a > 0) {
      ctx.save();
      ctx.globalAlpha = a * 0.8;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 30;
      for (const row of st.clear.rows) {
        ctx.beginPath();
        ctx.roundRect(
          gx,
          gy + row * pitch + pitch * 0.04,
          pitch * board[0].length,
          pitch * 0.92,
          pitch * 0.25,
        );
        ctx.fill();
      }
      for (const col of st.clear.cols) {
        ctx.beginPath();
        ctx.roundRect(
          gx + col * pitch + pitch * 0.04,
          gy,
          pitch * 0.92,
          pitch * board.length,
          pitch * 0.25,
        );
        ctx.fill();
      }
      ctx.restore();
    }
  }
  if (luminous && !bands && st.clear.rows.length === 1 && st.clear.cols.length === 0) {
    const color =
        h.faceColor?.(
          st.placedColors?.[`${st.clear.rows[0]},0`] ?? st.before.board.cells[st.clear.rows[0]][0],
        ) ?? '#ffe184',
      a = 1 - smooth((age - 0.06) / 0.27);
    if (a > 0) {
      ctx.save();
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 30;
      ctx.beginPath();
      ctx.roundRect(
        gx + pitch * 0.03,
        gy + st.clear.rows[0] * pitch + pitch * 0.08,
        pitch * board[0].length - pitch * 0.06,
        pitch * 0.84,
        pitch * 0.3,
      );
      ctx.fill();
      ctx.restore();
    }
  }
  for (const [k, c] of st.clear.cells.entries()) {
    if (board[c.row][c.col] != null) continue;
    const face =
      st.placedColors?.[`${c.row},${c.col}`] ??
      st.before.board.cells[c.row][c.col] ??
      st.piece.color;
    const color = h.faceColor?.(face) ?? '#ffe184';
    const x = gx + c.col * pitch,
      y = gy + c.row * pitch,
      dist = Math.hypot(c.row - (board.length - 1) / 2, c.col - (board[0].length - 1) / 2),
      body =
        1 -
        smooth(
          (age - 0.02) /
            (luminous ? (dist > 2.2 ? 0.08 : 0.45) : Math.max(0.08, 0.37 - dist * 0.055)),
        );
    if (body > 0 && !bands) {
      ctx.save();
      ctx.globalAlpha = body * (luminous ? 0.95 : 0.7);
      ctx.shadowColor = color;
      ctx.shadowBlur = 32;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x + pitch * 0.07, y + pitch * 0.04, pitch * 0.86, pitch * 0.92, 18);
      ctx.fill();
      const g = ctx.createLinearGradient(x, 0, x + pitch, 0);
      g.addColorStop(0, color + '00');
      g.addColorStop(0.5, '#fff0ce');
      g.addColorStop(1, color + '00');
      ctx.globalAlpha = body * 0.45;
      ctx.fillStyle = g;
      ctx.fillRect(x, y - pitch * 0.4, pitch, pitch * 1.8);
      ctx.restore();
    }
    const a = sat(age / (luminous ? 0.24 : 0.14)) * (1 - smooth((age - 0.25) / 0.65));
    if (a <= 0) continue;
    for (let j = 0; j < (bands ? 4 : 7); j++) {
      const seed = k * 17 + j,
        sz =
          pitch *
          (luminous ? 0.06 + rnd(seed) * 0.23 : 0.035 + rnd(seed) * 0.12) *
          (1 - age * 0.25),
        xx = x + pitch * rnd(seed + 21) + Math.sin(seed) * age * 27,
        yy = y + pitch * rnd(seed + 49) + age * (rnd(seed + 73) * 70 - 35);
      ctx.save();
      ctx.translate(xx, yy);
      ctx.rotate(bands ? rnd(seed + 8) * 0.12 : rnd(seed + 8) * 0.4 + age * (rnd(seed + 30) - 0.5));
      ctx.globalAlpha = a * (0.55 + rnd(seed + 87) * 0.4);
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 7;
      ctx.lineWidth = 2;
      if (j % 3 === 0) ctx.strokeRect(-sz / 2, -sz / 2, sz, sz);
      else ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
      ctx.restore();
    }
  }
}
