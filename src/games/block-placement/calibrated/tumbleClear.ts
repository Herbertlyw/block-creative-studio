// Derived production module; supplied reference files remain unchanged.
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const noise = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Whole faces tip out of a line, accelerate downwards and shrink away. */
export function tumblePose(age: number, index: number, pitch: number) {
  const t = Math.max(0, age),
    seed = index * 17 + 9;
  return {
    x: (noise(seed) - 0.5) * pitch * 2.2 * t * 3,
    y:
      pitch * (noise(seed + 4) - 0.5) * 1.8 * (1 - Math.exp(-t * 25)) -
      pitch * (0.4 + noise(seed + 1) * 0.4) * t * 3 +
      pitch * 45 * t * t,
    rotation: (noise(seed + 2) - 0.5) * 4.4 * clamp(t / 0.35),
    scale: 1 - 0.5 * clamp((t - 0.1) / 0.5),
    alpha: 1 - clamp((t - 0.34) / 0.3),
  };
}
export function rapidTumblePose(age: number, index: number, pitch: number) {
  const p = tumblePose(Math.max(0, age) * 2.8, index, pitch);
  return { ...p, rotation: p.rotation * 0.45, scale: 1 - 0.35 * clamp((age - 0.12) / 0.14) };
}
/** Measured short grey clips: a fast flip and a gravity-driven fall below the board. */
export function referenceFallPose(age: number, index: number, pitch: number) {
  const t = Math.max(0, age),
    seed = index * 17 + 9,
    pop = 1 - Math.exp(-t * 32);
  return {
    x: (noise(seed) - 0.5) * pitch * (pop * 0.7 + t * 5),
    y: pitch * ((noise(seed + 1) - 0.4) * 3.2 * pop + (100 + noise(seed + 3) * 45) * t * t),
    rotation: (noise(seed + 2) - 0.5) * 2.6 * pop,
    scale: 1 - 0.25 * clamp(t / 0.32),
    alpha: 1 - clamp((t - 0.24) / 0.1),
  };
}
export function drawTumbleClear(h: any, st: any, age: number, time: number, board: any[][]) {
  // Before the clear, legal board/drag/preview passes own the tiles. Repainting
  // them here hides the glow and can cover the moving piece with stale faces.
  if (age < 0) return;
  const { ctx, gx, gy, pitch, tile } = h;
  const rapid = h.style === 'rapid-tumble',
    reference = h.style === 'reference-fall' || h.style === 'column-rain',
    clean = reference || rapid || h.style === 'confetti-tumble';
  if (age < 0.06) {
    ctx.save();
    ctx.globalAlpha = 1 - clamp(Math.max(0, age) / 0.06);
    ctx.strokeStyle = reference ? '#fff7ed' : '#fff0a1';
    ctx.lineWidth = 3;
    ctx.shadowBlur = 16;
    ctx.shadowColor = reference
      ? (h.faceColor?.(Object.values(st.placedColors ?? {})[0]) ?? '#effcff')
      : '#ffd331';
    for (const r of st.clear.rows)
      ctx.strokeRect(gx + 2, gy + r * pitch + 2, board.length * pitch - 4, pitch - 4);
    for (const c of st.clear.cols)
      ctx.strokeRect(gx + c * pitch + 2, gy + 2, pitch - 4, board.length * pitch - 4);
    ctx.restore();
  }

  // The burst stays near the cleared line while whole tiles fall below it.
  if (!clean && age >= 0.03 && age < 0.42) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = clamp((age - 0.03) / 0.04) * clamp((0.42 - age) / 0.2);
    for (const [i, cell] of st.clear.cells.entries()) {
      const x = gx + (cell.col + 0.5) * pitch,
        y = gy + (cell.row + 0.5) * pitch;
      h.glow(x, y, pitch * 0.62, '#ffcf3960');
      for (let j = 0; j < 3; j++) {
        const q = noise(i * 13 + j + 2),
          xx = x + (q - 0.5) * pitch * 0.6,
          yy = y - (age - 0.03) * (50 + q * 150);
        ctx.fillStyle = '#fff8b7';
        ctx.shadowColor = '#ffe136';
        ctx.shadowBlur = 14;
        ctx.beginPath();
        ctx.ellipse(xx, yy, 3 + q * 6, 5 + q * 8, age * 8 + j, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  // A brief staggered brightening preserves the original faces on surviving cells.
  if (!clean && age >= 0.025 && age < 0.32) {
    ctx.save();
    ctx.filter = 'brightness(1.65) saturate(.7)';
    for (let r = 0; r < board.length; r++)
      for (let c = 0; c < board[r].length; c++) {
        if (board[r][c] === null) continue;
        const distance = Math.min(
          ...st.clear.rows.map((v: number) => Math.abs(r - v)),
          ...st.clear.cols.map((v: number) => Math.abs(c - v)),
        );
        if (distance > 3) continue;
        const local = age - noise(r * board[r].length + c) * 0.09;
        ctx.globalAlpha = 0.65 * clamp(local / 0.035) * clamp((0.25 - local) / 0.15);
        if (ctx.globalAlpha > 0) tile(gx + c * pitch, gy + r * pitch, pitch, board[r][c], time);
      }
    ctx.restore();
  }

  if (clean && age >= 0.035 && age < 0.45) {
    const colors = ['#ff5b59', '#fbe551', '#78ee74', '#23cce9', '#ac6afa', '#f386da'];
    ctx.save();
    ctx.globalAlpha = clamp((0.45 - age) / 0.2);
    for (const [i, cell] of st.clear.cells.entries())
      for (let j = 0; j < 3; j++) {
        const n = noise(i * 31 + j),
          m = noise(i * 31 + j + 77),
          dt = age - 0.035;
        const x = gx + (cell.col + 0.5) * pitch + (n - 0.5) * pitch * (0.5 + dt * 3);
        const y =
          gy + (cell.row + 0.5) * pitch + (m - 0.5) * pitch * 0.5 - dt * 120 + dt * dt * 200;
        ctx.fillStyle = colors[(i + j) % colors.length];
        ctx.fillRect(x, y, 4 + n * 5, 5 + m * 6);
      }
    ctx.restore();
  }

  for (const [i, cell] of st.clear.cells.entries()) {
    if (board[cell.row][cell.col] !== null && !(reference && age < 0)) continue;
    const color =
      (reference ? Object.values(st.placedColors ?? {})[0] : undefined) ??
      st.placedColors?.[`${cell.row},${cell.col}`] ??
      st.before.board.cells[cell.row][cell.col] ??
      st.piece.color;
    const x = gx + (cell.col + 0.5) * pitch,
      y =
        h.style === 'column-rain'
          ? gy + pitch * (board.length - 0.3 + noise(i + 33) * 0.65)
          : gy + (cell.row + 0.5) * pitch;
    if (age < 0) {
      tile(x - pitch / 2, y - pitch / 2, pitch, color, time);
      continue;
    }
    const p = reference
      ? referenceFallPose(age, i, pitch)
      : rapid
        ? rapidTumblePose(age, i, pitch)
        : tumblePose(age, i, pitch);
    if (p.alpha <= 0) continue;
    ctx.save();
    ctx.translate(x + p.x, y + p.y);
    ctx.rotate(p.rotation);
    ctx.scale(p.scale, p.scale);
    ctx.globalAlpha *= p.alpha;
    ctx.shadowColor = '#303a4c55';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 3;
    tile(-pitch / 2, -pitch / 2, pitch, color, time);
    ctx.restore();
  }
}
