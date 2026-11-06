// Derived production module; supplied reference files remain unchanged.
function mixColor(hex: string, f: number) {
  const q = hex.match(/[a-f0-9]{2}/gi)?.map((v) => parseInt(v, 16)) ?? [245, 135, 175];
  return (
    '#' +
    q
      .map((v) =>
        Math.round(v + (f > 0 ? 255 - v : v) * f)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const sat = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (x: number) => {
  x = sat(x);
  return x * x * (3 - 2 * x);
};

/** Measured at 60 fps: the fracture reaches the outer cells after the centre. */
export function prismFracturePhase(age: number, distanceInCells: number) {
  const local = age - (0.02 + distanceInCells * 0.033);
  const fractureDuration = Math.max(0.2, 0.27 - distanceInCells * 0.012);
  return {
    local,
    split: smooth(local / fractureDuration),
    motes: sat((local - 0.07) / 0.1) * (1 - smooth((local - 0.35) / 0.47)),
  };
}

export function drawPrismFracture(h: any, st: any, age: number, time: number, board: any[][]) {
  const { ctx, gx, gy, pitch, tile } = h;
  if (age < 0) return;
  const cells = st.clear.cells;
  const cr = cells.reduce((s: number, c: any) => s + c.row, 0) / cells.length;
  const cc = cells.reduce((s: number, c: any) => s + c.col, 0) / cells.length;
  for (const [k, { row, col }] of cells.entries()) {
    if (board[row][col] != null) continue;
    const x = gx + col * pitch,
      y = gy + row * pitch,
      cx = x + pitch / 2,
      cy = y + pitch / 2;
    const color =
      st.before.board.cells[row][col] ?? st.placedColors?.[`${row},${col}`] ?? st.piece.color;
    const tint = h.tintForColor?.(color),
      light = tint ? mixColor(tint, 0.55) : '#ffbbd6',
      base = tint ?? '#f78dbc',
      dark = tint ? mixColor(tint, -0.25) : '#d4598f';
    const { local, split, motes } = prismFracturePhase(age, Math.hypot(row - cr, col - cc));
    if (local <= 0) tile(x, y, pitch, color, time);
    else if (split < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - smooth((split - 0.05) / 0.24);
      tile(x, y, pitch, color, time);
      ctx.restore();
      const triangles = [
        [
          [0, 0],
          [pitch, 0],
          [pitch / 2, pitch / 2],
        ],
        [
          [pitch, 0],
          [pitch, pitch],
          [pitch / 2, pitch / 2],
        ],
        [
          [pitch, pitch],
          [0, pitch],
          [pitch / 2, pitch / 2],
        ],
        [
          [0, pitch],
          [0, 0],
          [pitch / 2, pitch / 2],
        ],
      ];
      for (const points of triangles) {
        const mx = points.reduce((s, p) => s + p[0], 0) / 3,
          my = points.reduce((s, p) => s + p[1], 0) / 3,
          scale = 1 - Math.pow(split, 1.6) * 0.83;
        ctx.save();
        ctx.globalAlpha = 1 - smooth((split - 0.76) / 0.24);
        ctx.translate(x + mx, y + my);
        ctx.scale(scale, scale);
        ctx.translate(-mx, -my);
        ctx.beginPath();
        points.forEach(([a, b], i) => (i ? ctx.lineTo(a, b) : ctx.moveTo(a, b)));
        ctx.closePath();
        ctx.clip();
        tile(0, 0, pitch, color, time);
        ctx.restore();
      }
    }
    // The fragments stay close to their original grid; the reference is not a blast.
    if (motes > 0) {
      for (let j = 0; j < 5; j++) {
        const dx = j === 0 ? 0 : (j % 2 ? -0.25 : 0.25) * pitch,
          dy = j === 0 ? 0 : (j < 3 ? -0.25 : 0.25) * pitch;
        const n = ((k * 13 + j * 7) % 19) / 19,
          drift = sat(local) * 12;
        const scatter = smooth((local - 0.42) / 0.3);
        const px = cx + dx + Math.sin(k + j) * drift * scatter,
          py = cy + dy + local * 9 * scatter;
        const size = (j === 0 ? 36 : 45) * (1 - sat(local) * 0.8) * 1;
        ctx.save();
        ctx.globalAlpha =
          motes *
          (j === 0 ? 0.95 : 0.8) *
          (h.polish ? 0.78 + 0.22 * Math.sin(local * 13 + k) ** 2 : 1);
        ctx.translate(px, py);
        ctx.rotate((j === 0 ? 0 : Math.PI / 4) + Math.sin(k + j) * local * 0.1 * scatter);
        const g = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
        g.addColorStop(0, light);
        g.addColorStop(0.35, base);
        g.addColorStop(1, dark);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(-size / 2, -size / 2, size, size, j === 0 ? 4 : 1);
        ctx.shadowColor = light;
        ctx.shadowBlur = 3;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = (tint ? mixColor(tint, 0.8) : '#ffdfeb') + '88';
        ctx.fillRect(-size / 2 + 2, -size / 2 + 1, size - 4, 2);
        ctx.restore();
        if (h.polish && j === 0) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = motes * 0.35 * (1 - sat(local));
          ctx.shadowColor = light;
          ctx.shadowBlur = 14;
          ctx.fillStyle = tint ? mixColor(tint, 0.92) : '#fff2fb';
          ctx.fillRect(px - 2, py - size * 0.3, 4, size * 0.6);
          ctx.fillRect(px - size * 0.3, py - 2, size * 0.6, 4);
          ctx.restore();
        }
      }
    }
  }
  // Draw AFTER the intact/splitting tiles, otherwise those tiles hide the flash.
  const axes = [
    ...st.clear.rows.map((n: number) => ({ horizontal: true, n })),
    ...st.clear.cols.map((n: number) => ({ horizontal: false, n })),
  ];
  for (const { horizontal, n } of axes) {
    const r = horizontal ? n : 3,
      c = horizontal ? 3 : n,
      tint = h.tintForColor?.(st.before.board.cells[r][c] ?? st.piece.color);
    const beam = tint ? mixColor(tint, 0.25) : '#ff94d0',
      core = tint ? mixColor(tint, 0.86) : '#ffe9f6',
      tailColor = tint ?? '#fb62ae';
    ctx.save();
    ctx.translate(gx + (horizontal ? 0 : n * pitch), gy + (horizontal ? n * pitch : 0));
    if (!horizontal) ctx.transform(0, 1, 1, 0, 0, 0);
    const a = smooth((age - 0.04) / 0.025) * (1 - smooth((age - 0.18) / 0.065));
    const width = pitch * board.length * smooth((age - 0.035) / 0.12),
      left = (pitch * board.length - width) / 2;
    if (a > 0 && width > 1) {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = a * 0.6;
      ctx.shadowColor = tint ?? '#ff89d0';
      ctx.shadowBlur = 35;
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.roundRect(left, pitch * 0.3, width, pitch * 0.4, 20);
      ctx.fill();
      ctx.globalAlpha = a * 0.9;
      ctx.shadowBlur = 15;
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.roundRect(left + 5, pitch * 0.415, Math.max(1, width - 10), pitch * 0.17, 9);
      ctx.fill();
    }
    // A low, broad pink afterglow follows the moving fracture wave.
    const tail = smooth((age - 0.16) / 0.13) * (1 - smooth((age - 0.55) / 0.42));
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = tail * 0.34;
    const g = ctx.createLinearGradient(0, 0, 0, pitch);
    g.addColorStop(0, tailColor + '00');
    g.addColorStop(0.5, tailColor);
    g.addColorStop(1, tailColor + '00');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, pitch * board.length, pitch);
    ctx.restore();
  }

  if (age < 0.8)
    drawPrismCombo(
      ctx,
      st.after.combo || 1,
      age,
      gx + (pitch * board.length) / 2,
      gy + pitch * 5.12,
    );
  if (st.after.board.cells.every((r: any[]) => r.every((v) => v == null)) && age > 0.2 && age < 1.6)
    drawPrismAllClear(ctx, gx, gy, pitch, board.length, age);
}
function drawPrismAllClear(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  pitch: number,
  n: number,
  age: number,
) {
  const cx = gx + (pitch * n) / 2,
    cy = gy + (pitch * n) / 2,
    a = sat((age - 0.2) / 0.14) * (1 - sat((age - 0.94) / 0.27));
  ctx.save();
  ctx.globalAlpha = a;
  const g = ctx.createRadialGradient(cx, cy, 20, cx, cy, pitch * n * 0.65);
  g.addColorStop(0, '#0d8cf733');
  g.addColorStop(1, '#077def00');
  ctx.fillStyle = g;
  ctx.fillRect(gx, gy, pitch * n, pitch * n);
  for (const sign of [-1, 1]) {
    const yy = cy + sign * pitch * n * (0.46 + (age - 0.45) * 0.055);
    ctx.save();
    ctx.shadowColor = '#26cfff';
    ctx.shadowBlur = 32;
    ctx.strokeStyle = '#a6faff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gx, yy);
    ctx.lineTo(gx + pitch * n, yy);
    ctx.stroke();
    ctx.restore();
  }
  ctx.font = '900 116px Arial,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.shadowColor = '#12eccc';
  ctx.shadowBlur = 23;
  ctx.strokeStyle = '#20edce';
  ctx.lineWidth = 13;
  ctx.strokeText('ALL CLEAR', cx, cy);
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#f4ffb5';
  ctx.lineWidth = 4;
  ctx.strokeText('ALL CLEAR', cx, cy);
  const fill = ctx.createLinearGradient(0, cy - 50, 0, cy + 50);
  fill.addColorStop(0, '#f0ffff');
  fill.addColorStop(0.45, '#5effed');
  fill.addColorStop(1, '#03d3ae');
  ctx.fillStyle = fill;
  ctx.fillText('ALL CLEAR', cx, cy);
  for (let j = 0; j < 28; j++) {
    const x = gx + ((j * 127.1) % (pitch * n)),
      y = gy + ((j * 213.7 + age * 35) % (pitch * n)),
      z = 3 + (j % 4) * 1.4;
    ctx.globalAlpha = a * (0.18 + (j % 5) * 0.15);
    ctx.shadowBlur = 13;
    ctx.shadowColor = '#42fff3';
    ctx.fillStyle = j % 3 ? '#46eccd' : '#fff9bb';
    ctx.beginPath();
    ctx.arc(x, y, z, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPrismCombo(
  ctx: CanvasRenderingContext2D,
  combo: number,
  age: number,
  x: number,
  y: number,
) {
  const key = [
    [0, 0],
    [0.1, 0.5],
    [0.2, 1],
    [0.3, 0.89],
    [0.4, 0.84],
    [0.5, 0.2],
    [0.57, 0],
  ];
  let scale = 0;
  for (let i = 1; i < key.length; i++) {
    if (age <= key[i][0]) {
      const a = key[i - 1],
        b = key[i],
        u = sat((age - a[0]) / (b[0] - a[0]));
      scale = a[1] + (b[1] - a[1]) * u;
      break;
    }
  }
  const digit = smooth((age - 0.09) / 0.1) * (1 - smooth((age - 0.57) / 0.18));
  ctx.save();
  ctx.translate(x, y);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const draw = (word: string, xx: number, size: number, fill: CanvasGradient) => {
    ctx.font = `italic 900 ${size}px "Arial Rounded MT Bold",Arial,sans-serif`;
    ctx.shadowColor = '#042267';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 9;
    ctx.strokeStyle = '#154ba9';
    ctx.lineWidth = 21;
    ctx.strokeText(word, xx, 0);
    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;
    ctx.strokeStyle = '#478ff5';
    ctx.lineWidth = 10;
    ctx.strokeText(word, xx, 0);
    ctx.fillStyle = fill;
    ctx.fillText(word, xx, 0);
  };
  if (scale > 0) {
    ctx.save();
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, scale * 3);
    const g = ctx.createLinearGradient(0, -60, 0, 70);
    g.addColorStop(0, '#f6ffff');
    g.addColorStop(1, '#a9eafa');
    draw('Combo', -70, 130, g);
    ctx.restore();
  }
  if (digit > 0) {
    ctx.save();
    ctx.translate(235, 0);
    ctx.scale(digit, digit);
    ctx.globalAlpha = Math.min(1, digit * 3);
    const g = ctx.createLinearGradient(0, -85, 0, 70);
    g.addColorStop(0, '#ffff82');
    g.addColorStop(0.5, '#ffed34');
    g.addColorStop(1, '#f9af19');
    draw(String(combo), 0, 176, g);
    ctx.restore();
  }
  ctx.restore();
}
