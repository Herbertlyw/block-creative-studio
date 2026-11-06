// Derived production module; supplied reference files remain unchanged.
const sat = (x: number) => Math.max(0, Math.min(1, x));
const noise = (x: number) => {
  const n = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};
export function stoneShardPose(age: number, seed: number, pitch: number) {
  const n = noise(seed),
    m = noise(seed + 9);
  return {
    x: (n - 0.5) * pitch * (0.5 + age * 3.5),
    y: -pitch * (0.1 + m * 0.5) - age * (110 + m * 270) + age * age * 900,
    rotation: n * 6 + age * (m - 0.5) * 9,
    size: pitch * (0.12 + n * 0.15),
    alpha: age < 0 ? 0 : 1 - sat((age - 0.23) / 0.27),
  };
}
/** Dry, irregular fragments sampled from the actual stone face, with short white impact dust. */
export function drawStoneBurst(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < 0 || age > 0.5) return;
  const { ctx, gx, gy, pitch, tile, glow } = h;
  for (const [k, c] of st.clear.cells.entries()) {
    if (board[c.row][c.col] != null) continue;
    const face =
        st.before.board.cells[c.row][c.col] ??
        st.placedColors?.[`${c.row},${c.col}`] ??
        st.piece.color,
      cx = gx + (c.col + 0.5) * pitch,
      cy = gy + (c.row + 0.5) * pitch;
    glow(cx, cy + pitch * 0.28, pitch * 0.4, '#fff5caaa', (1 - sat(age / 0.25)) * 0.75);
    for (let j = 0; j < 9; j++) {
      const seed = k * 23 + j * 5,
        p = stoneShardPose(age, seed, pitch);
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(cx + p.x, cy + p.y);
      ctx.rotate(p.rotation);
      ctx.beginPath();
      for (let v = 0; v < 6; v++) {
        const a = (v * Math.PI) / 3,
          r = p.size * (0.65 + 0.35 * noise(seed + v * 7));
        const x = Math.cos(a) * r,
          y = Math.sin(a) * r;
        v ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.clip();
      tile(-p.size, -p.size, p.size * 2, face, time);
      ctx.restore();
    }
    for (let j = 0; j < 3; j++) {
      const n = noise(k * 17 + j),
        x = cx + (n - 0.5) * pitch,
        y = cy + pitch * 0.35 - age * 30;
      ctx.save();
      ctx.globalAlpha = (1 - sat(age / 0.3)) * (0.3 + n * 0.7);
      ctx.fillStyle = '#fffde7';
      ctx.shadowColor = '#fff7dc';
      ctx.shadowBlur = 12;
      const z = 3 + 4 * n;
      ctx.fillRect(x - z, y - z, z * 2, z * 2);
      ctx.restore();
    }
  }
}
