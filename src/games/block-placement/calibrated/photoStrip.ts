// Derived production module; supplied reference files remain unchanged.
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const noise = (i: number) => {
  const n = Math.sin(i * 71.73 + 28.16) * 19753.317;
  return n - Math.floor(n);
};
/** Photo skins keep their mapped image until a short white outlined dissolve. */
export function drawPhotoStrip(h: any, st: any, age: number, time: number, board: any[][]) {
  const { ctx, gx, gy, pitch, tile } = h;
  if (age < 0) {
    for (const c of st.clear.cells) {
      const face =
        st.before.board.cells[c.row][c.col] ??
        st.placedColors?.[`${c.row},${c.col}`] ??
        st.piece.color;
      tile(gx + c.col * pitch, gy + c.row * pitch, pitch, face, time);
    }
  }
  const axes = [
    ...st.clear.rows.map((n: number) => ({ n, horizontal: true })),
    ...st.clear.cols.map((n: number) => ({ n, horizontal: false })),
  ];
  const alpha = age < 0 ? 1 : 1 - clamp((age - 0.025) / 0.18);
  for (const { n, horizontal } of axes) {
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : n * pitch), gy + (horizontal ? n * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#fff9f0';
    ctx.shadowColor = '#fff0dc';
    ctx.shadowBlur = 24;
    ctx.lineWidth = 5;
    ctx.strokeRect(2, 2, pitch * board.length - 4, pitch - 4);
    if (age >= 0) {
      ctx.globalAlpha = alpha * 0.19;
      ctx.fillStyle = '#fff8ef';
      ctx.fillRect(0, 0, pitch * board.length, pitch);
      for (let i = 0; i < 22; i++) {
        const size = 10 + noise(i + n * 31) * 27,
          x = ((i + 0.5) * pitch * board.length) / 22,
          y = pitch * (0.2 + noise(i + 81) * 0.6);
        ctx.globalAlpha = alpha * (0.65 + 0.35 * noise(i + 4));
        ctx.shadowBlur = 5;
        ctx.fillStyle = '#fffefb';
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
    }
    ctx.restore();
  }
}
