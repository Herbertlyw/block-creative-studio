// Derived production module; supplied reference files remain unchanged.
const sat = (x: number) => Math.max(0, Math.min(1, x));
const rnd = (x: number) => {
  const n = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return n - Math.floor(n);
};
/** Upward angular chips measured from the first two stone row clears in JP2161. */
export function stoneSprayPose(
  age: number,
  seed: number,
  pitch: number,
  controls?: { stoneLiftScale?: number; stoneGravityScale?: number; stoneLifeScale?: number },
) {
  const lift = controls?.stoneLiftScale ?? 1,
    gravity = controls?.stoneGravityScale ?? 1,
    lifeScale = controls?.stoneLifeScale ?? 1;
  const n = rnd(seed),
    m = rnd(seed + 9),
    life = (0.42 + rnd(seed + 41) * 0.24) * lifeScale;
  return {
    x: (n - 0.5) * pitch * (0.75 + age * 4.1),
    y:
      -(rnd(seed + 2) * 0.54) * pitch * lift -
      age * pitch * (2.6 + m * 6.7) * lift +
      age * age * pitch * 8.2 * gravity,
    rotation: n * 6.28 + age * (m - 0.5) * 13,
    size: pitch * (0.13 + rnd(seed + 17) * 0.19),
    alpha: age < 0 ? 0 : 1 - sat((age - life * 0.62) / (life * 0.38)),
  };
}
export function drawStoneSpray(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < 0 || age > 0.7 * (h.stoneLifeScale ?? 1)) return;
  const { ctx, gx, gy, pitch, tile, glow } = h;
  for (const [k, c] of st.clear.cells.entries()) {
    if (board[c.row][c.col] != null) continue;
    const face =
        st.before.board.cells[c.row][c.col] ??
        st.placedColors?.[`${c.row},${c.col}`] ??
        st.piece.color,
      cx = gx + (c.col + 0.5) * pitch,
      cy = gy + (c.row + 0.5) * pitch;
    glow(cx, cy + pitch * 0.21, pitch * 0.54, '#fff5dacc', (1 - sat(age / 0.22)) * 0.9);
    if (h.stoneDustGlow) {
      const a = (1 - sat((age - 0.12) / 0.55)) * 0.7;
      glow(cx, cy + pitch * 0.35, pitch * 0.7, '#ffcf6380', a);
      for (let d = 0; d < 4; d++) {
        const xx = cx + (rnd(k * 43 + d) - 0.5) * pitch,
          yy = cy + pitch * (0.2 + rnd(k * 67 + d) * 0.55) + age * pitch * 0.3;
        glow(xx, yy, pitch * 0.065, '#fff2a6dd', a);
        ctx.save();
        ctx.globalAlpha = a;
        ctx.strokeStyle = '#fffbd4';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(xx - 5, yy);
        ctx.lineTo(xx + 5, yy);
        ctx.moveTo(xx, yy - 5);
        ctx.lineTo(xx, yy + 5);
        ctx.stroke();
        ctx.restore();
      }
    }
    for (let j = 0; j < 13; j++) {
      const seed = k * 113 + j * 7,
        p = stoneSprayPose(age, seed, pitch, h);
      if (p.alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(cx + p.x, cy + p.y);
      ctx.rotate(p.rotation);
      if (h.stoneFragments && h.stoneFragmentRects?.length) {
        const rect = h.stoneFragmentRects[(k * 3 + j) % h.stoneFragmentRects.length],
          scale = (p.size * (h.stoneFragmentScale ?? 1)) / Math.max(rect[2], rect[3]),
          width = rect[2] * scale,
          height = rect[3] * scale;
        ctx.drawImage(h.stoneFragments, ...rect, -width / 2, -height / 2, width, height);
        ctx.restore();
        continue;
      }
      const points =
        j % 3 === 0
          ? [
              [-0.9, -0.65],
              [0.88, -0.5],
              [0.1, 0.92],
            ]
          : [
              [-0.92, -0.6],
              [0.52, -0.94],
              [0.92, 0.43],
              [-0.5, 0.86],
            ];
      ctx.beginPath();
      points.forEach(([x, y]: number[], i: number) =>
        i ? ctx.lineTo(x * p.size, y * p.size) : ctx.moveTo(x * p.size, y * p.size),
      );
      ctx.closePath();
      ctx.save();
      ctx.clip();
      tile(-p.size, -p.size, p.size * 2, face, time);
      ctx.fillStyle = j % 3 === 0 ? '#d4a36545' : '#ffe6b720';
      ctx.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
      ctx.restore();
      ctx.lineWidth = Math.max(0.75, pitch * 0.008);
      ctx.strokeStyle = '#78573390';
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(points[0][0] * p.size, points[0][1] * p.size);
      ctx.lineTo(points[1][0] * p.size, points[1][1] * p.size);
      ctx.lineTo(0, 0);
      ctx.closePath();
      ctx.fillStyle = '#fff4d377';
      ctx.fill();
      ctx.restore();
    }
    for (let j = 0; j < 7; j++) {
      const n = rnd(k * 19 + j),
        m = rnd(k * 31 + j + 20),
        x = cx + (n - 0.5) * pitch * 1.1,
        y = cy + pitch * (0.18 + m * 0.25) - age * pitch * (0.25 + m * 1.9),
        a = (1 - sat(age / (0.24 + m * 0.16))) * (0.4 + n * 0.6);
      if (a <= 0) continue;
      glow(x, y, pitch * (0.06 + m * 0.07), '#fff6cecc', a);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fffde8';
      ctx.beginPath();
      ctx.arc(x, y, pitch * (0.012 + m * 0.018), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
