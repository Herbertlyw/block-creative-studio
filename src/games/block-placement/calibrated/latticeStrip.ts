// Derived production module; supplied reference files remain unchanged.
const sat = (x: number) => Math.max(0, Math.min(1, x));
const rand = (n: number) => {
  const x = Math.sin(n * 91.31 + 17.73) * 47721.38;
  return x - Math.floor(x);
};
/** Coarse same-face diagonal lattice breaks into tiny square motes; no gameplay footage. */
export function drawLatticeStrip(h: any, st: any, age: number, time: number, board: any[][]) {
  const { ctx, gx, gy, pitch } = h,
    face = Object.values(st.placedColors ?? {})[0] ?? st.piece.color;
  const raw = h.faceColor?.(face) ?? '#ef7eac',
    rgb = raw.match(/[a-f0-9]{2}/gi)?.map((x: string) => parseInt(x, 16)) ?? [240, 100, 170];
  const mx = Math.max(...rgb),
    color =
      '#' +
      rgb
        .map((v: number) =>
          Math.min(255, Math.round(((v * 255) / mx) * 0.78 + 56))
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
  const axes = [
    ...st.clear.rows.map((n: number) => ({ n, horizontal: true })),
    ...st.clear.cols.map((n: number) => ({ n, horizontal: false })),
  ];
  for (const { n, horizontal } of axes) {
    const flash = age < 0 ? sat((age + 0.09) / 0.06) : 1 - sat((age - 0.18) / 0.18),
      tail = age < 0 ? 0 : 1 - sat((age - 0.25) / 0.62);
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : n * pitch), gy + (horizontal ? n * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    const width = board.length * pitch;
    ctx.shadowColor = color;
    ctx.shadowBlur = 28;
    if (tail > 0) {
      const g = ctx.createLinearGradient(0, -pitch * 0.45, 0, pitch * 1.45);
      g.addColorStop(0, color + '00');
      g.addColorStop(0.5, color + '70');
      g.addColorStop(1, color + '00');
      ctx.globalAlpha = tail * 0.85;
      ctx.fillStyle = g;
      ctx.fillRect(0, -pitch * 0.45, width, pitch * 1.9);
    }
    if (flash > 0) {
      ctx.globalAlpha = flash;
      ctx.lineWidth = 4;
      ctx.strokeStyle = color;
      ctx.strokeRect(1, 2, width - 2, pitch - 4);
      ctx.shadowBlur = 10;
      ctx.strokeStyle = '#f7fff1';
      ctx.lineWidth = 2;
      ctx.strokeRect(3, 4, width - 6, pitch - 8);
      ctx.save();
      ctx.beginPath();
      ctx.rect(1, 1, width - 2, pitch - 2);
      ctx.clip();
      ctx.globalAlpha = flash * 0.9;
      ctx.strokeStyle = color;
      ctx.shadowBlur = 4;
      ctx.lineWidth = 10;
      ctx.beginPath();
      for (let x = -pitch; x < width; x += pitch * 0.5) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x + pitch, pitch);
        ctx.moveTo(x, pitch);
        ctx.lineTo(x + pitch, 0);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (age >= 0.06 && tail > 0)
      for (let j = 0; j < board.length * 3; j++) {
        const seed = j + n * 41 + (horizontal ? 0 : 901),
          u = rand(seed),
          v = rand(seed + 8),
          sz = (9 + u * 25) * (1 - sat(age / 1.3) * 0.3),
          xx = ((j + 0.4) * width) / (board.length * 3) + (u - 0.5) * age * 70,
          yy = pitch * (0.15 + v * 0.7) + (v - 0.5) * age * 120;
        ctx.save();
        ctx.translate(xx, yy);
        ctx.rotate(u * Math.PI + age * (v - 0.5));
        ctx.globalAlpha = tail * (0.45 + u * 0.5);
        ctx.fillStyle = color;
        ctx.shadowBlur = j % 3 === 0 ? 9 : 0;
        ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
        ctx.restore();
      }
    ctx.restore();
  }
}
