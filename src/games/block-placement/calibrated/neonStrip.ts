// Derived production module; supplied reference files remain unchanged.
const sat = (v: number) => Math.max(0, Math.min(1, v));
const noise = (n: number) => {
  const x = Math.sin(n * 91.71 + 34.7) * 45187.23;
  return x - Math.floor(x);
};
function bright(hex: string) {
  const v = hex.match(/[a-f0-9]{2}/gi)?.map((n) => parseInt(n, 16)) ?? [80, 220, 60];
  const max = Math.max(...v);
  return (
    '#' +
    v
      .map((n) =>
        Math.round((n * 255) / Math.max(1, max))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
/** Saturated continuous line, white pre-clear core, then translucent motes. */
export function drawNeonStrip(h: any, st: any, age: number, time: number, board: any[][]) {
  if (h.style === 'neon-motes') {
    drawNeonMotes(h, st, age, time, board);
    return;
  }
  const { ctx, gx, gy, pitch } = h,
    face = Object.values(st.placedColors ?? {})[0] ?? st.piece.color,
    color = bright(h.faceColor?.(face) ?? '#69ff24');
  const axes = [
    ...st.clear.rows.map((n: number) => ({ n, horizontal: true })),
    ...st.clear.cols.map((n: number) => ({ n, horizontal: false })),
  ];
  for (const { n, horizontal } of axes) {
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : n * pitch), gy + (horizontal ? n * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    const alpha = age < 0 ? sat((age + 0.15) / 0.07) : 1 - sat((age - 0.25) / 0.45),
      height = age < 0 ? pitch * 0.13 : pitch;
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = 35;
    ctx.fillStyle = color;
    if (age >= 0) {
      const g = ctx.createLinearGradient(0, -pitch * 0.2, 0, pitch * 1.2);
      g.addColorStop(0, color + '00');
      g.addColorStop(0.25, color + '44');
      g.addColorStop(0.5, color + 'e0');
      g.addColorStop(0.75, color + '44');
      g.addColorStop(1, color + '00');
      ctx.fillStyle = g;
      ctx.fillRect(0, -pitch * 0.2, pitch * board.length, pitch * 1.4);
      ctx.globalAlpha = alpha * 0.45;
      ctx.fillStyle = '#f4ffd6';
      ctx.fillRect(0, pitch * 0.44, pitch * board.length, pitch * 0.12);
    } else {
      ctx.fillStyle = '#ecffdb';
      ctx.shadowBlur = 12;
      ctx.fillRect(0, pitch * 0.485, pitch * board.length, pitch * 0.03);
    }
    if (age >= 0)
      for (let i = 0; i < board.length * 3; i++) {
        const x = ((i + 0.3) * pitch) / 3 + (noise(i) - 0.5) * age * 60,
          y = pitch * (0.15 + noise(i + 4) * 0.7) + (noise(i + 8) - 0.5) * age * 70,
          size = 7 + noise(i + 1) * 19;
        ctx.globalAlpha = alpha * (0.3 + noise(i + 9) * 0.6);
        ctx.fillStyle = '#f6ffa8';
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
      }
    ctx.restore();
  }
}

/** Brief clear flash followed by independent luminous square motes. */
function drawNeonMotes(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < -0.16 || age > 1) return;
  const { ctx, gx, gy, pitch } = h,
    face = Object.values(st.placedColors ?? {})[0] ?? st.piece.color,
    color = bright(h.faceColor?.(face) ?? '#6aff28');
  const axes = [
    ...st.clear.rows.map((n: number) => ({ n, horizontal: true })),
    ...st.clear.cols.map((n: number) => ({ n, horizontal: false })),
  ];
  for (const { n, horizontal } of axes) {
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : n * pitch), gy + (horizontal ? n * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    const flash = age < 0 ? sat((age + 0.15) / 0.1) : Math.pow(1 - sat(age / 0.13), 2);
    if (flash > 0) {
      ctx.globalAlpha = flash;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;
      ctx.fillStyle = color;
      ctx.fillRect(0, pitch * 0.34, pitch * board.length, pitch * 0.32);
      ctx.fillStyle = '#f0ffe0';
      ctx.fillRect(0, pitch * 0.46, pitch * board.length, pitch * 0.07);
    }
    if (age >= 0) {
      const tail = 1 - sat((age - 0.18) / 0.68);
      for (let i = 0; i < board.length * 4; i++) {
        const seed = i + n * 43,
          x = ((i + 0.5) * pitch) / 4 + (noise(seed) - 0.5) * age * 90,
          y = pitch * (0.13 + noise(seed + 4) * 0.74) + (noise(seed + 8) - 0.5) * age * 95;
        const size = (8 + noise(seed + 1) * 23) * (1 - sat((age - 0.35) / 1.1));
        ctx.globalAlpha = tail * (0.25 + noise(seed + 9) * 0.7);
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 12 + noise(seed + 6) * 16;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
        if (i % 5 === 0) {
          ctx.globalAlpha = tail * 0.8;
          ctx.fillStyle = '#d7ff9a';
          ctx.fillRect(x - size * 0.3, y - size * 0.3, size * 0.6, size * 0.6);
        }
      }
    }
    ctx.restore();
  }
}
