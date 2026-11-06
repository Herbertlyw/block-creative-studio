// Derived production module; supplied reference files remain unchanged.
const sat = (n: number) => Math.max(0, Math.min(1, n));
const noise = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export function materialStripPhase(age: number) {
  return {
    face: 1 - sat(age / 0.065),
    rim: 1 - sat((age - 0.05) / 0.23),
    motes: sat(age / 0.04) * (1 - sat((age - 0.09) / 0.25)),
  };
}
/** The source dissolves its pastel faces into a soft outlined strip and small square motes. */
export function drawMaterialStrip(h: any, st: any, age: number, time: number, board: any[][]) {
  const { ctx, gx, gy, pitch, tile } = h,
    phase = materialStripPhase(age);
  const face = Object.values(st.placedColors ?? {})[0] ?? st.piece.color;
  const color = h.faceColor?.(face) ?? '#cde3ed';
  const axes = [
    ...st.clear.rows.map((n: number) => ({ n, horizontal: true })),
    ...st.clear.cols.map((n: number) => ({ n, horizontal: false })),
  ];
  for (const { n, horizontal } of axes) {
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : n * pitch), gy + (horizontal ? n * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    ctx.globalAlpha = phase.rim;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.lineWidth = 5;
    ctx.strokeRect(2, 2, pitch * board.length - 4, pitch - 4);
    ctx.globalAlpha = phase.rim * 0.1;
    ctx.fillStyle = color;
    ctx.fillRect(1, 1, pitch * board.length - 2, pitch - 2);
    ctx.globalAlpha = phase.rim * 0.6;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff2f5';
    ctx.strokeRect(4, 4, pitch * board.length - 8, pitch - 8);
    ctx.restore();
  }
  for (const [k, cell] of st.clear.cells.entries()) {
    const x = gx + cell.col * pitch,
      y = gy + cell.row * pitch;
    if (board[cell.row][cell.col] == null && phase.face > 0)
      tile(x, y, pitch, face, time, phase.face);
    if (age < 0 || phase.motes <= 0) continue;
    for (let j = 0; j < 2; j++) {
      const n = noise(k * 31 + j),
        m = noise(k * 31 + j + 77),
        size = (15 + n * 21) * (1 - sat(age / 0.5) * 0.3);
      const xx = x + pitch * (0.15 + n * 0.7) + (n - 0.5) * age * 90,
        yy = y + pitch * (0.3 + m * 0.4) + (m - 0.5) * age * 65;
      ctx.save();
      ctx.globalAlpha = phase.motes * (0.5 + n * 0.5);
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.roundRect(xx - size / 2, yy - size / 2, size, size, 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
