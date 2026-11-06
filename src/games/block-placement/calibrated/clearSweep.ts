// Derived production module; supplied reference files remain unchanged.
/** Native row/column material wipe with drifting filament trails. No source frames. */
export interface ClearSweepConfig {
  enabled: boolean;
  durationSeconds: number;
  direction: 'forward' | 'reverse';
  color: string;
}
const sat = (n: number) => Math.max(0, Math.min(1, n));
const noise = (n: number) => {
  const x = Math.sin(n * 78.233 + 12.9898) * 43758.5453;
  return x - Math.floor(x);
};
export function clearSweepProgress(age: number, duration: number) {
  return sat(age / duration);
}
export function drawClearSweep(
  h: any,
  st: any,
  age: number,
  time: number,
  board: any[][],
  config: ClearSweepConfig,
) {
  if (age < 0 || age > config.durationSeconds + 0.4) return;
  const { ctx, gx, gy, pitch, tile } = h,
    n = board.length,
    size = n * pitch,
    progress = clearSweepProgress(age, config.durationSeconds),
    reverse = config.direction === 'reverse',
    head = progress * size,
    tail = 1 - sat((age - config.durationSeconds) / 0.35);
  // The legal Take already removed these cells; temporarily draw the surviving part of each actual face.
  for (const c of st.clear.cells) {
    if (board[c.row][c.col] != null) continue;
    const horizontal = st.clear.rows.includes(c.row),
      axis = horizontal ? c.col : c.row,
      start = axis * pitch,
      end = start + pitch;
    const lo = reverse ? start : Math.max(start, head),
      hi = reverse ? Math.min(end, size - head) : end;
    if (hi <= lo) continue;
    ctx.save();
    ctx.beginPath();
    if (horizontal) ctx.rect(gx + lo, gy + c.row * pitch, hi - lo, pitch);
    else ctx.rect(gx + c.col * pitch, gy + lo, pitch, hi - lo);
    ctx.clip();
    const color =
      st.placedColors?.[`${c.row},${c.col}`] ??
      st.before.board.cells[c.row][c.col] ??
      st.piece.color;
    tile(gx + c.col * pitch, gy + c.row * pitch, pitch, color, time);
    ctx.restore();
  }
  const axes = [
    ...st.clear.rows.map((n: number) => ({ n, horizontal: true })),
    ...st.clear.cols.map((n: number) => ({ n, horizontal: false })),
  ];
  for (const { n: line, horizontal } of axes) {
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : line * pitch), gy + (horizontal ? line * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    if (reverse) {
      ctx.translate(size, 0);
      ctx.scale(-1, 1);
    }
    const tip = Math.min(size, head),
      begin = -pitch * 0.3;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = tail;
    for (let j = 0; j < 3; j++) {
      const yy = pitch * (j === 0 ? 0.08 : j === 1 ? 0.12 : 0.88),
        g = ctx.createLinearGradient(begin, 0, Math.max(begin + 1, tip), 0);
      g.addColorStop(0, config.color + '00');
      g.addColorStop(0.3, config.color + '88');
      g.addColorStop(0.9, config.color + 'ff');
      g.addColorStop(1, '#f4ffe7');
      ctx.strokeStyle = g;
      ctx.lineWidth = j === 0 ? 4.5 : 3.4;
      ctx.shadowBlur = j === 1 ? 12 : 7;
      ctx.shadowColor = config.color;
      ctx.beginPath();
      const steps = 24;
      for (let k = 0; k <= steps; k++) {
        const u = k / steps,
          x = begin + (tip - begin) * u,
          y = yy + Math.sin(Math.PI * u) * pitch * (j === 1 ? 0.59 : 0.035);
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    if (progress < 1) {
      ctx.shadowBlur = 12;
      ctx.fillStyle = config.color;
      ctx.globalAlpha = tail * 0.75;
      ctx.fillRect(tip - 2, pitch * 0.25, 3, pitch * 0.5);
    }
    for (let k = 0; k < 9; k++) {
      const seed = k + line * 17,
        born = 0.03 + noise(seed) * config.durationSeconds,
        dt = age - born;
      if (dt < 0 || dt > 0.38) continue;
      const x = (born / config.durationSeconds) * size + (noise(seed + 1) - 0.5) * dt * 120,
        y = pitch * (0.2 + noise(seed + 2) * 0.6) + (noise(seed + 3) - 0.5) * dt * 80,
        z = (3 + noise(seed + 4) * 5) * (1 - dt / 0.38);
      ctx.globalAlpha = tail * (1 - dt / 0.38) * 0.7;
      ctx.shadowBlur = 9;
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.arc(x, y, z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
