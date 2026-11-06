// Derived production module; supplied reference files remain unchanged.
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const noise = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Whole bevelled cubes spread first, then accelerate below the cleared rows. */
export function cubeBurstPose(age: number, index: number, pitch: number) {
  const t = Math.max(0, age),
    seed = index * 19 + 11,
    pop = 1 - Math.exp(-(t + 0.028) * 35),
    fall = Math.max(0, t - 0.025);
  return {
    x: (noise(seed) - 0.5) * pitch * (1.1 * pop + t * 8),
    y: pitch * ((noise(seed + 1) - 0.54) * 2.5 * pop - 0.6 - t * 2 + 600 * fall * fall),
    size: pitch * (0.7 + noise(seed + 2) * 0.35),
    rotation: (noise(seed + 3) - 0.5) * (0.4 + t * 12),
    alpha: age < 0 ? 0 : 1 - clamp((t - 0.19) / 0.08),
  };
}
export function drawCubeBurst(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < 0 || age >= 0.27) return;
  const { ctx, gx, gy, pitch, tile } = h;
  for (const [i, cell] of st.clear.cells.entries()) {
    if (board[cell.row][cell.col] !== null) continue;
    const face =
      st.placedColors?.[`${cell.row},${cell.col}`] ??
      st.before.board.cells[cell.row][cell.col] ??
      st.piece.color;
    for (let j = 0; j < 2; j++) {
      const p = cubeBurstPose(age, i * 2 + j, pitch);
      if (!p.alpha) continue;
      ctx.save();
      ctx.translate(gx + (cell.col + 0.5) * pitch + p.x, gy + (cell.row + 0.5) * pitch + p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha *= p.alpha;
      const z = p.size * 0.09,
        s = p.size / 2,
        color = h.faceColor?.(face) ?? '#e9b63c';
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(-s, -s);
      ctx.lineTo(-s - z, -s - z);
      ctx.lineTo(s - z, -s - z);
      ctx.lineTo(s, -s);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#69430f';
      ctx.beginPath();
      ctx.moveTo(s, -s);
      ctx.lineTo(s - z, -s - z);
      ctx.lineTo(s - z, s - z);
      ctx.lineTo(s, s);
      ctx.closePath();
      ctx.fill();
      tile(-s, -s, p.size, face, time);
      ctx.restore();
    }
  }
}
