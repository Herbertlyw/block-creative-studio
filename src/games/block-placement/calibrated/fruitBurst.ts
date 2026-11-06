// Derived production module; supplied reference files remain unchanged.
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const random = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const colors = [
  '#ed313b',
  '#ff5b25',
  '#f6c832',
  '#84ed32',
  '#33d253',
  '#36d5d7',
  '#4d86f5',
  '#b75df0',
];
const mix = (hex: string, k: number) => {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (
    '#' +
    v
      .map((n) =>
        Math.round(k >= 0 ? n + (255 - n) * k : n * (1 + k))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
};
/** Native cleared cells emit reference-matched candy cubes and round fruit beads.
 * Uses no gameplay footage; deterministic cell-local debris respects new placements. */
export function fruitParticlePose(age: number, seed: number, pitch: number) {
  const life = 0.46 + random(seed + 8) * 0.25,
    u = clamp(age / life);
  return {
    x: (random(seed + 1) - 0.5) * pitch * 0.85 + (random(seed + 2) - 0.5) * age * pitch * 3.4,
    y:
      -random(seed + 3) * pitch * 0.75 -
      age * pitch * (4.0 + random(seed + 4) * 6.0) +
      age * age * pitch * 7.2,
    size: pitch * (0.23 + random(seed + 5) * 0.35) * (1 - u * 0.34),
    rotation: random(seed + 6) * 5 + age * (random(seed + 7) - 0.5) * 12,
    alpha: age < 0 ? 0 : 1 - clamp((u - 0.68) / 0.32),
  };
}
export function drawFruitBurst(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < 0 || age > 0.84) return;
  const { ctx, gx, gy, pitch, tile, glow } = h;
  for (const [k, c] of st.clear.cells.entries()) {
    if (board[c.row][c.col] != null) continue;
    const axis = st.clear.rows.includes(c.row) ? c.col : c.row,
      col = colors[Math.min(7, Math.floor((axis * 8) / board.length))],
      cx = gx + (c.col + 0.5) * pitch,
      cy = gy + (c.row + 0.5) * pitch,
      local = age - Math.abs(axis - (board.length - 1) / 2) * 0.006;
    const material =
      st.before.board.cells[c.row][c.col] ??
      st.placedColors?.[`${c.row},${c.col}`] ??
      st.piece.color;
    if (local < 0.26) {
      const a = 1 - clamp((local - 0.19) / 0.07);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = mix(col, -0.35);
      ctx.fillRect(cx - pitch * 0.49, cy - pitch * 0.49, pitch * 0.98, pitch * 0.98);
      ctx.fillStyle = col;
      ctx.fillRect(cx - pitch * 0.37, cy - pitch * 0.37, pitch * 0.74, pitch * 0.74);
      ctx.fillStyle = mix(col, 0.45);
      ctx.beginPath();
      ctx.moveTo(cx - pitch * 0.49, cy - pitch * 0.49);
      ctx.lineTo(cx + pitch * 0.49, cy - pitch * 0.49);
      ctx.lineTo(cx + pitch * 0.37, cy - pitch * 0.37);
      ctx.lineTo(cx - pitch * 0.37, cy - pitch * 0.37);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    if (local < 0) continue;
    glow(cx, cy, pitch * 0.8, col + 'a0', 0.75 * (1 - clamp(local / 0.2)));
    if (k % 2 === 0) {
      glow(cx, cy - pitch * 0.1, pitch * 0.34, '#fffddaee', 1 - clamp(local / 0.22));
      if (local < 0.22) {
        const z = pitch * 0.25 * (1 - clamp(local / 0.22));
        ctx.save();
        ctx.fillStyle = '#fff39b';
        ctx.shadowColor = '#fff87e';
        ctx.shadowBlur = 16;
        ctx.beginPath();
        for (let q = 0; q < 8; q++) {
          const a = (q * Math.PI) / 4,
            r = q % 2 ? z * 0.23 : z;
          const x = cx + Math.cos(a) * r,
            y = cy + Math.sin(a) * r;
          q ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
    for (let j = 0; j < 9; j++) {
      const seed = k * 47 + j * 13 + 11,
        p = fruitParticlePose(local, seed, pitch);
      if (p.alpha <= 0) continue;
      ctx.save();
      ctx.globalAlpha = p.alpha;
      ctx.translate(cx + p.x, cy + p.y);
      ctx.rotate(p.rotation);
      const z = p.size,
        bead = j % 3 !== 0;
      if (bead) {
        const g = ctx.createRadialGradient(-z * 0.24, -z * 0.3, z * 0.03, 0, 0, z * 0.65);
        g.addColorStop(0, mix(col, 0.5));
        g.addColorStop(0.32, col);
        g.addColorStop(1, mix(col, -0.4));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(0, 0, z * 0.53, z * 0.57, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff88';
        ctx.beginPath();
        ctx.ellipse(-z * 0.19, -z * 0.23, z * 0.12, z * 0.06, -0.6, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = mix(col, -0.2);
        ctx.beginPath();
        ctx.roundRect(-z * 0.55, -z * 0.55, z * 1.1, z * 1.1, z * 0.13);
        ctx.fill();
        ctx.fillStyle = col;
        ctx.fillRect(-z * 0.43, -z * 0.38, z * 0.78, z * 0.77);
        ctx.fillStyle = mix(col, 0.5);
        ctx.beginPath();
        ctx.moveTo(-z * 0.55, -z * 0.55);
        ctx.lineTo(z * 0.55, -z * 0.55);
        ctx.lineTo(z * 0.35, -z * 0.37);
        ctx.lineTo(-z * 0.4, -z * 0.37);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = mix(col, -0.4);
        ctx.beginPath();
        ctx.moveTo(z * 0.55, -z * 0.55);
        ctx.lineTo(z * 0.55, z * 0.55);
        ctx.lineTo(z * 0.35, z * 0.4);
        ctx.lineTo(z * 0.35, -z * 0.37);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
    for (let j = 0; j < 3; j++) {
      const seed = k * 31 + j * 9,
        n = random(seed),
        a = 1 - clamp(local / 0.72),
        z = (5 + n * 8) * a,
        x = cx + (random(seed + 1) - 0.5) * pitch * 1.1,
        y = cy - local * pitch * (0.8 + n * 2);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = j === 0 ? '#fffacd' : col;
      ctx.shadowBlur = 8;
      ctx.shadowColor = col;
      ctx.translate(x, y);
      ctx.rotate(local * 5 + n * 4);
      ctx.fillRect(-z / 2, -z / 2, z, z);
      ctx.restore();
    }
  }
}
