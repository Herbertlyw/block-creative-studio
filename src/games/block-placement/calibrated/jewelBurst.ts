// Derived production module; supplied reference files remain unchanged.
// Inset-tile reference: a short luminous line, then many tumbling faceted chips.
// This is a presentation-only effect. Native replay owns the cleared cells.
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const random = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export function jewelChipPose(age: number, seed: number, pitch: number) {
  const life = 0.23 + random(seed + 2) * 0.14,
    u = clamp(age / life),
    a = random(seed) * Math.PI * 2;
  return {
    x: Math.cos(a) * pitch * (0.2 + random(seed + 3) * 0.7) * Math.sin(u * Math.PI * 0.55),
    y: Math.sin(a) * pitch * 0.65 * u + pitch * 0.65 * u * u,
    scale: Math.pow(1 - u, 0.7),
    rotation: random(seed + 7) * 6 + age * (random(seed + 5) - 0.5) * 9,
    alpha: 1 - clamp((u - 0.65) / 0.35),
  };
}
export function drawJewelBurst(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < -0.06 || age > 0.62) return;
  const { ctx, gx, gy, pitch, tile, glow } = h;
  const placed = Object.values(st.placedColors ?? {}).map(String),
    gold = placed.some((x) => x === 'observed-face:5');
  const base = gold ? '#ffe382' : '#ffa790',
    light = gold ? '#fff4bc' : '#ffd1bb',
    dark = gold ? '#e9b84f' : '#df795a',
    halo = gold ? '#ffd348' : '#ff95d4';
  const axes = [
    ...st.clear.rows.map((n: number) => ({ horizontal: true, n })),
    ...st.clear.cols.map((n: number) => ({ horizontal: false, n })),
  ];
  for (const { horizontal, n } of axes) {
    const x = gx + (horizontal ? 0 : n * pitch),
      y = gy + (horizontal ? n * pitch : 0),
      w = horizontal ? pitch * board.length : pitch,
      hh = horizontal ? pitch : pitch * board.length;
    const a = 1 - clamp((age - 0.13) / 0.25);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.shadowColor = halo;
    ctx.shadowBlur = 24;
    ctx.strokeStyle = '#ffcf54';
    ctx.lineWidth = 5;
    ctx.strokeRect(x + 2, y + 2, w - 4, hh - 4);
    ctx.globalAlpha = a * 0.3;
    ctx.fillStyle = halo;
    ctx.fillRect(x, y, w, hh);
    ctx.restore();
  }
  if (age < 0) return;
  for (const [k, { row, col }] of st.clear.cells.entries()) {
    if (board[row][col] != null) continue;
    const cx = gx + (col + 0.5) * pitch,
      cy = gy + (row + 0.5) * pitch;
    // The reference burst opens at the line centre and travels toward both ends.
    const axis = st.clear.rows.includes(row) ? col : row,
      local = age - Math.abs(axis - 3.5) * 0.032;
    const material =
      st.before.board.cells[row][col] ?? st.placedColors?.[`${row},${col}`] ?? st.piece.color;
    if (local < 0.075)
      tile(cx - pitch / 2, cy - pitch / 2, pitch, material, time, 1 - clamp(local / 0.075));
    if (local < 0) continue;
    glow(cx, cy, pitch * 1.2, halo + 'd0', 0.85 * (1 - clamp(local / 0.18)));
    if (local < 0.12) glow(cx, cy, pitch * 0.62, '#fff8d9e0', 1 - clamp(local / 0.12));
    for (let j = 0; j < 5; j++) {
      const seed = k * 31 + j * 13 + row * 7,
        p = jewelChipPose(local, seed, pitch);
      if (p.alpha <= 0) continue;
      const sz = pitch * (0.3 + random(seed + 4) * 0.3) * p.scale;
      ctx.save();
      ctx.translate(
        cx + (random(seed + 8) - 0.5) * pitch * 0.8 + p.x,
        cy + (random(seed + 9) - 0.5) * pitch * 0.8 + p.y,
      );
      ctx.rotate(p.rotation);
      ctx.globalAlpha = p.alpha;
      const hex = [
        [-0.42, -0.32],
        [0.08, -0.55],
        [0.5, -0.22],
        [0.42, 0.33],
        [-0.1, 0.54],
        [-0.5, 0.2],
      ];
      const poly = (points: number[][], color: string) => {
        ctx.beginPath();
        points.forEach(([x, y], i) =>
          i ? ctx.lineTo(x * sz, y * sz) : ctx.moveTo(x * sz, y * sz),
        );
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      poly(hex, base);
      poly([hex[0], hex[1], hex[2], [0, 0]], light);
      poly([[0, 0], hex[2], hex[3], hex[4]], dark);
      ctx.strokeStyle = gold ? '#fff8d2' : '#ffd5b5';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(-0.42 * sz, -0.32 * sz);
      ctx.lineTo(0, 0);
      ctx.lineTo(0.5 * sz, -0.22 * sz);
      ctx.stroke();
      ctx.restore();
    }
    if (age > 0.16 && age < 0.55) {
      for (let j = 0; j < 2; j++) {
        const seed = k * 13 + j * 19,
          sz = (3 + random(seed) * 5) * (1 - clamp((age - 0.22) / 0.33));
        ctx.save();
        ctx.translate(cx + (random(seed + 1) - 0.5) * pitch, cy + (random(seed + 2) - 0.5) * pitch);
        ctx.globalAlpha = 1 - clamp((age - 0.2) / 0.35);
        ctx.fillStyle = '#fff4bb';
        ctx.shadowBlur = 9;
        ctx.shadowColor = '#ffcf45';
        ctx.beginPath();
        ctx.moveTo(0, -sz);
        ctx.lineTo(sz * 0.2, -sz * 0.2);
        ctx.lineTo(sz, 0);
        ctx.lineTo(sz * 0.2, sz * 0.2);
        ctx.lineTo(0, sz);
        ctx.lineTo(-sz * 0.2, sz * 0.2);
        ctx.lineTo(-sz, 0);
        ctx.lineTo(-sz * 0.2, -sz * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }
}
