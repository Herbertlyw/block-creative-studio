// Derived production module; supplied reference files remain unchanged.
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const random = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export function iceShardPose(age: number, seed: number, pitch: number) {
  const t = Math.max(0, age - 0.035),
    angle = random(seed) * Math.PI * 2,
    speed = pitch * (1.6 + random(seed + 2) * 3.8);
  return {
    x: Math.cos(angle) * speed * t,
    y: Math.sin(angle) * speed * t + pitch * 18 * t * t,
    rotation: (random(seed + 3) - 0.5) * t * 9,
    alpha: 1 - clamp((t - 0.2) / 0.36),
  };
}
/** Glass triangles retain each cleared cell's native material, including mixed-color pieces. */
export function drawIceClear(h: any, st: any, age: number, time: number, board: any[][]) {
  const { ctx, gx, gy, pitch, tile, glow } = h;
  if (age < 0.16) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = age < 0 ? 0.55 : 1 - clamp(age / 0.16);
    for (const cell of st.clear.cells) {
      const x = gx + cell.col * pitch,
        y = gy + cell.row * pitch;
      glow(x + pitch / 2, y + pitch / 2, pitch * 0.95, '#7ceaffb0');
      ctx.fillStyle = '#dcfdff';
      ctx.fillRect(x, y, pitch, pitch);
    }
    ctx.restore();
  }
  if (age < 0) return;
  const points = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  for (const [index, cell] of st.clear.cells.entries()) {
    const color =
      st.placedColors?.[`${cell.row},${cell.col}`] ??
      st.before.board.cells[cell.row][cell.col] ??
      st.piece.color;
    if (board[cell.row][cell.col] !== null) continue;
    for (let j = 0; j < 4; j++) {
      const p = iceShardPose(age, index * 43 + j * 7, pitch);
      if (p.alpha <= 0) continue;
      ctx.save();
      ctx.translate(gx + (cell.col + 0.5) * pitch + p.x, gy + (cell.row + 0.5) * pitch + p.y);
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.alpha;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(points[j][0] * pitch, points[j][1] * pitch);
      ctx.lineTo(points[(j + 1) % 4][0] * pitch, points[(j + 1) % 4][1] * pitch);
      ctx.closePath();
      ctx.clip();
      tile(-pitch / 2, -pitch / 2, pitch, color, time);
      ctx.restore();
    }
  }
}
