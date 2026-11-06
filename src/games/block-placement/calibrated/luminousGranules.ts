// Derived production module; supplied reference files remain unchanged.
const sat = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  v = sat(v);
  return v * v * (3 - 2 * v);
};
const rnd = (v: number) => {
  const x = Math.sin(v * 127.1 + 31.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Measured phases are independent of frame rate and never alter replay occupancy. */
export function luminousGranulePhase(age: number) {
  return {
    rim: smooth((age + 0.2) / 0.08) * (1 - smooth((age - 0.25) / 0.16)),
    ring: age < 0 ? 0 : smooth((age + 0.025) / 0.05) * (1 - smooth((age - 0.035) / 0.14)),
    body: smooth((age - 0.04) / 0.09) * (1 - smooth((age - 0.19) / 0.2)),
    particles: smooth((age - 0.11) / 0.15) * (1 - smooth((age - 0.56) / 0.46)),
  };
}
export function luminousGranulePose(age: number, index: number, pitch: number) {
  const layer = index % 9,
    seed = index * 23 + 7,
    born = layer > 4 ? 0.09 : layer > 2 ? 0.1 : 0.11,
    local = Math.max(0, age - born - rnd(seed) * (layer < 5 ? 0.045 : 0.09));
  const size =
    pitch *
    (layer < 3
      ? 0.19 + rnd(seed + 2) * 0.2
      : layer < 5
        ? 0.08 + rnd(seed + 2) * 0.11
        : 0.012 + rnd(seed + 2) * 0.029);
  const drift = smooth(local / 0.65),
    wave = Math.sin(local * 5 + seed) * local;
  return {
    x:
      pitch * (0.1 + rnd(seed + 3) * 0.8) +
      (rnd(seed + 4) - 0.5) * pitch * 0.34 * drift +
      wave * pitch * 0.025,
    y:
      pitch * (0.1 + rnd(seed + 5) * 0.8) +
      (rnd(seed + 6) - 0.55) * pitch * 0.26 * drift +
      local * local * pitch * 0.04,
    size: size * (1 - 0.12 * smooth(local / 0.7)),
    rotation: (rnd(seed + 7) - 0.5) * 0.1,
    alpha:
      smooth(local / 0.085) *
      (1 - smooth((age - 0.57 - rnd(seed + 8) * 0.08) / 0.35)) *
      (layer < 3 ? 1 : layer < 5 ? 0.84 : 0.48),
    hollow: layer < 3 && index % 3 !== 0,
    layer,
  };
}
/** A fast outward first wave is separate from the persistent small-grain layer. */
export function luminousGranuleImpulse(
  age: number,
  index: number,
  pitch: number,
  radialX: number,
  radialY: number,
) {
  const layer = index % 9,
    seed = index * 19 + 47,
    local = Math.max(0, age - 0.13 - rnd(seed) * 0.055);
  if (layer >= 5) return { x: 0, y: 0, size: 1, rotation: 0 };
  const length = Math.max(0.15, Math.hypot(radialX, radialY)),
    wave = 1 - Math.exp(-local / 0.105);
  const speed = pitch * (layer < 3 ? 0.65 + rnd(seed + 1) * 0.65 : 0.25 + rnd(seed + 1) * 0.35);
  return {
    x: (radialX / length) * speed * wave,
    y: (radialY / length) * speed * wave + pitch * local * local * 0.16,
    size: 1 + 0.34 * Math.sin(Math.min(1, local / 0.25) * Math.PI),
    rotation: (rnd(seed + 2) - 0.5) * 0.22 * wave,
  };
}
export function luminousGranuleImpact(age: number) {
  return smooth((age - 0.025) / 0.035) * (1 - smooth((age - 0.12) / 0.14));
}
/** Gradient line light and fine grains are limited to the actual cleared cells. */
export function drawLuminousGranules(h: any, st: any, age: number, time: number, board: any[][]) {
  if (age < -0.2 || age > 1.02) return;
  const { ctx, gx, gy, pitch } = h,
    ph = luminousGranulePhase(age),
    width = board[0].length * pitch,
    height = board.length * pitch;
  if (ph.rim > 0) {
    ctx.save();
    ctx.globalAlpha = ph.rim * 0.95;
    ctx.strokeStyle = '#99f8f8';
    ctx.shadowColor = '#42effb';
    ctx.shadowBlur = 14;
    ctx.lineWidth = 2.8;
    ctx.strokeRect(gx - 2, gy - 2, width + 4, height + 4);
    ctx.restore();
  }
  if (age < 0) return;
  const visible = st.clear.cells.filter((c: any) => board[c.row][c.col] === null);
  if (!visible.length) return;
  const rows = st.clear.rows.length ? st.clear.rows : visible.map((c: any) => c.row),
    cols = st.clear.cols.length ? st.clear.cols : visible.map((c: any) => c.col);
  const r0 = Math.min(...rows),
    r1 = Math.max(...rows),
    c0 = Math.min(...cols),
    c1 = Math.max(...cols),
    cx = gx + ((c0 + c1 + 1) * pitch) / 2,
    cy = gy + ((r0 + r1 + 1) * pitch) / 2,
    w = Math.min(4, c1 - c0 + 1) * pitch,
    hh = Math.min(4, r1 - r0 + 1) * pitch,
    x0 = cx - w / 2,
    y0 = cy - hh / 2;
  ctx.save();
  ctx.beginPath();
  for (const c of visible) ctx.rect(gx + c.col * pitch, gy + c.row * pitch, pitch, pitch);
  ctx.clip();
  // Four soft ribbons surround the intersection first. Their centers stay bright,
  // their inner and outer edges disappear gradually, with no opaque panel fill.
  if (ph.ring > 0) {
    for (const side of [0, 1, 2, 3]) {
      const horizontal = side < 2,
        center = horizontal
          ? side === 0
            ? y0 + pitch * 0.4
            : y0 + hh - pitch * 0.4
          : side === 2
            ? x0 + pitch * 0.4
            : x0 + w - pitch * 0.4,
        half = pitch * 0.7;
      const grad = ctx.createLinearGradient(
        horizontal ? 0 : center - half,
        horizontal ? center - half : 0,
        horizontal ? 0 : center + half,
        horizontal ? center + half : 0,
      );
      for (const [p, a] of [
        [0, 0],
        [0.24, 0.16],
        [0.42, 0.64],
        [0.5, 0.9],
        [0.58, 0.64],
        [0.76, 0.16],
        [1, 0],
      ])
        grad.addColorStop(p, `rgba(255,211,104,${a})`);
      ctx.globalAlpha = ph.ring;
      ctx.fillStyle = grad;
      if (horizontal) ctx.fillRect(x0 - pitch * 0.25, center - half, w + pitch * 0.5, half * 2);
      else ctx.fillRect(center - half, y0 - pitch * 0.25, half * 2, hh + pitch * 0.5);
    }
  }
  if (ph.body > 0) {
    const spread = smooth((age - 0.035) / 0.2),
      bw = w + (width - w) * spread,
      bh = hh + (height - hh) * spread;
    for (const horizontal of [true, false]) {
      const lines = horizontal ? rows : cols,
        len = horizontal ? bw : bh,
        origin = (horizontal ? cx : cy) - len / 2;
      for (const axis of lines) {
        const center = (horizontal ? gy : gx) + (axis + 0.5) * pitch,
          half = pitch * 0.49;
        const acrossSize = horizontal ? bh : bw,
          acrossCenter = horizontal ? cy : cx,
          reveal = smooth(
            (acrossSize / 2 - Math.abs(center - acrossCenter) + pitch * 0.28) / (pitch * 0.55),
          );
        if (reveal <= 0) continue;
        ctx.save();
        ctx.beginPath();
        if (horizontal) ctx.roundRect(origin, center - half, len, half * 2, pitch * 0.27);
        else ctx.roundRect(center - half, origin, half * 2, len, pitch * 0.27);
        ctx.clip();
        const grad = ctx.createLinearGradient(
          horizontal ? 0 : center - half,
          horizontal ? center - half : 0,
          horizontal ? 0 : center + half,
          horizontal ? center + half : 0,
        );
        for (const [p, a] of [
          [0, 0],
          [0.08, 0.11],
          [0.22, 0.28],
          [0.48, 0.46],
          [0.68, 0.3],
          [0.9, 0.1],
          [1, 0],
        ])
          grad.addColorStop(p, `rgba(255,214,113,${a})`);
        ctx.globalAlpha = sat(ph.body * reveal * (1.14 + 0.14 * rnd(axis + 3)));
        ctx.fillStyle = grad;
        if (horizontal) ctx.fillRect(origin, center - half, len, half * 2);
        else ctx.fillRect(center - half, origin, half * 2, len);
        // Soft end caps retain the source's per-line depth without gold capsules.
        const along = ctx.createLinearGradient(
          horizontal ? origin : 0,
          horizontal ? 0 : origin,
          horizontal ? origin + len : 0,
          horizontal ? 0 : origin + len,
        );
        for (const [p, a] of [
          [0, 0.05],
          [0.025, 0.5],
          [0.085, 0.3],
          [0.16, 0.04],
          [0.4, 0],
          [0.5, 0.12],
          [0.6, 0],
          [0.84, 0.04],
          [0.915, 0.3],
          [0.975, 0.5],
          [1, 0.05],
        ])
          along.addColorStop(p, `rgba(255,222,131,${a})`);
        ctx.fillStyle = along;
        if (horizontal) ctx.fillRect(origin, center - half, len, half * 2);
        else ctx.fillRect(center - half, origin, half * 2, len);
        ctx.restore();
      }
    }
    const core = ctx.createRadialGradient(cx, cy, pitch * 0.1, cx, cy, pitch * 2.8);
    core.addColorStop(0, 'rgba(255,217,116,.4)');
    core.addColorStop(0.4, 'rgba(255,210,96,.23)');
    core.addColorStop(1, 'rgba(255,210,96,0)');
    ctx.globalAlpha = ph.body;
    ctx.fillStyle = core;
    ctx.fillRect(cx - pitch * 2.8, cy - pitch * 2.8, pitch * 5.6, pitch * 5.6);
    ctx.globalAlpha = ph.body * 0.13;
    ctx.strokeStyle = '#fff5d3';
    ctx.lineWidth = 0.8;
    for (const c of visible)
      ctx.strokeRect(gx + c.col * pitch + 2, gy + c.row * pitch + 2, pitch - 4, pitch - 4);
  }
  // Fast, broad warm-white core and two expanding light axes create the strike.
  // Restrict them to the true clear mask; a softer afterglow bridges into grains.
  const impact = luminousGranuleImpact(age),
    after = smooth((age - 0.065) / 0.06) * (1 - smooth((age - 0.27) / 0.18));
  const axisSpread = smooth((age - 0.035) / 0.1),
    axisWidth = pitch * 2 + (width - pitch * 2) * axisSpread,
    axisHeight = pitch * 2 + (height - pitch * 2) * axisSpread;
  for (const [rx, ry, strength] of [
    [axisWidth * 0.54, pitch * (0.64 + 0.34 * axisSpread), impact * 0.84 + after * 0.15],
    [pitch * (0.64 + 0.34 * axisSpread), axisHeight * 0.54, impact * 0.84 + after * 0.15],
    [
      pitch * (1.25 + 0.5 * axisSpread),
      pitch * (1.25 + 0.5 * axisSpread),
      impact * 0.76 + after * 0.2,
    ],
  ]) {
    if (strength <= 0) continue;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = sat(strength);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(255,250,217,.95)');
    g.addColorStop(0.25, 'rgba(255,239,182,.85)');
    g.addColorStop(0.55, 'rgba(255,213,112,.48)');
    g.addColorStop(0.82, 'rgba(255,182,65,.13)');
    g.addColorStop(1, 'rgba(255,176,52,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  ctx.restore();
  for (const [k, c] of visible.entries()) {
    const x = gx + c.col * pitch,
      y = gy + c.row * pitch,
      dist = Math.hypot(c.row - (board.length - 1) / 2, c.col - (board[0].length - 1) / 2),
      depth = 0.62 + 0.38 * (1 - sat(dist / 5));
    for (let j = 0; j < 9; j++) {
      const p = luminousGranulePose(age, k * 9 + j, pitch);
      if (p.alpha <= 0) continue;
      const impulse = luminousGranuleImpulse(
        age,
        k * 9 + j,
        pitch,
        (x + p.x - cx) / pitch,
        (y + p.y - cy) / pitch,
      );
      ctx.save();
      ctx.translate(x + p.x + impulse.x, y + p.y + impulse.y);
      ctx.rotate(p.rotation + impulse.rotation);
      ctx.globalAlpha = p.alpha * depth;
      const s = p.size * (j < 3 ? depth : 1) * impulse.size;
      ctx.shadowColor = '#ffd760';
      ctx.shadowBlur = j < 5 ? 4 : 1.5;
      ctx.lineWidth = 1.3;
      if (p.hollow) {
        ctx.strokeStyle = '#f9d666';
        ctx.strokeRect(-s / 2, -s / 2, s, s);
      } else {
        const grad = ctx.createLinearGradient(-s / 2, -s / 2, s / 2, s / 2);
        grad.addColorStop(0, '#fff2ad');
        grad.addColorStop(0.38, '#f8d667');
        grad.addColorStop(1, '#dca641');
        ctx.fillStyle = grad;
        ctx.fillRect(-s / 2, -s / 2, s, s);
        if (j < 3) {
          ctx.fillStyle = 'rgba(153,96,16,.38)';
          ctx.beginPath();
          ctx.moveTo(s / 2, -s / 2);
          ctx.lineTo(s * 0.65, -s * 0.35);
          ctx.lineTo(s * 0.65, s * 0.65);
          ctx.lineTo(s / 2, s / 2);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = 'rgba(255,253,207,.55)';
          ctx.fillRect(-s / 2, -s / 2, s, Math.max(1, s * 0.08));
        }
      }
      if (j === 7 && k % 4 === 0) {
        const blink = Math.pow(Math.max(0, Math.sin(age * 17 + k * 1.7)), 8);
        ctx.globalAlpha *= blink;
        ctx.fillStyle = '#fff6d6';
        ctx.fillRect(-s * 0.12, -s * 1.4, s * 0.24, s * 2.8);
        ctx.fillRect(-s * 1.1, -s * 0.12, s * 2.2, s * 0.24);
      }
      ctx.restore();
    }
  }
}
